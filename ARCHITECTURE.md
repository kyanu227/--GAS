# タンク管理 Operate - アーキテクチャ概要

## 1. 全体構成

```
Google Apps Script (Operate プロジェクト)
├── サーバーサイド (.js)
│   ├── 0_Config.js        定数・シート名・設定 (APP_TITLE, MENU_NAMES, SHEET_NAMES, MONEY_CONFIG等)
│   ├── 1_App.js           doGet / HTML生成 (createNormalPage) / include
│   ├── 2_Utils.js         ID正規化 / 認証(getUserInfo, verifyPasscode) / writeToSheet / キャッシュ / saveViewMode
│   ├── 3_Money.js         金銭ログ記録(recordMoneyLog) / 報酬計算(calculateRewardInMemory) / 単価マスタ
│   ├── 4_Rank.js          月次締め(runMonthlyClosing) / ランク判定 / 給与計算
│   ├── 5_Notify.js        LINE Messaging API送信(sendLineBroadcastOrPush) / メール通知 / 耐圧検査アラート / 貸出0件アラート
│   ├── Feature_Operations.js  OP_RULES定義 / validateOperations / submitOperations / processLend / processReturn / processFill
│   ├── Feature_InHouse.js     processCompanyUse / processCompanyRetroReport / processCompanyBulkReturn / 自動確定 / トリガー管理
│   ├── Feature_BulkReturn.js  getLentTanksByDestination / processBulkReturn (貸出先別一括返却)
│   ├── Feature_Dashboard.js   getDashboardData (ステータス集計 + 7日間ログ + 当日サマリ)
│   ├── Feature_Delete.js      deleteOperationAndRollback / editLogEntry / getRollbackStatus / getApplyStatus
│   ├── Feature_Maintenance.js getMaintenanceList / submitMaintenance / updateInspectionDate (修理済み・耐圧検査完了)
│   ├── Feature_MyPage.js      getMyStats (個人統計・リアルタイムランク再判定・報酬見込み)
│   ├── Feature_DamageReport.js processDamageReport (破損報告、writeToSheetへの薄いラッパー)
│   ├── Feature_Order.js       submitOrder(資材発注) / submitTankOrder(タンク購入+在庫登録) / getOrderHistory / batchDeleteOrderItems / batchUpdateOrderItems
│   ├── Funk_Line_Webhook.js   LINE Webhook受信 (doPost: 「ID教えて」でグループID返信)
│   └── check.js               テスト/デバッグ関数 (runAllTests等、データ変更なし)
│
├── フロントエンド (.html)
│   ├── index.html             メインシェル (認証フロー / ナビゲーション / switchMode / ページ切替)
│   ├── Global_CSS.html        共通スタイル
│   ├── Part_Operations_Dial.html  操作画面 (ダイヤル式: ロータリー選択 + 自社利用トグル + 自社一括返却)
│   ├── Part_Operations.html       操作画面 (リスト式: プレフィックスごと入力欄 + 自社利用トグル)
│   ├── Part_InHouse.html          自社管理画面 (事後報告 + 自社利用中リスト + 一括返却)
│   ├── Part_BulkReturn.html       一括返却画面 (貸出先別グルーピング + タグ付け)
│   ├── Part_Dashboard.html        ダッシュボード画面 (ステータス円グラフ + 7日間ログ + 削除/編集)
│   ├── Part_MyPage.html           マイページ画面 (個人統計 + ランク + 報酬見込み)
│   ├── Part_DamageReport.html     破損報告画面
│   ├── Part_Maintenance.html      メンテナンス画面 (修理済み/耐圧検査完了の対象リスト表示)
│   └── Part_Order.html            資材発注・タンク購入画面
│
└── 設定
    └── appsscript.json        GAS設定 (スコープ等)
```

---

## 2. ページ遷移

```
doGet(e)
  → 1_App.js: createNormalPage(userInfo, email, '', viewMode)
  → index.html をテンプレート展開
  → サーバー変数をグローバル変数に展開 (SERVER_STAFF_NAME, SERVER_USER_ROLE 等)

window.onload → checkAccessFlow()
  ├── Google認証済み (staffName != ゲスト) → resolveFinalView()
  ├── localStorage にパスコードあり → verifyPasscode() でサーバー問い合わせ
  │     ├── 成功 → resolveFinalView()
  │     └── 失敗 → ローディング非表示 → ログインモーダル表示
  └── 認証情報なし → ログインモーダル表示

resolveFinalView()
  → google.script.url.getLocation() でURLパラメータ取得
  → initAppView(action) → switchMode(action || '貸出')

switchMode(mode) によるSPA内ページ切替:
  ├── '貸出' / '返却' / '充填'     → view-operations  (Part_Operations_Dial or Part_Operations)
  │     └── フッターナビ(下部3ボタン)で切替、左右スワイプ対応
  ├── '破損報告'                    → view-operations-sub (Part_DamageReport)
  ├── '修理済み' / '耐圧検査完了'   → view-maintenance  (Part_Maintenance)
  ├── 'ダッシュボード'              → view-dashboard    (Part_Dashboard)
  ├── 'マイページ'                  → view-mypage       (Part_MyPage)
  ├── '資材発注'                    → view-order        (Part_Order)
  ├── '自社管理'                    → view-inhouse      (Part_InHouse)
  └── '一括返却'                    → view-bulk-return  (Part_BulkReturn)

ナビゲーション経路:
  ├── フッターナビ(常時表示): 貸出 / 返却 / 充填
  ├── サイドバーメニュー:     貸出 / 返却 / 充填 / ダッシュボード / 破損報告 / 修理済み / 耐圧検査完了 / 資材発注 / マイページ
  ├── ヘッダー右ボタン:       一括返却 (貸出/返却/充填 画面でのみ表示)
   └── 操作画面内の自社ボタン:
        → goToInHouse(): 入力済みキュー(opQueue)を引き継いで自社管理ページへ遷移
          ※ 入力済みタンクは window._pendingInHouseIds 経由で自社管理画面に渡される

```

