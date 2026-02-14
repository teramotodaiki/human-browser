import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCallback);

test('--help prints CLI usage', async () => {
  const { stdout, stderr } = await execFile('node', ['src/cli/human-browser.ts', '--help'], {
    cwd: process.cwd(),
  });

  assert.equal(stderr, '');
  assert.match(stdout, /human-browser CLI/);
  assert.match(stdout, /Usage:/);
});
