// ■■■ Feature_Delete.gs ■■■

/**
 * ダッシュボードからの操作削除（Undo）と巻き戻しを実行する
 * @param {Object} data { uuids: ["uuid1", "uuid2"] }
 */
function deleteOperationAndRollback(data) {
    var uuids = data.uuids;
    if (!uuids || uuids.length === 0) return { success: false, message: "削除対象がありません" };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ssMoney = getMoneySS();
    var timeZone = "Asia/Tokyo";
    var thisYear = parseInt(Utilities.formatDate(new Date(), timeZone, "yyyy"));
    var user = getUserInfo(getSafeUserEmail()).name;

    var historyYears = [thisYear, thisYear - 1, thisYear + 1];

    var deletedCount = 0;
    var notifyLogs = [];

    // 1. タンクステータスマスタのロード
    var statusSheet = ss.getSheetByName(SHEET_NAMES.STATUS);
    var statusData = statusSheet.getDataRange().getValues();
    var idMap = {};
    for (var r = 1; r < statusData.length; r++) {
        idMap[String(statusData[r][0]).toUpperCase()] = r;
    }

    // タイムマシーンシート取得（フェーズ2で追加）
    var tmSheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.TIMEMACHINE) ? SHEET_NAMES.TIMEMACHINE : '変更履歴';
    var tmSheet = ss.getSheetByName(tmSheetName);
    if (!tmSheet) {
        tmSheet = ss.insertSheet(tmSheetName);
        tmSheet.appendRow(["日時", "操作種別", "UUID", "タンクID", "元の操作名", "元の場所", "元のステータス", "実行者", "元データJSON"]);
    }

    // UUIDごとにループして処理
    uuids.forEach(function (uuid) {
        var foundInHistory = false;
        var targetTankId = "";
        var targetAction = "";
        var targetLoc = "";
        var targetPrevLoc = "";
        var logOperator = "";
        var originalRowData = null;

        // -- A. 履歴ログの検索とフラグ更新 --
        for (var y = 0; y < historyYears.length; y++) {
            if (foundInHistory) break;
            var year = historyYears[y];
            var sheetName = SHEET_NAMES.LOG + year;
            var sheet = ss.getSheetByName(sheetName);
            if (!sheet && year === thisYear) sheet = ss.getSheetByName(SHEET_NAMES.LOG);

            if (sheet) {
                var rows = sheet.getDataRange().getValues();
                for (var i = 1; i < rows.length; i++) {
                    if (String(rows[i][0]) === uuid) {
                        foundInHistory = true;
                        targetTankId = String(rows[i][3]);
                        targetAction = String(rows[i][4]);
                        targetLoc = String(rows[i][5]);
                        logOperator = String(rows[i][7]);
                        targetPrevLoc = String(rows[i][8]);

                        // 元データを保存
                        originalRowData = rows[i].slice();

                        // L列(操作名退避)を記録するため、配列の長さを拡張(インデックス11まで)
                        while (rows[i].length < 12) {
                            rows[i].push("");
                        }

                        // 退避列に記録 (既に削除済み等の場合は上書きしない)
                        if (targetAction !== "削除済み") {
                            rows[i][11] = targetAction; // L列
                        }

                        // E(4), F(5), I(8) を「削除済み」に変更
                        rows[i][4] = "削除済み";
                        rows[i][5] = "削除済み";
                        rows[i][8] = "削除済み";

                        // 対象行を上書き (i=1は2行目)
                        sheet.getRange(i + 1, 1, 1, rows[i].length).setValues([rows[i]]);
                        break;
                    }
                }
            }
        }

        if (foundInHistory) {
            // -- タイムマシーンに記録 --
            var now = new Date();
            var sRow = idMap[targetTankId.toUpperCase()];
            var prevStatus = (sRow !== undefined) ? String(statusData[sRow][1]) : "不明";
            tmSheet.appendRow([
                now,
                "削除",
                uuid,
                targetTankId,
                targetAction,
                targetLoc,
                prevStatus,
                user,
                JSON.stringify(originalRowData)
            ]);

            // -- B. 金銭ログの完全削除 (共同作業者分含む) --
            historyYears.forEach(function (year) {
                var moneySheetName = MONEY_CONFIG.SHEET_LOG + year;
                var mSheet = ssMoney.getSheetByName(moneySheetName);
                if (!mSheet && year === thisYear) mSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_LOG);
                if (mSheet) {
                    var mRows = mSheet.getDataRange().getValues();
                    // 下からループして削除
                    for (var i = mRows.length - 1; i >= 1; i--) {
                        if (String(mRows[i][0]) === uuid) {
                            mSheet.deleteRow(i + 1);
                        }
                    }
                }
            });

            // -- C. タンクステータスのロールバック（前ログ検索ベース） --
            var newStatus = "空";
            var newLoc = "自社";

            // 同じタンクIDの「一つ前の操作」を履歴ログから検索して、当時のステータスに戻す
            var prevLogFound = false;
            for (var y2 = 0; y2 < historyYears.length && !prevLogFound; y2++) {
                var year2 = historyYears[y2];
                var sName2 = SHEET_NAMES.LOG + year2;
                var sh2 = ss.getSheetByName(sName2);
                if (!sh2 && year2 === thisYear) sh2 = ss.getSheetByName(SHEET_NAMES.LOG);
                if (sh2) {
                    var allRows = sh2.getDataRange().getValues();
                    // 全行を日時降順でスキャンし、削除対象UUIDより前のログを探す
                    var candidates = [];
                    for (var r2 = 1; r2 < allRows.length; r2++) {
                        var rowUuid = String(allRows[r2][0]);
                        var rowTankId = String(allRows[r2][3]);
                        var rowAction = String(allRows[r2][4]);
                        if (rowUuid === uuid) continue; // 削除対象自体はスキップ
                        if (rowAction === "削除済み") continue;
                        if (formatDisplayId(rowTankId) === formatDisplayId(targetTankId) || normalizeId(rowTankId) === normalizeId(targetTankId)) {
                            candidates.push({
                                timestamp: new Date(allRows[r2][1]).getTime(),
                                status: String(allRows[r2][2]), // C列: 更新後ステータス
                                loc: String(allRows[r2][5])      // F列: 場所
                            });
                        }
                    }
                    // 最新のものを取得
                    if (candidates.length > 0) {
                        candidates.sort(function (a, b) { return b.timestamp - a.timestamp; });
                        newStatus = candidates[0].status;
                        newLoc = candidates[0].loc;
                        prevLogFound = true;
                    }
                }
            }

            // 前ログが見つからない場合はフォールバック推測
            if (!prevLogFound) {
                if (targetAction.indexOf("返却") !== -1) {
                    newStatus = "貸出中";
                    newLoc = targetPrevLoc || "不明";
                } else if (targetAction.indexOf("貸出") !== -1) {
                    newStatus = "充填済み";
                    newLoc = "自社";
                } else if (targetAction.indexOf("充填") !== -1) {
                    newStatus = "空";
                    newLoc = "自社";
                } else {
                    newStatus = "空";
                    newLoc = "自社";
                }
            }

            if (sRow !== undefined) {
                statusData[sRow][1] = newStatus; // B列: 状態
                statusData[sRow][2] = newLoc;    // C列: 場所
            }

            deletedCount++;
            notifyLogs.push(
                "【操作削除】: " + targetTankId + " (" + targetAction + ")\n" +
                "・元の操作者: " + logOperator + "\n" +
                "・削除実行者: " + user + "\n" +
                "・巻き戻し結果: 「" + newStatus + " (" + newLoc + ")」" +
                (prevLogFound ? "" : " ※推測")
            );
        }
    });

    // -- D. タンクステータスの一括保存 --
    if (deletedCount > 0) {
        statusSheet.getRange(1, 1, statusData.length, statusData[0].length).setValues(statusData);

        // -- E. 日報・通知への送信 --
        var msg = "⚠️ 【タンク操作削除・ロールバック通知】\n\n" + notifyLogs.join("\n\n---\n");

        var props = PropertiesService.getScriptProperties();
        var notifyOptsJson = props.getProperty('NOTIFY_REPORT_OPTIONS');
        var isEnabled = true;
        if (notifyOptsJson) {
            try {
                var nOpts = JSON.parse(notifyOptsJson);
                if (nOpts && nOpts.instant && nOpts.instant.deleteRecord === false) {
                    isEnabled = false;
                }
            } catch (e) { }
        }

        if (isEnabled) {
            try {
                if (typeof sendLineBroadcastOrPush === 'function') {
                    sendLineBroadcastOrPush(msg, 'DAILY');
                }
            } catch (e) {
                console.error("削除通知エラー", e);
            }
        }

        return { success: true, message: deletedCount + "件の操作を削除し、以前の状態へロールバックしました。" };
    }

    return { success: false, message: "削除対象が見つかりませんでした。すでに削除されている可能性があります。" };
}

