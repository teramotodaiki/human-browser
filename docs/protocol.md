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
- `snapshot`: `{ target: "active" | number, interactive?: boolean, cursor?: boolean, compact?: boolean, depth?: number, selector?: string }`
- `click`: `{ tab_id: number | "active", selector: string }`
- `fill`: `{ tab_id: number | "active", selector: string, value: string }`
- `keypress`: `{ tab_id: number | "active", key: string }`
- `scroll`: `{ tab_id: number | "active", x: number, y: number }`
- `navigate`: `{ tab_id: number | "active", url: string }`
- `open`: `{ tab_id: number | "active", url: string }`
- `close`: `{ tab_id: number | "active" }`
- `hover`: `{ tab_id: number | "active", selector: string }`
- `eval`: `{ tab_id: number | "active", script: string }`
- `text`: `{ tab_id: number | "active", selector: string }`
- `html`: `{ tab_id: number | "active", selector?: string }`
- `wait`: `{ tab_id: number | "active", selector?: string, sleep_ms?: number, timeout_ms?: number, text?: string, url_pattern?: string, load_state?: string, expression?: string }`
- `screenshot`: `{ tab_id: number | "active", full_page?: boolean }`
- `pdf`: `{ tab_id: number | "active" }`
- `cookies_get`: `{ tab_id: number | "active", url?: string }`
- `cookies_set`: `{ tab_id: number | "active", name: string, value: string, url?: string }`
- `cookies_delete`: `{ tab_id: number | "active", name: string, url?: string }`
- `cookies_clear`: `{ tab_id: number | "active" }`
- `network_start`: `{ tab_id: number | "active" }`
- `network_stop`: `{ tab_id: number | "active" }`
- `network_dump`: `{ tab_id: number | "active", filter?: string, clear?: boolean }`
- `console_start`: `{ tab_id: number | "active" }`
- `console_stop`: `{ tab_id: number | "active" }`
- `console_dump`: `{ tab_id: number | "active", clear?: boolean }`
- `reconnect`: `{}`
- `reset`: `{}`
