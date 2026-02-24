// ■■■ Admin_Feature_Staff.gs ■■■
// スタッフ統計に関する詳細な計算ロジック

/**
 * ダッシュボード・スタッフ画面用の詳細な情報を取得する
 */
function getDetailedStaffStats() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var today = new Date();
    var currentYear = today.getFullYear();
    var currentMonth = today.getMonth() + 1; // 1-12
    var targetDateStr = Utilities.formatDate(today, "Asia/Tokyo", "yyyy/MM/dd");

    var curSheetName = "履歴ログ" + currentYear;
    var curSheet = ss.getSheetByName(curSheetName);
    if (!curSheet) curSheet = ss.getSheetByName("履歴ログ");

    if (!curSheet) {
        return { success: false, message: "ログシートが見つかりません" };
    }

    var data = curSheet.getDataRange().getValues();

    // スタッフ毎の集計オブジェクト
    var staffStats = {};

    // 今日の稼働スタッフ
    var activeToday = {};

    for (var i = 1; i < data.length; i++) {
        var rawDate = data[i][ADMIN_CONFIG.COL_LOG_DATE];
        if (isValidDate_(rawDate)) {
            var d = new Date(rawDate);
            var rowDateStr = Utilities.formatDate(d, "Asia/Tokyo", "yyyy/MM/dd");

            // 対象月のみフィルタリング
            if (d.getFullYear() === currentYear && (d.getMonth() + 1) === currentMonth) {
                var staffName = String(data[i][ADMIN_CONFIG.COL_LOG_STAFF] || "").trim();
                var action = String(data[i][ADMIN_CONFIG.COL_LOG_ACTION] || "").trim();

                // 有効なスタッフ名であれば集計
                if (staffName && staffName !== "不明" && staffName !== "-") {
                    // 初期化
                    if (!staffStats[staffName]) {
                        staffStats[staffName] = {
                            name: staffName,
                            totalActions: 0,
                            actionsBreakdown: {}
                        };
                    }

                    staffStats[staffName].totalActions += 1;

                    if (!staffStats[staffName].actionsBreakdown[action]) {
                        staffStats[staffName].actionsBreakdown[action] = 0;
                    }
                    staffStats[staffName].actionsBreakdown[action] += 1;

                    // 本日分であれば記録
                    if (rowDateStr === targetDateStr) {
                        activeToday[staffName] = true;
                    }
                }
            }
        }
    }

    // 配列化して作業数(totalActions)の多い順にソート（ランキング）
    var staffList = [];
    for (var name in staffStats) {
        var s = staffStats[name];
        s.isActiveToday = (activeToday[name] === true);
        staffList.push(s);
    }

    // 降順ソート
    staffList.sort(function (a, b) { return b.totalActions - a.totalActions; });

    return {
        success: true,
        targetMonth: currentYear + "年" + currentMonth + "月",
        activeStaffCount: Object.keys(activeToday).length,
        staffRankings: staffList
    };
}
