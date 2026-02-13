# human-browser

Codex から、ユーザーのログイン済み Chrome をローカル daemon + 拡張経由で操作する最小実装です。

## 構成

- `src/cli/hb.ts`: 単一CLI入口
- `src/daemon/*`: 常駐ブリッジ
- `extension/*`: Chrome拡張 (MV3)
- `vendor/agent-browser/*`: snapshot/ref整形ロジックのvendor
- `test/*`: unit + integration

## セットアップ

```bash
npm install
node src/cli/hb.ts init
node src/cli/hb.ts daemon
```

`init` 後に表示される以下を拡張popupに設定:

- `extension_ws_url` 例: `ws://127.0.0.1:18765/bridge`
- `token`

## Chrome拡張の読み込み

1. `chrome://extensions` を開く
2. デベロッパーモードを ON
3. 「パッケージ化されていない拡張機能を読み込む」で `extension/` を選択
4. popupで `Daemon WS URL` と `Token` を保存

## 最小操作例

```bash
node src/cli/hb.ts status
node src/cli/hb.ts tabs
node src/cli/hb.ts snapshot
node src/cli/hb.ts click e1
node src/cli/hb.ts fill e2 hello@example.com
node src/cli/hb.ts diagnose --limit 20
```

## 仕様

- CLI仕様: `docs/cli-spec.md`
- protocol仕様: `docs/protocol.md`
