// ■■■ Admin.gs ■■■

// シート名や列の設定 (環境に合わせて変更してください)
const ADMIN_CONFIG = {
  SHEET_PRICE: 'M_設定_単価',      // 既存のFeature系と同じ単価マスタ
  SHEET_TANK: 'タンクステータス',    // ボンベの現在の状況

  // 各シートの列番号 (0始まり: A列=0, B列=1...)
  COL_LOG_DATE: 1,    // ログの日付列 (B列)
  COL_LOG_ACTION: 4,  // ログのアクション列 (E列)
  COL_LOG_STAFF: 7,   // ログの担当者列 (H列)

  COL_PRICE_NAME: 0,  // 単価マスタの品名 (A列)
  COL_PRICE_VAL: 1,   // 単価マスタの価格 (B列)

  COL_TANK_ID: 0,     // タンクID列 (A列)
  COL_TANK_STATUS: 1, // ステータス列 (B列)
  COL_TANK_LIMIT: 4   // 耐圧検査期限の列 (E列)
};

/**
 * ダッシュボード用データ一括取得
 */
function getAdminDashboardData() {
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  // 1. 各部から詳細データを取得
  var salesStats = getDetailedSalesStats();
  var staffStats = getDetailedStaffStats();
  var expiryInfo = checkTankExpiry_();
  var orderCount = 0; // いったん固定

  // 2. 取得したデータをダッシュボードトップ用の形式にマッピング
  var salesToday = 0;
  var salesRatio = salesStats.momRatio || 0;

  // 今日の売上を算出する処理 (ActionBreakdown等から取るか、別途当日だけ再取得。
  // 簡単のために、getDetailedSalesStats では当月全体のトータルを currentMonthTotal として返しているので、
  // 今日の売上は、元々の calcDailySales_ ではなく、昨日/今日を計算するか、または月間トータルをそのまま「今月の売上」として表示するように変更するのもありです。
  // ユーザーの要件に合わせて、ダッシュボードトップには「本日の売上」を残すため、当日分だけ簡易計算します)
  var priceMap = getPriceMap_();
  var salesToday = calcDailySales_(today, priceMap);
  var salesYesterday = calcDailySales_(yesterday, priceMap);
  if (salesYesterday > 0) {
    salesRatio = Math.round(((salesToday - salesYesterday) / salesYesterday) * 100);
  } else if (salesToday > 0) {
    salesRatio = 100;
  }

  var trendData = getSalesTrend_(7, priceMap);

  return {
    sales: salesToday,
    salesRatio: salesRatio,
    alertCount: expiryInfo.expiredCount,
    warningCount: expiryInfo.warningCount,
    orderCount: orderCount,
    activeStaff: staffStats.activeStaffCount,

    // チャート用データ
    chartLabels: trendData.labels,
    chartData: trendData.data,

    // お知らせリスト (期限切れ情報を追加)
    notifications: expiryInfo.messages
  };
}

// -------------------------------------------------------
// 内部計算用関数 (Private Functions)
// -------------------------------------------------------

/**
 * 単価マスタを連想配列で取得 { '充填': 5000, ... }
 */
function getPriceMap_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ADMIN_CONFIG.SHEET_PRICE);
  var map = {};
  if (!sheet) return map;

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    var name = String(data[i][ADMIN_CONFIG.COL_PRICE_NAME]).trim();
    var price = Number(data[i][ADMIN_CONFIG.COL_PRICE_VAL]) || 0;
    if (name) map[name] = price;
  }
  return map;
}

/**
 * フロントエンドからの詳細売上データ取得用エンドポイント
 */
function getAdminSalesData() {
  try {
    return getDetailedSalesStats(); // Admin_Feature_Sales.js の関数を呼び出す
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * フロントエンドからの詳細スタッフデータ取得用エンドポイント
 */
function getAdminStaffData() {
  try {
    return getDetailedStaffStats(); // Admin_Feature_Staff.js の関数を呼び出す
  } catch (e) {
    return { success: false, message: e.message };
  }
}

/**
 * 耐圧検査期限のチェック
 */
function checkTankExpiry_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ADMIN_CONFIG.SHEET_TANK); // 在庫管理シート
  var expiredCount = 0;
  var warningCount = 0;
  var messages = [];

  if (!sheet) return { expiredCount: 0, warningCount: 0, messages: [] };

  var data = sheet.getDataRange().getValues();
  var today = new Date();
  var nextMonth = new Date();
  nextMonth.setDate(today.getDate() + 30); // 30日後を警告ライン

  for (var i = 1; i < data.length; i++) {
    var tankId = data[i][ADMIN_CONFIG.COL_TANK_ID];
    var limitDate = data[i][ADMIN_CONFIG.COL_TANK_LIMIT];

    if (isValidDate_(limitDate)) {
      var limit = new Date(limitDate);

      if (limit < today) {
        // 期限切れ
        expiredCount++;
        messages.push({ type: 'Warn', msg: `期限切れ: ${tankId} (${Utilities.formatDate(limit, "JST", "yyyy/MM")})` });
      } else if (limit < nextMonth) {
        // 期限間近
        warningCount++;
      }
    }
  }
  return { expiredCount: expiredCount, warningCount: warningCount, messages: messages };
}

/**
 * 稼働中スタッフ数 (本日ログがある人数)
 */
function countActiveStaff_(today) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var year = today.getFullYear();
  var sheet = ss.getSheetByName("履歴ログ" + year);
  if (!sheet) sheet = ss.getSheetByName("履歴ログ");
  if (!sheet) return 0;

  var targetDateStr = Utilities.formatDate(today, "Asia/Tokyo", "yyyy/MM/dd");
  var data = sheet.getDataRange().getValues();
  var staffSet = {};

  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][ADMIN_CONFIG.COL_LOG_DATE];
    if (isValidDate_(rowDate)) {
      var rowDateStr = Utilities.formatDate(new Date(rowDate), "Asia/Tokyo", "yyyy/MM/dd");
      if (rowDateStr === targetDateStr) {
        var staffName = String(data[i][ADMIN_CONFIG.COL_LOG_STAFF] || "").trim();
        // プログラムのエラーや空文字の担当者は除外
        if (staffName && staffName !== "不明" && staffName !== "-") {
          staffSet[staffName] = true;
        }
      }
    }
  }

  // ユニークなスタッフ名をカウントして返す
  return Object.keys(staffSet).length;
}

// 日付妥当性チェック
function isValidDate_(d) {
  return Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d.getTime());
}