/**
 * ログの編集（タンクID / 貸出先の変更）
 * @param {Object} data { uuid, newTankId, newDest }
 */
function editLogEntry(data) {
    var uuid = data.uuid;
    if (!uuid) return { success: false, message: "UUIDが指定されていません" };

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var ssMoney = getMoneySS();
    var timeZone = "Asia/Tokyo";
    var thisYear = parseInt(Utilities.formatDate(new Date(), timeZone, "yyyy"));
    var user = getUserInfo(getSafeUserEmail()).name;
    var historyYears = [thisYear, thisYear - 1, thisYear + 1];

    var lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (e) {
        return { success: false, message: "他ユーザーが処理中です。少し待ってから再試行してください。" };
    }

    try {
        // 1. ステータスシートを読み込み
        var statusSheet = ss.getSheetByName(SHEET_NAMES.STATUS);
        var statusData = statusSheet.getDataRange().getValues();
        var idMap = {};
        for (var r = 1; r < statusData.length; r++) {
            idMap[normalizeId(statusData[r][0])] = r;
        }

        // 2. タイムマシーンシート取得
        var tmSheetName = (typeof SHEET_NAMES !== 'undefined' && SHEET_NAMES.TIMEMACHINE) ? SHEET_NAMES.TIMEMACHINE : '変更履歴';
        var tmSheet = ss.getSheetByName(tmSheetName);
        if (!tmSheet) {
            tmSheet = ss.insertSheet(tmSheetName);
            tmSheet.appendRow(["日時", "操作種別", "UUID", "タンクID", "元の操作名", "元の場所", "元のステータス", "実行者", "元データJSON"]);
        }

        // 3. 履歴ログからUUID行を検索
        var foundSheet = null;
        var foundRowIndex = -1;
        var foundRow = null;
        var originalRowData = null;

        for (var y = 0; y < historyYears.length; y++) {
            if (foundSheet) break;
            var year = historyYears[y];
            var sheetName = SHEET_NAMES.LOG + year;
            var sheet = ss.getSheetByName(sheetName);
            if (!sheet && year === thisYear) sheet = ss.getSheetByName(SHEET_NAMES.LOG);
            if (sheet) {
                var rows = sheet.getDataRange().getValues();
                for (var i = 1; i < rows.length; i++) {
                    if (String(rows[i][0]) === uuid) {
                        foundSheet = sheet;
                        foundRowIndex = i;
                        foundRow = rows[i];
                        originalRowData = rows[i].slice();
                        break;
                    }
                }
            }
        }

        if (!foundSheet || !foundRow) {
            return { success: false, message: "該当するログが見つかりません" };
        }

        var oldTankId = String(foundRow[3]);
        var oldAction = String(foundRow[4]);
        var oldLoc = String(foundRow[5]);
        var oldStatus = "";

        // 削除済みログは編集不可
        if (oldAction === "削除済み") {
            return { success: false, message: "削除済みのログは編集できません" };
        }

        var newTankId = data.newTankId ? String(data.newTankId).trim() : null;
        var newDest = data.newDest ? String(data.newDest).trim() : null;

        if (!newTankId && !newDest) {
            return { success: false, message: "変更内容が指定されていません" };
        }

        var changes = [];

        // -- A. タンクID変更の処理 --
        if (newTankId && formatDisplayId(newTankId) !== formatDisplayId(oldTankId)) {
            var nOldId = normalizeId(oldTankId);
            var nNewId = normalizeId(newTankId);

            // 新IDが存在するか確認
            if (idMap[nNewId] === undefined) {
                return { success: false, message: "新しいID (" + formatDisplayId(newTankId) + ") はマスタに登録されていません" };
            }

            var oldRow = idMap[nOldId];
            var newRow = idMap[nNewId];

            // 旧IDのステータスを巻き戻し
            if (oldRow !== undefined) {
                oldStatus = String(statusData[oldRow][1]);
                // 巻き戻し: 操作前の状態に戻す
                var rollbackStatus = getRollbackStatus(oldAction);
                statusData[oldRow][1] = rollbackStatus.status;
                statusData[oldRow][2] = rollbackStatus.loc;
            }

            // 新IDにステータスを適用
            if (newRow !== undefined) {
                var currentNewStatus = String(statusData[newRow][1]);
                // 操作によるステータスを適用
                var applyStatus = getApplyStatus(oldAction, newDest || oldLoc);
                statusData[newRow][1] = applyStatus.status;
                statusData[newRow][2] = applyStatus.loc;
            }

            // ログ行のタンクIDを更新
            foundRow[3] = formatDisplayId(newTankId);
            changes.push("ID: " + formatDisplayId(oldTankId) + " → " + formatDisplayId(newTankId));

            // 金銭ログのタンクIDも更新
            historyYears.forEach(function (yr) {
                var mSheetName = MONEY_CONFIG.SHEET_LOG + yr;
                var mSheet = ssMoney.getSheetByName(mSheetName);
                if (!mSheet && yr === thisYear) mSheet = ssMoney.getSheetByName(MONEY_CONFIG.SHEET_LOG);
                if (mSheet) {
                    var mRows = mSheet.getDataRange().getValues();
                    for (var mi = 1; mi < mRows.length; mi++) {
                        if (String(mRows[mi][0]) === uuid) {
                            mSheet.getRange(mi + 1, 5).setValue(formatDisplayId(newTankId)); // E列
                        }
                    }
                }
            });
        }

        // -- B. 貸出先変更の処理 --
        if (newDest && newDest !== oldLoc) {
            foundRow[5] = newDest; // F列: 場所

            // ステータスシートの場所も更新（現在その操作の結果を反映している場合）
            var tankIdForLoc = newTankId || oldTankId;
            var nTankId = normalizeId(tankIdForLoc);
            var sRowLoc = idMap[nTankId];
            if (sRowLoc !== undefined) {
                statusData[sRowLoc][2] = newDest;
            }

            changes.push("場所: " + oldLoc + " → " + newDest);
        }

        // -- C. タイムマシーンに記録 --
        var now = new Date();
        tmSheet.appendRow([
            now,
            "編集",
            uuid,
            oldTankId,
            oldAction,
            oldLoc,
            oldStatus || "(変更なし)",
            user,
            JSON.stringify(originalRowData)
        ]);

        // -- D. ログ行を書き戻し --
        foundSheet.getRange(foundRowIndex + 1, 1, 1, foundRow.length).setValues([foundRow]);

        // -- E. ステータスシート保存 --
        statusSheet.getRange(1, 1, statusData.length, statusData[0].length).setValues(statusData);

        // キャッシュクリア
        CacheService.getScriptCache().remove("ALL_TANK_STATUS_MAP");

        SpreadsheetApp.flush();

        // -- F. 編集通知 (削除通知と同じチャンネル) --
        try {
            var props = PropertiesService.getScriptProperties();
            var notifyOptsJson = props.getProperty('NOTIFY_REPORT_OPTIONS');
            var isEnabled = true;
            if (notifyOptsJson) {
                try {
                    var nOpts = JSON.parse(notifyOptsJson);
                    if (nOpts && nOpts.instant && nOpts.instant.deleteRecord === false) {
                        isEnabled = false;
                    }
                } catch (e) { }
            }
            if (isEnabled && typeof sendLineBroadcastOrPush === 'function') {
                var editMsg = "✏️ 【ログ編集通知】\n\n"
                    + "・タンク: " + oldTankId + "\n"
                    + "・操作: " + oldAction + "\n"
                    + "・変更内容: " + changes.join(", ") + "\n"
                    + "・編集者: " + user;
                sendLineBroadcastOrPush(editMsg, 'DAILY');
            }
        } catch (notifyErr) {
            console.error("編集通知エラー", notifyErr);
        }

        return {
            success: true,
            message: "ログを編集しました: " + changes.join(", "),
            changes: changes
        };

    } catch (e) {
        console.error("ログ編集エラー: " + e.toString());
        return { success: false, message: "編集エラー: " + e.message };
    } finally {
        lock.releaseLock();
    }
}

