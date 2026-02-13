# human-browser

Codex から、ユーザーのログイン済み Chrome をローカル daemon + 拡張経由で操作する最小実装です。

## 構成

- `src/cli/human-browser.ts`: 単一CLI入口
- `src/daemon/*`: 常駐ブリッジ
- `extension/*`: Chrome拡張 (MV3)
- `vendor/agent-browser/*`: snapshot/ref整形ロジックのvendor
- `test/*`: unit + integration

## セットアップ

```bash
npm install
npm link
human-browser init
human-browser daemon
```

`init` 後に表示される以下を拡張popupに設定:

- `extension_ws_url` 例: `ws://127.0.0.1:18765/bridge`
- `token` (`init` はデフォルトで token を隠すため、`human-browser init --show-token` で表示)

注意:
- `human-browser init --force` は既存configの token を維持します（稼働中daemonとの token 不整合を避けるため）。

## Chrome拡張の読み込み

1. `chrome://extensions` を開く
2. デベロッパーモードを ON
3. 「パッケージ化されていない拡張機能を読み込む」で `extension/` を選択
4. popupで `Daemon WS URL` と `Token` を保存

## 最小操作例

```bash
human-browser status
human-browser tabs
human-browser snapshot
human-browser click '#login'
human-browser fill '#email' hello@example.com
# refs (@e1/ref=e1/e1) で操作する場合は --snapshot が必須
human-browser click @e1 --snapshot <snapshot_id>
human-browser fill @e2 hello@example.com --snapshot <snapshot_id>
human-browser diagnose --limit 20
# token を表示する場合のみ明示フラグを使う
human-browser ws --show-token
```

## 仕様

- CLI仕様: `docs/cli-spec.md`
- protocol仕様: `docs/protocol.md`
