// ファイル名: Feature_Billing.gs

// ■ 設定シート名
var SHEET_NAME_INV_CONFIG = "M_設定_請求";
// ■ ログシートの基本名（ここを固定）
var LOG_SHEET_PREFIX = "履歴ログ";

// -------------------------------------------------------
// 1. 共通: 現在の有効な設定情報を取得（シートから読み込み）
// -------------------------------------------------------
function getEffectiveConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. 0_Config.gs の定義をベースにする
  var config = (typeof INVOICE_CONFIG !== 'undefined') ? JSON.parse(JSON.stringify(INVOICE_CONFIG)) : {};

  // 2. 設定シートを探す
  var sheet = ss.getSheetByName(SHEET_NAME_INV_CONFIG);
  if (!sheet) {
    return config; // シートがない場合はデフォルト設定
  }

  // 3. シートから値を読み込んで上書き
  var data = sheet.getDataRange().getValues();
  var map = {};
  for (var i = 0; i < data.length; i++) {
    if (data[i][0]) map[data[i][0]] = data[i][1];
  }

  // キーのマッピング
  if (map["会社名"]) config.COMPANY = String(map["会社名"]);
  if (map["住所"]) config.ADDRESS = String(map["住所"]);
  if (map["電話番号"]) config.TEL = String(map["電話番号"]);
  if (map["登録番号"]) config.REG_NUM = String(map["登録番号"]);
  if (map["振込先"]) config.BANK_INFO = String(map["振込先"]);
  if (map["挨拶文"]) config.GREETING = String(map["挨拶文"]);
  if (map["備考"]) config.NOTE = String(map["備考"]);
  if (map["消費税率"]) config.TAX_RATE = Number(map["消費税率"]);
  if (map["請求日"]) config.BILL_DATE = String(map["請求日"]);

  // フォールバック
  if (!config.COMPANY) config.COMPANY = "株式会社 タンク管理";

  return config;
}

// -------------------------------------------------------
// 2. 設定の保存 (UIから呼び出し)
// -------------------------------------------------------
function saveInvoiceSettings(formData) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME_INV_CONFIG);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME_INV_CONFIG);
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 400);
  }

  var rows = [
    ["【請求書設定】", "（このシートは自動生成されました）"],
    ["会社名", formData.company],
    ["登録番号", formData.regNum],
    ["住所", formData.address],
    ["電話番号", formData.tel],
    ["消費税率", formData.taxRate],
    ["請求日", formData.billDate],
    ["振込先", formData.bankInfo],
    ["挨拶文", formData.greeting],
    ["備考", formData.note],
    ["最終更新", new Date()]
  ];

  sheet.clear();
  sheet.getRange(1, 1, rows.length, 2).setValues(rows);

  return { message: "設定を保存しました。" };
}

function getInvoiceSettings() {
  return getEffectiveConfig();
}

// -------------------------------------------------------
// 3. 請求対象月のリスト取得 (履歴ログYYYY を優先参照)
// -------------------------------------------------------
function getBillingMonths() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var months = [];
  var seen = {};

  var thisYear = new Date().getFullYear();
  // ★修正: 今年と去年をチェック
  var yearsToCheck = [thisYear, thisYear - 1];

  yearsToCheck.forEach(function (year) {
    // 1. まず「履歴ログ2025」形式を探す
    var logSheet = ss.getSheetByName(LOG_SHEET_PREFIX + year);

    // 2. なければ既存定義の SHEET_NAMES.LOG + year (例: ログ2025) を探す
    if (!logSheet && typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.LOG) {
      logSheet = ss.getSheetByName(SHEET_NAMES.LOG + year);
    }

    // 3. それでもなく、かつ今年なら「履歴ログ」単体や「ログ」単体を探す（念のため）
    if (!logSheet && year === thisYear) {
      logSheet = ss.getSheetByName(LOG_SHEET_PREFIX); // "履歴ログ"
      if (!logSheet && typeof SHEET_NAMES !== 'undefined') {
        logSheet = ss.getSheetByName(SHEET_NAMES.LOG); // "ログ"
      }
    }

    if (logSheet) {
      // B列の日付をスキャン
      var data = logSheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var dStr = data[i][1];
        if (dStr) {
          var d = new Date(dStr);
          if (!isNaN(d.getTime())) {
            // YYYY-MM
            var key = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
            if (!seen[key]) {
              seen[key] = true;
              months.push(key);
            }
          }
        }
      }
    }
  });

  // 新しい月が上に来るようにソート
  return months.sort().reverse();
}