---

## 3. タンクの状態遷移

### ステータス一覧

| ステータス | 意味 | 操作で遷移する？ |
|---|---|---|
| 充填済み | ガスが入った状態。貸出/自社利用が可能 | Yes (充填・未使用返却で) |
| 空 | ガスが空の状態。充填が必要 | Yes (返却・修理済み・耐圧検査完了で) |
| 貸出中 | 顧客に貸し出し中 | Yes (貸出で) |
| 未返却 | 貸出中だが返却期限超過等。手動設定 | 手動。返却の対象にはなる |
| 自社利用中 | 自社で使用中 | Yes (自社利用で) |
| 破損 / 不良 / 故障 | 修理が必要な状態 | 破損は操作で設定。不良/故障は手動設定 |
| 保管中 | 操作では遷移しない手動ステータス。OP_RULESでは貸出/自社利用の許容元に含まれる | 手動設定のみ |
| 新規登録 / 不明 / メンテナンス完了 | 特殊ステータス。バリデーション免除対象 | 手動設定のみ |

### OP_RULES 定義 (Feature_Operations.js)
```
操作名            allowedPrev(許容する直前ステータス)        nextStatus
─────────────────────────────────────────────────────────
貸出              充填済み, 保管中                          貸出中
自社利用          充填済み, 保管中                          自社利用中
返却              貸出中, 未返却, 自社利用中                空 ※
一括返却          貸出中, 未返却                            空 ※
自社事後報告      (制限なし: allowedPrev=[])                自社利用中 ※※
充填              空                                        充填済み
破損報告          (制限なし: allowedPrev=[])                破損
修理済み          破損, 不良, 故障                          空

※  nextStatusは基本値。processReturn/processBulkReturn内で isUnused→充填済み に変わる場合あり
※※ OP_RULESのnextStatusは'空'と定義されているが、実際の処理(processCompanyRetroReport)では
    自社利用中に遷移する。OP_RULESのnextStatusは参照されず処理関数が直接指定するため影響なし
```

### バリデーション免除 (SPECIAL_STATUSES)
以下のステータスを持つタンクは、allowedPrevチェックを免除される:
`""(空文字)`, `"新規登録"`, `"不明"`, `"メンテナンス完了"`

### 正常フロー図
```
充填済み ──貸出──→ 貸出中 ──返却(通常)──→ 空 ──充填──→ 充填済み
    │                  │                     ↑
    │                  ├─返却(未充填)─────────┘  (充填不備のまま貸し出されていた)
    │                  │
    │                  └─未使用返却──→ 充填済み  (ガス残あり → 充填済みに戻る)
    │
    ├──自社利用──→ 自社利用中
    │                  ├─自社返却(通常)──→ 空
    │                  ├─自社返却(未使用)──→ 充填済み
    │                  └─自社返却(不備)──→ 空
    │
    ├──破損報告──→ 破損 ──修理済み──→ 空
    │              (不良/故障 も修理済みで → 空)
    │
    └──耐圧検査完了──→ 空 (+ E列の検査日を更新)

※ 未返却は手動設定のステータスだが、返却/一括返却のallowedPrevに含まれる
※ 保管中は手動設定のステータスだが、貸出/自社利用のallowedPrevに含まれる
```

### 返却パターン詳細

