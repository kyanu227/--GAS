// ■■■ Feature_Dashboard.gs ■■■

/**
 * ★スマート削除ロジック: UUIDの配列を受け取り、一括で削除します
 */
function batchDeleteMyLog(data) {
  var uuids = data.uuids;
  if (!uuids || uuids.length === 0) return { success: false, message: "削除対象がありません" };

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssMoney = getMoneySS();
  var timeZone = "Asia/Tokyo";
  var thisYear = parseInt(Utilities.formatDate(new Date(), timeZone, "yyyy"));

  var sheetConfigs = [
    { ss: ss, baseName: SHEET_NAMES.LOG },
    { ss: ssMoney, baseName: MONEY_CONFIG.SHEET_LOG }
  ];
  var years = [thisYear, thisYear - 1, thisYear + 1];

  var totalDeleted = 0;

  sheetConfigs.forEach(function (config) {
    years.forEach(function (year) {
      var sheetName = config.baseName + year;
      var sheet = config.ss.getSheetByName(sheetName);
      if (!sheet && year === thisYear) sheet = config.ss.getSheetByName(config.baseName);

      if (sheet) {
        var rows = sheet.getDataRange().getValues();
        var rowsToDelete = [];

        for (var i = 1; i < rows.length; i++) {
          var rowUuid = String(rows[i][0]);
          if (uuids.indexOf(rowUuid) !== -1) {
            rowsToDelete.push(i + 1);
          }
        }

        if (rowsToDelete.length > 0) {
          rowsToDelete.sort(function (a, b) { return b - a; });
          rowsToDelete.forEach(function (rowIdx) {
            sheet.deleteRow(rowIdx);
            totalDeleted++;
          });
        }
      }
    });
  });

  if (totalDeleted > 0) {
    return { success: true, message: totalDeleted + "件のログを削除しました。" };
  } else {
    return { success: false, message: "削除対象が見つかりませんでした(既に削除済みの可能性があります)。" };
  }
}
