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

  // --- 2. 過去7日間のログ取得 (全ユーザー) ---
  var DAYS_BACK = 7;
  var dayNames = ['日', '月', '火', '水', '木', '金', '土'];

  // 7日分の日付リスト生成
  var dateList = [];
  var targetDates = {};
  for (var d = 0; d < DAYS_BACK; d++) {
    var dt = new Date(today.getTime() - d * 86400000);
    var ds = Utilities.formatDate(dt, timeZone, 'yyyy/MM/dd');
    var m = dt.getMonth() + 1;
    var day = dt.getDate();
    var dow = dayNames[dt.getDay()];
    dateList.push({
      dateStr: ds,
      label: m + '/' + day + '(' + dow + ')' + (d === 0 ? ' 今日' : ''),
      dayOfWeek: dow,
      isToday: d === 0
    });
    targetDates[ds] = true;
  }

  var logSheetNames = [SHEET_NAMES.LOG + thisYear, SHEET_NAMES.LOG + (thisYear + 1), SHEET_NAMES.LOG];
  logSheetNames = logSheetNames.filter(function (x, i, self) { return self.indexOf(x) === i; });

  var logsByDate = {};  // { 'yyyy/MM/dd': [ logObj, ... ] }
  dateList.forEach(function (item) { logsByDate[item.dateStr] = []; });

  logSheetNames.forEach(function (sName) {
    var sheet = ss.getSheetByName(sName);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var row = data[i];
        var logDate = new Date(row[1]);
        if (isNaN(logDate.getTime())) continue;
        var logDateStr = Utilities.formatDate(logDate, timeZone, 'yyyy/MM/dd');
        if (!targetDates[logDateStr]) continue;

        var displayTime = "";
        var timeVal = row[2];
        if (Object.prototype.toString.call(timeVal) === "[object Date]") {
          displayTime = Utilities.formatDate(timeVal, timeZone, 'HH:mm');
        } else {
          displayTime = String(timeVal).replace(/.*(\d{2}:\d{2}).*/, '$1');
          if (displayTime.length > 5) displayTime = "";
        }

        logsByDate[logDateStr].push({
          uuid: row[0],
          time: displayTime,
          tankId: row[3] || '-',
          action: String(row[4] || '-'),
          loc: row[5] || '',
          note: row[6] || '',
          staff: String(row[7] || '').trim(),
          prevLoc: row[8] || '',
          coworkers: String(row[10] || '').trim(),
          timestamp: logDate.getTime(),
          dateStr: logDateStr
        });
      }
    }
  });

  // 各日付のログを時刻降順ソート
  Object.keys(logsByDate).forEach(function (key) {
    logsByDate[key].sort(function (a, b) { return b.timestamp - a.timestamp; });
  });

  var todayLogs = logsByDate[todayStr] || [];

  // --- 3. 担当者別・場所別サマリ集計 (本日分のみ) ---
  var lendSummary = {};
  var returnSummary = {};
  var fillSummary = {};
  var otherSummary = {};

  todayLogs.forEach(function (log) {
    var sender = log.staff || '不明';
    var staff = sender;
    if (log.coworkers) {
      var allMembers = [sender].concat(log.coworkers.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s; }));
      staff = allMembers.join('・') + ' (' + allMembers.length + '名作業)';
    }

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
    logsByDate: logsByDate,
    dateList: dateList,
    lendSummary: lendSummary,
    returnSummary: returnSummary,
    fillSummary: fillSummary,
    otherSummary: otherSummary,
    todayDate: Utilities.formatDate(today, timeZone, 'yyyy年M月d日'),
    todayDayOfWeek: dayNames[today.getDay()]
  };
}

// NOTE: batchDeleteMyLog has been replaced by deleteOperationAndRollback located in Feature_Delete.js
