// ■■■ Feature_InHouse.gs : 自社タンク管理 ■■■

function getInHouseTanks() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
    var sheet = ss.getSheetByName(sheetName);
    var lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];
    var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    var list = [];
    for (var i = 0; i < data.length; i++) {
      if (data[i][1] === '自社利用中') {
        list.push({ id: data[i][0] });
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
