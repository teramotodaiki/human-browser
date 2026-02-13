import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initConfig } from '../../src/shared/config.ts';

async function makeTempConfigPath(): Promise<{ dir: string; configPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'human-browser-config-'));
  return {
    dir,
    configPath: join(dir, 'config.json'),
  };
}

test('init --force reuses existing token to avoid daemon/cli token drift', async (t) => {
  const { dir, configPath } = await makeTempConfigPath();
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const first = await initConfig({
    configPath,
    host: '127.0.0.1',
    port: 18765,
    maxEvents: 500,
    force: false,
  });

  const second = await initConfig({
    configPath,
    host: '127.0.0.1',
    port: 19999,
    maxEvents: 600,
    force: true,
  });

  assert.equal(second.config.auth.token, first.config.auth.token);
  assert.equal(second.config.daemon.port, 19999);
  assert.equal(second.config.diagnostics.max_events, 600);
});

test('init --force regenerates token when existing config token is invalid', async (t) => {
  const { dir, configPath } = await makeTempConfigPath();
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  await writeFile(
    configPath,
    JSON.stringify(
      {
        daemon: { host: '127.0.0.1', port: 18765 },
        auth: { token: 'short' },
        diagnostics: { max_events: 500 },
      },
      null,
      2,
    ),
    'utf8',
  );

  const created = await initConfig({
    configPath,
    host: '127.0.0.1',
    port: 18765,
    maxEvents: 500,
    force: true,
  });

  assert.notEqual(created.config.auth.token, 'short');
  assert.equal(created.config.auth.token.length >= 24, true);

  const persistedRaw = await readFile(configPath, 'utf8');
  const persisted = JSON.parse(persistedRaw) as { auth: { token: string } };
  assert.equal(persisted.auth.token, created.config.auth.token);
});
