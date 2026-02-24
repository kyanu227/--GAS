// ■■■ Feature_Settings.gs : マスタ設定管理機能 (完全統合版・複数LINE対応) ■■■

/**
 * メールアドレスから強制的に管理者権限を確認する関数
 */
function forceCheckAdminByEmail(email) {
  if (!email) return false;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet) return false;
    var data = sheet.getDataRange().getValues();
    for (var i = 1; i < data.length; i++) {
      var rowEmail = String(data[i][1] || "").replace('【停止】', '').trim();
      var rowRole = String(data[i][2] || "");
      if (rowEmail === email) {
        if (rowRole.indexOf('管理者') !== -1 || rowRole.toLowerCase().indexOf('admin') !== -1) {
          return true;
        }
      }
    }
  } catch (e) {
    console.error("Admin Check Error: " + e.message);
  }
  return false;
}

/**
 * 初期データ取得
 */
function getSettingsInitData(userPasscode) {
  try {
    var userEmail = Session.getActiveUser().getEmail();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ssMoney = getMoneySS(); // 3_Money.gs

    var userInfo = getUserInfo(userEmail, userPasscode);
    var isRealAdmin = forceCheckAdminByEmail(userEmail);
    var role = userInfo.role || "";
    var isFullAdmin = isRealAdmin || (role.indexOf('管理者') !== -1 && role.indexOf('準') === -1);
    var isSemiAdmin = (role.indexOf('準管理者') !== -1);

    // 1. 担当者リスト
    var staffSheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    var staffData = staffSheet ? staffSheet.getDataRange().getValues() : [];
    var staffList = [];

    for (var i = 1; i < staffData.length; i++) {
      var row = staffData[i];
      var rawEmail = (row.length > 1 && row[1]) ? String(row[1]) : "";
      var targetRole = (row.length > 2 && row[2]) ? String(row[2]) : "一般";
      var rawStatus = (row.length > 4 && row[4]) ? String(row[4]) : "";
      var rawPass = (row.length > 5 && row[5]) ? String(row[5]) : "";

      var isStopped = (rawStatus === '停止') || (rawEmail.indexOf('【停止】') === 0);
      var cleanEmail = rawEmail.replace('【停止】', '');
      var cleanPass = rawPass.replace('【停止】', '');

      var canViewPass = false;
      if (isFullAdmin) {
        canViewPass = true;
      } else if (isSemiAdmin) {
        if (targetRole.indexOf('管理者') === -1) canViewPass = true;
      }

      staffList.push({
        name: row[0],
        email: cleanEmail,
        role: row[2],
        rank: row[3],
        status: isStopped ? '停止' : '稼働',
        passcode: canViewPass ? cleanPass : ""
      });
    }

    // 2. 貸出先リスト
    var destSheet = ss.getSheetByName(SHEET_NAMES.DEST);
    var destData = destSheet ? destSheet.getDataRange().getValues() : [];
    var destList = [];

    for (var i = 1; i < destData.length; i++) {
      var row = destData[i];
      var rawName = (row.length > 0 && row[0]) ? String(row[0]) : "";
      var price10 = 0, price12 = 0, rawStatus = "";

      if (row.length >= 5) {
        price10 = row[2]; price12 = row[3]; rawStatus = row[4];
      } else {
        price10 = (row.length > 2) ? row[2] : 0;
        price12 = 0;
        rawStatus = (row.length > 3) ? row[3] : "";
      }

      var isStopped = (rawStatus === '停止') || (rawName.indexOf('【停止】') === 0);
      destList.push({
        name: rawName.replace('【停止】', ''),
        formalName: row[1],
        price10: price10,
        price12: price12,
        status: isStopped ? '停止' : '稼働'
      });
    }

    // 3. 発注マスタ
    var orderSheetName = (typeof MONEY_CONFIG !== 'undefined' && MONEY_CONFIG.SHEET_ORDER_MASTER) ? MONEY_CONFIG.SHEET_ORDER_MASTER : "M_設定_発注";
    var orderSheet = ssMoney.getSheetByName(orderSheetName);
    var orderData = orderSheet ? orderSheet.getDataRange().getValues() : [];
    var orderList = [];
    for (var i = 1; i < orderData.length; i++) {
      orderList.push({ colA: orderData[i][0], colB: orderData[i][1], price: orderData[i][2] });
    }

    // 4. 通知設定 & ログインモード
    var props = PropertiesService.getScriptProperties();
    var lineConfigs = [];
    try {
      var json = props.getProperty('LINE_CONFIGS');
      if (json) lineConfigs = JSON.parse(json);
    } catch (e) { }

    // メール設定
    var emails = [];
    try {
      var jsonEmails = props.getProperty('NOTIFY_EMAILS');
      if (jsonEmails) emails = JSON.parse(jsonEmails);
      else if (typeof NOTIFY_CONFIG !== 'undefined' && NOTIFY_CONFIG.EMAILS) emails = NOTIFY_CONFIG.EMAILS;
    } catch (e) { }

    var notifyConfig = {
      alertMonths: Number(props.getProperty('ALERT_MONTHS')) || 6,
      validityYears: Number(props.getProperty('VALIDITY_YEARS')) || 3,
      emails: emails,
      lineConfigs: lineConfigs
    };

    var currentLoginMode = getLoginMode();

    return {
      success: true,
      staff: staffList,
      dest: destList,
      orderMaster: orderList,
      notify: notifyConfig,
      loginMode: currentLoginMode,
      currentUser: userInfo
    };

  } catch (e) {
    return { success: false, message: "データ取得エラー: " + e.message };
  }
}

