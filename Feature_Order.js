// ■■■ Feature_Order.gs : 資材発注機能 ■■■

/**
 * 既存タンクIDの一覧を取得 (タンク購入時の重複チェック用)
 */
function getExistingTankIds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAMES.STATUS);
  if (!sheet) return [];

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  // A列(ID列)のみ取得してフラットな配列にする
  var data = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var list = data.map(function (row) { return String(row[0]); }).filter(function (id) { return id !== ""; });

  return list;
}

/**
 * 発注画面の初期データ取得 (資材一覧・タンク種別一覧)
 */
function getOrderInitData() {
  var cache = CacheService.getScriptCache();
  var cacheKey = "order_master_data_v12";
  var cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  var result = { supplies: [], tanks: [] };
  try {
    var ss = SpreadsheetApp.openById(MONEY_CONFIG.SPREADSHEET_ID);
    var sheetName = MONEY_CONFIG.SHEET_ORDER_MASTER || "M_設定_発注";
    var sheet = ss.getSheetByName(sheetName);

    if (sheet) {
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        var colA = data[i][0];
        var colB = data[i][1];
        var colC = data[i][2];

        if (!colB && !colA) continue;

        var isTank = isNaN(colA);

        if (isTank) {
          result.tanks.push({
            type: String(colA),
            name: String(colB),
            price: Number(colC) || 0
          });
        } else {
          result.supplies.push({
            order: (Number(colA) || 9999),
            name: String(colB),
            price: Number(colC) || 0
          });
        }
      }
      result.supplies.sort(function (a, b) { return a.order - b.order; });
      cache.put(cacheKey, JSON.stringify(result), 21600);
    }
  } catch (e) { console.error("マスタ取得エラー", e); throw e; }
  return result;
}

/**
 * タンク購入処理 (isRegisterOnly=true の場合は発注計上なしで在庫登録のみ)
 */
function submitTankOrder(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var ssMoney = SpreadsheetApp.openById(MONEY_CONFIG.SPREADSHEET_ID);
    var ssApp = SpreadsheetApp.getActiveSpreadsheet();

    var cartItems = data.cartItems || [];
    var userPasscode = data.userPasscode || "";
    var isRegisterOnly = data.isRegisterOnly || false;

    var userInfo = getUserInfo(getSafeUserEmail(), userPasscode);
    var identifiedStaffName = userInfo.name;

    var now = new Date();

    if (!cartItems || cartItems.length === 0) return { success: false, message: "購入リストが空です" };

    var statusSheet = ssApp.getSheetByName(SHEET_NAMES.STATUS);
    if (!statusSheet) throw new Error("タンクステータスシートが見つかりません: " + SHEET_NAMES.STATUS);
    var lastRow = statusSheet.getLastRow();
    var existingIds = [];
    if (lastRow > 1) {
      var range = statusSheet.getRange(2, 1, lastRow - 1, 1).getValues();
      existingIds = range.map(function (r) { return String(r[0]); });
    }
    var allNewIds = [];
    cartItems.forEach(function (item) { allNewIds = allNewIds.concat(item.ids); });

    var duplicates = [];
    allNewIds.forEach(function (newId) { if (existingIds.indexOf(newId) !== -1) duplicates.push(newId); });
    if (duplicates.length > 0) {
      return { success: false, message: "エラー: 以下のIDは既に存在します。\n" + duplicates.join(", ") };
    }

    var statusRows = [];
    cartItems.forEach(function (item) {
      var nextDate = new Date(item.nextDateStr);
      item.ids.forEach(function (id) {
        statusRows.push([
          id,
          "空",
          "倉庫",
          identifiedStaffName,
          nextDate,
          "",
          item.note || "",
          now,
          item.type
        ]);
      });
    });

    if (statusRows.length > 0) {
      statusSheet.getRange(lastRow + 1, 1, statusRows.length, 9).setValues(statusRows);
    }

    var orderSheet = getYearlySheet(ssMoney, MONEY_CONFIG.SHEET_ORDER, now);
    var totalCount = 0;

    cartItems.forEach(function (item) {
      var count = item.ids.length;
      var subTotal = item.price * count;
      var uuid = Utilities.getUuid();
      var idStr = (count <= 5) ? item.ids.join(", ") : item.ids[0] + " ～ " + item.ids[count - 1] + " (計" + count + "本)";
      var fullNote = "【ID】" + idStr + "\n【耐圧】" + item.nextDateStr + "\n" + (item.note || "");

      var statusText = isRegisterOnly ? "在庫登録" : "購入済";
      var newRow = [uuid, now, identifiedStaffName, item.type, count, item.price, subTotal, statusText, fullNote];
      orderSheet.appendRow(newRow);

      // 登録のみモードの場合は金銭ログ(経費)には記録しない
      if (!isRegisterOnly) {
        try {
          if (typeof recordMoneyLog === 'function') {
            var moneyLog = {
              uuid: uuid,
              date: now,
              staff: identifiedStaffName,
              rank: userInfo.rank,
              action: "タンク購入",
              tankId: "-",
              repairCost: subTotal,
              repairDetail: item.type + " " + idStr,
              note: item.note
            };
            recordMoneyLog([moneyLog]);
          }
        } catch (e) { console.error(e); }
      }
      totalCount += count;
    });

    var msg = isRegisterOnly
      ? totalCount + "本 のタンクを在庫登録しました。(発注計上なし)"
      : totalCount + "本 のタンクを購入リストに登録しました。";

    return { success: true, message: msg };

  } catch (e) { return { success: false, message: "エラー: " + e.message }; } finally { lock.releaseLock(); }
}

