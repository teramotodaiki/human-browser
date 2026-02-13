import { formatSnapshotWithRefs } from '../../vendor/agent-browser/ref_formatter.ts';
import type { SnapshotData, SnapshotNode } from './types.ts';

let snapshotCounter = 0;

export function buildSnapshot(tabId: number, nodes: SnapshotNode[]): SnapshotData {
  const { tree, refs } = formatSnapshotWithRefs(nodes);
  snapshotCounter += 1;

  return {
    snapshot_id: `s${Date.now()}_${snapshotCounter}`,
    tab_id: tabId,
    tree,
    refs,
    created_at: new Date().toISOString(),
  };
}