/**
 * 担当者リストの更新
 */
function updateStaffMaster(data) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.STAFF);
    if (!sheet) throw new Error("担当者シートが見つかりません");

    var newList = data.list || [];
    var userPasscode = data.userPasscode || "";
    var userEmail = Session.getActiveUser().getEmail();

    var isRealAdmin = forceCheckAdminByEmail(userEmail);
    var currentUser = getUserInfo(userEmail, userPasscode);
    var role = currentUser.role || "";

    var isFullAdmin = isRealAdmin || (role.indexOf('管理者') !== -1 && role.indexOf('準') === -1);
    var isSemiAdmin = (role.indexOf('準管理者') !== -1);

    var currentData = sheet.getDataRange().getValues();
    var currentStaffMap = {};
    for (var i = 1; i < currentData.length; i++) {
      var cEmail = String(currentData[i][1] || "").replace('【停止】', '');
      var info = {
        role: currentData[i][2], rank: currentData[i][3],
        passcode: (currentData[i].length > 5) ? String(currentData[i][5]) : ""
      };
      if (cEmail) currentStaffMap[cEmail] = info;
    }

    var logEntries = [];
    var now = new Date();
    var timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm');

    var writeRows = newList.map(function (item) {
      var status = item.status || '稼働';
      var email = String(item.email).trim();
      var inputPass = item.passcode ? String(item.passcode).trim() : "";

      if (status === '停止') {
        if (email.indexOf('【停止】') !== 0) email = '【停止】' + email;
        if (inputPass && inputPass.indexOf('【停止】') !== 0) inputPass = '【停止】' + inputPass;
      } else {
        email = email.replace('【停止】', '');
        inputPass = inputPass.replace('【停止】', '');
      }

      var plainEmail = email.replace('【停止】', '');
      var existing = currentStaffMap[plainEmail];
      var targetRole = existing ? existing.role : item.role;

      if (!isFullAdmin) {
        if (existing) {
          item.role = existing.role; item.rank = existing.rank;
        } else {
          item.role = "一般"; item.rank = "レギュラー";
        }
        if (isSemiAdmin && String(targetRole).indexOf('管理者') === -1) {
          // OK
        } else {
          if (existing) inputPass = existing.passcode; else inputPass = "";
        }
      } else {
        if (existing && existing.passcode !== inputPass) {
          logEntries.push([
            Utilities.getUuid(), now, timeStr, "SYSTEM", "パスコード変更", "管理画面",
            item.name + "のパスコードを変更", currentUser.name || userEmail
          ]);
        }
      }
      return [item.name, email, item.role, item.rank, status, inputPass];
    });

    var lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    }

    if (writeRows.length > 0) {
      var numRows = writeRows.length;
      var numCols = 6;
      if (sheet.getMaxColumns() < numCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), numCols - sheet.getMaxColumns());

      var headers = sheet.getRange(1, 1, 1, numCols).getValues()[0];
      if (!headers[4]) sheet.getRange(1, 5).setValue("ステータス");
      if (!headers[5]) sheet.getRange(1, 6).setValue("パスコード");

      sheet.getRange(2, 1, numRows, numCols).setValues(writeRows);
    }

    if (logEntries.length > 0) {
      var logSheet = getCurrentLogSheet(ss);
      logSheet.getRange(logSheet.getLastRow() + 1, 1, logEntries.length, 8).setValues(logEntries);
    }

    if (typeof clearMasterCaches === 'function') clearMasterCaches();

    var msg = "担当者リストを更新しました。";
    if (!isFullAdmin) msg += "\n※権限・ランクの変更は管理者にのみ許可されています。";

    return { success: true, message: msg };
  } catch (e) {
    return { success: false, message: "保存エラー: " + e.message };
  }
}