| 操作 | 条件 | 元ステータス | 遷移先 | ログ操作名 | 金銭ログ操作名 |
|---|---|---|---|---|---|
| 通常返却 | - | 貸出中 | 空 | `返却` | `返却` |
| 未使用返却 | isUnused=true | 貸出中 | **充填済み** | `未使用返却` | `未使用返却` |
| 未充填返却 | isDefect=true | 貸出中 | 空 | `返却(未充填)` | `返却(未充填)` → 報酬0 |
| 返却(自社利用中から) | - | **自社利用中** | 空 | `返却` | **`自社返却`** ※ |
| 自社返却(通常) | statusTag=normal | 自社利用中 | 空 | `自社返却` | `自社返却` |
| 自社返却(未使用) | statusTag=unused | 自社利用中 | **充填済み** | `自社返却(未使用)` | `自社返却(未使用)` |
| 自社返却(不備) | statusTag=defect | 自社利用中 | 空 | `自社返却(不備)` | `自社返却(不備)` |
| 一括返却(通常) | statusTag=normal | 貸出中/未返却 | 空 | `返却` | `返却` |
| 一括返却(未使用) | statusTag=unused | 貸出中/未返却 | **充填済み** | `未使用返却` | `未使用返却` |
| 一括返却(未充填) | statusTag=defect | 貸出中/未返却 | 空 | `返却(未充填)` | `返却(未充填)` → 報酬0 |

※ 返却画面で自社利用中タンクを返却した場合、金銭ログのaction名が自動的に`自社返却`に変換される (submitOperations内)

### G列タグによる返却種別管理

自社利用中タンクの返却種別（通常/未使用/不備）はステータスシートのG列（ログ備考）に保存される:

| G列の値 | statusTag | 返却時の遷移先 | ログ操作名 |
|---|---|---|---|
| (空またはタグなし) | normal | 空 | 自社返却 |
| `[TAG:unused]` | unused | **充填済み** | 自社返却(未使用) |
| `[TAG:defect]` | defect | 空 | 自社返却(不備) |

- タグはフロントエンド（Part_InHouse.html）でタグ付け時に `saveInHouseTag()` で即時保存
- 自動返却（`autoConfirmInHouseTanks`）はG列のタグを読み取って返却種別を決定
- 返却処理後、`writeToSheet` がG列を上書きするためタグは自動クリアされる

### 報酬・スコアルール

金銭ログには全操作が記録されるが、報酬・スコアの計算は以下のルールに従う:

**calculateRewardInMemory (3_Money.js) による即時判定:**
- `返却(未充填)` / `未充填` → 報酬0, スコア0 を即座に返す
- それ以外 → 単価マスタ(M_設定_単価)を参照して報酬・スコアを計算

**runMonthlyClosing (4_Rank.js) による月次締め時の除外:**
- `返却(未充填)` / `未充填` → スキップ (報酬0, スコア0)
- action名に `"自社"` を含む操作すべて → スキップ (報酬0, スコア0)

| 操作 | 報酬 | スコア | 備考 |
|---|---|---|---|
| 貸出 | あり | あり | |
| 返却(通常) | あり | あり | |
| 充填 | あり | あり | |
| 未使用返却 | あり | あり | |
| 返却(未充填) | **なし** | **なし** | calculateRewardInMemoryで0を返す |
| 自社利用 | **なし** | **なし** | 月次締めで"自社"を含む操作として除外 |
| 自社返却(全種) | **なし** | **なし** | 同上 |
| 自社利用(事後) | **なし** | **なし** | 同上 |
| 修理済み | あり | あり | 単価マスタに定義がある場合 |
| 破損報告 | あり | あり | 単価マスタに定義がある場合 |
| 耐圧検査完了 | あり | あり | "完了"を除去して"耐圧検査"でマスタ検索 |

### 請求ルール (ビジネスロジック)

貸出先への請求対象となるのは、**通常に使用された貸出分のみ**。

| 返却種別 | 請求 | 理由 |
|---|---|---|
| 通常返却 | **請求可** | 貸出先が通常使用した |
| 未使用返却 | **請求不可** | 貸出先が使用していない（ガスが残っている） |
| 未充填返却 | **請求不可** | 充填不備はこちら側の不手際 |

※ 請求書発行ロジック自体はこのOperateプロジェクト内には含まれない (0_Config.jsにINVOICE_CONFIGの定義のみ存在)

---

## 4. 操作の処理フロー

### エントリポイント一覧

このアプリには2つのサーバーサイド処理エントリポイントがある:

| エントリポイント | 呼び出し元 | 対象操作 |
|---|---|---|
| `submitOperations(data)` | 操作画面 / 一括返却画面 / 自社管理画面 | 貸出, 返却, 充填, 自社利用, 自社事後報告, 自社一括返却, 一括返却, 破損報告 |
| `submitMaintenance(data)` | メンテナンス画面 | 修理済み, 耐圧検査完了 |

※ submitOperationsのswitch文には`修理済み`のcase(processRepair)も存在するが、UIからの導線はすべてsubmitMaintenance経由のため未使用

