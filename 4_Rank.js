// ■■■ 4_Rank.gs : 月次ランク判定・給与一括計算 ■■■

/**
 * 月次締め処理を実行する関数
 * 対象月のスコアを集計し、ランクを確定させ、そのランクに基づいて全報酬を計算します。
 * targetDateStr: "2025/01" (省略すると先月分を集計)
 */
function runMonthlyClosing(targetDateStr) {
  // 1. 対象月の決定
  var targetDate;
  if (targetDateStr) {
    targetDate = new Date(targetDateStr + "/01");
  } else {
    var now = new Date();
    targetDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); // 先月
  }

  var targetYear = targetDate.getFullYear();
  var targetMonth = targetDate.getMonth(); // 0-11
  var targetMonthStr = Utilities.formatDate(targetDate, Session.getScriptTimeZone(), "yyyy-MM");

  console.log("集計開始: " + targetMonthStr);

  var ssMoney = getMoneySS();

  // 2. マスタデータの取得（単価・ランク定義）
  var priceData = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_PRICE).getDataRange().getValues();
  var rankData = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_RANK).getDataRange().getValues();

  // --- 4_Rank.js内で単価マスタを独自マップ化せず、3_Money.js側のcalculateRewardInMemoryを利用する ---

  // ランク定義を整理（スコア高い順）
  var rankDefs = [];
  for (var r = 1; r < rankData.length; r++) {
    rankDefs.push({
      name: rankData[r][1], // ランク名
      minScore: Number(rankData[r][2]) || 0
    });
  }
  rankDefs.sort(function (a, b) { return b.minScore - a.minScore; });


  // 3. ログデータの集計
  var sheetLog = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_LOG);
  var logs = sheetLog.getDataRange().getValues();

  // スタッフごとの集計箱
  // stats = { "山田": { totalScore:0, repairCost:0, actions:{ "貸出":10, "返却":5 } } }
  var stats = {};

  for (var i = 1; i < logs.length; i++) {
    var rowDate = new Date(logs[i][1]);

    // 対象月のみ集計
    if (rowDate.getFullYear() === targetYear && rowDate.getMonth() === targetMonth) {
      var staff = logs[i][2];  // 担当者
      var action = logs[i][3]; // 作業種別
      var score = Number(logs[i][5]) || 0; // スコア
      var repair = Number(logs[i][6]) || 0; // 修理実費

      if (!stats[staff]) {
        stats[staff] = { totalScore: 0, repairCost: 0, actions: {}, logs: [] };
      }

      var numWorkers = (logs[i].length > 9 && Number(logs[i][9])) ? Number(logs[i][9]) : 1;

      stats[staff].repairCost += repair;
      stats[staff].logs.push({ action: action, numWorkers: numWorkers });

      if (!stats[staff].actions[action]) stats[staff].actions[action] = 0;
      stats[staff].actions[action]++;
    }
  }


  // 4. 給与計算 & 書き出しデータ作成
  var outputRows = [];
  var staffNewRanks = {}; // 担当者リスト更新用

  for (var name in stats) {
    var s = stats[name];

    // (A) まずは全ログを走査して動的スコアを合計し、ランク判定用スコアを算出する
    var dynamicTotalScore = 0;
    for (var j = 0; j < s.logs.length; j++) {
      var actA = s.logs[j].action;
      var workersA = s.logs[j].numWorkers;

      if (actA === "返却(未充填)" || actA === "未充填" || actA.indexOf("自社") !== -1) continue;

      var rewardCalcA = calculateRewardInMemory(actA, "レギュラー", priceData);
      dynamicTotalScore += Math.floor(rewardCalcA.score / workersA);
    }

    // (B) ランク確定
    var confirmedRank = "レギュラー"; // デフォルト
    // ランク定義を上から見ていき、スコア条件を満たせば採用
    for (var k = 0; k < rankDefs.length; k++) {
      if (dynamicTotalScore >= rankDefs[k].minScore) {
        confirmedRank = rankDefs[k].name;
        break;
      }
    }
    staffNewRanks[name] = confirmedRank; // 更新用に保持

    // (C) 報酬計算
    // 確定したランクを使って、全作業の金額報酬を計算
    var totalReward = 0;

    // 行ごとに、(基本単価 + 確定ランクまでの全累計加算額) / J列の値 を計算して加算
    for (var j = 0; j < s.logs.length; j++) {
      var act = s.logs[j].action;
      var workers = s.logs[j].numWorkers;

      if (act === "返却(未充填)" || act === "未充填" || act.indexOf("自社") !== -1) continue;

      var rewardCalcC = calculateRewardInMemory(act, confirmedRank, priceData);
      totalReward += Math.floor(rewardCalcC.total / workers);
    }

    // (D) 行データ作成
    outputRows.push([
      targetMonthStr,
      name,
      confirmedRank, // 確定ランク
      dynamicTotalScore, // 動的計算したスコア
      s.actions['貸出'] || 0,
      s.actions['返却'] || 0,
      s.actions['充填'] || 0,
      s.actions['修理完了'] || 0,
      s.actions['破損報告'] || 0,
      totalReward,       // 歩合報酬
      s.repairCost,      // 修理立替
      totalReward + s.repairCost, // 支払総額
      new Date()
    ]);
  }

  // 5. シートへ書き出し
  var sheetMonthly = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_MONTHLY);
  if (!sheetMonthly) throw new Error("月次給与シートが見つかりません: " + MONEY_CONFIG.SHEET_MONTHLY);

  if (outputRows.length > 0) {
    // 既存の同月のデータがあれば消す処理を入れても良いが、今回は追記のみ
    var lastRow = sheetMonthly.getLastRow();
    sheetMonthly.getRange(lastRow + 1, 1, outputRows.length, outputRows[0].length).setValues(outputRows);
  }

  // 6. 担当者リスト(原本)のランクを更新
  // これにより、翌月のマイページ等で「先月の実績ランク」が表示されるようになる
  updateStaffRanks(staffNewRanks);

  console.log("集計完了: " + targetMonthStr + " (" + outputRows.length + "名)");
  return "完了: " + targetMonthStr;
}

// 担当者シートのランク列を更新する内部関数
function updateStaffRanks(newRankMap) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
  if (!sheet) return;

  var data = sheet.getDataRange().getValues();
  // D列(インデックス3)がランクと想定
  for (var i = 1; i < data.length; i++) {
    var name = data[i][0];
    if (newRankMap[name]) {
      // 新しいランクがあれば書き換え
      sheet.getRange(i + 1, 4).setValue(newRankMap[name]);
    }
  }
}