// ■■■ 2_Utils.gs : ユーティリティ & 共通書き込み処理 ■■■

/**
 * 安全なユーザーメール取得 (匿名アクセス時のエラー回避)
 */
function getSafeUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || "";
  } catch (e) {
    return "";
  }
}

/**
 * IDの正規化
 */
function normalizeId(id) {
  if (id === null || id === undefined) return "";
  var s = String(id).toUpperCase();
  s = s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, function (s) { return String.fromCharCode(s.charCodeAt(0) - 0xFEE0); });
  return s.replace(/[-−\s_ー]/g, '');
}

/**
 * スマートマッチ
 */
function isIdMatch(id1, id2) {
  if (!id1 || !id2) return false;
  var s1 = normalizeId(id1);
  var s2 = normalizeId(id2);
  if (s1 === s2) return true;
  var m1 = s1.match(/^([A-Z]+)(\d+)$/);
  var m2 = s2.match(/^([A-Z]+)(\d+)$/);
  if (m1 && m2) {
    if (m1[1] === m2[1] && parseInt(m1[2], 10) === parseInt(m2[2], 10)) {
      return true;
    }
  }
  return false;
}

/**
 * ID整形関数 (完全版)
 */
function formatDisplayId(id) {
  if (!id) return "";
  var s = normalizeId(id);
  var mNum = s.match(/^([A-Z]+)(\d+)$/);
  if (mNum) {
    var prefix = mNum[1];
    var num = parseInt(mNum[2], 10);
    var suffix = (num < 10) ? '0' + num : '' + num;
    return prefix + '-' + suffix;
  }
  var mOK = s.match(/^([A-Z]+)(OK)$/);
  if (mOK) {
    return mOK[1] + '-' + mOK[2];
  }
  return String(id);
}

function getList(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().filter(String);
}

function getListWithCache(sheetName, durationSec) {
  if (!durationSec) durationSec = 43200;
  var cacheKey = "list_cache_" + sheetName;
  var cache = CacheService.getScriptCache();
  var cachedJson = cache.get(cacheKey);
  if (cachedJson) {
    return JSON.parse(cachedJson);
  }
  var list = getList(sheetName);
  if (list.length > 0) {
    try { cache.put(cacheKey, JSON.stringify(list), durationSec); } catch (e) { }
  }
  return list;
}

function clearMasterCaches() {
  var cache = CacheService.getScriptCache();
  cache.removeAll(["list_cache_貸出先リスト", "price_master_data", "repair_options", "order_master_data_v12", "TANK_PREFIXES", "ALL_TANK_STATUS_MAP"]);
  return { success: true, message: "マスタデータを最新化しました。" };
}

/**
 * ユーザー情報取得 (Googleアカウント・パスコード両対応)
 */
function getUserInfo(email, passcode) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STAFF) ? SHEET_NAMES.STAFF : '担当者リスト';
  var sheet = ss.getSheetByName(sheetName);

  var info = { name: "ゲスト", role: "一般", rank: "レギュラー", email: "" };
  var mode = getLoginMode();

  if (sheet) {
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
      for (var i = 0; i < data.length; i++) {
        var row = data[i];
        if (row[4] === '停止' || String(row[0]).indexOf('【停止】') === 0) continue;

        var dbName = row[0];
        var dbEmail = String(row[1]);
        var dbRole = row[2];
        var dbRank = row[3];
        var dbPass = String(row[5]);

        var isEmailMatch = (email && dbEmail === email);
        var isPassMatch = (passcode && dbPass && String(passcode).trim() === String(dbPass).trim());
        var isAdmin = (dbRole.indexOf('管理者') !== -1 || dbRole.indexOf('準管理者') !== -1 || String(dbRole).toLowerCase().indexOf('admin') !== -1);

        // パスコード一致、またはメールアドレス一致でアカウント特定
        if (isPassMatch || isEmailMatch) {
          var dbViewMode = (row.length > 6) ? String(row[6] || '') : '';
          return { name: dbName, role: dbRole, rank: dbRank || "レギュラー", email: dbEmail, viewMode: dbViewMode };
        }
      }
    }
  }
  if (info.name === "ゲスト" && email) {
    info.name = email;
  }
  return info;
}