### submitOperations (Feature_Operations.js)
```
1. ロック取得 (LockService, 10秒タイムアウト)
2. ステータスシート読み込み → preLoadedData { sheet, data, idMap } 構築
3. validateOperations: OP_RULES で現在ステータスを検証
   ├── SPECIAL_STATUSES はバリデーション免除
   └── allowedPrev が空配列の場合もバリデーション免除
4. ユーザー認証 (getUserInfo: email + passcode で担当者リスト照合)
5. 直前ステータス記録 (prevStatusMap: 金銭ログのaction名変換に使用)
6. action別の処理関数を呼び出し:
   ├── '貸出'         → processLend         → writeToSheet(貸出中, 貸出先名, '貸出')
   ├── '自社利用'     → processCompanyUse   → writeToSheet(自社利用中, 自社, '自社利用')
   ├── '返却'         → processReturn       → writeToSheet(空 or 充填済み, 倉庫, '返却' or '未使用返却' or '返却(未充填)')
   ├── '充填'         → processFill         → writeToSheet(充填済み, 倉庫, '充填')
   ├── '破損報告'     → processDamageReport → writeToSheet(破損, 倉庫, '破損報告')
   ├── '修理済み'     → processRepair       → writeToSheet(空, 倉庫, '修理済み')  ※UIからは未使用(submitMaintenance経由)
   ├── '自社事後報告' → processCompanyRetroReport → writeToSheet(自社利用中, 自社, '自社利用(事後)')
   │                    ※ 既に自社利用中のIDはスキップ(成功扱い)
   ├── '自社一括返却' → processCompanyBulkReturn → 3グループに分けてwriteToSheet
   │                    ├── normal → writeToSheet(空, 倉庫, '自社返却')
   │                    ├── unused → writeToSheet(充填済み, 倉庫, '自社返却(未使用)')
   │                    └── defect → writeToSheet(空, 倉庫, '自社返却(不備)')
   └── '一括返却'     → processBulkReturn → 3グループに分けてwriteToSheet
                         ├── normal → writeToSheet(空, 倉庫, '返却')
                         ├── unused → writeToSheet(充填済み, 倉庫, '未使用返却')
                         └── defect → writeToSheet(空, 倉庫, '返却(未充填)')
7. 金銭ログ記録 (recordMoneyLog)
   ├── 共同作業者がいる場合: 全員分のログを生成 (報酬 = 個人報酬 / 人数)
   └── 返却時に元ステータスが自社利用中 → 金銭ログのactionを '自社返却' に変換
8. キャッシュ無効化 (ALL_TANK_STATUS_MAP を削除)
9. ロック解放
```

### submitMaintenance (Feature_Maintenance.js)
```
1. ユーザー認証
2. 耐圧検査完了の場合 → updateInspectionDate: E列(耐圧期限)を現在 + VALIDITY_YEARS年 に更新
3. preLoadedData 構築 (getPreLoadedDataForMaint)
4. writeToSheet(items, '空', '倉庫', mode名)
5. 金銭ログ記録 (recordMoneyLog)
```

### writeToSheet (2_Utils.js) — 全操作の共通書き込み関数
```
1. IDを正規化(normalizeId)してidMapで照合
2. ステータスシートの該当行を更新:
   ├── B列: ステータス → newStatus
   ├── C列: 場所      → newLoc
   ├── D列: 担当者    → staffName
   ├── F列: 備考      → 空/充填済みの場合クリア、破損/不良/故障の場合はnoteを設定
   ├── G列: ログ備考  → noteText (破損系以外)
   ├── H列: 更新日時  → now
   └── I列: 種別      → 既存値を維持
3. 履歴ログシート(履歴ログ{年})に1行追加:
   [UUID, 日時, 時刻(HH:mm), タンクID(整形済), 操作名, 場所, 備考, 担当者, 直前場所, 種別, 共同作業者]
4. SpreadsheetApp.flush() で確定
```

---

## 5. スプレッドシート構成

### [本体SS] タンクステータス
| 列 | Index | 内容 | 例 | 備考 |
|---|---|---|---|---|
| A | 0 | タンクID | A-01 | |
| B | 1 | ステータス | 貸出中 | 充填済み/空/貸出中/自社利用中/破損/不良/故障/未返却/保管中 等 |
| C | 2 | 場所/貸出先 | 〇〇商事 | 倉庫/自社/貸出先名 |
| D | 3 | 担当者 | 山田 | 最終操作者 |
| E | 4 | 耐圧期限 | 2026/06/15 | Date型。耐圧検査完了で更新 |
| F | 5 | 備考 | バルブ不良 | 破損/不良/故障時のみ設定、空/充填済みでクリア |
| G | 6 | ログ備考 | | 直近操作のメモ |
| H | 7 | 更新日時 | 2024/03/08 15:30 | Date型 |
| I | 8 | 種別/型式 | 7kg | タンク購入時に設定、以降保持 |

### [本体SS] 履歴ログ{年} (例: 履歴ログ2026)
| 列 | Index | 内容 |
|---|---|---|
| A | 0 | UUID |
| B | 1 | 日時 (Date型) |
| C | 2 | 時刻 (HH:mm 文字列) |
| D | 3 | タンクID (formatDisplayId済) |
| E | 4 | 操作名 (削除時は「削除済み」に変更) |
| F | 5 | 場所 (削除時は「削除済み」に変更) |
| G | 6 | 備考 |
| H | 7 | 担当者名 |
| I | 8 | 直前場所/貸出先 (削除時は「削除済み」に変更) |
| J | 9 | 種別 |
| K | 10 | 共同作業者 (カンマ区切り) |
| L | 11 | 退避列 (削除時に元の操作名を保存) |

