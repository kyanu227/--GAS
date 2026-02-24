// ■■■ 0_Config.gs ■■■

// ▼ アプリの基本設定
const APP_TITLE = "タンク管理";

// ▼ 耐圧検査 通知・設定
const NOTIFY_CONFIG = {
  // ★設定画面で保存された値を優先して読み込みます
  get EMAILS() {
    var json = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS');
    // 設定がなければデフォルト値を返す
    return json ? JSON.parse(json) : ['user1@example.com', 'user2@example.com'];
  },

  // ★LINE Messaging API設定
  get LINE_CHANNEL_TOKEN() {
    return PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN') || '';
  },
  get LINE_GROUP_ID() {
    return PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID') || '';
  },

  // ★期限設定
  get ALERT_MONTHS() {
    return Number(PropertiesService.getScriptProperties().getProperty('ALERT_MONTHS')) || 6;
  },
  get VALIDITY_YEARS() {
    return Number(PropertiesService.getScriptProperties().getProperty('VALIDITY_YEARS')) || 3;
  },

  MSG_HEADER: "【耐圧検査アラート】\n以下のタンクが期限切れ、または期限間近です。\n手配の準備をお願いします。",
  MSG_FOOTER: "確認後、メンテナンス担当へ連絡してください。"
};

// ▼ メニュー名
const MENU_NAMES = {
  LEND:     "貸出登録",
  RETURN:   "返却登録",
  FILL:     "充填登録",
  DAMAGE:   "破損報告",
  REPAIR:   "修理済み",
  INSP:     "耐圧検査完了",
  ORDER:    "資材発注",
  ADMIN:    "ダッシュボード",
  BILL:     "請求書発行",
  SALES:    "売上統計",
  STAFF:    "スタッフ統計",
  SETTINGS: "設定変更",
  MYPAGE:   "マイページ"
};

// ▼ 請求書用の設定
const INVOICE_CONFIG = {
  BANK_INFO: "琉球銀行　宮古支店<br>普通 1234567<br>カ）ボンベカンリ",
  GREETING: "平素は格別のご高配を賜り、厚く御礼申し上げます。<br>下記の通りご請求申し上げます。",
  NOTE: "※ 振込手数料は貴社負担にてお願い致します。",
  NOTE_TITLE: "備考・お振込先",
  TAX_RATE: 0.10
};

// ▼ シート名 (本体スプレッドシート)
const SHEET_NAMES = {
  STATUS:   'タンクステータス',
  LOG:      '履歴ログ',
  DEST:     '貸出先リスト',
  STAFF:    '担当者リスト',
  // CONFIG_NOTIFYシートは廃止しプロパティ管理に移行しましたが、定義は残しても無害です
  CONFIG_NOTIFY: '通知設定' 
};

// ▼ 金銭・経営管理用スプレッドシート設定
const MONEY_CONFIG = {
  SPREADSHEET_ID: "1WqhL0NbRL6jvYwJVrKnkSe7JlkNlZB91gH2ywN4fyAM",
  SHEET_LOG:           "D_金銭ログ",
  SHEET_PRICE:         "M_設定_単価",
  SHEET_RANK:          "M_設定_ランク",
  SHEET_REPAIR:        "M_設定_修理項目",
  SHEET_ORDER_MASTER:  "M_設定_発注",
  SHEET_MONTHLY:       "S_月次給与・収支",
  SHEET_ORDER:         "D_発注ログ"
};