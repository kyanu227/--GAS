// ■■■ Feature_Operations.gs : 現場操作 ■■■

// 操作ルール定義: 許容する直前ステータスと操作後ステータス
const OP_RULES = {
  '貸出': { allowedPrev: ['充填済み', '保管中'], nextStatus: '貸出中' },
  '自社利用': { allowedPrev: ['充填済み', '保管中'], nextStatus: '自社利用中' },
  '返却': { allowedPrev: ['貸出中', '未返却', '自社利用中'], nextStatus: '空' },
  '充填': { allowedPrev: ['空'], nextStatus: '充填済み' },
  '破損報告': { allowedPrev: [], nextStatus: '破損' },
  '修理済み': { allowedPrev: ['破損', '不良', '故障'], nextStatus: '空' }
};

// 新規登録直後など、ステータス不整合チェックを免除する特殊ステータス
const SPECIAL_STATUSES = ["", "新規登録", "不明", "メンテナンス完了"];

// ※ clearMasterCaches は 2_Utils.gs に定義済み

function getOperationsInitData() {
  var repairOpts = [];
  try { repairOpts = getRepairOptions(); } catch (e) { console.error("修理OP取得失敗", e); }

  // 1. 貸出先リスト
  var activeDestList = [];
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.DEST) ? SHEET_NAMES.DEST : 'M_設定_貸出先';
    var sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var name = data[i][0];
        var status = (data[i].length > 3) ? data[i][3] : "";
        if (name && status !== '停止' && String(name).indexOf('【停止】') !== 0) {
          activeDestList.push(name);
        }
      }
    }
  } catch (e) {
    console.error("貸出先リスト取得エラー", e);
    activeDestList = getListWithCache('貸出先リスト', 3600);
  }

  // 2. タンクID Prefix
  var prefixes = getTankPrefixesWithCache();

  // 3. 全タンクの現在の状態と場所（入力時の事前チェック用）
  var tankMap = getAllTankStatusesWithCache(false);

  return {
    destList: activeDestList,
    repairOptions: repairOpts,
    prefixes: prefixes,
    tankMap: tankMap
  };
}

function getAllTankStatusesWithCache(forceRefresh) {
  var cacheKey = "ALL_TANK_STATUS_MAP";
  var cache = CacheService.getScriptCache();

  if (!forceRefresh) {
    var cached = cache.get(cacheKey);
    if (cached) return JSON.parse(cached);
  }

  var map = {};
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        // A列(ID), B列(状態), C列(場所/貸出先)
        var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
        for (var i = 0; i < data.length; i++) {
          var id = normalizeId(data[i][0]);
          var status = String(data[i][1]);
          var loc = String(data[i][2]);

          if (id) {
            map[id] = { status: status, loc: loc };
          }
        }
      }
    }
    // 最大6時間キャッシュ
    cache.put(cacheKey, JSON.stringify(map), 21600);
  } catch (e) {
    console.error("全タンクステータス取得エラー", e);
  }
  return map;
}

function getTankPrefixesWithCache() {
  var cacheKey = "TANK_PREFIXES";
  var cache = CacheService.getScriptCache();
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var list = [];
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      var lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        var prefixSet = {};
        for (var i = 0; i < data.length; i++) {
          var id = String(data[i][0]);
          if (!id) continue;
          var match = id.match(/^([A-Z]+)/);
          if (match) prefixSet[match[1]] = true;
        }
        list = Object.keys(prefixSet).sort();
      }
    }
  } catch (e) { console.error("Prefix取得エラー", e); }

  if (list.length === 0) list = ["A", "B", "C", "D", "E", "F", "G", "H"];
  cache.put(cacheKey, JSON.stringify(list), 21600);
  return list;
}