/**
 * 資材発注
 */
function submitOrder(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    var ss = SpreadsheetApp.openById(MONEY_CONFIG.SPREADSHEET_ID);

    var userInfo = getUserInfo(getSafeUserEmail(), data.userPasscode);
    var identifiedStaffName = userInfo.name;

    var now = new Date();
    var sheet = getYearlySheet(ss, MONEY_CONFIG.SHEET_ORDER, now);
    var newRows = [];
    var moneyLogs = [];

    data.items.forEach(function (item) {
      if (item.count > 0) {
        var uuid = Utilities.getUuid();
        var total = item.price * item.count;
        newRows.push([uuid, now, identifiedStaffName, item.name, item.count, item.price, total, "発注済", item.note || ""]);

        moneyLogs.push({
          uuid: uuid,
          date: now,
          staff: identifiedStaffName,
          rank: userInfo.rank,
          action: "資材発注",
          tankId: "-",
          repairCost: total,
          repairDetail: item.name + " x" + item.count,
          note: item.note
        });
      }
    });
    if (newRows.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      try { if (typeof recordMoneyLog === 'function') recordMoneyLog(moneyLogs); } catch (e) { console.error(e); }
      return { success: true, message: newRows.length + "件の発注を登録しました。" };
    } else { return { success: false, message: "発注対象がありません。" }; }
  } catch (e) { return { success: false, message: "エラー: " + e.message }; } finally { lock.releaseLock(); }
}

/**
 * 履歴取得
 */
function getOrderHistory(passcode) {
  var ss = SpreadsheetApp.openById(MONEY_CONFIG.SPREADSHEET_ID);

  var userInfo = getUserInfo(getSafeUserEmail(), passcode);
  var role = userInfo.role;
  var currentStaffName = userInfo.name;
  var isAdmin = (role.indexOf('管理者') !== -1 || role.indexOf('準管理者') !== -1 || role.toLowerCase().indexOf('admin') !== -1);

  var now = new Date();
  var limitTime = 3 * 24 * 60 * 60 * 1000; // 3日

  var thisYear = now.getFullYear();
  var yearsToCheck = [thisYear, thisYear - 1];
  var allData = [];

  yearsToCheck.forEach(function (year) {
    var sheetName = MONEY_CONFIG.SHEET_ORDER + year;
    var sheet = ss.getSheetByName(sheetName);
    if (sheet && sheet.getLastRow() >= 2) {
      var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues();
      allData = allData.concat(data);
    }
  });
  allData.sort(function (a, b) { return new Date(b[1]) - new Date(a[1]); });

  return allData.map(function (row) {
    var orderDate = new Date(row[1]);
    var ownerName = row[2];
    var note = String(row[8]);
    var isTank = (note.indexOf("【ID】") !== -1);

    var canDelete = false;
    if (isAdmin) {
      canDelete = true;
    } else if (ownerName === currentStaffName) {
      if ((now - orderDate) < limitTime) {
        canDelete = true;
      }
    }

    return {
      uuid: row[0],
      date: Utilities.formatDate(orderDate, Session.getScriptTimeZone(), 'MM/dd HH:mm'),
      staff: ownerName,
      name: row[3],
      count: row[4],
      total: row[6],
      status: row[7],
      note: note,
      itemType: isTank ? 'tank' : 'supply',
      canDelete: canDelete
    };
  });
}

