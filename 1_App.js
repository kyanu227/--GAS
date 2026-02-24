// ■■■ 1_App.gs ■■■

function doGet(e) {
  var page = (e.parameter && e.parameter.page) ? e.parameter.page : '';
  // URLパラメータからパスコードを取得
  var urlPasscode = (e.parameter && e.parameter.passcode) ? e.parameter.passcode : '';
  
  var userEmail = Session.getActiveUser().getEmail();
  
  // ユーザー情報取得 (メールアドレス または パスコードで特定)
  // ※ getUserInfoが第2引数を受け取れる想定で記述しています
  var userInfo = getUserInfo(userEmail, urlPasscode); 
  
  // ------------------------------------------
  // ▼ 1. 管理者ページへのリクエスト (?page=admin)
  // ------------------------------------------
  if (page === 'admin') {
    // Googleアカウントだけですでに管理者と確定しているなら、即座に admin.html を返す
    if (checkAdminRole(userInfo)) {
      return createAdminPage(userInfo, userEmail);
    }
    // ★重要: そうでない場合、一旦 index.html を返すが、「本当はadminに行きたい」という情報を渡す
    else {
      return createNormalPage(userInfo, userEmail, 'admin', urlPasscode);
    }
  }

  // ------------------------------------------
  // ▼ 2. 現場用ページ (通常アクセス)
  // ------------------------------------------
  return createNormalPage(userInfo, userEmail, '', urlPasscode);
}

// 権限チェック用ヘルパー関数
function checkAdminRole(userInfo) {
  return (userInfo.role.indexOf('管理者') !== -1 || userInfo.role.indexOf('準管理者') !== -1 || userInfo.role.toLowerCase().indexOf('admin') !== -1);
}

// ★追加: クライアント側からパスコード認証後に呼ばれ、admin.htmlのソースコードを返す関数
function getAdminHtml(passcode) {
  // パスコードからユーザーを特定
  var userInfo = getUserInfo("", passcode); // メアドは空でOK、パスコード優先検索
  
  // 権限チェック
  if (userInfo && checkAdminRole(userInfo)) {
    // 権限があれば、admin.html を生成して、その「文字列(HTML)」を返す
    // ※admin画面生成に必要な情報を渡す
    var htmlOutput = createAdminPage(userInfo, ""); 
    return { success: true, html: htmlOutput.getContent() };
  } else {
    return { success: false, message: "管理者権限がありません。" };
  }
}

// 現場用HTML生成
// 引数に targetPage, urlPasscode を追加
function createNormalPage(userInfo, userEmail, targetPage, urlPasscode) {
  var template = HtmlService.createTemplateFromFile('index');
  
  var currentMode = getLoginMode(); 
  var isSpecialUser = (userInfo.role.indexOf('管理者') !== -1 || userInfo.role.indexOf('準管理者') !== -1);

  // パスコードモードかつ非特権ユーザーならゲスト扱い
  if (currentMode === 'PASSCODE' && !isSpecialUser) {
    template.staffName = "ゲスト";
    template.userRole = "一般"; 
  } else {
    template.staffName = userInfo.name;
    template.userRole = userInfo.role;
  }

  template.userEmail = userEmail;
  // URL由来または特定済みのパスコードを渡す
  template.foundPasscode = urlPasscode || userInfo.passcode || ""; 
  
  // ★追加: ターゲットページ情報
  template.targetPage = targetPage || ''; 

  // 定数読み込みエラー回避
  try { template.menuNames = MENU_NAMES; template.appTitle = APP_TITLE; } 
  catch(e) { template.menuNames = {}; template.appTitle = "タンク管理"; }

  template.scriptUrl = ScriptApp.getService().getUrl();
  template.loginMode = currentMode;
  
  return template.evaluate()
    .setTitle(template.appTitle || "タンク管理")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// 管理者用HTML生成
function createAdminPage(userInfo, userEmail) {
  var template = HtmlService.createTemplateFromFile('admin'); // ★管理者用ファイルを読み込み
  
  template.staffName = userInfo.name;
  template.userRole = userInfo.role;
  template.scriptUrl = ScriptApp.getService().getUrl(); 
  template.loginMode = getLoginMode();
  template.userEmail = userEmail || "";
  
  try { template.menuNames = MENU_NAMES; } catch(e) { template.menuNames = {}; }

  return template.evaluate()
    .setTitle("タンク管理ページ")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}