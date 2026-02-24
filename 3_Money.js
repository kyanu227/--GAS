// ファイル名: 3_Money.gs

function getMoneySS() {
  if (typeof MONEY_CONFIG === 'undefined' || !MONEY_CONFIG.SPREADSHEET_ID) {
    throw new Error("金銭管理シートのIDがConfigに設定されていません");
  }
  return SpreadsheetApp.openById(MONEY_CONFIG.SPREADSHEET_ID);
}

function getYearlySheet(ss, baseName, dateObj) {
  var year = dateObj.getFullYear();
  var sheetName = baseName + year;
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (baseName === MONEY_CONFIG.SHEET_LOG) {
      sheet.appendRow(["UUID", "日時", "担当者", "作業", "タンクID", "スコア", "立替金", "立替詳細", "備考"]);
    } else if (baseName === MONEY_CONFIG.SHEET_ORDER) {
      sheet.appendRow(["UUID", "日時", "担当者", "品名", "数量", "単価(目安)", "合計(目安)", "ステータス", "備考"]);
    }
  }
  return sheet;
}

function getRepairOptions() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("repair_options");
  if (cached) return JSON.parse(cached);

  var ss = getMoneySS();
  var sheetName = (MONEY_CONFIG && MONEY_CONFIG.SHEET_REPAIR) ? MONEY_CONFIG.SHEET_REPAIR : "M_設定_修理項目";
  var sheet = ss.getSheetByName(sheetName);
  
  if (!sheet) {
    return [{ name: "バルブ交換", price: 0 }, { name: "再塗装", price: 0 }];
  }

  var data = sheet.getDataRange().getValues();
  var options = [];
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    var price = (data[i].length > 1) ? (Number(data[i][1]) || 0) : 0;
    if (name) options.push({ name: String(name), price: price });
  }
  cache.put("repair_options", JSON.stringify(options), 43200);
  return options;
}

function getPriceMasterWithCache() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("price_master_data");
  if (cached) return JSON.parse(cached);

  var ss = getMoneySS();
  var sheet = ss.getSheetByName(MONEY_CONFIG.SHEET_PRICE);
  var data = [];
  if (sheet) data = sheet.getDataRange().getValues();
  
  if (data.length > 0) {
    cache.put("price_master_data", JSON.stringify(data), 43200);
  }
  return data;
}

/**
 * ★報酬計算ロジック (改良版)
 * あいまい検索に対応し、完了・済みを取り除いてマスタ検索します。
 */
function calculateRewardInMemory(action, rankName, priceData) {
  var searchAction = String(action).trim();
  var targetRow = null;

  // 1. 完全一致
  for (var i = 1; i < priceData.length; i++) {
    if (String(priceData[i][0]).trim() === searchAction) {
      targetRow = priceData[i];
      break;
    }
  }

  // 2. あいまい検索 (末尾の済み・完了を削除して再検索)
  if (!targetRow) {
    var normalized = searchAction.replace(/(済み|完了)$/, "");
    if (normalized !== searchAction) {
      for (var i = 1; i < priceData.length; i++) {
        if (String(priceData[i][0]).trim() === normalized) {
          targetRow = priceData[i];
          break;
        }
      }
    }
  }

  var result = { basePrice: 0, score: 0, rankAdd: 0, total: 0 };
  
  if (!targetRow) return result; 

  result.basePrice = Number(targetRow[1]) || 0;
  result.score     = Number(targetRow[2]) || 0;
  
  var rankColIndex = 7;
  if (rankName === 'プラチナ') rankColIndex = 3;
  else if (rankName === 'ゴールド') rankColIndex = 4;
  else if (rankName === 'シルバー') rankColIndex = 5;
  else if (rankName === 'ブロンズ') rankColIndex = 6;

  if (targetRow.length > rankColIndex) {
    result.rankAdd = Number(targetRow[rankColIndex]) || 0;
  }
  
  result.total = result.basePrice + result.rankAdd;
  return result;
}

function recordMoneyLog(logDataList) {
  if (!logDataList || logDataList.length === 0) return;

  var ss = getMoneySS();
  var priceData = getPriceMasterWithCache();

  var logsByYear = {};

  logDataList.forEach(function(d) {
    var dateObj = new Date(d.date);
    var year = dateObj.getFullYear();
    if (!logsByYear[year]) logsByYear[year] = [];

    // IDはMaintenance側で整形済みだが、念のためここでも通す
    var rawId = String(d.tankId);
    var formattedId = (typeof formatDisplayId === 'function') ? formatDisplayId(rawId) : rawId;

    var reward = calculateRewardInMemory(d.action, d.rank, priceData);
    
    logsByYear[year].push([
      d.uuid,
      d.date,
      d.staff,
      d.action,
      formattedId,
      reward.score,
      d.repairCost || 0,
      d.repairDetail || "",
      d.note || ""
    ]);
  });

  Object.keys(logsByYear).forEach(function(year) {
    var dummyDate = new Date(year, 0, 1);
    var sheet = getYearlySheet(ss, MONEY_CONFIG.SHEET_LOG, dummyDate);
    var rows = logsByYear[year];
    
    if (rows.length > 0) {
      var lastRow = sheet.getLastRow();
      sheet.getRange(lastRow + 1, 1, rows.length, rows[0].length).setValues(rows);
    }
  });
}

function calculateReward(action, rankName) {
  var priceData = getPriceMasterWithCache();
  return calculateRewardInMemory(action, rankName, priceData);
}