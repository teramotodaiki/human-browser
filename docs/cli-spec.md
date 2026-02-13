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
- `human-browser daemon`
  - starts local daemon
- `human-browser status`
  - connection/session status
- `human-browser tabs`
  - list tabs from extension
- `human-browser use <active|tab_id>`
  - select target tab
- `human-browser snapshot [--tab <active|tab_id>]`
  - returns deterministic tree with refs and `snapshot_id`
- `human-browser click <selector|@ref> [--snapshot <snapshot_id>]`
- `human-browser fill <selector|@ref> <value> [--snapshot <snapshot_id>]`
  - ref (`@eN`/`ref=eN`/`eN`) を使う場合は `--snapshot` 必須
- `human-browser keypress <key> [--tab <active|tab_id>]`
- `human-browser scroll <x> <y> [--tab <active|tab_id>]`
- `human-browser navigate <url> [--tab <active|tab_id>]`
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