function getCurrentLogSheet(ss) {
  var baseName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.LOG) ? SHEET_NAMES.LOG : '履歴ログ';
  var year = new Date().getFullYear();
  var targetName = baseName + year;
  var sheet = ss.getSheetByName(targetName);
  if (!sheet) {
    sheet = ss.insertSheet(targetName);
    sheet.appendRow(["UUID", "日時", "時刻", "タンクID", "操作", "場所", "備考", "担当者", "直前貸出先", "種別"]);
  }
  return sheet;
}

/**
 * ステータスシートへの書き込みと履歴ログ追記を行う共通関数
 * 列定義: A:ID, B:Status, C:Loc, D:Staff, E:Limit, F:Note, G:Log, H:Update, I:Type
 */
function writeToSheet(items, newStatus, newLoc, action, preLoadedData, optStaffName, optDirectPrevLoc) {
  if (!preLoadedData || !preLoadedData.data || !preLoadedData.idMap) {
    throw new Error("システムエラー: データが正しく引き継がれませんでした。");
  }

  var masterData = preLoadedData.data;
  var idMap = preLoadedData.idMap;
  var sheet = preLoadedData.sheet;
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var log = getCurrentLogSheet(ss);

  var staff = optStaffName;
  if (!staff) staff = getUserInfo(getSafeUserEmail()).name;

  var now = new Date();
  var timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm');

  var successIds = [];
  var failedItems = [];
  var logRows = [];

  items.forEach(function (item) {
    var rawId = item.id;
    var nTargetId = normalizeId(rawId);
    var noteText = item.note || "";
    var rowIndex = idMap[nTargetId];

    if (rowIndex !== undefined) {
      // 1. マスタデータから情報取得
      var officialId = masterData[rowIndex][0];
      var logId = formatDisplayId(officialId); // 整形

      // 場所(C列:index 2)を取得 (日付で上書きしないように注意)
      var recordPrevLoc = (optDirectPrevLoc !== undefined && optDirectPrevLoc !== null) ? optDirectPrevLoc : (masterData[rowIndex][2] || "");

      // 種別(I列:index 8)を取得
      var tankType = (masterData[rowIndex].length > 8) ? masterData[rowIndex][8] : "";

      // 2. ステータスシート更新
      masterData[rowIndex][1] = newStatus; // B: 状態
      masterData[rowIndex][2] = newLoc;    // C: ★場所 (以前のコードで日付になっていたのを修正)
      masterData[rowIndex][3] = staff;     // D: 担当

      // F: 備考
      if (newStatus === '空' || newStatus === '充填済み') {
        masterData[rowIndex][5] = "";
      }
      if (['破損', '不良', '故障'].indexOf(newStatus) !== -1) {
        if (noteText) masterData[rowIndex][5] = noteText;
      } else {
        masterData[rowIndex][6] = noteText ? noteText : ""; // G列(ログ用)
      }

      // H: 更新日時 (index 7)
      // I列(種別)は既存を維持
      while (masterData[rowIndex].length < 9) masterData[rowIndex].push("");
      masterData[rowIndex][7] = now;

      successIds.push(rawId);

      // 3. ログ行作成
      logRows.push([
        Utilities.getUuid(),
        now,
        timeStr,
        logId,
        action,
        newLoc,
        noteText,
        staff,
        recordPrevLoc,
        tankType  // 種別も記録              
      ]);
    } else {
      failedItems.push({ id: rawId, reason: "ID未登録・不一致" });
    }
  });

  if (successIds.length > 0) {
    var maxCols = 9; // I列までカバー
    for (var i = 0; i < masterData.length; i++) {
      while (masterData[i].length < maxCols) masterData[i].push("");
    }
    // ステータス更新
    sheet.getRange(1, 1, masterData.length, maxCols).setValues(masterData);

    // ログ追記
    if (logRows.length > 0) {
      var lastRow = log.getLastRow();
      log.getRange(lastRow + 1, 1, logRows.length, logRows[0].length).setValues(logRows);
    }
    SpreadsheetApp.flush();
  }

  return {
    success: true,
    message: successIds.length + "件の処理が完了しました",
    successIds: successIds,
    failedItems: failedItems,
    totalCount: items.length
  };
}

