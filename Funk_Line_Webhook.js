// ファイル名: Func_Line_Webhook.gs

function doPost(e) {
  // LINEからデータが届いた時の処理
  var json = JSON.parse(e.postData.contents);
  var event = json.events[0];
  
  // 返信用のトークン
  var replyToken = event.replyToken;
  var userMessage = event.message.text;
  
  // IDを取得
  var groupId = "";
  if (event.source.type === 'group') {
    groupId = event.source.groupId;
  } else if (event.source.type === 'room') {
    groupId = event.source.roomId;
  }
  
  // もし「ID教えて」と打たれたら、IDを返信する
  if (userMessage.indexOf("ID教えて") !== -1) {
    var replyText = "このグループのIDはこちらです:\n" + (groupId ? groupId : "ここはグループではありません");
    replyLineMessage(replyToken, replyText);
  }
}

// 返信実行用（このファイル内だけで使う関数）
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