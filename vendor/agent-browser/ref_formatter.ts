/**
 * Adapted from vercel-labs/agent-browser (commit 03a8cb95...):
 * deterministic ref assignment + duplicate disambiguation rules.
 */

import type { SnapshotNode, SnapshotRef } from '../../src/shared/types.ts';

interface RoleNameTracker {
  counts: Map<string, number>;
  refsByKey: Map<string, string[]>;
  getKey(role: string, name?: string): string;
  getNextIndex(role: string, name?: string): number;
  trackRef(role: string, name: string | undefined, ref: string): void;
  getDuplicateKeys(): Set<string>;
}

function createRoleNameTracker(): RoleNameTracker {
  const counts = new Map<string, number>();
  const refsByKey = new Map<string, string[]>();

  return {
    counts,
    refsByKey,
    getKey(role: string, name?: string): string {
      return `${role}:${name ?? ''}`;
    },
    getNextIndex(role: string, name?: string): number {
      const key = this.getKey(role, name);
      const current = counts.get(key) ?? 0;
      counts.set(key, current + 1);
      return current;
    },
    trackRef(role: string, name: string | undefined, ref: string): void {
      const key = this.getKey(role, name);
      const refs = refsByKey.get(key) ?? [];
      refs.push(ref);
      refsByKey.set(key, refs);
    },
    getDuplicateKeys(): Set<string> {
      const duplicates = new Set<string>();
      for (const [key, refs] of refsByKey) {
        if (refs.length > 1) {
          duplicates.add(key);
        }
      }
      return duplicates;
    },
  };
}

export interface FormattedSnapshot {
  tree: string;
  refs: Record<string, SnapshotRef>;
}

export function formatSnapshotWithRefs(nodes: SnapshotNode[]): FormattedSnapshot {
  const refs: Record<string, SnapshotRef> = {};
  const tracker = createRoleNameTracker();
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i];
    const role = node.role.toLowerCase();
    const name = normalizeName(node.name);
    const ref = `e${i + 1}`;
    const nth = tracker.getNextIndex(role, name);
    tracker.trackRef(role, name, ref);

    refs[ref] = {
      selector: node.selector,
      role,
      name,
      nth,
    };

    let line = `- ${role}`;
    if (name) {
      line += ` "${escapeQuotes(name)}"`;
    }
    line += ` [ref=${ref}]`;

    if (nth > 0) {
      line += ` [nth=${nth}]`;
    }

    if (node.suffix) {
      line += ` ${node.suffix}`;
    }

    lines.push(line);
  }

  removeNthFromNonDuplicates(refs, tracker);

  return {
    tree: lines.length > 0 ? lines.join('\n') : '(no interactive elements)',
    refs,
  };
}

function normalizeName(name?: string): string | undefined {
  if (name === undefined) {
    return undefined;
  }
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function removeNthFromNonDuplicates(refs: Record<string, SnapshotRef>, tracker: RoleNameTracker): void {
  const duplicateKeys = tracker.getDuplicateKeys();

  for (const [ref, data] of Object.entries(refs)) {
    const key = tracker.getKey(data.role, data.name);
    if (!duplicateKeys.has(key)) {
      delete refs[ref].nth;
    }
  }
}

function escapeQuotes(value: string): string {
  return value.replaceAll('"', '\\"');
}
