// ■■■ Feature_InHouse.gs : 自社タンク管理 ■■■

/**
 * 自社利用中タンクを取得（G列のタグ情報も返す）
 * @returns {Array<{id: string, statusTag: string}>}
 */
function getInHouseTanks() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sheet = ss.getSheetByName(sheetName);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    // A(ID), B(ステータス), C(場所), D,E,F, G(ログ備考) まで読む
    var cols = Math.min(sheet.getLastColumn(), 7);
    var data = sheet.getRange(2, 1, lastRow - 1, cols).getValues();
    var list = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i][1] === '自社利用中') {
        var tagValue = 'normal';
        if (cols >= 7) {
          var gCol = String(data[i][6] || '');
          var tagMatch = gCol.match(/\[TAG:(unused|defect)\]/);
          if (tagMatch) tagValue = tagMatch[1];
        }
        list.push({ id: data[i][0], statusTag: tagValue });
      }
    }
    list.sort(function (a, b) {
      var idA = a.id.toUpperCase();
      var idB = b.id.toUpperCase();
      if (idA < idB) return -1;
      if (idA > idB) return 1;
      return 0;
    });
    return list;
  } catch (e) {
    console.error("自社タンク取得エラー", e);
    return [];
  }
}

/**
 * 自社利用中タンクの返却タグをG列に保存
 * @param {string} tankId タンクID
 * @param {string} tag 'normal' | 'unused' | 'defect'
 */
function saveInHouseTag(tankId, tag) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sheet = ss.getSheetByName(sheetName);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return { success: false, message: 'データなし' };

    var nId = normalizeId(tankId);
    var data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    for (var i = 0; i < data.length; i++) {
      if (normalizeId(data[i][0]) === nId && data[i][1] === '自社利用中') {
        var existingNote = String(data[i][6] || '');
        // 既存タグを除去
        existingNote = existingNote.replace(/\[TAG:(normal|unused|defect)\]/g, '').trim();
        // 新しいタグを付与（normalの場合はタグなし）
        var newNote = (tag && tag !== 'normal') ? '[TAG:' + tag + ']' : '';
        if (existingNote && newNote) newNote = newNote + ' ' + existingNote;
        else if (existingNote) newNote = existingNote;
        // G列(7列目)に書き込み
        sheet.getRange(i + 2, 7).setValue(newNote);
        return { success: true };
      }
    }
    return { success: false, message: 'タンクが見つかりません' };
  } catch (e) {
    console.error('タグ保存エラー', e);
    return { success: false, message: e.message };
  }
}

function processCompanyUse(data, preLoadedData, staffName) {
  data.items.forEach(function (item) { if (!item.note) item.note = '社内使用'; });
  return writeToSheet(data.items, '自社利用中', '自社', '自社利用', preLoadedData, staffName, '自社');
}

function processCompanyBulkReturn(data, preLoadedData, staffName) {
  var groups = { normal: [], unused: [], defect: [] };

  data.items.forEach(function (item) {
    if (item.statusTag === 'unused') groups.unused.push(item);
    else if (item.statusTag === 'defect') groups.defect.push(item);
    else groups.normal.push(item);
  });

  var results = { successIds: [], failedItems: [], message: "" };

  function mergeResult(res) {
    if (res.successIds) results.successIds = results.successIds.concat(res.successIds);
    if (res.failedItems) results.failedItems = results.failedItems.concat(res.failedItems);
  }

  if (groups.normal.length > 0) mergeResult(writeToSheet(groups.normal, '空', '倉庫', '自社返却', preLoadedData, staffName, null));
  if (groups.unused.length > 0) mergeResult(writeToSheet(groups.unused, '充填済み', '倉庫', '自社返却(未使用)', preLoadedData, staffName, null));
  if (groups.defect.length > 0) mergeResult(writeToSheet(groups.defect, '空', '倉庫', '自社返却(不備)', preLoadedData, staffName, null));

  results.success = (results.successIds.length > 0);
  results.message = results.successIds.length + "件の自社一括返却が完了しました";
  return results;
}

/**
 * 自社使用 事後報告処理（ステップ1のみ）
 * → 自社利用中にする。既に自社利用中のタンクはスキップ（成功扱い）。
 */
