// ■■■ Feature_Maintenance.gs : メンテナンス業務ロジック ■■■

function getMaintenanceList(mode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.STATUS);
  var data = sheet.getDataRange().getValues();
  var list = [];
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // 設定取得
  var alertMonths = NOTIFY_CONFIG.ALERT_MONTHS;
  var limitDate = new Date();
  limitDate.setMonth(today.getMonth() + alertMonths);

  for (var i = 1; i < data.length; i++) {
    var id = data[i][0];
    var displayId = (typeof formatDisplayId === 'function') ? formatDisplayId(id) : id;
    var status = data[i][1];
    var nextInspDate = data[i][4]; 
    var note = data[i][5];         

    if (mode === '修理済み' && (status === '破損' || status === '不良' || status === '故障')) {
      list.push({ id: displayId, note: note, status: status });
    }
    else if (mode === '耐圧検査完了') {
      if (status === '廃棄') continue;
      if (Object.prototype.toString.call(nextInspDate) === "[object Date]" && !isNaN(nextInspDate)) {
        if (nextInspDate <= limitDate) {
          var dateStr = Utilities.formatDate(nextInspDate, Session.getScriptTimeZone(), 'yyyy/MM/dd');
          var statusLabel = (nextInspDate < today) ? "●期限切" : "あと" + Math.floor((nextInspDate - today) / (1000 * 60 * 60 * 24 * 30)) + "ヶ月";
          list.push({ id: displayId, note: statusLabel + " (" + dateStr + ")", status: status });
        }
      }
    }
  }
  return list;
}

function submitMaintenance(data) {
  var rawItems = data.items;
  var mode = data.mode;
  var userPasscode = data.userPasscode || "";

  var items = rawItems.map(function(idStr) {
    return { id: idStr, note: "" };
  });

  var staffInfo = (typeof getUserInfo === 'function') ? getUserInfo(Session.getActiveUser().getEmail(), userPasscode) : {name: "不明", rank: "レギュラー"};
  var identifiedStaffName = staffInfo.name;
  var identifiedStaffRank = staffInfo.rank || "レギュラー";

  var newStatus = '空';
  var newLocation = '倉庫';
  var actionName = mode;

  if (mode === '耐圧検査完了') {
    updateInspectionDate(items);
  }

  // マスタデータを事前に取得
  var preLoadedData = getPreLoadedDataForMaint();

  // 1. ステータス更新 & 履歴ログ記録
  var result = writeToSheet(
    items, 
    newStatus, 
    newLocation, 
    actionName, 
    preLoadedData, 
    identifiedStaffName, 
    null 
  );

  // 2. 金銭ログ連携
  if (result && result.success) {
    try {
      var moneyLogs = [];
      var now = new Date();
      var cost = data.cost || 0; 
      var detail = data.detail || "";
      var moneyActionName = actionName;

      items.forEach(function(item) {
        var rawId = item.id;
        var nId = (typeof normalizeId === 'function') ? normalizeId(rawId) : String(rawId);
        
        var rowIndex = preLoadedData.idMap[nId];
        var officialId = rawId; 
        
        if (rowIndex !== undefined && preLoadedData.data[rowIndex]) {
          officialId = preLoadedData.data[rowIndex][0];
        }
        
        var formattedId = (typeof formatDisplayId === 'function') ? formatDisplayId(officialId) : officialId;

        moneyLogs.push({
          uuid: Utilities.getUuid(),
          date: now,
          staff: identifiedStaffName,
          rank: identifiedStaffRank,
          action: moneyActionName, 
          tankId: formattedId,
          repairCost: cost,
          repairDetail: detail,
          note: ""
        });
      });
      
      if (typeof recordMoneyLog === 'function') {
        recordMoneyLog(moneyLogs);
      }
    } catch (e) {
      console.error("金銭ログ連携エラー: " + e.toString());
    }
  }

  return result;
}

function getPreLoadedDataForMaint() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.STATUS);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  
  var fetchCols = (lastCol >= 9) ? 9 : (lastCol >= 8 ? 8 : 7);
  var masterData = (lastRow > 0) ? sheet.getRange(1, 1, lastRow, fetchCols).getValues() : [];

  var idMap = {};
  for (var i = 1; i < masterData.length; i++) {
    var nId = (typeof normalizeId === 'function') ? normalizeId(masterData[i][0]) : String(masterData[i][0]);
    if(nId) idMap[nId] = i;
  }
  return { sheet: sheet, data: masterData, idMap: idMap };
}

function updateInspectionDate(items) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.STATUS);
  var data = sheet.getDataRange().getValues();
  var yearsToAdd = NOTIFY_CONFIG.VALIDITY_YEARS;
  var nextDate = new Date();
  nextDate.setFullYear(nextDate.getFullYear() + yearsToAdd);
  
  var targetDbIds = items.map(function(item) { 
    return (typeof normalizeId === 'function') ? normalizeId(item.id) : String(item.id); 
  });
  
  for (var i = 1; i < data.length; i++) {
    if (targetDbIds.indexOf(String(data[i][0])) !== -1) {
      sheet.getRange(i + 1, 5).setValue(nextDate);
    }
  }
  SpreadsheetApp.flush(); 
}