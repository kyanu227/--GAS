// ■■■ Feature_Dashboard.gs ■■■

/**
 * ダッシュボード用データ取得
 * - タンクステータス集計 (総数・内訳)
 * - 本日の全ユーザー作業ログ (貸出/返却を担当者・場所別に集計)
 */
function getDashboardData() {
  var timeZone = "Asia/Tokyo";
  var today = new Date();
  var todayStr = Utilities.formatDate(today, timeZone, 'yyyy/MM/dd');
  var thisYear = parseInt(Utilities.formatDate(today, timeZone, "yyyy"));

  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // --- 1. タンクステータス集計 ---
  var statusSheet = ss.getSheetByName(SHEET_NAMES.STATUS);
  var statusSummary = { total: 0, filled: 0, empty: 0, onLoan: 0, inHouse: 0, damaged: 0, inspection: 0, other: 0 };
  var statusDetails = {};

  if (statusSheet) {
    var lastRow = statusSheet.getLastRow();
    if (lastRow > 1) {
      var statusData = statusSheet.getRange(2, 1, lastRow - 1, 3).getValues();
      for (var i = 0; i < statusData.length; i++) {
        var id = String(statusData[i][0]).trim();
        if (!id) continue;
        var st = String(statusData[i][1]).trim();
        statusSummary.total++;

        if (!statusDetails[st]) statusDetails[st] = 0;
        statusDetails[st]++;

        if (st === '充填済み') statusSummary.filled++;
        else if (st === '空') statusSummary.empty++;
        else if (st === '貸出中') statusSummary.onLoan++;
        else if (st === '自社利用中') statusSummary.inHouse++;
        else if (st === '破損' || st === '不良' || st === '故障') statusSummary.damaged++;
        else if (st === '耐圧検査') statusSummary.inspection++;
        else statusSummary.other++;
      }
    }
  }

  // --- 2. 本日のログ取得 (全ユーザー) ---
  var logSheetNames = [SHEET_NAMES.LOG + thisYear, SHEET_NAMES.LOG + (thisYear + 1), SHEET_NAMES.LOG];
  logSheetNames = logSheetNames.filter(function (x, i, self) { return self.indexOf(x) === i; });

  var todayLogs = [];
  logSheetNames.forEach(function (sName) {
    var sheet = ss.getSheetByName(sName);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var logDate = new Date(row[1]);
        if (isNaN(logDate.getTime())) continue;
        var logDateStr = Utilities.formatDate(logDate, timeZone, 'yyyy/MM/dd');
        if (logDateStr !== todayStr) continue;

        var displayTime = "";
        var timeVal = row[2];
        if (Object.prototype.toString.call(timeVal) === "[object Date]") {
          displayTime = Utilities.formatDate(timeVal, timeZone, 'HH:mm');
        } else {
          displayTime = String(timeVal).replace(/.*(\d{2}:\d{2}).*/, '$1');
          if (displayTime.length > 5) displayTime = "";
        }

        todayLogs.push({
          uuid: row[0],
          time: displayTime,
          tankId: row[3] || '-',
          action: String(row[4] || '-'),
          loc: row[5] || '',
          note: row[6] || '',
          staff: String(row[7] || '').trim(),
          prevLoc: row[8] || '',
          timestamp: logDate.getTime()
        });
      }
    }
  });

  todayLogs.sort(function (a, b) { return b.timestamp - a.timestamp; });

  // --- 3. 担当者別・場所別サマリ集計 ---
  var lendSummary = {};   // { staffName: { locations: { locName: count }, total: n } }
  var returnSummary = {}; // { staffName: { sources: { srcName: count }, total: n } }
  var fillSummary = {};   // { staffName: count }
  var otherSummary = {};  // { staffName: { actions: { actionName: count }, total: n } }

  todayLogs.forEach(function (log) {
    var staff = log.staff || '不明';
    var action = log.action;

    if (action.indexOf('貸出') !== -1) {
      if (!lendSummary[staff]) lendSummary[staff] = { locations: {}, total: 0 };
      var loc = log.loc || '不明';
      lendSummary[staff].locations[loc] = (lendSummary[staff].locations[loc] || 0) + 1;
      lendSummary[staff].total++;
    } else if (action.indexOf('返却') !== -1) {
      if (!returnSummary[staff]) returnSummary[staff] = { sources: {}, total: 0 };
      var src = log.prevLoc || log.note || log.loc || '不明';
      if (log.note && log.note.indexOf('より返却') !== -1) {
        src = log.note.replace(/[()（）]/g, '').replace('より返却', '').trim();
      }
      returnSummary[staff].sources[src] = (returnSummary[staff].sources[src] || 0) + 1;
      returnSummary[staff].total++;
    } else if (action.indexOf('充填') !== -1) {
      fillSummary[staff] = (fillSummary[staff] || 0) + 1;
    } else {
      if (!otherSummary[staff]) otherSummary[staff] = { actions: {}, total: 0 };
      otherSummary[staff].actions[action] = (otherSummary[staff].actions[action] || 0) + 1;
      otherSummary[staff].total++;
    }
  });

  return {
    statusSummary: statusSummary,
    statusDetails: statusDetails,
    todayLogs: todayLogs,
    lendSummary: lendSummary,
    returnSummary: returnSummary,
    fillSummary: fillSummary,
    otherSummary: otherSummary,
    todayDate: Utilities.formatDate(today, timeZone, 'yyyy年M月d日'),
    todayDayOfWeek: ['日', '月', '火', '水', '木', '金', '土'][today.getDay()]
  };
}

/**
 * ★スマート削除ロジック: UUIDの配列を受け取り、一括で削除します
 */
function batchDeleteMyLog(data) {
  var uuids = data.uuids;
  if (!uuids || uuids.length === 0) return { success: false, message: "削除対象がありません" };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssMoney = getMoneySS();
  var timeZone = "Asia/Tokyo";
  var thisYear = parseInt(Utilities.formatDate(new Date(), timeZone, "yyyy"));

  var sheetConfigs = [
    { ss: ss, baseName: SHEET_NAMES.LOG },
    { ss: ssMoney, baseName: MONEY_CONFIG.SHEET_LOG }
  ];
  var years = [thisYear, thisYear - 1, thisYear + 1];

  var totalDeleted = 0;

  sheetConfigs.forEach(function (config) {
    years.forEach(function (year) {
      var sheetName = config.baseName + year;
      var sheet = config.ss.getSheetByName(sheetName);
      if (!sheet && year === thisYear) sheet = config.ss.getSheetByName(config.baseName);

      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        var rowsToDelete = [];

        for (var i = 1; i < rows.length; i++) {
          var rowUuid = String(rows[i][0]);
          if (uuids.indexOf(rowUuid) !== -1) {
            rowsToDelete.push(i + 1);
          }
        }

        if (rowsToDelete.length > 0) {
          rowsToDelete.sort(function (a, b) { return b - a; });
          rowsToDelete.forEach(function (rowIdx) {
            sheet.deleteRow(rowIdx);
            totalDeleted++;
          });
        }
      }
    });
  });

  if (totalDeleted > 0) {
    return { success: true, message: totalDeleted + "件のログを削除しました。" };
  } else {
    return { success: false, message: "削除対象が見つかりませんでした(既に削除済みの可能性があります)。" };
  }
}