function processCompanyRetroReport(data, preLoadedData, staffName) {
  var masterData = preLoadedData.data;
  var idMap = preLoadedData.idMap;

  var alreadyInHouseIds = [];
  var needsUpdate = [];

  data.items.forEach(function (item) {
    var nId = normalizeId(item.id);
    var rowIndex = idMap[nId];
    if (rowIndex !== undefined) {
      var currentStatus = String(masterData[rowIndex][1]);
      if (currentStatus === '自社利用中') {
        alreadyInHouseIds.push(item.id);
      } else {
        needsUpdate.push(item);
      }
    }
  });

  var results = { successIds: alreadyInHouseIds.slice(), failedItems: [], message: "" };

  if (needsUpdate.length > 0) {
    needsUpdate.forEach(function (item) { if (!item.note) item.note = '事後報告'; });
    var res = writeToSheet(needsUpdate, '自社利用中', '自社', '自社利用(事後)', preLoadedData, staffName, '自社');
    if (res.successIds) results.successIds = results.successIds.concat(res.successIds);
    if (res.failedItems) results.failedItems = results.failedItems.concat(res.failedItems);
  }

  results.success = (results.successIds.length > 0);
  results.message = results.successIds.length + "件を自社利用中に登録しました";
  return results;
}

/**
 * 自社利用中タンクの自動確定（日次トリガーと連動）
 * G列のタグ情報を読み取り、タグに応じた返却処理を行う
 */
function autoConfirmInHouseTanks() {
  var tanks = getInHouseTanks(); // statusTag付きで返ってくる
  if (tanks.length === 0) return;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (e) {
    console.error("自動確定: ロック取得失敗", e);
    return;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sheet = ss.getSheetByName(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    var fetchCols = (lastCol >= 9) ? 9 : (lastCol >= 8 ? 8 : 7);
    var masterData = (lastRow > 0) ? sheet.getRange(1, 1, lastRow, fetchCols).getValues() : [];
    var idMap = {};
    for (var i = 1; i < masterData.length; i++) {
      var nId = normalizeId(masterData[i][0]);
      if (nId) idMap[nId] = i;
    }
    var preLoadedData = { sheet: sheet, data: masterData, idMap: idMap };

    // G列から読み取ったstatusTagをそのまま使用
    var items = tanks.map(function (t) { return { id: t.id, statusTag: t.statusTag || 'normal', note: '' }; });
    var result = processCompanyBulkReturn({ items: items }, preLoadedData, 'システム自動確定');

    if (result.successIds && result.successIds.length > 0) {
      CacheService.getScriptCache().remove("ALL_TANK_STATUS_MAP");
      var tagSummary = { normal: 0, unused: 0, defect: 0 };
      items.forEach(function (item) { tagSummary[item.statusTag] = (tagSummary[item.statusTag] || 0) + 1; });
      console.log("自動確定: " + result.successIds.length + "件を返却しました (通常:" + tagSummary.normal + " 未使用:" + tagSummary.unused + " 不備:" + tagSummary.defect + ")");
    }
  } catch (e) {
    console.error("自動確定エラー: " + e.toString());
  } finally {
    lock.releaseLock();
  }
}

// -----------------------------------------------------------
// トリガー管理（フロントエンドから呼び出し可能）
// -----------------------------------------------------------

/**
 * 自動確定トリガーを登録
 * @param {number} hour - 実行時刻 (0-23)
 */
function setupAutoConfirmTrigger(hour) {
  try {
    deleteAutoConfirmTrigger(); // 既存を削除
    ScriptApp.newTrigger('autoConfirmInHouseTanks')
      .timeBased()
      .everyDays(1)
      .atHour(hour)
      .create();
    return { success: true, message: '自動確定トリガーを ' + hour + '時 に設定しました。' };
  } catch (e) {
    return { success: false, message: 'トリガー登録エラー: ' + e.message };
  }
}

/**
 * 自動確定トリガーを削除
 */
function deleteAutoConfirmTrigger() {
  try {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      if (t.getHandlerFunction() === 'autoConfirmInHouseTanks') {
        ScriptApp.deleteTrigger(t);
      }
    });
    return { success: true, message: '自動確定トリガーを解除しました。' };
  } catch (e) {
    return { success: false, message: 'トリガー削除エラー: ' + e.message };
  }
}

/**
 * 自動確定トリガーの現在の状態を取得
 */
function getAutoConfirmTriggerStatus() {
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'autoConfirmInHouseTanks') {
        return { enabled: true };
      }
    }
    return { enabled: false };
  } catch (e) {
    return { enabled: false, error: e.message };
  }
}
