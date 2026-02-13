# CLI Spec (`hb`)

## Global options

- `--json`: machine-friendly JSON output
- `--config <path>`: config file path (default: `~/.human-browser/config.json`)
- `--timeout <ms>`: daemon command timeout (default: `10000`)
- `--queue-mode hold|fail`: behavior when extension is offline
  - `hold`: wait for reconnect until timeout
  - `fail`: immediately return `DISCONNECTED`

## Commands

- `hb init [--host 127.0.0.1] [--port 18765] [--max-events 500] [--force]`
  - creates config with shared token
- `hb daemon`
  - starts local daemon
- `hb status`
  - connection/session status
- `hb tabs`
  - list tabs from extension
- `hb use <active|tab_id>`
  - select target tab
- `hb snapshot [--tab <active|tab_id>]`
  - returns deterministic tree with refs and `snapshot_id`
- `hb click <ref> [--snapshot <snapshot_id>]`
- `hb fill <ref> <value> [--snapshot <snapshot_id>]`
- `hb keypress <key> [--tab <active|tab_id>]`
- `hb scroll <x> <y> [--tab <active|tab_id>]`
- `hb navigate <url> [--tab <active|tab_id>]`
- `hb reconnect`
  - request bridge reconnect
- `hb reset`
  - drop session snapshot and request extension reset
- `hb diagnose [--limit <N>]`
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
      "next_command": "hb snapshot",
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
