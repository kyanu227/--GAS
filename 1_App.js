// ■■■ 1_App.gs ■■■

function doGet(e) {
  var userEmail = getSafeUserEmail();
  var userInfo = getUserInfo(userEmail, '');

  // ▼ 現場用ページ (通常アクセスのみ)
  return createNormalPage(userInfo, userEmail, '');
}



/**
 * 現場用 HTML を生成して返す
 */
function createNormalPage(userInfo, userEmail, targetPage) {
  var template = HtmlService.createTemplateFromFile('index');

  var currentMode = getLoginMode();

  template.staffName = userInfo.name;
  template.userRole = userInfo.role;

  template.userEmail = userEmail;
  template.targetPage = targetPage || '';

  // 0_Config.gs の定数読み込みエラーに備えたフォールバック
  try { template.menuNames = MENU_NAMES; template.appTitle = APP_TITLE; }
  catch (e) { template.menuNames = {}; template.appTitle = "タンク管理"; }

  template.scriptUrl = ScriptApp.getService().getUrl();
  template.loginMode = currentMode;

  // 操作画面は常にダイヤル形式
  template.operationsView = 'Part_Operations_Dial';

  // 言語設定: G列が「英語」なら英語モード
  template.userLang = (userInfo.lang === '英語') ? 'en' : 'ja';

  return template.evaluate()
    .setTitle(template.appTitle || "タンク管理")
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}



function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getScriptUrl() {
  return ScriptApp.getService().getUrl();
}