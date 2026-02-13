import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
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

test('CLI returns DISCONNECTED when daemon is unreachable', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'human-browser-cli-'));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const port = await getFreePort();
  const configPath = join(dir, 'config.json');
  await writeFile(
    configPath,
    JSON.stringify(
      {
        daemon: { host: '127.0.0.1', port },
        auth: { token: 'unreachable_test_token_123456' },
        diagnostics: { max_events: 500 },
      },
      null,
      2,
    ),
    'utf8',
  );

  try {
    await execFile('node', ['src/cli/human-browser.ts', '--config', configPath, 'status'], {
      cwd: process.cwd(),
    });
    assert.fail('status should fail when daemon is not running');
  } catch (error) {
    const stderr = String((error as { stderr?: string }).stderr ?? '').trim();
    assert.notEqual(stderr.length, 0);
    const parsed = JSON.parse(stderr) as {
      ok: boolean;
      error: { code: string; message: string; recovery?: { next_command?: string } };
    };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.error.code, 'DISCONNECTED');
    assert.equal(parsed.error.recovery?.next_command, 'human-browser daemon');
  }
});
