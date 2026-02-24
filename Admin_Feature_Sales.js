// ■■■ Admin_Feature_Sales.gs ■■■
// 売上統計に関する詳細な計算ロジック

/**
 * ダッシュボード・売上画面用の詳細な売上データを取得する
 */
function getDetailedSalesStats() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var today = new Date();
    var currentYear = today.getFullYear();
    var currentMonth = today.getMonth() + 1; // 1-12

    var prevMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    var prevYear = prevMonthDate.getFullYear();
    var prevMonth = prevMonthDate.getMonth() + 1;

    // 単価情報取得
    var priceMap = getPriceMasterMap_();
    if (Object.keys(priceMap).length === 0) priceMap = { "貸出": 5000, "自社利用": 0, "充填": 2000 };

    // 今月分を計算
    var curSheet = ss.getSheetByName("履歴ログ" + currentYear);
    if (!curSheet) curSheet = ss.getSheetByName("履歴ログ");
    var curData = curSheet ? curSheet.getDataRange().getValues() : [];
    var currentMonthStats = calculateMonthStats_(curData, currentYear, currentMonth, priceMap);

    // 先月分を計算 (年またぎ対応)
    var prevSheetName = "履歴ログ" + prevYear;
    var prevSheet = ss.getSheetByName(prevSheetName);
    // 現行シートと同じ年ならcurDataを再利用できるが厳密に判定
    var prevData = curData;
    if (prevYear !== currentYear) {
        prevData = prevSheet ? prevSheet.getDataRange().getValues() : [];
    }
    var prevMonthStats = calculateMonthStats_(prevData, prevYear, prevMonth, priceMap);

    // 月間売上比較
    var curTotal = currentMonthStats.totalSales;
    var prevTotal = prevMonthStats.totalSales;
    var momRatio = 0; // Month-over-Month ratio
    if (prevTotal > 0) {
        momRatio = Math.round(((curTotal - prevTotal) / prevTotal) * 100);
    } else if (curTotal > 0) {
        momRatio = 100; // 元が0なら+100%増加扱い
    }

    // アクション別内訳 (グラフ用)
    var actionLabels = Object.keys(currentMonthStats.actionSales);
    var actionData = actionLabels.map(function (k) { return currentMonthStats.actionSales[k]; });

    // 取引先別トップ5 (ランキング表用)
    var destArr = [];
    for (var d in currentMonthStats.destSales) {
        destArr.push({ name: d, sales: currentMonthStats.destSales[d], count: currentMonthStats.destCount[d] });
    }
    destArr.sort(function (a, b) { return b.sales - a.sales; });
    var topDestinations = destArr.slice(0, 5);

    return {
        success: true,
        currentMonthTotal: curTotal,
        prevMonthTotal: prevTotal,
        momRatio: momRatio,
        actionBreakdown: {
            labels: actionLabels,
            data: actionData
        },
        topDestinations: topDestinations
    };
}

/**
 * 指定月(年月)の売上などの統計を抽出する内部関数
 */
function calculateMonthStats_(data, targetYear, targetMonth, priceMap) {
    var result = {
        totalSales: 0,
        actionSales: {},
        destSales: {},
        destCount: {}
    };

    for (var i = 1; i < data.length; i++) {
        var rawDate = data[i][ADMIN_CONFIG.COL_LOG_DATE]; // B列(1)
        if (isValidDate_(rawDate)) {
            var d = new Date(rawDate);
            if (d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth) {

                var action = String(data[i][ADMIN_CONFIG.COL_LOG_ACTION] || "").trim(); // E列(4)
                var price = priceMap[action] || 0;

                var dest = String(data[i][5] || "").trim(); // 取引先(F列想定だが、実際は 場所 かも。ログの仕様に合わせてindex5, または8)
                // Utils.jsの仕様では、場所はindex5(F列), 直前貸出先はindex8(I列)
                if (!dest || dest === "倉庫" || dest === "自社") dest = "その他";

                if (price > 0) {
                    // 合計売上
                    result.totalSales += price;

                    // アクション別売上
                    if (!result.actionSales[action]) result.actionSales[action] = 0;
                    result.actionSales[action] += price;

                    // 取引先別売上
                    if (!result.destSales[dest]) {
                        result.destSales[dest] = 0;
                        result.destCount[dest] = 0;
                    }
                    result.destSales[dest] += price;
                    result.destCount[dest] += 1;
                }
            }
        }
    }
    return result;
}
