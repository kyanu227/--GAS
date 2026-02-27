// ■■■ 1_App.gs ■■■

function doGet(e) {
  var urlPasscode = (e.parameter && e.parameter.passcode) ? e.parameter.passcode : '';
  var userEmail = getSafeUserEmail();
  var userInfo = getUserInfo(userEmail, urlPasscode);

  // ▼ 現場用ページ (通常アクセスのみ)
  return createNormalPage(userInfo, userEmail, '', urlPasscode);
}



/**
 * 現場用 HTML を生成して返す
 */
function createNormalPage(userInfo, userEmail, targetPage, urlPasscode) {
  var template = HtmlService.createTemplateFromFile('index');

  var currentMode = getLoginMode();
  var isSpecialUser = (userInfo.role.indexOf('管理者') !== -1 || userInfo.role.indexOf('準管理者') !== -1);

  // パスコードモードかつ非特権ユーザーはゲスト表示
  if (currentMode === 'PASSCODE' && !isSpecialUser) {
    template.staffName = "ゲスト";
    template.userRole = "一般";
  } else {
    template.staffName = userInfo.name;
    template.userRole = userInfo.role;
  }

  template.userEmail = userEmail;
  // URLパラメータ由来のパスコードを渡す (自動ログインに利用)
  template.foundPasscode = urlPasscode || "";
  template.targetPage = targetPage || '';

  // 0_Config.gs の定数読み込みエラーに備えたフォールバック
  try { template.menuNames = MENU_NAMES; template.appTitle = APP_TITLE; }
  catch (e) { template.menuNames = {}; template.appTitle = "タンク管理"; }

  template.scriptUrl = ScriptApp.getService().getUrl();
  template.loginMode = currentMode;

  return template.evaluate()
    .setTitle(template.appTitle || "タンク管理")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}



function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}