// -----------------------------------------------------------
// 以下、設定系ユーティリティ
// -----------------------------------------------------------

function deleteRowByUuid(ss, sheetName, uuid, uuidColIndex) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return false;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][uuidColIndex]) === String(uuid)) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

function getNotificationSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.CONFIG_NOTIFY) ? SHEET_NAMES.CONFIG_NOTIFY : 'M_設定_通知';
  var sheet = ss.getSheetByName(sheetName);
  var defaults = {
    alertMonths: (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.ALERT_MONTHS) ? NOTIFY_CONFIG.ALERT_MONTHS : 6,
    validityYears: (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.VALIDITY_YEARS) ? NOTIFY_CONFIG.VALIDITY_YEARS : 3,
    emails: (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.EMAILS) ? NOTIFY_CONFIG.EMAILS : [],
    lineTokens: (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.LINE_TOKENS) ? NOTIFY_CONFIG.LINE_TOKENS : []
  };
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    var initData = [
      ["設定_通知月数(ヶ月前)", defaults.alertMonths],
      ["設定_有効期限(年)", defaults.validityYears],
      ["---", "---"],
      ["【通知先メールリスト】", "【LINEトークンリスト】"]
    ];
    sheet.getRange(1, 1, initData.length, 2).setValues(initData);
    return defaults;
  }
  try {
    var lastRow = sheet.getLastRow();
    var data = (lastRow > 0) ? sheet.getDataRange().getValues() : [];
    var alertMonths = (data.length > 0 && data[0][1] !== "") ? Number(data[0][1]) : defaults.alertMonths;
    var validityYears = (data.length > 1 && data[1][1] !== "") ? Number(data[1][1]) : defaults.validityYears;
    var emails = [];
    var tokens = [];
    for (var i = 4; i < data.length; i++) {
      if (data[i][0]) emails.push(String(data[i][0]).trim());
      if (data[i].length > 1 && data[i][1]) tokens.push(String(data[i][1]).trim());
    }
    return { alertMonths: alertMonths, validityYears: validityYears, emails: emails, lineTokens: tokens };
  } catch (e) {
    return defaults;
  }
}

function getLoginMode() {
  return PropertiesService.getScriptProperties().getProperty('LOGIN_MODE') || 'GOOGLE';
}

function saveLoginMode(mode) {
  PropertiesService.getScriptProperties().setProperty('LOGIN_MODE', mode);
  return "ログインモードを「" + (mode === 'GOOGLE' ? 'Googleアカウント優先' : 'パスコード必須') + "」に変更しました。";
}

function verifyPasscode(inputPass) {
  var user = getUserInfo(null, inputPass);
  if (user.name !== "ゲスト") {
    return { success: true, user: user };
  }
  return { success: false, message: "パスコードが正しくありません" };
}

/**
 * 日付オブジェクトの妥当性チェック
 * Admin.js・Feature_Dashboard.js で重複定義されていたものを統合
 */
function isValidDate(d) {
  if (!d) return false;
  return Object.prototype.toString.call(d) === "[object Date]" && !isNaN(d.getTime());
}

/**
 * ビューモード保存 (担当者リスト G列)
 * @param {string} passcode - ユーザーのパスコード
 * @param {string} viewMode - "リスト" or "ダイヤル"
 */
function saveViewMode(passcode, viewMode, optStaffName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STAFF) ? SHEET_NAMES.STAFF : '担当者リスト';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return { success: false, message: "担当者リストが見つかりません" };

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: false, message: "担当者データがありません" };

  var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  for (var i = 0; i < data.length; i++) {
    var dbName = String(data[i][0]);
    var dbPass = String(data[i][5]);
    var stopFlag = data[i][4];

    if (stopFlag === '停止' || String(dbName).indexOf('【停止】') === 0) continue;

    var isNameMatch = (optStaffName && dbName === optStaffName);
    var isPassMatch = (!optStaffName && passcode && dbPass && String(passcode).trim() === dbPass.trim());

    if (isNameMatch || isPassMatch) {
      sheet.getRange(i + 2, 7).setValue(viewMode);
      return { success: true, message: "ビューモードを「" + viewMode + "」に変更しました" };
    }
  }
  return { success: false, message: "ユーザーが見つかりません" };
}