import test from 'node:test';
import assert from 'node:assert/strict';
import { formatSnapshotWithRefs } from '../../vendor/agent-browser/ref_formatter.ts';

test('formatSnapshotWithRefs is deterministic for identical input', () => {
  const input = [
    { role: 'button', name: 'ログイン', selector: '#login' },
    { role: 'textbox', name: 'メールアドレス', selector: '#email' },
  ];

  const first = formatSnapshotWithRefs(input);
  const second = formatSnapshotWithRefs(input);

  assert.deepEqual(first, second);
});

test('duplicate role/name receives nth from second item', () => {
  const input = [
    { role: 'button', name: '送信', selector: '#submit-1' },
    { role: 'button', name: '送信', selector: '#submit-2' },
  ];

  const snapshot = formatSnapshotWithRefs(input);

  assert.equal(snapshot.refs.e1.nth, 0);
  assert.equal(snapshot.refs.e2.nth, 1);
  assert.match(snapshot.tree, /\[nth=1\]/);
});

test('non-duplicate role/name drops nth in ref map', () => {
  const input = [
    { role: 'button', name: '送信', selector: '#submit' },
  ];

  const snapshot = formatSnapshotWithRefs(input);

  assert.equal(snapshot.refs.e1.nth, undefined);
  assert.doesNotMatch(snapshot.tree, /\[nth=/);
});