/**
 * 操作名から「巻き戻し先ステータス」を返す
 */
function getRollbackStatus(action) {
    if (action.indexOf("返却") !== -1) return { status: "貸出中", loc: "不明" };
    if (action.indexOf("貸出") !== -1 || action.indexOf("自社利用") !== -1) return { status: "充填済み", loc: "倉庫" };
    if (action.indexOf("充填") !== -1) return { status: "空", loc: "倉庫" };
    if (action.indexOf("修理") !== -1) return { status: "破損", loc: "倉庫" };
    if (action.indexOf("破損") !== -1) return { status: "充填済み", loc: "倉庫" };
    return { status: "空", loc: "自社" };
}

/**
 * 操作名から「適用先ステータス」を返す
 */
function getApplyStatus(action, loc) {
    if (action.indexOf("貸出") !== -1) return { status: "貸出中", loc: loc || "不明" };
    if (action.indexOf("自社利用") !== -1) return { status: "自社利用中", loc: "自社" };
    if (action === "未使用返却" || action === "自社返却(未使用)") return { status: "充填済み", loc: "倉庫" };
    if (action.indexOf("返却") !== -1) return { status: "空", loc: "倉庫" };
    if (action.indexOf("充填") !== -1) return { status: "充填済み", loc: "倉庫" };
    if (action.indexOf("修理") !== -1) return { status: "空", loc: "倉庫" };
    if (action.indexOf("破損") !== -1) return { status: "破損", loc: "倉庫" };
    return { status: "空", loc: "自社" };
}
