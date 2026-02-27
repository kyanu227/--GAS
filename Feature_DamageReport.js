// ■■■ Feature_DamageReport.gs : 破損報告 ■■■

function processDamageReport(data, preLoadedData, staffName) {
  return writeToSheet(data.items, '破損', '倉庫', '破損報告', preLoadedData, staffName, null);
}
