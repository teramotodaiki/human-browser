# CLI Spec (`human-browser`)

## Global options

- `--json`: machine-friendly JSON output
- `--config <path>`: config file path (default: `~/.human-browser/config.json`)
- `--timeout <ms>`: daemon command timeout (default: `10000`)
- `--queue-mode hold|fail`: behavior when extension is offline
  - `hold`: wait for reconnect until timeout
  - `fail`: immediately return `DISCONNECTED`

## Commands

- `human-browser init [--host 127.0.0.1] [--port 18765] [--max-events 500] [--force] [--show-token]`
  - creates config with shared token
  - `--force` で再初期化しても既存 token は維持される（daemon との token 不整合防止）
- `human-browser ws [--show-token]`
  - prints websocket endpoint (`token` is hidden unless `--show-token` is specified)
- `human-browser rotate-token [--show-token]`
  - rotates shared token in config
  - 実行後は daemon再起動と拡張のtoken更新が必要
- `human-browser daemon`
  - starts local daemon
- `human-browser status`
  - connection/session status
- `human-browser tabs`
  - list tabs from extension
- `human-browser use <active|tab_id>`
  - select target tab
- `human-browser snapshot [--tab <active|tab_id>] [--interactive] [--cursor] [--compact] [--depth <N>] [--selector <css>]`
  - returns deterministic tree with refs and `snapshot_id`
  - default is full-context snapshot (content + interactive). `--interactive` narrows output to interactive candidates only.
- `human-browser click <selector|@ref> [--snapshot <snapshot_id>]`
- `human-browser fill <selector|@ref> <value> [--snapshot <snapshot_id>]`
  - ref (`@eN`/`ref=eN`/`eN`) を使う場合は `--snapshot` 必須
- `human-browser keypress <key> [--tab <active|tab_id>]`
- `human-browser scroll <x> <y> [--tab <active|tab_id>]`
- `human-browser navigate <url> [--tab <active|tab_id>]`
- `human-browser open <url> [--tab <active|tab_id>]`
- `human-browser close [--tab <active|tab_id>]`
- `human-browser hover <selector|@ref> [--snapshot <snapshot_id>]`
- `human-browser screenshot [path] [--full] [--tab <active|tab_id>]`
- `human-browser pdf <path> [--tab <active|tab_id>]`
- `human-browser eval <javascript> [--tab <active|tab_id>]`
- `human-browser get text <selector|@ref> [--snapshot <snapshot_id>]`
- `human-browser get html [selector|@ref] [--snapshot <snapshot_id>]`
- `human-browser wait <selector|milliseconds> [--timeout <ms>] [--tab <active|tab_id>]`
- `human-browser wait --text <text> [--timeout <ms>] [--tab <active|tab_id>]`
- `human-browser wait --url <pattern> [--timeout <ms>] [--tab <active|tab_id>]`
- `human-browser wait --load <load|domcontentloaded|networkidle> [--timeout <ms>] [--tab <active|tab_id>]`
- `human-browser wait --fn <expression> [--timeout <ms>] [--tab <active|tab_id>]`
- `human-browser cookies [get]`
- `human-browser cookies set <name> <value> [--url <url>]`
- `human-browser cookies delete <name> [--url <url>]`
- `human-browser cookies clear`
- `human-browser network start|stop [--tab <active|tab_id>]`
- `human-browser network dump|requests [--filter <text>] [--clear] [--tab <active|tab_id>]`
- `human-browser console [start|stop|dump] [--clear] [--tab <active|tab_id>]`
- `human-browser reconnect`
  - request bridge reconnect
- `human-browser reset`
  - drop session snapshot and request extension reset
- `human-browser diagnose [--limit <N>]`
  - recent events/disconnect/reconnect history

## Error model

All errors are structured:

```json
{
  "ok": false,
  "error": {
    "code": "STALE_SNAPSHOT",
    "message": "Snapshot mismatch...",
    "details": {},
    "recovery": {
      "next_command": "human-browser snapshot",
      "reconnect_required": false,
      "reset_session_recommended": false
    }
  }
}
```

Core codes:

- `DISCONNECTED`
- `TIMEOUT` (`details.phase`: `wait_for_extension` / `extension_response`)
- `NO_SUCH_REF`
- `STALE_SNAPSHOT`
- `NO_ACTIVE_SNAPSHOT`
- `EXTENSION_ERROR`
- `BAD_REQUEST`
- `UNAUTHORIZED`
- `INTERNAL`