### [本体SS] 担当者リスト
| 列 | Index | 内容 | 備考 |
|---|---|---|---|
| A | 0 | 名前 | 【停止】プレフィックスで無効化も可 |
| B | 1 | メールアドレス | Google認証用 |
| C | 2 | 権限 | 管理者/準管理者/一般 |
| D | 3 | ランク | 月次締めで自動更新 |
| E | 4 | ステータス | '停止' で無効化 |
| F | 5 | パスコード | 6桁数字 |
| G | 6 | ビューモード | リスト/ダイヤル |

### [本体SS] 貸出先リスト
| 列 | Index | 内容 | 備考 |
|---|---|---|---|
| A | 0 | 貸出先名 | |
| D | 3 | ステータス | '停止' or 名前に【停止】で除外 |

### [本体SS] 変更履歴 (タイムマシーン)
| 列 | 内容 |
|---|---|
| A | 日時 |
| B | 操作種別 (削除/編集) |
| C | UUID |
| D | タンクID |
| E | 元の操作名 |
| F | 元の場所 |
| G | 元のステータス |
| H | 実行者 |
| I | 元データJSON (行データ全体の復元用) |

### [金銭SS] D_金銭ログ{年}
| 列 | Index | 内容 |
|---|---|---|
| A | 0 | UUID |
| B | 1 | 日時 |
| C | 2 | 担当者 |
| D | 3 | 操作名 |
| E | 4 | タンクID |
| F | 5 | (空欄: 動的集計に移行したため未使用) |
| G | 6 | 修理立替金 |
| H | 7 | 修理詳細 |
| I | 8 | 備考 |
| J | 9 | 作業人数 |

### [金銭SS] その他シート
| シート名 | 用途 |
|---|---|
| M_設定_単価 | A:操作名, B:基本単価, C:スコア, D-H:ランク別加算額(プラチナ→レギュラー順) |
| M_設定_ランク | A:ID, B:ランク名, C:必要スコア |
| M_設定_修理項目 | 修理チェックリスト (名前+価格) |
| M_設定_発注 | 発注マスタ (数値ID=資材, 文字列ID=タンク種別) |
| S_月次給与・収支 | 月次締め結果 |
| D_発注ログ{年} | 発注履歴 |

---

## 6. 認証フロー

### サーバーサイド (doGet → 1_App.js)
```
doGet(e)
  → getSafeUserEmail()  // Session.getActiveUser().getEmail() (匿名時は空文字)
  → getUserInfo(email, '')  // メールアドレスで担当者リスト照合
  → createNormalPage(userInfo, email, '', viewMode)
      → index.html テンプレートに staffName, userRole 等を埋め込み
```

### クライアントサイド (index.html)
```
checkAccessFlow()
  ├── GLOBAL_STAFF_NAME が有効 (Google認証成功: staffName != ゲスト)
  │     → resolveFinalView() → 即座にアプリ画面表示
  │
  ├── localStorageにパスコードあり (前回ログイン時に保存)
  │     → verifyPasscode(passcode) をサーバーに問い合わせ
  │     ├── 成功 → GLOBAL変数更新 → resolveFinalView()
  │     └── 失敗 → ローディング非表示 → ログインモーダル表示
  │
  └── 認証情報なし
        → ローディング非表示 → ログインモーダル表示

doLogin()
  → verifyPasscode(passcode) をサーバーに問い合わせ
  → 成功時:
     ├── GLOBAL_STAFF_NAME, GLOBAL_USER_ROLE, GLOBAL_PASSCODE を更新
     ├── localStorage にパスコードを永続保存 (app_user_passcode)
     ├── localStorage にビューモードを保存 (app_view_mode)
     └── resolveFinalView()

doLogout()
  → localStorage からパスコードとビューモードを削除
  → GLOBAL変数をリセット
  → getScriptUrl() でトップURLを取得 → リダイレクト
```

### getUserInfo (2_Utils.js) — ユーザー特定ロジック
```
担当者リストを走査:
  1. 停止フラグ (E列='停止' or 名前に【停止】) → スキップ
  2. パスコード一致 OR メールアドレス一致 → ユーザー特定
  3. どちらも一致しない → { name: "ゲスト", role: "一般", rank: "レギュラー" }
```

### 権限判定
```
isUserAdmin() (クライアント側):
  role に '管理者', '準管理者', 'admin' のいずれかを含む → true
```

---

## 7. 月次締めフロー (4_Rank.js)

