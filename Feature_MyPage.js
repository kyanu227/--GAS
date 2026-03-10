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

  // --- 4. 単価マスタ読み込み ---
  // キャッシュを使うと単価やスコアの変更がリアルタイムに反映されないため、毎回シートから取得する
  var priceData = [];
  try {
    var priceSheetObj = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_PRICE);
    if (priceSheetObj) {
      priceData = priceSheetObj.getDataRange().getValues();
    }
  } catch (e) {
    console.error("単価マスタ取得エラー", e);
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

  var thisMonthLogs = [];
  var dynamicScore = 0;

  for (var i = 0; i < allMoneyData.length; i++) {
    var row = allMoneyData[i];
    var d = new Date(row[1]);
    var staff = String(row[2]); // ★文字列化
    var rawAction = String(row[3]);
    var numWorkers = (row.length > 9 && Number(row[9])) ? Number(row[9]) : 1;
    var isUncharged = (rawAction === "返却(未充填)" || rawAction === "未充填");

    // ★重要修正: 名前の比較時に trim() を行い、確実に一致させる
    if (staff.trim() === name.trim()) {
      if (!isNaN(d.getTime())) {
        var logYear = parseInt(Utilities.formatDate(d, timeZone, "yyyy"));
        var logMonth = parseInt(Utilities.formatDate(d, timeZone, "M")) - 1;

        // 今月のデータなら一旦配列に保存し、スコアだけ先に計算する
        if (logYear === thisYear && logMonth === thisMonth) {
          thisMonthLogs.push({
            rawAction: rawAction,
            numWorkers: numWorkers,
            isUncharged: isUncharged
          });

          if (!isUncharged && rawAction.indexOf("自社") === -1) {
            // スコアにはランク依存がないため固定で取得
            var pInfo = calculateRewardInMemory(rawAction, "レギュラー", priceData);
            dynamicScore += Math.floor(pInfo.score / numWorkers);
          }
        }

        // 履歴グラフ用
        var logKey = Utilities.formatDate(d, timeZone, "yyyy-MM");
        if (historyMap[logKey]) {
          var histReward = { total: 0, score: 0 };
          if (!isUncharged && rawAction.indexOf("自社") === -1) {
            histReward = calculateRewardInMemory(rawAction, currentRank, priceData);
          }
          historyMap[logKey].amount += Math.floor(histReward.total / numWorkers);
        }
      }
    }
  }

  Object.keys(historyMap).sort().forEach(function (k) {
    stats.chartHistory.labels.push(historyMap[k].label);
    stats.chartHistory.data.push(historyMap[k].amount);
  });

  // --- 6. リアルタイムランク再判定 ---
  var dynamicRank = currentRank;
  if (ranks.length > 0) {
    dynamicRank = "レギュラー"; // デフォルトから再評価
    for (var k = 0; k < ranks.length; k++) {
      if (dynamicScore >= ranks[k].score) {
        dynamicRank = ranks[k].name;
      }
    }
  }
  stats.rank = dynamicRank;
  stats.currentScore = dynamicScore;

  if (ranks.length > 0) {
    stats.nextRankScore = 0;
    for (var k = 0; k < ranks.length; k++) {
      if (ranks[k].score > dynamicScore) {
        stats.nextRankScore = ranks[k].score;
        break;
      }
    }
  }

  // --- 6.1. 確定した現在ランクを使って今月の報酬を計算 ---
  for (var j = 0; j < thisMonthLogs.length; j++) {
    var mLog = thisMonthLogs[j];
    var rewardCalc = { total: 0 };
    if (!mLog.isUncharged && mLog.rawAction.indexOf("自社") === -1) {
      rewardCalc = calculateRewardInMemory(mLog.rawAction, dynamicRank, priceData);
    }
    stats.estimatedMoney += Math.floor(rewardCalc.total / mLog.numWorkers);

    var key = mLog.rawAction;
    if (key.indexOf('修理') !== -1) key = '修理';
    else if (key.indexOf('返却') !== -1) key = '返却';
    else if (key.indexOf('貸出') !== -1) key = '貸出';
    else if (key.indexOf('充填') !== -1) key = '充填';
    else key = 'その他';

    if (stats.chartWork[key] !== undefined) stats.chartWork[key]++;
    else stats.chartWork['その他']++;
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