// ■■■ check.js : デバッグ・テスト関数 ■■■
// GASエディタから関数を選んで ▶ で実行してください

// ============================================
// 自社管理関連テスト
// ============================================

/**
 * 自社利用中タンクの取得テスト
 */
function test_getInHouseTanks() {
  var result = getInHouseTanks();
  console.log("=== 自社利用中タンク ===");
  console.log("件数: " + result.length);
  result.forEach(function (t) { console.log("  " + t.id); });
}

/**
 * 自動確定ドライラン（実際には書き込まない）
 * → 自動確定の対象となるタンクを確認するだけ
 */
function test_autoConfirmDryRun() {
  var tanks = getInHouseTanks();
  console.log("=== 自動確定ドライラン ===");
  console.log("対象件数: " + tanks.length);
  if (tanks.length === 0) {
    console.log("自社利用中のタンクは0件です。自動確定の対象はありません。");
    return;
  }
  tanks.forEach(function (t) { console.log("  対象: " + t.id + " → 通常返却として確定される予定"); });
  console.log("※ これはドライランです。実際の書き込みは行われていません。");
}

/**
 * 事後報告テスト（ドライラン）
 * processCompanyRetroReportの動作を安全に検証
 */
function test_retroReportDryRun() {
  console.log("=== 事後報告ドライラン ===");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
  var sheet = ss.getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var fetchCols = (lastCol >= 9) ? 9 : 7;
  var masterData = sheet.getRange(1, 1, lastRow, fetchCols).getValues();
  var idMap = {};
  for (var i = 1; i < masterData.length; i++) {
    var nId = normalizeId(masterData[i][0]);
    if (nId) idMap[nId] = i;
  }

  // 最初の3件のIDを使ってシミュレーション
  var sampleIds = [];
  for (var j = 1; j < masterData.length && sampleIds.length < 3; j++) {
    if (masterData[j][0]) sampleIds.push(masterData[j][0]);
  }

  console.log("サンプルID: " + sampleIds.join(", "));
  sampleIds.forEach(function (id) {
    var nId = normalizeId(id);
    var idx = idMap[nId];
    if (idx !== undefined) {
      var status = masterData[idx][1];
      var action = (status === '自社利用中') ? 'スキップ（既に自社利用中）' : '自社利用(事後)として登録';
      console.log("  " + id + " [現在: " + status + "] → " + action);
    }
  });
  console.log("※ ドライランです。実際の書き込みは行われていません。");
}

// ============================================
// トリガー関連テスト
// ============================================

/**
 * 現在のトリガー状態を確認
 */
function test_triggerStatus() {
  var status = getAutoConfirmTriggerStatus();
  console.log("=== トリガー状態 ===");
  console.log("自動確定トリガー: " + (status.enabled ? "ON" : "OFF"));
  if (status.error) console.log("エラー: " + status.error);

  // 全トリガー一覧
  var allTriggers = ScriptApp.getProjectTriggers();
  console.log("全トリガー数: " + allTriggers.length);
  allTriggers.forEach(function (t) {
    console.log("  関数: " + t.getHandlerFunction() + " / タイプ: " + t.getEventType());
  });
}

// ============================================
// バリデーション関連テスト
// ============================================

/**
 * OP_RULES定義の整合性チェック
 */
function test_opRulesConsistency() {
  console.log("=== OP_RULES整合性チェック ===");
  var requiredActions = ['貸出', '自社利用', '返却', '一括返却', '自社事後報告', '充填', '破損報告', '修理済み'];
  var ok = true;
  requiredActions.forEach(function (a) {
    if (!OP_RULES[a]) {
      console.log("❌ " + a + ": ルール未定義");
      ok = false;
    } else {
      console.log("✅ " + a + ": allowedPrev=" + JSON.stringify(OP_RULES[a].allowedPrev) + ", nextStatus=" + OP_RULES[a].nextStatus);
    }
  });
  if (ok) console.log("全てのルールが正しく定義されています。");
}

/**
 * submitOperationsのswitchルーティング確認
 * → 各actionが正しい処理関数にルーティングされるか確認
 */
function test_routingCheck() {
  console.log("=== ルーティングチェック ===");
  var routeMap = {
    '貸出': 'processLend',
    '自社利用': 'processCompanyUse',
    '自社一括返却': 'processCompanyBulkReturn',
    '一括返却': 'processBulkReturn',
    '自社事後報告': 'processCompanyRetroReport',
    '返却': 'processReturn',
    '充填': 'processFill',
    '破損報告': 'processDamageReport',
    '修理済み': 'processRepair'
  };

  var ok = true;
  Object.keys(routeMap).forEach(function (action) {
    var funcName = routeMap[action];
    if (typeof this[funcName] === 'function') {
      console.log("✅ " + action + " → " + funcName + "() が存在します");
    } else {
      console.log("❌ " + action + " → " + funcName + "() が見つかりません！");
      ok = false;
    }
  });
  if (ok) console.log("全てのルーティング先関数が存在します。");
}

// ============================================
// データ整合性テスト
// ============================================

/**
 * タンクステータスシートの基本データチェック
 */
function test_statusSheetIntegrity() {
  console.log("=== ステータスシートチェック ===");
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    console.log("❌ シート '" + sheetName + "' が見つかりません");
    return;
  }

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  console.log("行数: " + lastRow + ", 列数: " + lastCol);

  if (lastRow <= 1) {
    console.log("⚠️ データ行がありません（ヘッダーのみ）");
    return;
  }

  var data = sheet.getRange(2, 1, lastRow - 1, Math.min(lastCol, 3)).getValues();
  var statusCounts = {};
  var emptyIds = 0;

  data.forEach(function (row) {
    if (!row[0]) { emptyIds++; return; }
    var status = String(row[1] || '(空)');
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  });

  console.log("総タンク数: " + data.length);
  if (emptyIds > 0) console.log("⚠️ ID空行: " + emptyIds + "件");

  console.log("--- ステータス分布 ---");
  Object.keys(statusCounts).sort().forEach(function (s) {
    console.log("  " + s + ": " + statusCounts[s] + "件");
  });
}

/**
 * normalizeId関数のテスト
 */
function test_normalizeId() {
  console.log("=== normalizeIdテスト ===");
  var testCases = [
    { input: 'A-01', expected: 'A01' },
    { input: 'a-01', expected: 'A01' },
    { input: 'Ａ０１', expected: 'A01' },
    { input: 'A 01', expected: 'A01' },
    { input: 'A_01', expected: 'A01' },
    { input: 'A01', expected: 'A01' }
  ];

  testCases.forEach(function (tc) {
    var result = normalizeId(tc.input);
    var pass = (result === tc.expected);
    console.log((pass ? "✅" : "❌") + " normalizeId('" + tc.input + "') = '" + result + "'" + (pass ? "" : " (期待値: '" + tc.expected + "')"));
  });
}

// ============================================
// 全テスト一括実行
// ============================================

/**
 * 安全なテストを全て実行（データ変更なし）
 */
function runAllTests() {
  console.log("■■■ 全テスト実行開始 ■■■\n");
  test_normalizeId();
  console.log("");
  test_opRulesConsistency();
  console.log("");
  test_routingCheck();
  console.log("");
  test_statusSheetIntegrity();
  console.log("");
  test_getInHouseTanks();
  console.log("");
  test_triggerStatus();
  console.log("");
  test_autoConfirmDryRun();
  console.log("");
  test_retroReportDryRun();
  console.log("\n■■■ 全テスト完了 ■■■");
}
