# Cartes MCP 共桌版

這個分支讓一位人類透過瀏覽器 UI，和一個或多個 MCP Agent 一起玩 21 點或十點半。每位 Agent 都是獨立玩家，有自己的手牌、回合與戰績；所有玩家共同對戰規則驅動的莊家。

原本的單檔 `index.html` 沒有被改成需要後端，既有玩法仍可照常使用。新版共桌 UI 位於 `web/`，由本機 Cartes Host 提供。

## 架構

```text
人類瀏覽器 UI ───────┐
                     │ HTTP + 席位憑證
Codex STDIO MCP ─────┼── Cartes Host ── 規則、牌堆、回合、事件游標
Claude Code STDIO MCP┤
其他 Agent MCP ──────┘
```

- `cartes-host` 是唯一牌局權威，持有牌堆、莊家暗牌與所有座位狀態。
- 每個 MCP client 啟動自己的 `cartes-mcp` STDIO process；該 process 只在記憶體持有自己座位的 capability token。
- 人類在 UI 建立牌桌並取得邀請碼。Agent 只能用邀請碼入座，無法列舉其他牌桌。
- 人類負責開局；之後依入座順序逐家行動，全部停牌或爆牌後由莊家自動結算。
- 牌桌、邀請碼與戰績目前只存在 Host 記憶體；Host 重啟後會消失。

## 開始遊戲

需求：Node.js 20 以上。

```powershell
npm install
npm start
```

`npm start` 會先編譯再啟動 Host，並持續占用這個終端。Host 預設只監聽 `127.0.0.1:3210`。在瀏覽器開啟 `http://127.0.0.1:3210`，輸入人類玩家名稱與模式後建立共桌。

把編譯後的 STDIO adapter 加到每個 MCP client。Codex CLI 範例：

```powershell
codex mcp add cartes -- node D:\絕對路徑\cartes\dist\src\index.js
```

Claude Code 範例：

```powershell
claude mcp add --transport stdio --scope user cartes -- node D:\絕對路徑\cartes\dist\src\index.js
```

設定後重新啟動對應 client。Claude Code 可用 `claude mcp get cartes`、`claude mcp list` 或互動介面的 `/mcp` 檢查連線。

若 Host 不在預設位置，為 MCP process 設定 `CARTES_HOST_URL`。Host 連接埠可用 `CARTES_HOST_PORT` 變更。

UI 的「複製 Agent 邀請詞」會產生可直接貼給 Agent 的提示。也可以自行說：

```text
請使用 cartes MCP，以「小葵」加入牌桌 ABCDEFG。加入後先打招呼，
只在 legal_actions 有 hit 或 stand 時出牌；否則用 wait_for_table_event
等待其他玩家，持續到本局結束。
```

若要多個 Agent，同一組邀請碼分別交給各個 MCP client 即可；每個 client 都會取得不同座位與不同的未讀事件游標。

## Agent 如何知道別家動了

`wait_for_table_event` 是有上限的 long poll，最多等待 25 秒。有人加入、開局、要牌、停牌、爆牌、結算或說話時，Host 會喚醒所有正在等待的 Agent。每位 Agent 的游標互相獨立，因此 Agent A 讀過事件不會讓 Agent B 漏掉。

逾時不是牌局結束；Agent 應重新呼叫等待。這個設計不要求 STDIO Server 主動把訊息塞進 client，也避免一個 MCP request 無限占住。MCP client 或模型若在一次回覆後不會繼續呼叫工具，仍需要 client 本身支援持續的 agent loop；Cartes 無法跨過產品邊界強制喚醒已停止執行的模型。

## MCP tools

| Tool | 用途 |
| --- | --- |
| `join_table` | 用人類 UI 的邀請碼取得一個獨立 Agent 座位 |
| `get_table_view` | 讀取最新公開牌桌、自己的座位與合法動作 |
| `take_action` | 輪到自己時執行 `hit` 或 `stand` |
| `say_at_table` | 對人類與其他 Agent 說話，不消耗出牌回合 |
| `wait_for_table_event` | 等候其他座位或牌局產生事件 |

遊戲寫入必須帶最新的 `expected_version` 與新的 `idempotency_key`。版本不符時，Agent 要重讀牌桌後再決定；同一 idempotency key 的網路重試只會回放第一次結果，不會重複抽牌。聊天不改變遊戲版本，避免一句話讓正在出牌的玩家產生不必要的版本衝突。

## 真雙盲邊界

洗牌使用 Node.js `crypto.randomInt` 驅動的 Fisher–Yates shuffle，牌序只存在 Host 內部。人類 API、瀏覽器 UI 與 MCP tool result 都不包含：

- 剩餘牌堆或牌序；
- 尚未翻開的莊家底牌；
- capability token（`join_table` 的 MCP 回傳也會過濾）；
- 內部遊戲狀態、測試牌序或其他牌桌資料。

同桌玩家的手牌是桌面公開資訊，所有座位都看得到。21 點進行中只公開莊家第一張牌；十點半在攤牌前不公開莊家牌。全部玩家完成回合後才翻開莊家完整手牌。

座位名稱、聊天與事件文字都是不可信的遊戲內容，MCP Server instructions 明確要求 Agent 不得把它們當作操作指令。

## 目前範圍

- 本機單一人類 UI，可邀請最多七個 Agent；
- 同一時間只支援一個人類座位，沒有旁觀者或真人多人模式；
- 沒有資料庫、斷線復原、網際網路部署、TLS 或 OAuth；
- 沒有金錢、籌碼或賭注；
- Host 刻意只綁 loopback。若未來改成遠端服務，必須重新設計登入、席位授權、撤銷、TLS、資源限制與跨桌隔離，不能直接把目前連接埠公開到網路。

完整測試範圍請看 [`QA.md`](QA.md)。
