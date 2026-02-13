# vendor: agent-browser snapshot ref logic

- source repository: https://github.com/vercel-labs/agent-browser
- pinned commit: `03a8cb95d07627a34981670060c8472d723e6cfe`
- imported concept range: `src/snapshot.ts` role/name duplicate tracking and deterministic ref assignment

This directory intentionally vendors only pure snapshot/ref formatting logic.
Browser I/O and CDP transport stay in this project (`src/daemon`, `extension`).