/**
 * ログインモード設定の保存
 */
function saveLoginSettings(data) {
  try {
    var mode = data.mode;
    var userPasscode = data.userPasscode || "";
    var userEmail = Session.getActiveUser().getEmail();
    var isRealAdmin = forceCheckAdminByEmail(userEmail);
    var currentUser = getUserInfo(userEmail, userPasscode);
    var role = currentUser.role || "";
    var isFullAdmin = isRealAdmin || (role.indexOf('管理者') !== -1 && role.indexOf('準') === -1);

    if (!isFullAdmin) {
      return { success: false, message: "ログイン設定を変更する権限がありません。" };
    }

    saveLoginMode(mode);

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = getCurrentLogSheet(ss);
    var now = new Date();
    var timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm');
    var modeText = (mode === 'GOOGLE') ? 'Google優先' : 'パスコード必須';

    logSheet.appendRow([
      Utilities.getUuid(), now, timeStr, "SYSTEM", "設定変更", "管理画面",
      "ログインモードを「" + modeText + "」に変更", currentUser.name || userEmail
    ]);

    return { success: true, message: "ログインモードを更新しました: " + modeText };
  } catch (e) {
    return { success: false, message: "エラー: " + e.message };
  }
}

/**
 * 貸出先リストの更新
 */
function updateDestMaster(data) {
  try {
    var newList = data.list || [];
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_NAMES.DEST);
    if (!sheet) throw new Error("貸出先シートが見つかりません");

    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();

    if (newList && newList.length > 0) {
      var writeRows = newList.map(function (d) {
        var status = d.status || '稼働';
        var name = String(d.name);
        if (status === '停止') {
          if (name.indexOf('【停止】') !== 0) name = '【停止】' + name;
        } else {
          name = name.replace('【停止】', '');
        }
        return [name, d.formalName, d.price10, d.price12, status];
      });

      var numCols = writeRows[0].length;
      if (sheet.getMaxColumns() < numCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), numCols - sheet.getMaxColumns());

      var currentHeaders = sheet.getRange(1, 1, 1, numCols).getValues()[0];
      if (sheet.getLastColumn() < 5 || currentHeaders[2] === '単価') {
        sheet.getRange(1, 3).setValue("単価(10L)");
        sheet.getRange(1, 4).setValue("単価(12L)");
        sheet.getRange(1, 5).setValue("ステータス");
      }

      sheet.getRange(2, 1, writeRows.length, numCols).setValues(writeRows);
    }

    if (typeof clearMasterCaches === 'function') clearMasterCaches();
    return { success: true, message: "貸出先リストを更新しました。" };
  } catch (e) { return { success: false, message: "保存エラー: " + e.message }; }
}

function updateOrderMaster(data) {
  try {
    var newList = data.list || [];
    var ssMoney = getMoneySS();
    var orderSheetName = (typeof MONEY_CONFIG !== 'undefined' && MONEY_CONFIG.SHEET_ORDER_MASTER) ? MONEY_CONFIG.SHEET_ORDER_MASTER : "M_設定_発注";
    var sheet = ssMoney.getSheetByName(orderSheetName);
    if (!sheet) {
      sheet = ssMoney.insertSheet(orderSheetName);
      sheet.appendRow(["種類/順", "容量/品名", "単価"]);
    }
    var lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    if (newList && newList.length > 0) {
      var rows = newList.map(function (item) {
        return [item.colA, item.colB, item.price];
      });
      sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    }
    if (typeof clearMasterCaches === 'function') clearMasterCaches();
    return { success: true, message: "発注品目マスタを更新しました。" };
  } catch (e) { return { success: false, message: "保存エラー: " + e.message }; }
}

/**
 * ★修正: 通知・期限設定の保存 (複数LINE & 複数選択対応)
 * targets配列をそのままJSONとして保存します
 */
function updateNotifySettings(data) {
  try {
    var props = PropertiesService.getScriptProperties();

    // 1. 基本設定
    props.setProperty('ALERT_MONTHS', String(data.alertMonths));
    props.setProperty('VALIDITY_YEARS', String(data.validityYears));

    // 2. メールアドレス
    if (data.emails && Array.isArray(data.emails)) {
      props.setProperty('NOTIFY_EMAILS', JSON.stringify(data.emails));
    }

    // 3. LINE設定
    if (data.lineConfigs && Array.isArray(data.lineConfigs)) {
      var cleaned = data.lineConfigs.map(function (c) {
        // targetsがなければデフォルトとしてALLを入れる
        var t = (Array.isArray(c.targets) && c.targets.length > 0) ? c.targets : ['ALL'];
        return {
          name: String(c.name || ""),
          token: String(c.token || "").trim(),
          groupId: String(c.groupId || "").trim(),
          targets: t // 配列として保存
        };
      });
      props.setProperty('LINE_CONFIGS', JSON.stringify(cleaned));

      // シングル設定(旧互換)
      if (cleaned.length > 0) {
        props.setProperty('LINE_CHANNEL_TOKEN', cleaned[0].token);
        props.setProperty('LINE_GROUP_ID', cleaned[0].groupId);
      }
    }

    return { success: true, message: "通知・システム設定を保存しました。" };
  } catch (e) {
    return { success: false, message: "保存エラー: " + e.message };
  }
}

