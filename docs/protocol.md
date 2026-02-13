# Daemon <-> Extension Protocol (minimal)

Transport: WebSocket (`ws://127.0.0.1:<port>/bridge?token=<shared_token>`)

## Daemon -> Extension

### `PING`

```json
{ "type": "PING", "ts": "2026-02-12T10:00:00.000Z" }
```

### `COMMAND`

```json
{
  "type": "COMMAND",
  "request_id": "uuid",
  "command": "snapshot",
  "payload": {
    "target": "active"
  }
}
```

## Extension -> Daemon

### `HELLO`

```json
{ "type": "HELLO", "version": "0.1.0", "retry_count": 0 }
```

### `PONG`

```json
{ "type": "PONG", "ts": "2026-02-12T10:00:00.000Z" }
```

### `EVENT`

```json
{
  "type": "EVENT",
  "name": "connection_opened",
  "payload": { "ws_url": "ws://127.0.0.1:18765/bridge" }
}
```

### `RESULT`

Success:

```json
{
  "type": "RESULT",
  "request_id": "uuid",
  "ok": true,
  "result": { "tab_id": 123 }
}
```

Failure:

```json
{
  "type": "RESULT",
  "request_id": "uuid",
  "ok": false,
  "error": {
    "code": "NO_MATCH",
    "message": "Element not found",
    "details": { "selector": "#login" }
  }
}
```

## Required payload keys by command

- `select_tab`: `{ target: "active" | number }`
- `snapshot`: `{ target: "active" | number }`
- `click`: `{ tab_id: number | "active", selector: string }`
- `fill`: `{ tab_id: number | "active", selector: string, value: string }`
- `keypress`: `{ tab_id: number | "active", key: string }`
- `scroll`: `{ tab_id: number | "active", x: number, y: number }`
- `navigate`: `{ tab_id: number | "active", url: string }`
- `reconnect`: `{}`
- `reset`: `{}`