```
runMonthlyClosing(targetDateStr)  // 省略時は先月分
  1. 対象月の決定 (例: "2026/02" → 2月分)

  2. マスタデータ取得
     ├── 単価マスタ (M_設定_単価): priceData
     └── ランク定義 (M_設定_ランク): rankDefs (スコア降順ソート)
         例: プラチナ(200) > ゴールド(150) > シルバー(100) > ブロンズ(50) > レギュラー(0)

  3. 金銭ログ(D_金銭ログ{年})から対象月のデータを集計
     担当者ごとに: totalScore, repairCost, actions{}, logs[]
     ※ スコアはF列(空欄)ではなく、calculateRewardInMemoryで動的計算

  4. 担当者ごとの給与計算:
     (A) スコア合計を動的計算 (レギュラーランクベースで)
         ※ 除外: 返却(未充填), 未充填, 自社を含む操作
         ※ 作業人数で割る: Math.floor(score / numWorkers)

     (B) ランク確定: スコアがランク定義の必要スコア以上で最上位のランクを採用

     (C) 報酬計算: 確定ランクで全操作の報酬を再計算
         報酬 = (基本単価 + レギュラー→確定ランクまでの累計加算額) / 作業人数
         ※ 除外条件は(A)と同じ

     (D) 行データ: [月, 名前, ランク, スコア, 貸出数, 返却数, 充填数, 修理数, 破損数, 歩合, 修理立替, 支払総額, 集計日時]
         ※ 修理数は s.actions['修理完了'] を参照するが、実際のログ操作名は '修理済み'。キー不一致のため常に0になる可能性あり

  5. S_月次給与・収支 シートに追記

  6. 担当者リスト(本体SS)の D列(ランク) を更新
```

---

## 8. 通知システム (5_Notify.js)

### 通知一覧
| 通知タイプ | トリガー | 用途コード | 送信関数 |
|---|---|---|---|
| 耐圧検査アラート | 月次トリガー | INSPECTION | checkHydrostaticDeadline |
| 貸出0件アラート | 日次トリガー | DAILY | checkDailyLendingCount |
| 操作削除通知 | 即時 (deleteOperationAndRollback内) | DAILY | sendLineBroadcastOrPush |
| ログ編集通知 | 即時 (editLogEntry内) | DAILY | sendLineBroadcastOrPush |
| テスト通知 | 手動 (testLineSend) | ALL | sendLineBroadcastOrPush |

### LINE設定
スクリプトプロパティ `LINE_CONFIGS` にJSON配列で保存:
```json
[{
  "token": "チャネルアクセストークン",
  "groupId": "グループID (空ならbroadcast)",
  "targets": ["DAILY", "INSPECTION"],
  "name": "社内通知"
}]
```

### 送信判定ロジック (sendLineBroadcastOrPush)
```
各LINE設定の targets 配列と通知の type を照合:
  targets に 'ALL' を含む → 常に送信
  targets に type を含む  → 送信
  type が 'ALL'           → 常に送信
  いずれにも該当しない   → スキップ

送信先:
  groupId あり → Push API (特定グループ)
  groupId なし → Broadcast API (全フォロワー)
```

---

## 9. 削除 + ロールバック (Feature_Delete.js)

### deleteOperationAndRollback
```
deleteOperationAndRollback({ uuids: [...] })
  UUIDごとに以下を実行:

  A. 履歴ログの検索とフラグ更新 (今年/去年/来年のシートを走査)
     ├── L列(index 11)に元の操作名を退避
     └── E列(操作), F列(場所), I列(直前場所) を「削除済み」に書換

  B. タイムマシーン(変更履歴)に記録
     → [日時, "削除", UUID, タンクID, 元操作名, 元場所, 現ステータス, 実行者, 元データJSON]

  C. 金銭ログの完全削除 (行ごと削除、共同作業者分のUUID一致行も削除)

  D. ステータスロールバック (前ログ検索ベース)
     ├── 同じタンクIDの「直前の操作ログ」を履歴ログから検索 (削除済み行は除外)
     │     └── 見つかった場合: そのログの結果状態に復元
     └── 前ログが見つからない場合: フォールバック推測
           ├── 返却系 → 貸出中 (場所は直前場所)
           ├── 貸出系 → 充填済み (場所は自社)
           ├── 充填系 → 空 (場所は自社)
           └── その他 → 空 (場所は自社)

  E. ステータスシート一括保存

  F. LINE通知 (DAILY) — NOTIFY_REPORT_OPTIONS で無効化可能
```

### editLogEntry
```
editLogEntry({ uuid, newTankId, newDest })
  1. 履歴ログからUUID行を検索
  2. 削除済みログは編集不可

  A. タンクID変更の場合:
     ├── 新IDがマスタに存在するか確認
     ├── 旧IDのステータスを巻き戻し (getRollbackStatus)
     ├── 新IDにステータスを適用 (getApplyStatus)
     ├── 履歴ログ行のタンクIDを更新
     └── 金銭ログのタンクIDも更新

  B. 貸出先変更の場合:
     ├── 履歴ログのF列(場所)を更新
     └── ステータスシートのC列(場所)も更新

  C. タイムマシーンに記録 (操作種別: "編集")
  D. ログ行・ステータスシートを保存
  E. キャッシュクリア
  F. LINE通知 (DAILY)
```

