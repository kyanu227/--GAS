/**
 * ダッシュボード用のデータを取得するメイン関数
 * HTML側から google.script.run.getDashboardData() で呼ばれます
 */
function getDashboardData() {
  // ■ 1. 返却データの初期化（エラーが起きても最低限これだけは返す）
  var result = {
    dateYear: "----", 
    dateDay: "--.--",
    total: 0, 
    lending: 0, 
    lendingToday: 0, 
    lendingLong: 0,
    unreturned: [], 
    damaged: [], 
    expired: [],
    todayLog: [], 
    weeklyLog: [],
    error: null
  };

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timeZone = ss.getSpreadsheetTimeZone() || 'Asia/Tokyo'; // スプレッドシートのタイムゾーンを使用
    var today = new Date();
    var todayStr = Utilities.formatDate(today, timeZone, 'yyyy/MM/dd');

    // ■ 2. 日付表示の作成
    result.dateYear = Utilities.formatDate(today, timeZone, 'yyyy');
    result.dateDay = Utilities.formatDate(today, timeZone, 'MM.dd E');

    // ■ 3. 設定・定数の安全な取得（ファイルまたぎのエラー回避）
    // シート名がグローバル定数にない場合のバックアップ
    var sStatus = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sLogBase = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.LOG) ? SHEET_NAMES.LOG : '履歴ログ';
    
    // 通知設定（期限判定用）のバックアップ
    var alertMonths = 6;
    if (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.ALERT_MONTHS) {
      alertMonths = NOTIFY_CONFIG.ALERT_MONTHS;
    }
    
    var warningLimitDate = new Date();
    warningLimitDate.setMonth(today.getMonth() + alertMonths);


    // =================================================================
    // ■ 4. ステータスシートの集計（在庫・未返却・期限アラート）
    // =================================================================
    var sheetStatus = ss.getSheetByName(sStatus);
    if (!sheetStatus) {
      // シートがない場合はエラーにせず、ゼロ件として続行（日付などは表示させるため）
      console.warn("Sheet not found: " + sStatus);
    } else {
      var data = sheetStatus.getDataRange().getValues();
      // データがある場合のみ処理（1行目はヘッダーと仮定）
      if (data.length > 1) {
        result.total = data.length - 1; // ヘッダー分を引く

        for (var i = 1; i < data.length; i++) {
          var row = data[i];
          // 列定義（想定）: [0]ID, [1]状態, [2]場所, [3]担当, [4]期限, [5]備考, [6]ログ用, [7]更新日
          
          var item = {
            id: String(row[0] || '-'),
            status: String(row[1] || ''),
            loc: String(row[2] || ''),
            staff: String(row[3] || ''),
            limitRaw: row[4],
            note: String(row[5] || ''),
            updateDateRaw: row[7]
          };

          // --- 集計ロジック ---

          // A. 貸出中・未返却のカウント
          if (item.status === '貸出中' || item.status === '未返却') {
            result.lending++;

            // 「本日」貸出したかどうかの判定
            var isTodayLend = false;
            if (isValidDate(item.updateDateRaw)) {
              var upStr = Utilities.formatDate(item.updateDateRaw, timeZone, 'yyyy/MM/dd');
              if (upStr === todayStr) isTodayLend = true;
            }

            if (isTodayLend) {
              result.lendingToday++;
            } else {
              result.lendingLong++;
              // 長期未返却リストに追加
              result.unreturned.push({
                id: item.id,
                loc: item.loc,
                note: item.note,
                status: item.status
              });
            }
          } 
          // B. 破損・修理系のカウント
          else if (['破損', '不良', '故障', '修理中', '要修理'].indexOf(item.status) !== -1) {
            result.damaged.push(item);
          }

          // C. 有効期限アラート（期限切れ・期限間近）
          // ※ 耐圧検査中や廃棄済みは対象外
          if (isValidDate(item.limitRaw) && item.status !== '耐圧検査' && item.status !== '廃棄') {
            var limitStr = Utilities.formatDate(item.limitRaw, timeZone, 'yyyy/MM/dd');
            var alertObj = {
              id: item.id,
              loc: item.loc,
              limit: limitStr,
              alertType: ''
            };

            if (limitStr < todayStr) {
              alertObj.alertType = 'expired'; // 期限切れ
              result.expired.push(alertObj);
            } else if (new Date(limitStr) <= warningLimitDate) {
              alertObj.alertType = 'warning'; // もうすぐ期限
              result.expired.push(alertObj);
            }
          }
        }
      }
    }

    // =================================================================
    // ■ 5. ログシートの集計（本日の作業一覧・週間履歴）
    // =================================================================
    // 今年のログシートを探す（例: 履歴ログ2024）。なければ基本名（履歴ログ）を探す。
    var currentYear = Utilities.formatDate(today, timeZone, 'yyyy');
    var sheetLog = ss.getSheetByName(sLogBase + currentYear);
    if (!sheetLog) sheetLog = ss.getSheetByName(sLogBase);

    if (sheetLog) {
      var logData = sheetLog.getDataRange().getValues();
      // 列定義（想定）: [0]UUID, [1]日付, [2]時間, [3]ID, [4]操作, [5]場所, [6]備考, [7]担当
      
      // データ量が多い場合の対策: 直近のデータから逆順に走査
      // ※最大2000件程度チェックすれば、通常の運用なら「本日」や「週間」は十分カバー可能
      var checkLimit = 2000;
      var count = 0;

      for (var i = logData.length - 1; i >= 1; i--) {
        if (count >= checkLimit) break;
        count++;

        var row = logData[i];
        var logDateRaw = row[1];
        if (!isValidDate(logDateRaw)) continue;

        var logDateStr = Utilities.formatDate(logDateRaw, timeZone, 'yyyy/MM/dd');
        
        // --- ログデータの整形 ---
        var timeStr = "";
        if (isValidDate(row[2])) {
          timeStr = Utilities.formatDate(row[2], timeZone, 'HH:mm');
        } else {
          timeStr = String(row[2] || '');
        }

        var logItem = {
          date: Utilities.formatDate(logDateRaw, timeZone, 'MM/dd'), // 表示用（10/25）
          fullDate: logDateStr, // フィルタ用
          time: timeStr,
          id: String(row[3] || '-'),
          action: String(row[4] || '-'),
          loc: String(row[5] || ''),
          note: String(row[6] || ''),
          staff: String(row[7] || '不明')
        };

        // A. 本日分のリストに追加
        if (logDateStr === todayStr) {
          result.todayLog.push(logItem);
        }

        // B. 週間履歴（過去7日以内）に追加
        // 今日のミリ秒 - ログ日付のミリ秒
        var diff = today.getTime() - logDateRaw.getTime();
        var diffDays = diff / (1000 * 60 * 60 * 24);
        
        if (diffDays <= 7 && diffDays >= -1) { // -1は未来日付の誤入力を許容する範囲
          result.weeklyLog.push(logItem);
        }
      }
    }

  } catch (e) {
    // エラー発生時、サーバーログに残しつつ、クライアントにはエラーメッセージを返す
    console.error(e.stack);
    result.error = "データ取得中にエラーが発生しました: " + e.message;
  }

  return result;
}

// -------------------------------------------------
// ヘルパー関数（内部利用のみ）
// -------------------------------------------------
function isValidDate(d) {
  if (!d) return false;
  return Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d.getTime());
}