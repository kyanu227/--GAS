// ■■■ Funk_Line_Webhook.gs : LINE Webhook 受信処理 ■■■
// 「ID教えて」と送信されたグループ/ルームのIDをそのまま返信する

function doPost(e) {
  var json = JSON.parse(e.postData.contents);
  var event = json.events[0];

  var replyToken = event.replyToken;
  var userMessage = event.message.text;

  var groupId = "";
  if (event.source.type === 'group') {
    groupId = event.source.groupId;
  } else if (event.source.type === 'room') {
    groupId = event.source.roomId;
  }

  if (userMessage.indexOf("ID教えて") !== -1) {
    var replyText = "このグループのIDはこちらです:\n" + (groupId ? groupId : "ここはグループではありません");
    replyLineMessage(replyToken, replyText);
  }
}

// LINE 返信送信 (このファイル内専用)
function replyLineMessage(replyToken, text) {
  var token = NOTIFY_CONFIG.LINE_CHANNEL_TOKEN;
  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + token
    },
    "method": "post",
    "payload": JSON.stringify({
      "replyToken": replyToken,
      "messages": [{ "type": "text", "text": text }]
    })
  });
}