---

## 10. 自社管理フロー (Feature_InHouse.js)

### 基本概念

自社利用の入口は2つあるが、どちらも最終的に**自社管理画面（Part_InHouse.html）**を経由する:

| 操作経路 | UI画面 | 動作 | ログに記録される操作名 | 結果ステータス |
|---|---|---|---|---|
| 操作画面の自社ボタン | Part_Operations_Dial/List | 入力済みIDを引き継いで自社管理画面へ遷移 | `自社利用(事後)` | 自社利用中 |
| 自社管理画面の使用報告 | Part_InHouse | ダイヤルでID入力して事後報告 | `自社利用(事後)` | 自社利用中 |

※ `processCompanyUse` (action=`自社利用`, ログ=`自社利用`) はバックエンドに残存するが、UIからの直接呼び出し導線は廃止。
操作画面の自社ボタンは常に `goToInHouse()` で自社管理画面へ遷移し、事後報告フローを通る。

### 操作画面からの自社利用 (Part_Operations_Dial / Part_Operations)
```
自社ボタン押下時:
  → goToInHouse(): 常に自社管理ページへ遷移
  ├── opQueue に入力済みタンクあり
  │     → window._pendingInHouseIds にキューをコピー
  │     → 自社管理画面で事後報告キューに自動追加
  └── opQueue 空
        → そのまま自社管理画面へ遷移
```

### 自社管理画面のフロー (Part_InHouse.html)
```
自社管理画面は2段階構成:

ステップ1: 使用報告
  ダイヤルでタンクIDを入力（または操作画面から引き継いだIDを使用）
  → submitOperations({ action: '自社事後報告', items: [...] })
  → processCompanyRetroReport:
     ├── 既に自社利用中のID → スキップ (成功扱い)
     └── それ以外 → writeToSheet(自社利用中, 自社, '自社利用(事後)')
     ※ item.note が空の場合、自動で '事後報告' を設定

ステップ2: 返却確定
  A. 手動: 同画面下部の「利用中タンク」リストでタグ付け(未使用/未充填/通常)
     → タグ変更時に saveInHouseTag() でG列に即時保存
     → submitOperations({ action: '自社一括返却', items: [...] })
     → processCompanyBulkReturn → 3グループに分けてwriteToSheet
        ├── normal → writeToSheet(空, 倉庫, '自社返却')
        ├── unused → writeToSheet(充填済み, 倉庫, '自社返却(未使用)')
        └── defect → writeToSheet(空, 倉庫, '自社返却(不備)')

  B. 自動: autoConfirmInHouseTanks (日次トリガー実行)
     → getInHouseTanks() で全ての自社利用中タンクをG列タグ付きで取得
     → processCompanyBulkReturn でタグに応じた返却処理を実行
        ├── [TAG:unused] → 充填済みに戻す
        ├── [TAG:defect] → 空（不備）
        └── タグなし → 空（通常返却）
     → 担当者名: 'システム自動確定'
```

### サーバーサイド関数一覧 (Feature_InHouse.js)
```
getInHouseTanks()              → 自社利用中タンク取得（G列タグ情報付き）
saveInHouseTag(tankId, tag)    → G列にタグを保存 ([TAG:unused], [TAG:defect])
processCompanyUse(...)         → 自社利用処理（操作画面からの直接呼び出しは廃止）
processCompanyBulkReturn(...)  → 自社一括返却（タグに応じた3グループ分岐）
processCompanyRetroReport(...) → 事後報告処理
autoConfirmInHouseTanks()      → 自動確定（G列タグを読み取り反映）
```

### トリガー管理
```
setupAutoConfirmTrigger(hour)   → 日次トリガー登録 (autoConfirmInHouseTanks を指定時刻に実行)
deleteAutoConfirmTrigger()      → トリガー削除
getAutoConfirmTriggerStatus()   → 状態取得 { enabled: boolean }
```

---

## 11. 一括返却フロー (Feature_BulkReturn.js)

### 貸出先別一括返却
```
Part_BulkReturn.html:
  1. initBulkReturn() → getLentTanksByDestination()
     → ステータスが '貸出中' or '未返却' のタンクを貸出先(C列)別にグルーピング

  2. UI: 貸出先ごとのアコーディオン表示
     → 各タンクに statusTag をタグ付け: normal(通常) / unused(未使用) / defect(未充填)

  3. 送信: submitOperations({ action: '一括返却', items: [...] })
     → processBulkReturn → 3グループに分けてwriteToSheet
```

---

## 12. メンテナンスフロー (Feature_Maintenance.js)

