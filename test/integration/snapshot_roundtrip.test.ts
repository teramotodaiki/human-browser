import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { JSDOM } from 'jsdom';
import { WebSocket } from 'ws';
import { startDaemon } from '../../src/daemon/app.ts';
import type { DaemonConfig } from '../../src/shared/types.ts';

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('failed to allocate free port'));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function callDaemon(config: DaemonConfig, command: string, args: Record<string, unknown>) {
  const response = await fetch(`http://${config.daemon.host}:${config.daemon.port}/v1/command`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hb-token': config.auth.token,
    },
    body: JSON.stringify({
      command,
      args,
      queue_mode: 'hold',
      timeout_ms: 3000,
    }),
  });

  const payload = (await response.json()) as {
    ok: boolean;
    data?: Record<string, unknown>;
    error?: { code: string; message: string };
  };

  if (!payload.ok) {
    throw new Error(`${payload.error?.code}: ${payload.error?.message}`);
  }

  return payload.data ?? {};
}

test('snapshot -> click -> fill roundtrip works via daemon/bridge protocol', async () => {
  const port = await getFreePort();
  const config: DaemonConfig = {
    daemon: {
      host: '127.0.0.1',
      port,
    },
    auth: {
      token: 'testtoken_testtoken_testtoken',
    },
    diagnostics: {
      max_events: 100,
    },
  };

  const fixturePath = join(process.cwd(), 'test', 'fixtures', 'fixed.html');
  const html = await readFile(fixturePath, 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://example.test/',
    pretendToBeVisual: true,
  });

  const button = dom.window.document.querySelector('#login');
  if (!(button instanceof dom.window.HTMLButtonElement)) {
    throw new Error('button fixture missing');
  }
  button.addEventListener('click', () => {
    button.setAttribute('data-clicked', '1');
  });

  const daemon = await startDaemon(config);

  const ws = new WebSocket(`ws://${config.daemon.host}:${config.daemon.port}/bridge?token=${config.auth.token}`);

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });

  ws.send(JSON.stringify({ type: 'HELLO', version: 'test', retry_count: 0 }));

  ws.on('message', (raw) => {
    const message = JSON.parse(raw.toString()) as {
      type: string;
      request_id?: string;
      command?: string;
      payload?: Record<string, unknown>;
      ts?: string;
    };

    if (message.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG', ts: message.ts }));
      return;
    }

    if (message.type !== 'COMMAND' || !message.request_id || !message.command) {
      return;
    }

    const reply = (ok, resultOrError) => {
      if (ok) {
        ws.send(
          JSON.stringify({
            type: 'RESULT',
            request_id: message.request_id,
            ok: true,
            result: resultOrError,
          }),
        );
        return;
      }

      ws.send(
        JSON.stringify({
          type: 'RESULT',
          request_id: message.request_id,
          ok: false,
          error: resultOrError,
        }),
      );
    };

    if (message.command === 'list_tabs') {
      reply(true, {
        tabs: [{ id: 1, active: true, title: 'fixture', url: dom.window.location.href }],
      });
      return;
    }

    if (message.command === 'select_tab') {
      reply(true, { tab_id: 1 });
      return;
    }

    if (message.command === 'snapshot') {
      reply(true, {
        tab_id: 1,
        nodes: [
          { role: 'button', name: 'ログイン', selector: '#login' },
          { role: 'textbox', name: 'メールアドレス', selector: '#email' },
        ],
      });
      return;
    }

    if (message.command === 'click') {
      const selector = String(message.payload?.selector ?? '');
      const el = dom.window.document.querySelector(selector);
      if (!el) {
        reply(false, { code: 'NO_MATCH', message: 'selector not found' });
        return;
      }
      if (el instanceof dom.window.HTMLElement) {
        el.click();
      }
      reply(true, { ok: true });
      return;
    }

    if (message.command === 'fill') {
      const selector = String(message.payload?.selector ?? '');
      const value = String(message.payload?.value ?? '');
      const input = dom.window.document.querySelector(selector);
      if (!(input instanceof dom.window.HTMLInputElement)) {
        reply(false, { code: 'NOT_FILLABLE', message: 'input not found' });
        return;
      }
      input.value = value;
      reply(true, { ok: true });
      return;
    }

    if (message.command === 'reset' || message.command === 'reconnect') {
      reply(true, { ok: true });
      return;
    }

    reply(false, { code: 'UNKNOWN', message: `Unhandled command: ${message.command}` });
  });

  try {
    const snapshot = await callDaemon(config, 'snapshot', {});
    const snapshotId = String(snapshot.snapshot_id);

    assert.match(snapshot.tree ? String(snapshot.tree) : '', /\[ref=e1\]/);
    assert.match(snapshot.tree ? String(snapshot.tree) : '', /\[ref=e2\]/);

    await callDaemon(config, 'click', {
      ref: 'e1',
      snapshot_id: snapshotId,
    });

    await callDaemon(config, 'fill', {
      ref: 'e2',
      value: 'alice@example.com',
      snapshot_id: snapshotId,
    });

    const clicked = dom.window.document.querySelector('#login')?.getAttribute('data-clicked');
    assert.equal(clicked, '1');

    const email = dom.window.document.querySelector('#email');
    if (!(email instanceof dom.window.HTMLInputElement)) {
      throw new Error('email input missing');
    }
    assert.equal(email.value, 'alice@example.com');
  } finally {
    ws.close();
    await daemon.close();
  }
});
