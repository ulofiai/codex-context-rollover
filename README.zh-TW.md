<p align="center">
  <img src="assets/social-preview.png" alt="Codex Context Rollover 在重複壓縮後仍讓目標 A 保持為 A" width="100%">
</p>

<h1 align="center">Codex Context Rollover</h1>

<p align="center"><strong>別讓 Codex 在重複壓縮後，悄悄把 A 做成 B。</strong></p>

<p align="center">
  <a href="https://github.com/ulofiai/codex-context-rollover/actions/workflows/test.yml"><img src="https://github.com/ulofiai/codex-context-rollover/actions/workflows/test.yml/badge.svg" alt="跨平台驗證"></a>
  <a href="https://github.com/ulofiai/codex-context-rollover/releases/latest"><img src="https://img.shields.io/github/v/release/ulofiai/codex-context-rollover?display_name=tag" alt="最新版本"></a>
  <img src="https://img.shields.io/badge/dependencies-0-35c46a" alt="零套件相依">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT 授權"></a>
</p>

<p align="center">
  <a href="README.md">English</a> ·
  <a href="#兩條指令安裝">安裝</a> ·
  <a href="#第-2-次壓縮時會發生什麼">運作方式</a> ·
  <a href="https://github.com/ulofiai/codex-context-rollover/issues">回報任務漂移案例</a>
</p>

## 10 秒看懂

Codex 的長任務可能先被摘要一次，再拿摘要繼續摘要。任務表面上還在正常執行，原始限制卻可能消失，甚至讓目標 **A** 悄悄漂成 **B**。

Context Rollover 在第 2 次壓縮時準備一條乾淨的逃生路線：

```text
A → 摘要 → 再摘要 → B                         重複壓縮漂移
A → 完整本機快照 → /clear → A                 Context Rollover
```

- 保存具有 SHA-256 邊界的**逐 byte 本機 transcript 快照**。
- 接手的是**最初與最近 user 訊息原文**，不是另一份 AI 重寫摘要。
- 只有明確的 `/clear` 能消耗**短時效、一次性 handoff**，進入乾淨 session。
- 普通 `/new` **完全不接舊任務**，避免 A 污染不相關的 B。
- Pending handoff 會過期，舊快照也會依保留量自動清理。

沒有輪詢、prompt wrapper、背景服務、雲端帳號、telemetry 或套件相依。

## 兩條指令安裝

需求只有支援外掛／hooks 的 Codex、Git，以及 Node.js 20 或更新版本。沒有 `npm install` 步驟。

```shell
codex plugin marketplace add ulofiai/codex-context-rollover
codex plugin add codex-context-rollover@codex-context-rollover
```

重新啟動 Codex 或開新任務，執行一次 `/hooks`，檢查並信任 command hook。Codex 對第三方 command hook 會要求這一次檢查。

安裝到此結束。不需要搬移任何本機路徑、專案檔案、credential、資料庫或舊 state。

## 第 2 次壓縮時會發生什麼

```text
PostCompact #2
    └─ 完整本機快照 + SHA-256 + 逐字 user 指令錨點
         └─ 啟用短時效、一次性 handoff
              ├─ /clear  → 乾淨 session 接手一次
              └─ /new    → 完全不接，維持獨立
```

外掛不會停止壓縮、中斷工具或改寫 prompt。每次 hook 結果都以 `continue: true` 讓 Codex 繼續；唯一需要使用者做的事，就是用明確的 `/clear` 選擇接手目前任務。

| 長任務的痛點 | Context Rollover 改變了什麼 |
| --- | --- |
| 做歪以後才發現任務已經漂移 | 每個任務的實際壓縮次數都有記錄 |
| Recovery 還要依靠另一份摘要 | 精確 transcript 邊界完整保存在本機 |
| 乾淨 session 要自己重建 context | `/clear` 一次性收到最初與最近 user 訊息原文 |
| 自動接手可能把舊目標灌進新任務 | `/new` 刻意維持完全隔離 |
| Recovery 資料可能一直累積 | 保留量與過期機制會自動清理 |

