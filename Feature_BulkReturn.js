// ■■■ Feature_BulkReturn.gs : 一括返却（貸出先別） ■■■

/**
 * 貸出中・未返却タンクを貸出先別にグルーピングして返す
 * @return {Object} { destinations: [string], tanks: { dest: [{id, status}] } }
 */
function getLentTanksByDestination() {
    try {
        var ss = SpreadsheetApp.getActiveSpreadsheet();
        var sheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.STATUS) ? SHEET_NAMES.STATUS : 'タンクステータス';
        var sheet = ss.getSheetByName(sheetName);
        var lastRow = sheet.getLastRow();
        if (lastRow <= 1) return { destinations: [], tanks: {} };

        // A列: ID, B列: ステータス, C列: 場所/貸出先
        var data = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
        var tanksByDest = {};

        for (var i = 0; i < data.length; i++) {
            var id = String(data[i][0]).trim();
            var status = String(data[i][1]).trim();
            var dest = String(data[i][2]).trim();

            // 貸出中・未返却のみ（自社利用中は除外）
            if (status === '貸出中' || status === '未返却') {
                if (!dest) dest = '不明';
                if (!tanksByDest[dest]) tanksByDest[dest] = [];
                tanksByDest[dest].push({ id: id, status: status });
            }
        }

        // 貸出先ごとにIDソート
        var destinations = Object.keys(tanksByDest).sort();
        destinations.forEach(function (d) {
            tanksByDest[d].sort(function (a, b) {
                var idA = a.id.toUpperCase();
                var idB = b.id.toUpperCase();
                if (idA < idB) return -1;
                if (idA > idB) return 1;
                return 0;
            });
        });

        return { destinations: destinations, tanks: tanksByDest };
    } catch (e) {
        console.error("貸出中タンク取得エラー", e);
        return { destinations: [], tanks: {} };
    }
}

/**
 * 一括返却処理（貸出先ごと）
 * processReturn と同じロジックだが、一括返却用
 */
function processBulkReturn(data, preLoadedData, staffName) {
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

    if (groups.normal.length > 0) mergeResult(writeToSheet(groups.normal, '空', '倉庫', '返却', preLoadedData, staffName, null, data.coworkersStr));
    if (groups.unused.length > 0) mergeResult(writeToSheet(groups.unused, '充填済み', '倉庫', '未使用返却', preLoadedData, staffName, null, data.coworkersStr));
    if (groups.defect.length > 0) mergeResult(writeToSheet(groups.defect, '空', '倉庫', '返却(未充填)', preLoadedData, staffName, null, data.coworkersStr));

    results.success = (results.successIds.length > 0);
    results.message = results.successIds.length + "件の一括返却が完了しました";
    return results;
}
