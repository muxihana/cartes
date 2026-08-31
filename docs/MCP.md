# Cartes MCP Server

這個分支讓支援 Model Context Protocol（MCP）的 AI 以玩家身分加入 Cartes，對戰規則驅動的莊家。目前是可驗證規則與工具邊界的本機 STDIO MVP；原本的 `index.html` 不需要後端，行為也沒有被改動。

## 目前玩法

- AI 坐玩家席，決定要牌或停牌。
- 莊家依原版規則自動補牌：21 點未滿 17 點補牌，十點半未滿 8 點補牌。
- 支援 21 點與十點半。
- 每張牌桌存在 MCP Server 的記憶體；Server 重啟後牌桌消失。
- MCP Server 不呼叫模型 API、不讀取 API key，也不主動連外。

## 真雙盲邊界

洗牌使用 Node.js `crypto.randomInt`，牌序只存在伺服器內部。任何 MCP tool result 都不得包含：

- 剩餘牌堆或牌序；
- 尚未翻開的莊家底牌；
- 內部遊戲狀態、測試牌序或其他牌桌內容；
- API key、席位憑證或伺服器 log。

AI 可以看到自己的手牌。21 點進行中只會看到莊家第一張明牌；十點半在攤牌前不顯示莊家牌。牌局結束後才公開莊家完整手牌。

目前每個 STDIO process 只服務啟動它的本機 MCP client，而且沒有跨桌列舉工具。未來若加入 Streamable HTTP，必須先用 OAuth 身分綁定席位，再由伺服器依呼叫者身分產生視角；不能只靠 `table_id` 當授權。

## 安裝與測試

需求：Node.js 20 以上。

```powershell
npm install
npm test
npm run build
```

以 Codex CLI 為例，把編譯後的 STDIO Server 加進 MCP 設定：

```powershell
codex mcp add cartes -- node D:\絕對路徑\cartes\dist\src\index.js
```

重新啟動 MCP client 後，可以要求 AI：

```text
請用 cartes 加入一桌 21 點，你叫小葵。讀取牌桌後自行決定要牌或停牌，直到這局結束。
```

## MCP tools

| Tool | 用途 |
| --- | --- |
| `join_table` | 建立記憶體牌桌並坐上玩家席 |
| `get_table_view` | 取得最新、已過濾隱藏資訊的玩家視角 |
| `take_action` | 執行 `hit` 或 `stand` |
| `say_at_table` | 留下一句桌邊台詞，不會代替出牌 |
| `start_new_round` | 本局結束後開始下一局 |

每次寫入都必須帶最新的 `expected_version` 與新的 `idempotency_key`。版本不符時，AI 必須重新讀取牌桌再決定；相同 idempotency key 的重試只會回放第一次結果，不會重複抽牌。

## 尚未包含

- 瀏覽器觀戰頁與 MCP 牌桌同步；
- 多位真人／AI 同桌；
- Streamable HTTP、OAuth、資料庫與部署設定；
- 事件喚醒或常駐 Agent Runner；
- 金錢、籌碼或賭注功能。

Remote MCP 是牌局操作通道，不會保證各家 AI 產品在沒有人發訊息時自行醒來。完全自動輪替需要另外的 Agent Runner，不能把這個責任藏進遊戲規則或假設 MCP client 一定會處理通知。