function submitOperations(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    return { success: false, message: "他ユーザーが処理中のため、少し待ってから再試行してください。", successIds: [], failedItems: [] };
  }

  try {
    var action = (data.action || "").trim();
    var items = data.items;

    // クライアントからパスコードを受け取る
    var userPasscode = data.userPasscode || "";

    if (!items || items.length === 0) {
      return { success: false, message: "送信データが空です", successIds: [], failedItems: [] };
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sheet = ss.getSheetByName(sheetName);
    var lastRow = sheet.getLastRow();

    // ★重要: I列(種別)を守るため、9列目まで読み込む
    var lastCol = sheet.getLastColumn();
    var fetchCols = (lastCol >= 9) ? 9 : (lastCol >= 8 ? 8 : 7);

    var masterData = (lastRow > 0) ? sheet.getRange(1, 1, lastRow, fetchCols).getValues() : [];

    var idMap = {};
    for (var i = 1; i < masterData.length; i++) {
      var nId = normalizeId(masterData[i][0]);
      if (nId) idMap[nId] = i;
    }

    var preLoadedData = {
      sheet: sheet,
      data: masterData,
      idMap: idMap
    };

    var checkResult = validateOperations(items, action, preLoadedData);
    var validItems = checkResult.validItems;
    var failedItems = checkResult.failedItems;

    if (validItems.length === 0) {
      return {
        success: false,
        message: "送信できるタンクがありません",
        successIds: [],
        failedItems: failedItems,
        totalCount: items.length
      };
    }

    // 操作実行者の特定 (Google優先 -> パスコード)
    var userInfo = getUserInfo(getSafeUserEmail(), userPasscode);
    var identifiedStaffName = userInfo.name;

    var prevStatusMap = {};
    validItems.forEach(function (item) {
      var nId = normalizeId(item.id);
      var rIndex = idMap[nId];
      if (rIndex !== undefined) {
        prevStatusMap[item.id] = masterData[rIndex][1];
      }
    });

    var processData = {
      action: action,
      items: validItems,
      destination: data.destination,
      isUnused: data.isUnused,
      isDefect: data.isDefect,
      repairCost: data.repairCost,
      repairDetail: data.repairDetail
    };

    // writeToSheetに特定された担当者名を渡す
    var writeResult;
    switch (action) {
      case '貸出': writeResult = processLend(processData, preLoadedData, identifiedStaffName); break;
      case '自社利用': writeResult = processCompanyUse(processData, preLoadedData, identifiedStaffName); break;
      case '返却': writeResult = processReturn(processData, preLoadedData, identifiedStaffName); break;
      case '充填': writeResult = processFill(processData, preLoadedData, identifiedStaffName); break;
      case '破損報告': writeResult = processDamageReport(processData, preLoadedData, identifiedStaffName); break;
      case '修理済み': writeResult = processRepair(processData, preLoadedData, identifiedStaffName); break;
      default:
        writeResult = {
          success: false,
          message: "システムエラー: 指示された操作 [" + action + "] が不明です",
          successIds: [],
          failedItems: items.map(i => ({ id: i.id, reason: "操作コマンド不一致" }))
        };
    }

    if (writeResult.successIds && writeResult.successIds.length > 0) {
      try {
        var moneyLogs = [];
        var now = new Date();
        var successMap = {};
        writeResult.successIds.forEach(function (sid) { successMap[sid] = true; });

        validItems.forEach(function (item) {
          if (successMap[item.id]) {
            var moneyLogAction = action;
            var oldStatus = prevStatusMap[item.id];
            if (action === '返却' && oldStatus === '自社利用中') {
              moneyLogAction = '自社返却';
            }

            moneyLogs.push({
              uuid: Utilities.getUuid(),
              date: now,
              staff: identifiedStaffName,
              rank: userInfo.rank,
              action: moneyLogAction,
              tankId: formatDisplayId(item.id),
              note: item.note,
              repairCost: (action === '修理済み') ? data.repairCost : 0,
              repairDetail: (action === '修理済み') ? data.repairDetail : ""
            });
          }
        });
        recordMoneyLog(moneyLogs);
      } catch (e) {
        console.error("金銭ログ記録エラー: " + e.toString());
      }

      // 場所やステータスが変更された可能性があるため、キャッシュを破棄
      if (['貸出', '自社利用', '返却', '充填', '破損報告', '修理済み'].indexOf(action) !== -1) {
        CacheService.getScriptCache().remove("ALL_TANK_STATUS_MAP");
      }
    }

    var finalFailedItems = failedItems.concat(writeResult.failedItems || []);
    var finalSuccessIds = writeResult.successIds || [];
    var isTotalSuccess = (finalSuccessIds.length > 0);

    return {
      success: isTotalSuccess,
      message: writeResult.message || (finalSuccessIds.length + "件成功"),
      successIds: finalSuccessIds,
      failedItems: finalFailedItems,
      totalCount: items.length
    };

  } catch (e) {
    console.error("System Error: " + e.toString());
    return { success: false, message: "エラーが発生しました: " + e.message, successIds: [], failedItems: [] };
  } finally {
    lock.releaseLock();
  }
}

function validateOperations(items, action, preLoadedData) {
  var validItems = [];
  var failedItems = [];
  var rule = OP_RULES[action];
  if (!rule) return { validItems: items, failedItems: [] };

  var masterData = preLoadedData.data;
  var idMap = preLoadedData.idMap;

  items.forEach(function (item) {
    var rawId = item.id;
    var nId = normalizeId(rawId);
    var rowIndex = idMap[nId];

    if (rowIndex === undefined) {
      failedItems.push({ id: rawId, reason: "ID未登録" });
    } else {
      var currentStatus = String(masterData[rowIndex][1]);
      var isSpecial = SPECIAL_STATUSES.includes(currentStatus);
      if (!isSpecial && rule.allowedPrev.length > 0 && rule.allowedPrev.indexOf(currentStatus) === -1) {
        failedItems.push({ id: rawId, reason: `ステータス不整合 (現在: ${currentStatus})` });
      } else {
        validItems.push(item);
      }
    }
  });
  return { validItems: validItems, failedItems: failedItems };
}

// ----------------------------------------------------
// 操作別の個別処理関数
// writeToSheet の第7引数: 履歴ログのI列(直前場所/取引先)に記録する値
//   - 貸出: 貸出先名を渡す
//   - 返却・充填: null を渡す → writeToSheet が現在の場所を自動取得
// ----------------------------------------------------

function processLend(data, preLoadedData, staffName) {
  if (!data.destination) return { success: false, message: "貸出先未選択", failedItems: [], successIds: [] };
  return writeToSheet(data.items, '貸出中', data.destination, '貸出', preLoadedData, staffName, data.destination);
}

function processReturn(data, preLoadedData, staffName) {
  var newStatus = '空';
  var logAction = '返却';
  if (data.isDefect) {
    logAction = '返却(未充填)';
  } else if (data.isUnused) {
    newStatus = '充填済み';
    logAction = '未使用返却';
  }
  return writeToSheet(data.items, newStatus, '倉庫', logAction, preLoadedData, staffName, null);
}

function processFill(data, preLoadedData, staffName) {
  return writeToSheet(data.items, '充填済み', '倉庫', '充填', preLoadedData, staffName, null);
}

function processRepair(data, preLoadedData, staffName) {
  return writeToSheet(data.items, '空', '倉庫', '修理済み', preLoadedData, staffName, null);
}