// -------------------------------------------------------
// 4. 請求データの詳細生成 (複数月・年跨ぎ対応)
// -------------------------------------------------------
function getBillingDetail(monthsInput) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var config = getEffectiveConfig();

  var targetMonths = Array.isArray(monthsInput) ? monthsInput : [monthsInput];
  if (targetMonths.length === 0) return { month: "", issuer: config, list: [] };

  // A. マスタ取得
  var destName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.DEST) ? SHEET_NAMES.DEST : '貸出先リスト';
  var destSheet = ss.getSheetByName(destName);
  // もし上記で見つからなければ "取引先マスタ" も試す
  if (!destSheet) destSheet = ss.getSheetByName("取引先マスタ");

  var destData = destSheet ? destSheet.getDataRange().getValues() : [];
  var destMap = {};

  for (var i = 1; i < destData.length; i++) {
    var key = destData[i][0];
    if (key) {
      destMap[key] = {
        formalName: destData[i][1] || key + ' 御中',
        priceTaxIn: Number(destData[i][2]) || 0
      };
    }
  }

  // B. 集計処理
  var aggregations = {};

  targetMonths.forEach(function (monthStr) {
    if (!monthStr) return;

    var parts = monthStr.split('-');
    var tYear = parseInt(parts[0], 10);
    var tMonth = parseInt(parts[1], 10);

    // ★修正: シート特定の優先順位
    var logSheet = ss.getSheetByName(LOG_SHEET_PREFIX + tYear); // "履歴ログ2025"

    if (!logSheet && typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.LOG) {
      logSheet = ss.getSheetByName(SHEET_NAMES.LOG + tYear); // "ログ2025"
    }

    // フォールバック
    if (!logSheet) {
      logSheet = ss.getSheetByName(LOG_SHEET_PREFIX); // "履歴ログ"
      if (!logSheet && typeof SHEET_NAMES !== 'undefined') {
        logSheet = ss.getSheetByName(SHEET_NAMES.LOG); // "ログ"
      }
    }
    if (!logSheet) return;

    var logData = logSheet.getDataRange().getValues();

    // [0]UUID, [1]Date, [2]Time, [3]ID, [4]Action, [5]Dest
    for (var i = 1; i < logData.length; i++) {
      var d = new Date(logData[i][1]);
      var action = logData[i][4];
      var dest = logData[i][5];

      if (d instanceof Date && !isNaN(d) &&
        d.getFullYear() === tYear &&
        (d.getMonth() + 1) === tMonth) {

        if (dest && dest !== '自社利用' && dest !== '自社') {
          if (action === '貸出') {
            if (!aggregations[dest]) {
              var info = destMap[dest] || { formalName: dest, priceTaxIn: 0 };
              aggregations[dest] = {
                name: info.formalName,
                unitPrice: info.priceTaxIn,
                dates: {}
              };
            }

            // ソート用に完全な日付キーを使う
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var da = ('0' + d.getDate()).slice(-2);
            var fullDateKey = tYear + '/' + m + '/' + da;
            var dispDateKey = m + '/' + da;

            if (!aggregations[dest].dates[fullDateKey]) {
              aggregations[dest].dates[fullDateKey] = { disp: dispDateKey, count: 0 };
            }
            aggregations[dest].dates[fullDateKey].count++;

          } else if (action === '返却(未充填)' || action === '未使用返却') {
            // 貸出を取り消す（カウントを減らす）処理
            // ただし、返却日と同じ日に貸出があったとは限らないが、当月内の請求総数を減らすために
            // その返却日の日付キーでマイナスカウントを入れるか、既存のカウントを減らす
            if (!aggregations[dest]) {
              var info = destMap[dest] || { formalName: dest, priceTaxIn: 0 };
              aggregations[dest] = {
                name: info.formalName,
                unitPrice: info.priceTaxIn,
                dates: {}
              };
            }
            var m = ('0' + (d.getMonth() + 1)).slice(-2);
            var da = ('0' + d.getDate()).slice(-2);
            var fullDateKey = tYear + '/' + m + '/' + da;
            var dispDateKey = m + '/' + da;

            if (!aggregations[dest].dates[fullDateKey]) {
              aggregations[dest].dates[fullDateKey] = { disp: dispDateKey, count: 0 };
            }
            aggregations[dest].dates[fullDateKey].count--;
          }
        }
      }
    }
  });

  // C. 出力整形
  var billList = [];
  var taxRate = config.TAX_RATE || 0.10;

  for (var key in aggregations) {
    var item = aggregations[key];
    var details = [];
    var totalCount = 0;

    // 日付順ソート (YYYY/MM/DDのおかげで年越しも正しく並ぶ)
    var sortedKeys = Object.keys(item.dates).sort();

    sortedKeys.forEach(function (k) {
      var dObj = item.dates[k];
      var count = dObj.count;
      var amount = count * item.unitPrice;

      details.push({
        date: dObj.disp,
        itemName: "タンク貸出料",
        count: count,
        unitPrice: item.unitPrice,
        amount: amount
      });
      totalCount += count;
    });

    var totalTaxIn = totalCount * item.unitPrice;
    var tax = Math.floor(totalTaxIn * taxRate / (1 + taxRate));
    var amountNoTax = totalTaxIn - tax;

    billList.push({
      id: Utilities.getUuid(),
      name: item.name,
      details: details,
      totalCount: totalCount,
      amountNoTax: amountNoTax,
      tax: tax,
      total: totalTaxIn
    });
  }

  // 名前順ソート
  billList.sort(function (a, b) { return a.name.localeCompare(b.name, 'ja'); });

  return {
    month: targetMonths.join(','),
    issuer: config,
    list: billList
  };
}