/**
 * 一括削除処理
 */
function batchDeleteOrderItems(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    var uuids = data.uuids || [];
    var userPasscode = data.userPasscode || "";

    if (!uuids || uuids.length === 0) return { success: false, message: "削除対象がありません" };

    // 担当者の特定
    var userInfo = getUserInfo(getSafeUserEmail(), userPasscode);
    var role = userInfo.role;
    var isAdmin = (role.indexOf('管理者') !== -1 || role.indexOf('準管理者') !== -1 || role.toLowerCase().indexOf('admin') !== -1);
    var currentStaffName = userInfo.name;

    var now = new Date();
    var limitTime = 3 * 24 * 60 * 60 * 1000;

    var ssMoney = SpreadsheetApp.openById(MONEY_CONFIG.SPREADSHEET_ID);
    var ssApp = SpreadsheetApp.getActiveSpreadsheet();
    var statusSheet = ssApp.getSheetByName(SHEET_NAMES.STATUS);

    var totalDeleted = 0;
    var deletedTankIds = [];
    var deletedDetails = [];

    var thisYear = now.getFullYear();
    var years = [thisYear, thisYear - 1];

    years.forEach(function (year) {
      var oName = MONEY_CONFIG.SHEET_ORDER + year;
      var oSheet = ssMoney.getSheetByName(oName);
      if (oSheet) {
        var oRows = oSheet.getDataRange().getValues();
        var oDel = [];

        for (var i = 1; i < oRows.length; i++) {
          var rowUuid = String(oRows[i][0]);
          if (uuids.indexOf(rowUuid) !== -1) {
            var orderDate = new Date(oRows[i][1]);
            var ownerName = oRows[i][2];

            var isDeletable = false;
            if (isAdmin) isDeletable = true;
            else if (ownerName === currentStaffName && (now - orderDate) < limitTime) isDeletable = true;

            if (isDeletable) {
              oDel.push(i + 1);

              var dName = oRows[i][3]; // 品名
              var dCount = oRows[i][4]; // 個数
              var dPrice = oRows[i][6]; // 合計金額
              deletedDetails.push(dName + " x" + dCount + " (¥" + Number(dPrice).toLocaleString() + ")");

              var note = String(oRows[i][8]);
              var idMatch = note.match(/【ID】([A-Z0-9, ]+)/);
              if (idMatch && idMatch[1]) {
                var ids = idMatch[1].split(',').map(function (s) { return s.trim().split(' ')[0]; });
                deletedTankIds = deletedTankIds.concat(ids);
              }
            }
          }
        }
        oDel.sort((a, b) => b - a).forEach(r => oSheet.deleteRow(r));
        totalDeleted += oDel.length;
      }

      // Moneyログ側の削除 (連動)
      if (totalDeleted > 0) {
        var mName = MONEY_CONFIG.SHEET_LOG + year;
        var mSheet = ssMoney.getSheetByName(mName);
        if (mSheet) {
          var mRows = mSheet.getDataRange().getValues();
          var mDel = [];
          for (var i = 1; i < mRows.length; i++) {
            if (uuids.indexOf(String(mRows[i][0])) !== -1) {
              mDel.push(i + 1);
            }
          }
          mDel.sort((a, b) => b - a).forEach(r => mSheet.deleteRow(r));
        }
      }
    });

    // タンクステータス側の削除 (連動)
    if (statusSheet && deletedTankIds.length > 0) {
      var sRows = statusSheet.getDataRange().getValues();
      var sDel = [];
      for (var i = 1; i < sRows.length; i++) {
        var id = String(sRows[i][0]);
        if (deletedTankIds.indexOf(id) !== -1) {
          sDel.push(i + 1);
        }
      }
      sDel.sort((a, b) => b - a).forEach(r => statusSheet.deleteRow(r));
    }

    if (totalDeleted === 0) {
      return { success: false, message: "削除できませんでした。\n権限がないか、期限(3日)を過ぎています。" };
    }

    // アプリ側の履歴ログに削除操作を記録
    try {
      var logSheet = getCurrentLogSheet(ssApp);
      var timeStr = Utilities.formatDate(now, Session.getScriptTimeZone(), 'HH:mm');
      var logMsg = "【削除件数: " + totalDeleted + "件】\n" + deletedDetails.join("\n");
      if (deletedTankIds.length > 0) {
        logMsg += "\n(削除タンクID: " + deletedTankIds.join(", ") + ")";
      }

      logSheet.appendRow([
        Utilities.getUuid(),
        now,
        timeStr,
        "-",          // タンクID
        "発注削除",    // 操作
        "管理画面",    // 場所
        logMsg,       // 備考(詳細)
        currentStaffName, // 担当者
        "",           // 直前
        ""            // 種別
      ]);
    } catch (e) {
      console.error("削除ログ記録エラー: " + e.message);
    }

    var msg = totalDeleted + "件を削除しました。";
    if (deletedTankIds.length > 0) msg += "\n(関連タンクも削除済)";
    return { success: true, message: msg };

  } catch (e) { return { success: false, message: "エラー: " + e.message }; } finally { lock.releaseLock(); }
}