```
Part_Maintenance.html:
  switchMode('修理済み') or switchMode('耐圧検査完了')
  → initMaintenance(mode) → getMaintenanceList(mode)

修理済み:
  → 対象: ステータスが '破損' / '不良' / '故障' のタンク一覧を表示
  → submitMaintenance({ mode: '修理済み', items: [...], cost, detail })
  → writeToSheet → ステータスを '空', 場所を '倉庫' に
  → 金銭ログに記録 (修理立替金を含む)

耐圧検査完了:
  → 対象: E列(耐圧期限)が ALERT_MONTHS 以内のタンク一覧を表示
  → submitMaintenance({ mode: '耐圧検査完了', items: [...] })
  → updateInspectionDate: E列を 現在 + VALIDITY_YEARS年 に更新
  → writeToSheet → ステータスを '空', 場所を '倉庫' に
  → 金銭ログに記録
```

---

## 13. 資材発注・タンク購入 (Feature_Order.js)

### 資材発注
```
submitOrder({ items: [{name, count, price, note}], userPasscode })
  → D_発注ログ{年} に追記
  → 金銭ログにも記録 (action: "資材発注", repairCost: 合計金額)
```

### タンク購入
```
submitTankOrder({ cartItems: [{type, ids[], price, nextDateStr, note}], isRegisterOnly })
  1. 重複チェック: 入力IDが既存タンクステータスにないか確認
  2. タンクステータスシートに新規行追加 (ステータス: '空', 場所: '倉庫')
  3. D_発注ログ{年} に追記
  4. isRegisterOnly=false の場合のみ、金銭ログにも記録 (action: "タンク購入")
```

### 発注削除 (batchDeleteOrderItems)
```
権限チェック:
  管理者/準管理者 → 常に削除可
  一般ユーザー → 自分の発注かつ3日以内のみ削除可

削除時の連動:
  ├── 発注ログから行削除
  ├── 金銭ログから行削除
  ├── タンク購入の場合: ステータスシートからタンク行も削除
  └── 履歴ログに「発注削除」操作を記録
```

### 発注数量変更 (batchUpdateOrderItems)
```
権限チェック: 削除と同じ (管理者は常に可、一般は自分の発注かつ3日以内)
更新対象: 発注ログの数量・合計、金銭ログの金額
```

---

## 14. マイページ (Feature_MyPage.js)

```
getMyStats(passcode)
  1. ユーザー特定 (getUserInfo)
  2. ランク定義・単価マスタを毎回シートから取得 (キャッシュ不使用、リアルタイム反映)
  3. 金銭ログ(D_金銭ログ)から当月の操作を集計:
     ├── スコア計算 (レギュラーベース、自社/未充填除外、人数割り)
     └── 過去6ヶ月の月別報酬額 (グラフ用)
  4. リアルタイムランク再判定 (当月スコアでランク定義を照合)
  5. 確定ランクで今月の報酬見込み額を計算
  6. 履歴ログから過去35日分の作業ログを取得 (表示用リスト)

返却データ:
  { name, rank, currentScore, estimatedMoney, nextRankScore,
    todayLog[], weeklyLog[], chartWork{}, chartHistory{} }
```

---

## 15. キャッシュ戦略

| キー名 | 内容 | TTL | 無効化タイミング |
|---|---|---|---|
| `ALL_TANK_STATUS_MAP` | 全タンクステータス | 6時間 | 操作成功後に即時削除 |
| `list_cache_貸出先リスト` | 貸出先マスタ | 12時間 | clearMasterCaches |
| `price_master_data` | 単価マスタ | 12時間 | clearMasterCaches |
| `repair_options` | 修理項目 | 12時間 | clearMasterCaches |
| `TANK_PREFIXES_V2` | IDプレフィックス一覧 | 6時間 | clearMasterCaches |
| `order_master_data_v12` | 発注マスタ | 6時間 | clearMasterCaches |

手動リフレッシュ: `clearMasterCaches()` で上記全キャッシュをクリア

---

## 16. 報酬計算ロジック (3_Money.js)

### calculateRewardInMemory(action, rankName, priceData)
```
1. 単価マスタから action に完全一致する行を検索
2. 見つからない場合: 末尾の「済み」「完了」を除去して再検索 (あいまい検索)
3. 特殊ケース: "返却(未充填)" or "未充填" → 即座に報酬0を返す

単価マスタの列構造:
  A: 操作名, B: 基本単価, C: スコア,
  D: プラチナ加算, E: ゴールド加算, F: シルバー加算, G: ブロンズ加算, H: レギュラー加算

報酬計算:
  rankAdd = H列(レギュラー) から 確定ランク列 までの全加算額を合計
  total = 基本単価(B列) + rankAdd

  例: ゴールドの場合 → rankAdd = H + G + F + E
```

---

## 17. 外部依存

| サービス | 用途 |
|---|---|
| LINE Messaging API | 通知送信 (Push/Broadcast) + Webhook受信 |
| Google Sheets | データストア (本体SS + 金銭SS の2つ) |
| Google Apps Script | サーバーランタイム + トリガー |
| Bootstrap 5.0.2 | UIフレームワーク |
| Bootstrap Icons 1.10.5 | アイコン |
| Chart.js | ダッシュボード/マイページのグラフ |
