// ■■■ Admin_Feature_Staff.gs ■■■
// スタッフ統計に関する詳細な計算ロジック

/**
 * ダッシュボード・スタッフ画面用の詳細な情報を取得する
 */
function getDetailedStaffStats() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var moneySs = null;
    try { moneySs = SpreadsheetApp.openById("1WqhL0NbRL6jvYwJVrKnkSe7JlkNlZB91gH2ywN4fyAM"); } catch (e) { }

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
    var activeToday = {};

    // 1. 履歴ログ走査
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
                    if (!staffStats[staffName]) {
                        staffStats[staffName] = {
                            name: staffName,
                            totalActions: 0,
                            damageCount: 0,
                            returnCountTotal: 0,
                            returnCountUnusedDefect: 0,
                            earnedAmount: 0, // 報酬
                            actionsBreakdown: {}
                        };
                    }

                    var sObj = staffStats[staffName];
                    sObj.totalActions += 1;

                    if (!sObj.actionsBreakdown[action]) {
                        sObj.actionsBreakdown[action] = 0;
                    }
                    sObj.actionsBreakdown[action] += 1;

                    // 破損カウント
                    if (action.indexOf("破損") !== -1) {
                        sObj.damageCount += 1;
                    }

                    // 返却カウント(エラー率算出用)
                    if (action.indexOf("返却") !== -1 || action === "未使用返却") {
                        sObj.returnCountTotal += 1;
                        if (action === "返却(未充填)" || action === "未使用返却") {
                            sObj.returnCountUnusedDefect += 1;
                        }
                    }

                    // 本日分であれば記録
                    if (rowDateStr === targetDateStr) {
                        activeToday[staffName] = true;
                    }
                }
            }
        }
    }

    // 2. 金銭ログ走査(スタッフ報酬取得)
    if (moneySs) {
        var curMoneySheet = moneySs.getSheetByName("D_金銭ログ" + currentYear) || moneySs.getSheetByName("D_金銭ログ");
        if (curMoneySheet) {
            var mData = curMoneySheet.getDataRange().getValues();
            for (var j = 1; j < mData.length; j++) {
                var rawMDate = mData[j][1];
                if (isValidDate_(rawMDate)) {
                    var md = new Date(rawMDate);
                    if (md.getFullYear() === currentYear && (md.getMonth() + 1) === currentMonth) {
                        var mStaff = String(mData[j][2] || "").trim();
                        var mScore = Number(mData[j][5]) || 0; // スコア = 報酬額

                        // もし履歴ログ側に該当スタッフがいなくても、金銭ログ側で獲得があれば足す
                        if (mStaff && mStaff !== "不明" && mStaff !== "-") {
                            if (!staffStats[mStaff]) {
                                staffStats[mStaff] = {
                                    name: mStaff, totalActions: 0, damageCount: 0, returnCountTotal: 0,
                                    returnCountUnusedDefect: 0, earnedAmount: 0, actionsBreakdown: {}
                                };
                            }
                            staffStats[mStaff].earnedAmount += mScore;
                        }
                    }
                }
            }
        }
    }

    // 配列化して算出
    var staffList = [];
    for (var name in staffStats) {
        var s = staffStats[name];
        s.isActiveToday = (activeToday[name] === true);

        // 算出項目
        // 破損係数
        s.damageCoef = (s.totalActions > 0) ? Math.round((s.damageCount / s.totalActions) * 100) : 0;
        // エラー率
        s.errorRatio = (s.returnCountTotal > 0) ? Math.round((s.returnCountUnusedDefect / s.returnCountTotal) * 100) : 0;

        staffList.push(s);
    }

    // 降順ソート (総アクション数 または 獲得点数など。ここでは合計アクション数)
    staffList.sort(function (a, b) { return b.totalActions - a.totalActions; });

    return {
        success: true,
        targetMonth: currentYear + "年" + currentMonth + "月",
        activeStaffCount: Object.keys(activeToday).length,
        staffRankings: staffList
    };
}