## 它記錄什麼

每次自動或手動壓縮後，外掛會在 Codex 提供的可寫 `${PLUGIN_DATA}` 留下狀態。從設定門檻起，還會保存完整 transcript 快照並啟用工作目錄限定的 handoff：

```text
sessions/<session-id 的 sha256>/
├── state.json
├── 0002-<utc-timestamp>-<nonce>.json
└── 0002-<utc-timestamp>-<nonce>.transcript.jsonl
pending/
└── <工作目錄的 sha256>.json
```

每個檢查點包含：

- 壓縮次數與時間；
- transcript 路徑與當下擷取的 byte 邊界；
- 該邊界為止的 transcript SHA-256；
- trigger、turn ID 與工作目錄。

Pending handoff 另外保存一次性接手所需的原始與最近逐字 user 訊息錨點。

門檻快照是擷取邊界以前的**逐 byte 本機副本**，不會離開電腦。每個來源 session 只保留設定數量的最新快照，待接手 handoff 也會自動過期。

## 它真正解決什麼

它解決的是「不要再拿摘要去摘要」的接手問題。`/clear` 建立真正乾淨的 Codex session，而 `SessionStart source: clear` 是安全、明確的接手訊號。逐字 user 訊息錨點保存原始目標與最近限制，完整快照則保留可追查證據。

它不替你點 `/clear`，也不會透過 `/new` 偷偷延續。這唯一一次明確操作就是 consent boundary，避免 pending objective 洩漏進不相關任務。

### 為什麼是 `/clear`，不是 `/new`

Codex 會把 `/clear` 明確標成 `SessionStart source: clear`，普通新任務則獨立啟動。Context Rollover 只匹配明確的 `clear` 來源、相同工作目錄、短時效，而且只能消耗一份 handoff。正是這個原生差異，讓自動接手不需要在所有新對話中猜測該延續哪個舊任務。參考 [Codex 官方 hooks 事件文件](https://learn.chatgpt.com/docs/hooks#sessionstart)。

## 可選設定

| 環境變數 | 預設 | 用途 |
| --- | --- | --- |
| `CODEX_CONTEXT_ROLLOVER_THRESHOLD` | `2` | 從第幾次壓縮開始啟用 `/clear` handoff |
| `CODEX_CONTEXT_ROLLOVER_LOCALE` | `zh-TW` | 設為 `en` 改用英文提醒 |
| `CODEX_CONTEXT_ROLLOVER_DATA` | Codex `${PLUGIN_DATA}` | 隔離測試用的資料目錄覆寫 |
| `CODEX_CONTEXT_ROLLOVER_HANDOFF_TTL_MINUTES` | `30` | `/clear` 可消耗一次性 handoff 的時限 |
| `CODEX_CONTEXT_ROLLOVER_SNAPSHOT_RETENTION` | `2` | 每個來源 session 保留的完整快照數 |

## 隱私與失敗行為

- Runtime 記錄與完整快照全部留在本機。
- Session ID 先經 SHA-256 才會作為目錄名稱。
- 沒有網路請求、telemetry、token 或帳號。
- Atomic 寫入以及 session／workspace lock 保護並行更新。
- 過期、已消耗或超過保留數量的 handoff 資料不會重播。
- 記錄錯誤會顯示，但任務永遠繼續。

## 驗證

Repo 直接測真正安裝的 hook 行為，不是 mock；Windows、macOS、Linux 都會驗證完整快照、逐字錨點擷取、一次性 `/clear` 消耗、`/new`／startup 隔離、過期、自動保留清理、記錄失敗與 session 計數。

維護者可以直接使用 Node 驗證，沒有 npm 相依：

```shell
node --check plugins/codex-context-rollover/scripts/context-rollover.mjs
node --test test/post-compact.test.mjs
```

## 移除

```shell
codex plugin remove codex-context-rollover
```

如果某個專案已經有功能相同的 `PostCompact` hook，啟用此外掛前請停用重複版本。Codex 會執行所有符合的 hooks。

## 授權

[MIT](LICENSE)
