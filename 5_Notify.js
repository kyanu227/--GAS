// ■■■ 5_Notify.gs : 通知・アラート機能 (LINE Messaging API 対応) ■■■

/**
 * 耐圧検査期限切れアラート — 月次トリガーで実行
 * LINE/メール通知の用途区分: 'INSPECTION'
 */
function checkHydrostaticDeadline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_NAMES.STATUS);
  if (!sheet) return;
  
  var props = PropertiesService.getScriptProperties();
  var alertMonths = Number(props.getProperty('ALERT_MONTHS')) || 6;
  var emails = [];
  try { emails = JSON.parse(props.getProperty('NOTIFY_EMAILS')); } catch(e){}

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const data = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const limitDate = new Date();
  limitDate.setMonth(today.getMonth() + alertMonths);
  
  let alertList = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const tankId = row[0];
    const status = row[1];
    const nextInspDate = row[4];
    if (status === '耐圧検査' || status === '廃棄') continue;
    if (Object.prototype.toString.call(nextInspDate) === "[object Date]" && !isNaN(nextInspDate)) {
      if (nextInspDate <= limitDate) {
        var dId = (typeof formatDisplayId === 'function') ? formatDisplayId(tankId) : tankId;
        alertList.push({
          id: dId,
          date: nextInspDate,
          formattedDate: Utilities.formatDate(nextInspDate, Session.getScriptTimeZone(), 'yyyy/MM/dd')
        });
      }
    }
  }
  
  if (alertList.length > 0) {
    alertList.sort((a, b) => a.date - b.date);
    const listBody = alertList.map(item => `${(item.date < today) ? "●期限切" : " "} ${item.id} : ${item.formattedDate}`).join('\n');
    
    var header = (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.MSG_HEADER) ? NOTIFY_CONFIG.MSG_HEADER : "【耐圧検査アラート】";
    var footer = (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.MSG_FOOTER) ? NOTIFY_CONFIG.MSG_FOOTER : "";

    const message = header + "\n\n" +
      "【対象期間】\n" + Utilities.formatDate(limitDate, Session.getScriptTimeZone(), 'yyyy/MM/dd') + " まで\n\n" +
      "【該当タンク一覧 (" + alertList.length + "本)】\n" +
      "-----------------------------\n" +
      listBody + "\n" +
      "-----------------------------\n\n" +
      footer;

    // メール送信
    if (emails && emails.length > 0) {
      emails.forEach(email => {
        if (email && email.trim() !== '') {
          try { MailApp.sendEmail({ to: email, subject: `【${APP_TITLE}】耐圧検査アラート (${alertList.length}件)`, body: message }); } catch(e) {}
        }
      });
    }

    // LINE送信 (用途: INSPECTION)
    sendLineBroadcastOrPush(message, 'INSPECTION');
  }
}

/**
 * 貸出0件アラート — 日次トリガーで実行
 * LINE通知の用途区分: 'DAILY'
 */
function checkDailyLendingCount() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.LOG); 
  if (!sheet) return;

  var today = new Date();
  var todayStr = Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy/MM/dd');
  var data = sheet.getDataRange().getDisplayValues(); 
  
  var lendCount = 0;
  var COL_DATE = 1;   // B列: 日付
  var COL_ACTION = 4; // E列: 操作内容

  for (var i = 1; i < data.length; i++) {
    var rowDate = data[i][COL_DATE];   
    var rowAction = data[i][COL_ACTION];
    if (rowDate === todayStr && rowAction === '貸出') {
      lendCount++;
    }
  }

  if (lendCount === 0) {
    var message = "【配達忘れはありませんか?】\n" + todayStr + "\n本日のタンク貸出件数は「0件」でした。\n配達忘れがないか、今一度タンク配達のLINEを確認してください。";
    // LINE送信 (用途: DAILY)
    sendLineBroadcastOrPush(message, 'DAILY');
  } else {
    console.log("本日の貸出: " + lendCount + "件");
  }
}

/**
 * LINE Messaging API でメッセージを送信する共通関数
 * @param {string} message - 送信するメッセージ本文
 * @param {string} type    - 通知の種類 ('ALL' / 'INSPECTION' / 'DAILY' など)
 *                           各 LINE 設定の targets 配列と照合して送信先を決定する
 */
function sendLineBroadcastOrPush(message, type) {
  var props = PropertiesService.getScriptProperties();
  var configs = [];
  try {
    var json = props.getProperty('LINE_CONFIGS');
    if (json) configs = JSON.parse(json);
  } catch(e) {}

  if (configs.length === 0) {
    // 旧設定互換
    var oldToken = props.getProperty('LINE_CHANNEL_TOKEN');
    if (oldToken) {
      configs.push({ token: oldToken, groupId: props.getProperty('LINE_GROUP_ID'), targets: ['ALL'] });
    }
  }

  if (configs.length === 0) {
    console.log("LINE設定がないため送信スキップ");
    return;
  }

  configs.forEach(function(conf) {
    var token = conf.token;
    if (!token) return;

    // targetsは配列であることを保証、なければ空配列
    var targets = Array.isArray(conf.targets) ? conf.targets : [];
    
    // 旧データとの互換: target が文字列で残っている場合は配列に変換
    if (conf.target && !conf.targets) {
      targets = (conf.target === 'ALL') ? ['ALL'] : [conf.target];
    }

    var reqType = type || 'ALL';

    // 送信判定: targets に 'ALL' が含まれるか、今回の type が一致するか、または reqType が 'ALL'
    var shouldSend = targets.includes('ALL') || targets.includes(reqType) || reqType === 'ALL';

    if (!shouldSend) return;

    // 送信実行
    var url = "";
    var payload = { "messages": [{ "type": "text", "text": message }] };
    var groupId = conf.groupId;

    if (groupId) {
      url = "https://api.line.me/v2/bot/message/push";
      payload.to = groupId;
    } else {
      url = "https://api.line.me/v2/bot/message/broadcast";
    }

    try {
      UrlFetchApp.fetch(url, {
        "method": "post",
        "headers": { "Authorization": "Bearer " + token, "Content-Type": "application/json" },
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
      });
    } catch (e) {
      console.error("LINE送信エラー (" + (conf.name || "名称なし") + "): " + e.message);
    }
  });
}

/**
 * テスト実行用 (エディタから手動実行)
 */
function testLineSend() {
  sendLineBroadcastOrPush("【テスト通知】\n設定は正しく完了しています。\nこのメッセージが届いていればOKです！", 'ALL');
}