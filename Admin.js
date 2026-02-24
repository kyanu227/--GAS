// ■■■ Admin.gs ■■■

// シート名や列の設定 (環境に合わせて変更してください)
const ADMIN_CONFIG = {
  SHEET_LOG_PREFIX: '履歴ログ',   // "履歴ログ2024" などの接頭辞
  SHEET_PRICE: '設定_単価',
  SHEET_TANK: '在庫管理',         // タンク一覧シート (ボンベマスタ)
  
  // 各シートの列番号 (0始まり: A列=0, B列=1...)
  COL_LOG_DATE: 1,    // ログの日付列
  COL_LOG_ACTION: 4,  // ログのアクション列 (貸出, 充填 etc)
  
  COL_PRICE_NAME: 0,  // 単価マスタの品名
  COL_PRICE_VAL: 1,   // 単価マスタの価格 (基本単価)
  
  COL_TANK_ID: 0,     // タンクID列
  COL_TANK_LIMIT: 5   // 耐圧検査期限の列 (仮定)
};

/**
 * ダッシュボード用データ一括取得
 */
function getAdminDashboardData() {
  var today = new Date();
  var yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  // 1. 単価マスタの取得
  var priceMap = getPriceMap_();

  // 2. 売上計算 (本日・昨日)
  var salesToday = calcDailySales_(today, priceMap);
  var salesYesterday = calcDailySales_(yesterday, priceMap);
  
  // 前日比 (%)
  var salesRatio = 0;
  if (salesYesterday > 0) {
    salesRatio = Math.round(((salesToday - salesYesterday) / salesYesterday) * 100);
  }

  // 3. 売上推移 (過去7日間)
  var trendData = getSalesTrend_(7, priceMap);

  // 4. 耐圧検査期限切れチェック
  var expiryInfo = checkTankExpiry_();

  // 5. その他 (仮置きのまま)
  var orderCount = 5; 
  var activeStaff = countActiveStaff_(today); 

  return {
    sales: salesToday,
    salesRatio: salesRatio,
    alertCount: expiryInfo.expiredCount, // 期限切れ件数
    warningCount: expiryInfo.warningCount, // 期限間近件数
    orderCount: orderCount,
    activeStaff: activeStaff,
    
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
 * 指定日の売上を計算
 */
function calcDailySales_(targetDate, priceMap) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var year = targetDate.getFullYear();
  var sheetName = ADMIN_CONFIG.SHEET_LOG_PREFIX + year; // "履歴ログ2025"
  var sheet = ss.getSheetByName(sheetName);
  
  // 年またぎ対応 (シートがない場合は現在のログシートなどを探す処理が必要ですが今回は省略)
  if (!sheet) sheet = ss.getSheetByName("履歴ログ"); 
  if (!sheet) return 0;

  var targetDateStr = Utilities.formatDate(targetDate, "Asia/Tokyo", "yyyy/MM/dd");
  var data = sheet.getDataRange().getValues();
  var total = 0;

  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][ADMIN_CONFIG.COL_LOG_DATE];
    // 日付判定
    if (isValidDate_(rowDate)) {
      var rowDateStr = Utilities.formatDate(new Date(rowDate), "Asia/Tokyo", "yyyy/MM/dd");
      if (rowDateStr === targetDateStr) {
        var action = String(data[i][ADMIN_CONFIG.COL_LOG_ACTION]).trim();
        // 単価マップにあれば加算
        if (priceMap[action]) {
          total += priceMap[action];
        }
      }
    }
  }
  return total;
}

/**
 * 過去N日間の売上推移を取得
 */
function getSalesTrend_(days, priceMap) {
  var labels = [];
  var data = [];
  var today = new Date();

  // 過去days分ループ (今日を含まない場合は i=days, i>0)
  for (var i = days - 1; i >= 0; i--) {
    var d = new Date(today);
    d.setDate(today.getDate() - i);
    
    var label = Utilities.formatDate(d, "Asia/Tokyo", "MM/dd");
    var sales = calcDailySales_(d, priceMap);
    
    labels.push(label);
    data.push(sales);
  }
  return { labels: labels, data: data };
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
  // 簡易実装: 本日のログに登場するユニークなスタッフ数をカウント
  // 必要に応じて実装してください
  return 8; // ダミー
}

// 日付妥当性チェック
function isValidDate_(d) {
  return Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d.getTime());
}