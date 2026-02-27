// ■■■ 0_Config.gs : アプリ全体の設定定数 ■■■

const APP_TITLE = "タンク管理";

// ▼ 耐圧検査 通知・設定 (スクリプトプロパティの値を優先して読み込む)
const NOTIFY_CONFIG = {
  get EMAILS() {
    var json = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAILS');
    return json ? JSON.parse(json) : ['user1@example.com', 'user2@example.com'];
  },
  get LINE_CHANNEL_TOKEN() {
    return PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_TOKEN') || '';
  },
  get LINE_GROUP_ID() {
    return PropertiesService.getScriptProperties().getProperty('LINE_GROUP_ID') || '';
  },
  get ALERT_MONTHS() {
    return Number(PropertiesService.getScriptProperties().getProperty('ALERT_MONTHS')) || 6;
  },
  get VALIDITY_YEARS() {
    return Number(PropertiesService.getScriptProperties().getProperty('VALIDITY_YEARS')) || 3;
  },
  MSG_HEADER: "【耐圧検査アラート】\n以下のタンクが期限切れ、または期限間近です。\n手配の準備をお願いします。",
  MSG_FOOTER: "確認後、メンテナンス担当へ連絡してください。"
};

// ▼ メニュー表示名 (HTML側でボタンラベルとして参照)
const MENU_NAMES = {
  LEND: "貸出登録",
  RETURN: "返却登録",
  FILL: "充填登録",
  DAMAGE: "破損報告",
  REPAIR: "修理済み",
  INSP: "耐圧検査完了",
  ORDER: "資材発注",
  DASHBOARD: "ダッシュボード",
  BILL: "請求書発行",
  SALES: "売上統計",
  STAFF: "スタッフ統計",
  SETTINGS: "設定変更",
  MYPAGE: "マイページ"
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
  STATUS: 'タンクステータス',
  LOG: '履歴ログ',   // 年別シートのプレフィックス (例: 履歴ログ2025)
  DEST: '貸出先リスト',
  STAFF: '担当者リスト',
  CONFIG_NOTIFY: '通知設定'   // 廃止済み (スクリプトプロパティに移行) — 互換のため残す
};

// ▼ 金銭・経営管理用スプレッドシート設定
const MONEY_CONFIG = {
  SPREADSHEET_ID: "1WqhL0NbRL6jvYwJVrKnkSe7JlkNlZB91gH2ywN4fyAM",
  SHEET_LOG: "D_金銭ログ",
  SHEET_PRICE: "M_設定_単価",
  SHEET_RANK: "M_設定_ランク",
  SHEET_REPAIR: "M_設定_修理項目",
  SHEET_ORDER_MASTER: "M_設定_発注",
  SHEET_MONTHLY: "S_月次給与・収支",
  SHEET_ORDER: "D_発注ログ"
};