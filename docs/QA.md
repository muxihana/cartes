# MCP 驗證報告

驗證日期：2026-08-31
驗證範圍：`feat/mcp-server` 本機 STDIO MVP

## 結論

目前自動化驗證為 **PASS**：MCP game core 與原版瀏覽器規則在固定牌序下逐步一致，且已測的 MCP 成功、錯誤、版本衝突與冪等重試路徑都沒有回傳未翻開的莊家底牌或剩餘牌堆。

這個結論只適用於本機 STDIO 架構。未來加入 Streamable HTTP 時，仍須完成 OAuth actor／seat binding 後才能宣稱遠端多人環境也符合雙盲。

## 自動化證據

執行：

```powershell
npm test
npm run typecheck
npm audit --audit-level=high
git diff --check
```

結果：

- 14 個 Node 測試全部通過；
- TypeScript typecheck 通過；
- npm audit：0 vulnerabilities；
- `git diff --check` 通過。

## 規則對拍

`test/browser-parity.test.ts` 會用 jsdom 執行原版 `index.html` 的 `window.cardsTest`，再把同一副固定牌序與同一串動作送入 MCP game core。每次發牌與每次行動後都比對：

- 玩家手牌、莊家完整手牌與規則允許的可見手牌；
- 剩餘牌序；
- 回合狀態、底牌是否翻開；
- 勝負與特殊牌型。

目前共有 24 組代表局面，涵蓋 21 點與十點半的 Blackjack、soft 17、A 降點、爆牌、平手、十點半、五龍、花牌半點，以及莊家多次補牌。

原版的完整底牌與牌堆只從瀏覽器既有的測試鉤子讀取，僅用於同 process 的測試比對；MCP schema 與 tool result 不提供這個鉤子。

## 雙盲紅隊測試

`test/mcp-server.test.ts` 在牌序中放入可辨識的暗牌 canary，檢查完整 tool result（文字與 structured content）：

| 路徑 | 驗證 |
| --- | --- |
| `join_table` | 莊家底牌、下一張牌與剩餘牌堆均不可見 |
| `get_table_view` | 重讀不增加可見資訊 |
| `say_at_table` | 聊天成功與重試都不洩漏，也不重複寫入 |
| `take_action` | 要牌前後、停牌、版本衝突、key 誤用與重試皆受檢查 |
| `start_new_round` | 成功、過早呼叫與重試皆受檢查，不重複發牌 |
| 找不到牌桌／空白台詞 | 錯誤內容不夾帶牌局內部狀態 |

另由 `test/stdio.test.ts` 啟動兩個獨立 STDIO server process，確認 client B 無法發現或讀取 client A 建立的記憶體牌桌，且工具清單不存在 `list_tables`。

## 洗牌檢查

正式牌局使用 `crypto.randomInt` 驅動 Fisher–Yates shuffle。測試連續建立 100 副洗牌結果，逐副確認仍是 52 張、無重複、無缺牌。

固定牌序注入只存在 game core 與 `TableStore` 的測試 seam；MCP tools 沒有接受 deck／seed／card 的輸入欄位。這項檢查能證明牌組完整性與介面封鎖，不能單獨當作隨機分布的統計認證。

## 尚待下一階段

- 讓真實 MCP client／模型各自玩 21 點與十點半多局，檢查工具選擇、重試與最終文字回覆；
- 若做 Remote MCP：補 OAuth、呼叫者身分綁定席位、跨席位存取測試與部署邊界測試；
- 瀏覽器觀戰頁若要接 MCP 牌桌，另做不同席位的視角過濾測試。