/**
 * 更新機能
 */
function batchUpdateOrderItems(data) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);

    var updates = data.updates || [];
    var userPasscode = data.userPasscode || "";

    if (!updates || updates.length === 0) return { success: false, message: "更新対象がありません" };

    var userInfo = getUserInfo(getSafeUserEmail(), userPasscode);
    var role = userInfo.role;
    var isAdmin = (role.indexOf('管理者') !== -1 || role.indexOf('準管理者') !== -1 || role.toLowerCase().indexOf('admin') !== -1);
    var currentStaffName = userInfo.name;

    var now = new Date();
    var limitTime = 3 * 24 * 60 * 60 * 1000;

    var ss = SpreadsheetApp.openById(MONEY_CONFIG.SPREADSHEET_ID);
    var updateCount = 0;
    var updateMap = {};
    updates.forEach(function (u) { updateMap[u.uuid] = parseInt(u.count); });

    var thisYear = new Date().getFullYear();
    var years = [thisYear, thisYear - 1];

    years.forEach(function (year) {
      var orderSheet = ss.getSheetByName(MONEY_CONFIG.SHEET_ORDER + year);
      var moneySheet = ss.getSheetByName(MONEY_CONFIG.SHEET_LOG + year);
      if (!orderSheet) return;
      var orderData = orderSheet.getDataRange().getValues();
      var moneyData = moneySheet ? moneySheet.getDataRange().getValues() : [];

      for (var i = 1; i < orderData.length; i++) {
        var uuid = String(orderData[i][0]);
        if (updateMap.hasOwnProperty(uuid)) {
          var orderDate = new Date(orderData[i][1]);
          var owner = orderData[i][2];

          var isEditable = false;
          if (isAdmin) {
            isEditable = true;
          } else if (owner === currentStaffName) {
            if ((now - orderDate) < limitTime) {
              isEditable = true;
            }
          }

          if (isEditable) {
            var newCount = updateMap[uuid];
            var unitPrice = Number(orderData[i][5]) || 0;
            var newTotal = unitPrice * newCount;
            var itemName = orderData[i][3];

            orderSheet.getRange(i + 1, 5).setValue(newCount);
            orderSheet.getRange(i + 1, 7).setValue(newTotal);

            if (moneySheet) {
              for (var j = 1; j < moneyData.length; j++) {
                if (String(moneyData[j][0]) === uuid) {
                  moneySheet.getRange(j + 1, 7).setValue(newTotal);
                  moneySheet.getRange(j + 1, 8).setValue(itemName + " x" + newCount);
                  break;
                }
              }
            }
            updateCount++;
          }
        }
      }
    });

    if (updateCount === 0) return { success: false, message: "更新できませんでした。\n権限がないか、期限(3日)を過ぎている可能性があります。" };
    return { success: true, message: updateCount + "件を更新しました。" };

  } catch (e) { return { success: false, message: "エラー: " + e.message }; } finally { lock.releaseLock(); }
}