/**
 * 金銭・ランク設定の保存 (管理者専用)
 */
function updateMoneySettings(data) {
  try {
    var ssMoney = getMoneySS();

    // 1. 単価マスタの更新
    if (data.prices && data.prices.length > 0) {
      var priceSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_PRICE || "M_設定_単価");
      if (priceSheet) {
        var headers = priceSheet.getRange(1, 1, 1, priceSheet.getLastColumn()).getValues()[0];
        // headers = ["作業名", "基本経費", "獲得スコア", "レギュラー加算", "ブロンズ加算", ...] と想定

        var writePrices = data.prices.map(function (p) {
          var row = [p.action, p.base, p.score];
          for (var col = 3; col < headers.length; col++) {
            var rName = String(headers[col]).replace(/加算/g, "").replace(/\(円\)|（円）/g, "").trim();
            row.push(p.rankAdd[rName] !== undefined ? p.rankAdd[rName] : 0);
          }
          return row;
        });

        var pLastRow = priceSheet.getLastRow();
        if (pLastRow > 1) priceSheet.getRange(2, 1, pLastRow - 1, priceSheet.getLastColumn()).clearContent();
        priceSheet.getRange(2, 1, writePrices.length, writePrices[0].length).setValues(writePrices);
      }
    }

    // 2. ランクマスタの更新
    if (data.ranks && data.ranks.length > 0) {
      var rankSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_RANK || "M_設定_ランク");
      if (rankSheet) {
        // ランクシートは A列:ID, B列:ランク名, C列:必要スコア と想定
        var writeRanks = data.ranks.map(function (r, idx) {
          return [idx + 1, r.name, r.minScore];
        });

        var rLastRow = rankSheet.getLastRow();
        if (rLastRow > 1) rankSheet.getRange(2, 1, rLastRow - 1, 3).clearContent();
        rankSheet.getRange(2, 1, writeRanks.length, 3).setValues(writeRanks);
      }
    }

    // キャッシュのクリア（変更を即反映するため）
    var cache = CacheService.getScriptCache();
    cache.remove("PRICE_MASTER");
    cache.remove("RANK_MASTER");

    return { success: true, message: "金銭設定とランク条件を更新しました。\nシステムに即座に反映されます。" };

  } catch (e) {
    return { success: false, message: "保存エラー: " + e.message };
  }
}

/**
 * 金銭・ランク設定の取得 (管理者専用)
 */
function getMoneySettingsData() {
  try {
    var ssMoney = getMoneySS(); // 3_Money.gs
    var moneyPrices = [];
    var moneyRanks = [];

    // 1. 単価マスタ取得
    var priceSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_PRICE || "M_設定_単価");
    if (priceSheet) {
      var pData = priceSheet.getDataRange().getValues();
      var headers = pData[0];
      for (var p = 1; p < pData.length; p++) {
        var actionName = pData[p][0];
        if (!actionName) continue;
        var basePrice = Number(pData[p][1]) || 0;
        var score = Number(pData[p][2]) || 0;
        var rankAdd = {};
        for (var col = 3; col < headers.length; col++) {
          var rName = String(headers[col]).replace(/加算/g, "").replace(/\(円\)|（円）/g, "").trim();
          rankAdd[rName] = Number(pData[p][col]) || 0;
        }
        moneyPrices.push({ action: actionName, base: basePrice, score: score, rankAdd: rankAdd });
      }
    }

    // 2. ランクマスタ取得
    var rankSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_RANK || "M_設定_ランク");
    if (rankSheet) {
      var rData = rankSheet.getDataRange().getValues();
      for (var r = 1; r < rData.length; r++) {
        var rankName = rData[r][1];
        if (!rankName) continue;
        moneyRanks.push({ name: rankName, minScore: Number(rData[r][2]) || 0 });
      }
    }

    return { success: true, prices: moneyPrices, ranks: moneyRanks };
  } catch (e) {
    return { success: false, message: "データ取得エラー: " + e.message };
  }
}