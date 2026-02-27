// ■■■ Feature_MyPage.gs ■■■

/**
 * マイページ用データ取得
 * 修正: 名前比較時の空白除去を追加し、金額計算を確実に実行
 */
function getMyStats(passcode) {
  var email = getSafeUserEmail();

  // 1. ユーザー情報の取得 (名前はここで確定している)
  var userInfo = getUserInfo(email, passcode);
  var name = userInfo.name;
  var currentRank = userInfo.rank;

  // ゲストの場合
  if (name === "ゲスト") {
    return {
      error: "ユーザーを特定できませんでした。ログインしてください。",
      name: "ゲスト",
      rank: "レギュラー",
      currentScore: 0,
      estimatedMoney: 0,
      nextRankScore: 0,
      todayLog: [],
      weeklyLog: [],
      chartWork: { "貸出": 0, "返却": 0, "充填": 0, "修理": 0, "その他": 0 },
      chartHistory: { labels: [], data: [] }
    };
  }

  // --- 2. データ集計の準備 ---
  var timeZone = "Asia/Tokyo";
  var today = new Date();
  var thisYear = parseInt(Utilities.formatDate(today, timeZone, "yyyy"));
  var thisMonth = parseInt(Utilities.formatDate(today, timeZone, "M")) - 1; // 0-indexed

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssMoney = getMoneySS();

  var stats = {
    name: name,
    rank: currentRank,
    currentScore: 0,
    estimatedMoney: 0, // 今月の獲得予定額
    nextRankScore: 0,
    todayLog: [],
    weeklyLog: [],
    chartWork: { "貸出": 0, "返却": 0, "充填": 0, "修理": 0, "その他": 0 },
    chartHistory: { labels: [], data: [] }
  };

  // --- 3. ランク定義読み込み ---
  var rankSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_RANK);
  var ranks = [];
  if (rankSheet) {
    var rankData = rankSheet.getDataRange().getValues();
    // 2行目以降を読む(A列=ID, B列=ランク名, C列=必要スコア)
    for (var i = 1; i < rankData.length; i++) {
      var rName = rankData[i][1];
      var rScore = Number(rankData[i][2]) || 0;
      if (rName) ranks.push({ name: rName, score: rScore });
    }
    ranks.sort((a, b) => a.score - b.score);
  }

  // --- 4. 単価マスタ読み込み (文字揺れ吸収強化版) ---
  var priceSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_PRICE);
  var priceMap = {};

  if (priceSheet) {
    var priceData = priceSheet.getDataRange().getValues();
    if (priceData.length > 0) {
      var headers = priceData[0]; // 1行目ヘッダー

      // 基本単価の列を探す (B列想定だがヘッダーで探す)
      var baseColIdx = 1; // デフォルトB列
      // 現在のランクの加算額列を探す
      var rankAddColIdx = -1;

      for (var c = 0; c < headers.length; c++) {
        var hVal = String(headers[c]);
        // 基本単価
        if (hVal.indexOf("基本") !== -1 || hVal.indexOf("単価") !== -1) {
          if (baseColIdx === 1) baseColIdx = c;
        }
        // ランク加算列
        if (hVal.indexOf(currentRank) !== -1) {
          rankAddColIdx = c;
        }
      }

      // データ行を走査
      for (var i = 1; i < priceData.length; i++) {
        // 余分な空白を除去してキーにする
        var rawName = String(priceData[i][0]);
        var actionName = rawName.replace(/\s+/g, '').trim();
        if (!actionName) continue;

        var basePrice = Number(priceData[i][baseColIdx]) || 0;
        var addPrice = 0;
        if (rankAddColIdx !== -1) {
          addPrice = Number(priceData[i][rankAddColIdx]) || 0;
        }

        // 合計単価を登録
        priceMap[actionName] = basePrice + addPrice;
        // 元の名前でも登録(念のため)
        if (rawName !== actionName) priceMap[rawName] = basePrice + addPrice;
      }
    }
  }

  // --- 5. 金銭ログ集計 (獲得額計算) ---
  var targetYears = [thisYear + 1, thisYear, thisYear - 1];
  var allMoneyData = [];
  targetYears.forEach(function (y) {
    var sheetName = MONEY_CONFIG.SHEET_LOG + y;
    var sheet = ssMoney.getSheetByName(sheetName);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      if (data.length > 1) {
        allMoneyData = allMoneyData.concat(data.slice(1));
      }
    }
  });

  var historyMap = {};
  for (var m = 5; m >= 0; m--) {
    var d = new Date(today.getFullYear(), today.getMonth() - m, 1);
    var key = Utilities.formatDate(d, timeZone, "yyyy-MM");
    historyMap[key] = { label: (d.getMonth() + 1) + "月", amount: 0 };
  }

  for (var i = 0; i < allMoneyData.length; i++) {
    var row = allMoneyData[i];
    var d = new Date(row[1]);
    var staff = String(row[2]); // ★文字列化
    var rawAction = String(row[3]);
    var actionKey = rawAction.replace(/\s+/g, '').trim();
    var score = Number(row[5]) || 0;

    // ★重要修正: 名前の比較時に trim() を行い、確実に一致させる
    if (staff.trim() === name.trim()) {
      if (!isNaN(d.getTime())) {
        var logYear = parseInt(Utilities.formatDate(d, timeZone, "yyyy"));
        var logMonth = parseInt(Utilities.formatDate(d, timeZone, "M")) - 1;

        // 今月のデータなら計算
        if (logYear === thisYear && logMonth === thisMonth) {
          stats.currentScore += score;

          // 単価マスタから金額を取得して加算
          var unitPrice = 0;
          if (actionKey.indexOf("自社") === -1 && rawAction.indexOf("自社") === -1) {
            if (priceMap.hasOwnProperty(actionKey)) unitPrice = priceMap[actionKey];
            else if (priceMap.hasOwnProperty(rawAction)) unitPrice = priceMap[rawAction];
          }

          stats.estimatedMoney += unitPrice;

          var key = rawAction;
          if (key.indexOf('修理') !== -1) key = '修理';
          else if (key.indexOf('返却') !== -1) key = '返却';
          else if (key.indexOf('貸出') !== -1) key = '貸出';
          else if (key.indexOf('充填') !== -1) key = '充填';
          else key = 'その他';

          if (stats.chartWork[key] !== undefined) stats.chartWork[key]++;
          else stats.chartWork['その他']++;
        }

        // 履歴グラフ用
        var logKey = Utilities.formatDate(d, timeZone, "yyyy-MM");
        if (historyMap[logKey]) {
          var histPrice = 0;
          if (actionKey.indexOf("自社") === -1 && rawAction.indexOf("自社") === -1) {
            if (priceMap.hasOwnProperty(actionKey)) histPrice = priceMap[actionKey];
            else if (priceMap.hasOwnProperty(rawAction)) histPrice = priceMap[rawAction];
          }
          historyMap[logKey].amount += histPrice;
        }
      }
    }
  }

  Object.keys(historyMap).sort().forEach(function (k) {
    stats.chartHistory.labels.push(historyMap[k].label);
    stats.chartHistory.data.push(historyMap[k].amount);
  });

  // --- 6. リアルタイムランク再判定 ---
  if (ranks.length > 0) {
    var newRank = stats.rank;
    for (var k = 0; k < ranks.length; k++) {
      if (stats.currentScore >= ranks[k].score) {
        newRank = ranks[k].name;
      }
    }
    stats.rank = newRank;

    stats.nextRankScore = 0;
    for (var k = 0; k < ranks.length; k++) {
      if (ranks[k].score > stats.currentScore) {
        stats.nextRankScore = ranks[k].score;
        break;
      }
    }
  }

  // --- 7. 作業詳細ログ取得 (表示用リスト) ---
  var todayStr = Utilities.formatDate(today, timeZone, 'yyyy/MM/dd');
  var searchLimit = new Date();
  searchLimit.setDate(today.getDate() - 35);
  var searchLimitTime = searchLimit.getTime();

  var logSheetNames = [
    SHEET_NAMES.LOG + thisYear,
    SHEET_NAMES.LOG + (thisYear - 1),
    SHEET_NAMES.LOG + (thisYear + 1),
    SHEET_NAMES.LOG
  ];
  logSheetNames = logSheetNames.filter(function (x, i, self) { return self.indexOf(x) === i; });

  var combinedLogs = [];
  logSheetNames.forEach(function (sName) {
    var sheet = ss.getSheetByName(sName);
    if (sheet) {
      var data = sheet.getDataRange().getValues();
      if (data.length > 1) {
        combinedLogs = combinedLogs.concat(data.slice(1));
      }
    }
  });

  for (var i = 0; i < combinedLogs.length; i++) {
    var row = combinedLogs[i];
    var rowStaff = String(row[7]).trim();

    // 名前比較の修正 (trim)
    if (rowStaff !== String(name).trim()) continue;

    var logDateRaw = row[1];
    var logDate = new Date(logDateRaw);
    if (isNaN(logDate.getTime())) continue;
    if (logDate.getTime() < searchLimitTime) continue;

    var logDateStr = Utilities.formatDate(logDate, timeZone, 'yyyy/MM/dd');
    var displayDate = Utilities.formatDate(logDate, timeZone, 'M/d');
    var displayTime = "";
    var timeVal = row[2];
    if (Object.prototype.toString.call(timeVal) === "[object Date]") {
      displayTime = Utilities.formatDate(timeVal, timeZone, 'HH:mm');
    } else {
      displayTime = String(timeVal).replace(/.*(\d{2}:\d{2}).*/, '$1');
      if (displayTime.length > 5) displayTime = "";
    }

    var logItem = {
      uuid: row[0],
      dateDisplay: displayDate,
      fullDate: logDateStr,
      timestamp: logDate.getTime(),
      time: displayTime,
      tankId: row[3] || '-',
      action: row[4] || '-',
      loc: row[5] || '',
      note: row[6] || ''
    };
    stats.weeklyLog.push(logItem);
    if (logDateStr === todayStr) stats.todayLog.push(logItem);
  }

  stats.weeklyLog.sort(function (a, b) { return b.timestamp - a.timestamp; });
  stats.todayLog.sort(function (a, b) { return b.timestamp - a.timestamp; });

  return stats;
}