# Codex Context Rollover

[English](README.md)

這是一個小型、原生的 Codex 外掛。每次 Codex 壓縮任務內容後，它都會留下可驗證的檢查點；同一任務第二次壓縮起，會提醒你使用 `/new`，避免反覆有損摘要造成內容失真與任務飄移，最後把 A 做成 B。

它刻意不是護欄：hook 永遠回傳 `continue: true`。它不會阻擋壓縮、停止任務、改寫提示，也不會偷偷把舊內容灌進新任務。

## 在全新電腦安裝

需求：

- 支援外掛與 hooks 的 Codex CLI 或 Codex 桌面版
- 可直接執行 `node` 的 Node.js 20 或更新版本
- Git

把 GitHub repo 加成 Codex marketplace，再安裝外掛：

```shell
codex plugin marketplace add ulofiai/codex-context-rollover
codex plugin add codex-context-rollover@codex-context-rollover
```

重新啟動 Codex 或開新任務，執行一次 `/hooks`，檢查並信任此外掛 hook。Codex 基於安全設計，不會自動信任第三方命令 hook。

Hooks 預設啟用；如果新電腦曾把它關掉，請在 `~/.codex/config.toml` 設定：

```toml
[features]
hooks = true
```

安裝不依賴你的磁碟路徑、既有專案檔案、憑證或舊 state。Codex 會把 `${PLUGIN_ROOT}` 展開成實際外掛位置，並提供可寫入的 `${PLUGIN_DATA}`。

## 實際行為

1. Codex 自動或手動壓縮後觸發 `PostCompact`。
2. 外掛擷取當下 transcript 的 byte 邊界與 SHA-256，將小型 JSON 檢查點寫到 `${PLUGIN_DATA}/sessions/<雜湊後的-session-id>/`。
3. 第一次成功壓縮只記錄，不打擾你。
4. 第二次及之後顯示 `/new` 提醒。
5. 記錄若失敗會立刻告知，但不會攔截任務。

檢查點包含本機 transcript 路徑、byte 數、SHA-256、壓縮次數、時間、觸發來源、turn ID 與工作目錄；不會複製 transcript 內容。原 Codex 任務仍是完整來源，而且執行 `/new` 後仍會保留。

Session ID 會先經 SHA-256 才作為目錄名稱。Runtime 記錄只留在本機，不會寫進這個 Git repo。

## 可選設定

| 環境變數 | 預設 | 用途 |
| --- | --- | --- |
| `CODEX_CONTEXT_ROLLOVER_THRESHOLD` | `2` | 從第幾次壓縮開始提醒 `/new` |
| `CODEX_CONTEXT_ROLLOVER_LOCALE` | `zh-TW` | 設成 `en` 可改用英文提醒 |
| `CODEX_CONTEXT_ROLLOVER_DATA` | Codex `${PLUGIN_DATA}` | 僅供測試／開發覆寫資料目錄 |

## 更新或移除

使用你目前 Codex 版本提供的外掛命令：

```shell
codex plugin list
codex plugin remove codex-context-rollover
codex plugin marketplace list
```

如果你以前在專案內裝過功能相同的 `PostCompact` hook，啟用這個全域外掛前，請停用或移除重複的舊 hook。Codex 會執行所有符合的 hooks，兩套同時存在就會記錄與提醒兩次。

## 開發與測試

```shell
npm test
```

測試會在隔離的暫存目錄實際執行 hook，涵蓋成功記錄、重複壓縮提醒、記錄失敗、session 隔離，以及忽略其他事件。CI 會在 Windows、macOS 與 Linux 執行。

## 授權

[MIT](LICENSE)
