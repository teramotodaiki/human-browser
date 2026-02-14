import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { initConfig } from '../../src/shared/config.ts';

const execFile = promisify(execFileCallback);

test('rotate-token rotates config token via CLI', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'human-browser-rotate-token-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const configPath = join(dir, 'config.json');
  const initialized = await initConfig({
    configPath,
    host: '127.0.0.1',
    port: 18765,
    maxEvents: 500,
    force: false,
  });

  const { stdout } = await execFile(
    'node',
    ['src/cli/human-browser.ts', '--json', '--config', configPath, 'rotate-token', '--show-token'],
    {
      cwd: process.cwd(),
    },
  );

  const payload = JSON.parse(stdout) as {
    config_path: string;
    ws_url: string;
    token: string;
    token_hidden: boolean;
    daemon_restart_required: boolean;
  };

  assert.equal(payload.config_path, configPath);
  assert.equal(payload.ws_url, 'ws://127.0.0.1:18765/bridge');
  assert.equal(payload.token_hidden, false);
  assert.equal(payload.daemon_restart_required, true);
  assert.notEqual(payload.token, initialized.config.auth.token);
  assert.equal(payload.token.length >= 24, true);

  const persistedRaw = await readFile(configPath, 'utf8');
  const persisted = JSON.parse(persistedRaw) as { auth: { token: string } };
  assert.equal(persisted.auth.token, payload.token);
});
