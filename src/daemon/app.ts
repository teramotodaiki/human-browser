import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { URL } from 'node:url';
import { HBError, asStructuredError } from '../shared/errors.ts';
import { buildSnapshot } from '../shared/snapshot.ts';
import type {
  DaemonApiResponse,
  DaemonConfig,
  DaemonEvent,
  DiagnosticsReport,
  ExtensionToDaemonEnvelope,
  QueueMode,
  SnapshotData,
  SnapshotNode,
  StructuredError,
} from '../shared/types.ts';

interface PendingCommand {
  requestId: string;
  command: string;
  resolve: (value: Record<string, unknown>) => void;
  reject: (reason: StructuredError) => void;
  timer: NodeJS.Timeout;
}

interface ConnectionWaiter {
  resolve: () => void;
  reject: (reason: StructuredError) => void;
  timer: NodeJS.Timeout;
}

interface RuntimeState {
  config: DaemonConfig;
  extensionSocket?: WebSocket;
  extensionConnectedAt?: string;
  lastPingAt?: string;
  lastDisconnectReason?: string;
  reconnectAttempts: number;
  selectedTabId?: number;
  latestSnapshot?: SnapshotData;
  pendingCommands: Map<string, PendingCommand>;
  connectionWaiters: ConnectionWaiter[];
  events: DaemonEvent[];
  disconnectHistory: Array<{ at: string; reason: string }>;
  reconnectHistory: Array<{ at: string; reason: string }>;
}

export interface StartedDaemon {
  close: () => Promise<void>;
  port: number;
  host: string;
  getDiagnostics: (limit: number) => DiagnosticsReport;
}

export async function startDaemon(config: DaemonConfig): Promise<StartedDaemon> {
  const state: RuntimeState = {
    config,
    reconnectAttempts: 0,
    pendingCommands: new Map(),
    connectionWaiters: [],
    events: [],
    disconnectHistory: [],
    reconnectHistory: [],
  };

  const httpServer = createServer((req, res) => {
    void handleHttpRequest(state, req, res);
  });

  const bridgeServer = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    void handleUpgrade(state, bridgeServer, request, socket, head);
  });

  bridgeServer.on('connection', (ws) => {
    onExtensionConnected(state, ws);
  });

  const heartbeat = setInterval(() => {
    if (!state.extensionSocket || state.extensionSocket.readyState !== state.extensionSocket.OPEN) {
      return;
    }

    const payload = JSON.stringify({ type: 'PING', ts: new Date().toISOString() });
    state.extensionSocket.send(payload, (error) => {
      if (error) {
        logEvent(state, 'warn', 'bridge.ping_send_failed', 'Failed to send PING to extension', {
          error: error.message,
        });
      }
    });
  }, 5000);

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.daemon.port, config.daemon.host, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });

  logEvent(state, 'info', 'daemon.started', 'Daemon started', {
    host: config.daemon.host,
    port: config.daemon.port,
  });

  return {
    close: async () => {
      clearInterval(heartbeat);
      rejectAllPending(state, {
        code: 'DISCONNECTED',
        message: 'Daemon shutting down',
      });
      rejectConnectionWaiters(state, {
        code: 'DISCONNECTED',
        message: 'Daemon shutting down',
      });
      await closeServer(httpServer);
      bridgeServer.close();
    },
    port: config.daemon.port,
    host: config.daemon.host,
    getDiagnostics: (limit) => buildDiagnostics(state, limit),
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function authorizeHttp(state: RuntimeState, req: IncomingMessage): void {
  const token = req.headers['x-hb-token'];
  if (typeof token !== 'string' || token !== state.config.auth.token) {
    throw new HBError('UNAUTHORIZED', 'Invalid token', undefined, {
      next_command: 'human-browser init',
    });
  }
}

async function handleHttpRequest(state: RuntimeState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      sendJson(res, 200, {
        ok: true,
        data: {
          status: 'ok',
          now: new Date().toISOString(),
        },
      });
      return;
    }

    if (req.method !== 'POST' || req.url !== '/v1/command') {
      sendJson(res, 404, {
        ok: false,
        error: {
          code: 'BAD_REQUEST',
          message: 'Not found',
        },
      });
      return;
    }

    authorizeHttp(state, req);
    const payload = await readJsonBody(req);
    const command = getStringField(payload, 'command');
    const args = getObjectField(payload, 'args', {});
    const timeoutMs = getNumberField(payload, 'timeout_ms', 10000);
    const queueMode = getQueueMode(payload, 'queue_mode', 'hold');
    const result = await executeCommand(state, command, args, { timeoutMs, queueMode });

    sendJson(res, 200, {
      ok: true,
      data: result,
    });
  } catch (error) {
    const structured = asStructuredError(error);
    const status = structured.code === 'UNAUTHORIZED' ? 401 : 400;
    sendJson(res, status, {
      ok: false,
      error: structured,
    });
  }
}

async function handleUpgrade(
  state: RuntimeState,
  bridgeServer: WebSocketServer,
  request: IncomingMessage,
  socket: import('node:net').Socket,
  head: Buffer,
): Promise<void> {
  try {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? state.config.daemon.host}`);
    if (requestUrl.pathname !== '/bridge') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    const token = requestUrl.searchParams.get('token');
    if (token !== state.config.auth.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      logEvent(state, 'warn', 'bridge.auth_failed', 'Bridge auth failed', {
        remote: request.socket.remoteAddress,
      });
      return;
    }

    bridgeServer.handleUpgrade(request, socket, head, (ws) => {
      bridgeServer.emit('connection', ws, request);
    });
  } catch (error) {
    socket.destroy();
    logEvent(state, 'error', 'bridge.upgrade_failed', 'Bridge upgrade failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function onExtensionConnected(state: RuntimeState, ws: WebSocket): void {
  if (state.extensionSocket && state.extensionSocket.readyState === state.extensionSocket.OPEN) {
    state.extensionSocket.close(1000, 'Replaced by a new extension connection');
  }

  state.extensionSocket = ws;
  state.extensionConnectedAt = new Date().toISOString();
  state.reconnectAttempts = 0;
  state.reconnectHistory.push({
    at: state.extensionConnectedAt,
    reason: 'extension_connected',
  });
  truncateHistory(state);

  resolveConnectionWaiters(state);
  logEvent(state, 'info', 'bridge.connected', 'Extension bridge connected');

  ws.on('message', (data) => {
    void handleExtensionMessage(state, data.toString());
  });

  ws.on('close', (code, reasonBuffer) => {
    const reason = reasonBuffer.toString() || `close_code_${code}`;
    state.extensionSocket = undefined;
    state.lastDisconnectReason = reason;
    state.reconnectAttempts += 1;
    state.disconnectHistory.push({
      at: new Date().toISOString(),
      reason,
    });
    truncateHistory(state);
    logEvent(state, 'warn', 'bridge.disconnected', 'Extension bridge disconnected', {
      close_code: code,
      reason,
      reconnect_attempts: state.reconnectAttempts,
    });

    rejectAllPending(state, {
      code: 'DISCONNECTED',
      message: 'Bridge disconnected while command was running',
      details: {
        reason,
      },
      recovery: {
        reconnect_required: true,
        next_command: 'human-browser reconnect',
      },
    });
  });

  ws.on('error', (error) => {
    logEvent(state, 'error', 'bridge.socket_error', 'Bridge socket error', {
      error: error.message,
    });
  });
}

async function handleExtensionMessage(state: RuntimeState, raw: string): Promise<void> {
  let envelope: ExtensionToDaemonEnvelope;
  try {
    envelope = JSON.parse(raw) as ExtensionToDaemonEnvelope;
  } catch {
    logEvent(state, 'warn', 'bridge.invalid_json', 'Received invalid JSON from extension', { raw });
    return;
  }

  switch (envelope.type) {
    case 'HELLO': {
      logEvent(state, 'info', 'bridge.hello', 'Extension hello received', {
        version: envelope.version,
        retry_count: envelope.retry_count,
      });
      break;
    }
    case 'PONG': {
      state.lastPingAt = envelope.ts;
      break;
    }
    case 'EVENT': {
      logEvent(state, 'info', `extension.${envelope.name}`, `Extension event: ${envelope.name}`, envelope.payload);
      break;
    }
    case 'RESULT': {
      const pending = state.pendingCommands.get(envelope.request_id);
      if (!pending) {
        logEvent(state, 'warn', 'bridge.orphan_result', 'Result for unknown request_id', {
          request_id: envelope.request_id,
        });
        break;
      }

      clearTimeout(pending.timer);
      state.pendingCommands.delete(envelope.request_id);

      if (envelope.ok) {
        pending.resolve(envelope.result ?? {});
      } else {
        pending.reject({
          code: 'EXTENSION_ERROR',
          message: envelope.error?.message ?? 'Extension command failed',
          details: {
            extension_code: envelope.error?.code,
            ...(envelope.error?.details ?? {}),
          },
        });
      }
      break;
    }
    default: {
      logEvent(state, 'warn', 'bridge.unknown_message', 'Unknown message type from extension', {
        raw,
      });
    }
  }
}

function rejectAllPending(state: RuntimeState, error: StructuredError): void {
  for (const [, pending] of state.pendingCommands) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  state.pendingCommands.clear();
}

function resolveConnectionWaiters(state: RuntimeState): void {
  for (const waiter of state.connectionWaiters) {
    clearTimeout(waiter.timer);
    waiter.resolve();
  }
  state.connectionWaiters = [];
}

function rejectConnectionWaiters(state: RuntimeState, error: StructuredError): void {
  for (const waiter of state.connectionWaiters) {
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
  state.connectionWaiters = [];
}

async function executeCommand(
  state: RuntimeState,
  command: string,
  args: Record<string, unknown>,
  options: { timeoutMs: number; queueMode: QueueMode },
): Promise<Record<string, unknown>> {
  switch (command) {
    case 'status': {
      return {
        extension: {
          connected: Boolean(state.extensionSocket && state.extensionSocket.readyState === state.extensionSocket.OPEN),
          connected_at: state.extensionConnectedAt,
          last_ping_at: state.lastPingAt,
          last_disconnect_reason: state.lastDisconnectReason,
          reconnect_attempts: state.reconnectAttempts,
        },
        session: {
          selected_tab_id: state.selectedTabId,
          latest_snapshot_id: state.latestSnapshot?.snapshot_id,
        },
      };
    }

    case 'tabs': {
      return sendBridgeCommand(state, 'list_tabs', {}, options);
    }

    case 'use': {
      const target = args.target;
      if (target === undefined) {
        throw new HBError('BAD_REQUEST', 'use command requires args.target');
      }
      const result = await sendBridgeCommand(state, 'select_tab', { target }, options);
      const tabId = Number(result.tab_id);
      if (Number.isFinite(tabId)) {
        state.selectedTabId = tabId;
      }
      return {
        selected_tab_id: state.selectedTabId,
      };
    }

    case 'snapshot': {
      const target = args.target ?? state.selectedTabId ?? 'active';
      const result = await sendBridgeCommand(state, 'snapshot', { target }, options);
      const tabId = Number(result.tab_id);
      const nodes = result.nodes as SnapshotNode[] | undefined;

      if (!Number.isFinite(tabId) || !Array.isArray(nodes)) {
        throw new HBError('EXTENSION_ERROR', 'snapshot result is missing tab_id or nodes', {
          result,
        });
      }

      const snapshot = buildSnapshot(tabId, nodes);
      state.latestSnapshot = snapshot;
      state.selectedTabId = tabId;

      return {
        snapshot_id: snapshot.snapshot_id,
        tab_id: snapshot.tab_id,
        tree: snapshot.tree,
        refs: snapshot.refs,
        created_at: snapshot.created_at,
      };
    }

    case 'click': {
      const target = resolveActionTarget(args, 'click');

      if (target.kind === 'ref') {
        const snapshotId = getRequiredSnapshotId(args, 'click');
        const snapshot = resolveSnapshotForAction(state, {
          ...args,
          snapshot_id: snapshotId,
        });
        const refData = snapshot.refs[target.ref];
        if (!refData) {
          throw new HBError('NO_SUCH_REF', `Ref not found: ${target.ref}`, {
            ref: target.ref,
            snapshot_id: snapshot.snapshot_id,
          }, {
            next_command: 'human-browser snapshot',
          });
        }

        const result = await sendBridgeCommand(
          state,
          'click',
          {
            tab_id: snapshot.tab_id,
            selector: refData.selector,
          },
          options,
        );

        return {
          snapshot_id: snapshot.snapshot_id,
          tab_id: snapshot.tab_id,
          ref: target.ref,
          selector: refData.selector,
          result,
        };
      }

      const tabId = resolveTabForAction(state, args);
      const result = await sendBridgeCommand(
        state,
        'click',
        {
          tab_id: tabId,
          selector: target.selector,
        },
        options,
      );

      return {
        tab_id: tabId,
        selector: target.selector,
        result,
      };
    }

    case 'fill': {
      const value = getStringField(args, 'value');
      const target = resolveActionTarget(args, 'fill');

      if (target.kind === 'ref') {
        const snapshotId = getRequiredSnapshotId(args, 'fill');
        const snapshot = resolveSnapshotForAction(state, {
          ...args,
          snapshot_id: snapshotId,
        });
        const refData = snapshot.refs[target.ref];
        if (!refData) {
          throw new HBError('NO_SUCH_REF', `Ref not found: ${target.ref}`, {
            ref: target.ref,
            snapshot_id: snapshot.snapshot_id,
          }, {
            next_command: 'human-browser snapshot',
          });
        }

        const result = await sendBridgeCommand(
          state,
          'fill',
          {
            tab_id: snapshot.tab_id,
            selector: refData.selector,
            value,
          },
          options,
        );

        return {
          snapshot_id: snapshot.snapshot_id,
          tab_id: snapshot.tab_id,
          ref: target.ref,
          selector: refData.selector,
          result,
        };
      }

      const tabId = resolveTabForAction(state, args);
      const result = await sendBridgeCommand(
        state,
        'fill',
        {
          tab_id: tabId,
          selector: target.selector,
          value,
        },
        options,
      );

      return {
        tab_id: tabId,
        selector: target.selector,
        result,
      };
    }

    case 'keypress': {
      const key = getStringField(args, 'key');
      const tabId = resolveTabForAction(state, args);
      const result = await sendBridgeCommand(state, 'keypress', { tab_id: tabId, key }, options);
      return {
        tab_id: tabId,
        key,
        result,
      };
    }

    case 'scroll': {
      const x = Number(args.x ?? 0);
      const y = Number(args.y ?? 0);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new HBError('BAD_REQUEST', 'scroll requires numeric x and y');
      }
      const tabId = resolveTabForAction(state, args);
      const result = await sendBridgeCommand(state, 'scroll', { tab_id: tabId, x, y }, options);
      return {
        tab_id: tabId,
        x,
        y,
        result,
      };
    }

    case 'navigate': {
      const url = getStringField(args, 'url');
      const tabId = resolveTabForAction(state, args);
      const result = await sendBridgeCommand(state, 'navigate', { tab_id: tabId, url }, options);
      return {
        tab_id: tabId,
        url,
        result,
      };
    }

    case 'reconnect': {
      if (!state.extensionSocket || state.extensionSocket.readyState !== state.extensionSocket.OPEN) {
        throw new HBError(
          'DISCONNECTED',
          'Extension is disconnected',
          {
            reason: state.lastDisconnectReason,
          },
          {
            reconnect_required: true,
            next_command: 'Open extension popup and press Reconnect',
          },
        );
      }
      const result = await sendBridgeCommand(state, 'reconnect', {}, options);
      return {
        requested: true,
        result,
      };
    }

    case 'reset': {
      state.latestSnapshot = undefined;
      const extensionOnline = Boolean(
        state.extensionSocket && state.extensionSocket.readyState === state.extensionSocket.OPEN,
      );

      if (extensionOnline) {
        await sendBridgeCommand(state, 'reset', {}, options);
      }

      return {
        session_reset: true,
        extension_reset_requested: extensionOnline,
      };
    }

    case 'diagnose': {
      const limit = Number(args.limit ?? 50);
      if (!Number.isFinite(limit) || limit <= 0) {
        throw new HBError('BAD_REQUEST', 'diagnose requires a positive numeric limit');
      }
      return buildDiagnostics(state, limit) as unknown as Record<string, unknown>;
    }

    default:
      throw new HBError('BAD_REQUEST', `Unknown command: ${command}`);
  }
}

function resolveSnapshotForAction(state: RuntimeState, args: Record<string, unknown>): SnapshotData {
  const snapshot = state.latestSnapshot;
  if (!snapshot) {
    throw new HBError('NO_ACTIVE_SNAPSHOT', 'No active snapshot. Run snapshot first.', undefined, {
      next_command: 'human-browser snapshot',
    });
  }

  const requestedSnapshotId = typeof args.snapshot_id === 'string' ? args.snapshot_id : snapshot.snapshot_id;
  if (requestedSnapshotId !== snapshot.snapshot_id) {
    throw new HBError(
      'STALE_SNAPSHOT',
      `Snapshot mismatch. latest=${snapshot.snapshot_id}, requested=${requestedSnapshotId}`,
      {
        latest_snapshot_id: snapshot.snapshot_id,
        requested_snapshot_id: requestedSnapshotId,
      },
      {
        next_command: 'human-browser snapshot',
      },
    );
  }

  return snapshot;
}

function resolveTabForAction(state: RuntimeState, args: Record<string, unknown>): number | 'active' {
  const explicit = args.tab_id;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) {
    return explicit;
  }

  if (typeof explicit === 'string') {
    if (explicit === 'active') {
      return 'active';
    }
    const parsed = Number(explicit);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (typeof state.selectedTabId === 'number') {
    return state.selectedTabId;
  }

  if (state.latestSnapshot) {
    return state.latestSnapshot.tab_id;
  }

  return 'active';
}

function resolveActionTarget(
  args: Record<string, unknown>,
  command: 'click' | 'fill',
): { kind: 'ref'; ref: string } | { kind: 'selector'; selector: string } {
  const refRaw = typeof args.ref === 'string' ? args.ref : undefined;
  const selectorRaw = typeof args.selector === 'string' ? args.selector : undefined;

  if (refRaw && selectorRaw) {
    throw new HBError('BAD_REQUEST', `${command} supports either args.ref or args.selector, not both`);
  }

  if (refRaw) {
    const ref = parseRefArg(refRaw);
    if (!ref) {
      throw new HBError('BAD_REQUEST', `Invalid ref format for ${command}: ${refRaw}`);
    }
    return { kind: 'ref', ref };
  }

  if (selectorRaw) {
    const selectorAsRef = parseRefArg(selectorRaw);
    if (selectorAsRef) {
      return { kind: 'ref', ref: selectorAsRef };
    }
    return { kind: 'selector', selector: selectorRaw };
  }

  throw new HBError('BAD_REQUEST', `${command} requires args.ref or args.selector`);
}

function getRequiredSnapshotId(args: Record<string, unknown>, command: 'click' | 'fill'): string {
  const snapshotId = args.snapshot_id;
  if (typeof snapshotId !== 'string' || snapshotId.length === 0) {
    throw new HBError('BAD_REQUEST', `${command} with ref requires args.snapshot_id`, undefined, {
      next_command: 'human-browser snapshot',
    });
  }
  return snapshotId;
}

function parseRefArg(raw: string): string | null {
  if (/^@e\d+$/.test(raw)) {
    return raw.slice(1);
  }

  if (/^ref=e\d+$/.test(raw)) {
    return raw.slice(4);
  }

  if (/^e\d+$/.test(raw)) {
    return raw;
  }

  return null;
}

async function sendBridgeCommand(
  state: RuntimeState,
  command: string,
  payload: Record<string, unknown>,
  options: { timeoutMs: number; queueMode: QueueMode },
): Promise<Record<string, unknown>> {
  await ensureBridgeConnected(state, options.timeoutMs, options.queueMode);

  if (!state.extensionSocket || state.extensionSocket.readyState !== state.extensionSocket.OPEN) {
    throw new HBError('DISCONNECTED', 'Bridge disconnected before command dispatch', undefined, {
      reconnect_required: true,
      next_command: 'human-browser reconnect',
    });
  }

  const requestId = randomUUID();

  const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pendingCommands.delete(requestId);
      reject(
        new HBError(
          'TIMEOUT',
          `Extension timeout while executing command: ${command}`,
          {
            phase: 'extension_response',
            command,
            timeout_ms: options.timeoutMs,
          },
          {
            next_command: 'human-browser diagnose',
          },
        ).structured,
      );
    }, options.timeoutMs);

    const pending: PendingCommand = {
      requestId,
      command,
      resolve,
      reject: (structuredError) => reject(structuredError),
      timer,
    };

    state.pendingCommands.set(requestId, pending);

    state.extensionSocket?.send(
      JSON.stringify({
        type: 'COMMAND',
        request_id: requestId,
        command,
        payload,
      }),
      (error) => {
        if (error) {
          clearTimeout(timer);
          state.pendingCommands.delete(requestId);
          reject(
            new HBError('DISCONNECTED', 'Failed to send command to extension', {
              command,
              error: error.message,
            }).structured,
          );
        }
      },
    );
  });

  logEvent(state, 'info', 'bridge.command_ok', `Bridge command succeeded: ${command}`, {
    command,
    request_id: requestId,
  });

  return result;
}

async function ensureBridgeConnected(state: RuntimeState, timeoutMs: number, queueMode: QueueMode): Promise<void> {
  if (state.extensionSocket && state.extensionSocket.readyState === state.extensionSocket.OPEN) {
    return;
  }

  if (queueMode === 'fail') {
    throw new HBError('DISCONNECTED', 'Extension is disconnected', {
      reason: state.lastDisconnectReason,
    }, {
      reconnect_required: true,
      next_command: 'human-browser reconnect',
    });
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      state.connectionWaiters = state.connectionWaiters.filter((entry) => entry !== waiter);
      reject(
        new HBError(
          'TIMEOUT',
          'Timed out while waiting for extension to reconnect',
          {
            phase: 'wait_for_extension',
            timeout_ms: timeoutMs,
          },
          {
            reconnect_required: true,
            next_command: 'human-browser diagnose',
          },
        ),
      );
    }, timeoutMs);

    const waiter: ConnectionWaiter = {
      resolve,
      reject: (structuredError) => reject(structuredError),
      timer,
    };

    state.connectionWaiters.push(waiter);
  });
}

function buildDiagnostics(state: RuntimeState, limit: number): DiagnosticsReport {
  const normalized = Math.max(1, Math.floor(limit));
  return {
    now: new Date().toISOString(),
    extension: {
      connected: Boolean(state.extensionSocket && state.extensionSocket.readyState === state.extensionSocket.OPEN),
      connected_at: state.extensionConnectedAt,
      last_ping_at: state.lastPingAt,
      last_disconnect_reason: state.lastDisconnectReason,
    },
    session: {
      selected_tab_id: state.selectedTabId,
      latest_snapshot_id: state.latestSnapshot?.snapshot_id,
    },
    events: state.events.slice(-normalized),
    disconnect_history: state.disconnectHistory.slice(-normalized),
    reconnect_history: state.reconnectHistory.slice(-normalized),
  };
}

function truncateHistory(state: RuntimeState): void {
  const maxEvents = state.config.diagnostics.max_events;
  if (state.events.length > maxEvents) {
    state.events = state.events.slice(-maxEvents);
  }

  if (state.disconnectHistory.length > maxEvents) {
    state.disconnectHistory = state.disconnectHistory.slice(-maxEvents);
  }

  if (state.reconnectHistory.length > maxEvents) {
    state.reconnectHistory = state.reconnectHistory.slice(-maxEvents);
  }
}

function logEvent(
  state: RuntimeState,
  level: DaemonEvent['level'],
  kind: string,
  message: string,
  details?: Record<string, unknown>,
): void {
  state.events.push({
    id: randomUUID(),
    at: new Date().toISOString(),
    level,
    kind,
    message,
    details,
  });

  truncateHistory(state);
}

function sendJson(res: ServerResponse, status: number, payload: DaemonApiResponse | Record<string, unknown>): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const body = Buffer.concat(chunks).toString('utf8').trim();
  if (!body) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new HBError('BAD_REQUEST', 'Request body must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new HBError('BAD_REQUEST', 'Request body must be a JSON object');
  }

  return parsed as Record<string, unknown>;
}

function getStringField(
  input: Record<string, unknown>,
  field: string,
  fallback?: string,
): string {
  const value = input[field];
  if (value === undefined && fallback !== undefined) {
    return fallback;
  }

  if (typeof value !== 'string' || value.length === 0) {
    throw new HBError('BAD_REQUEST', `Field must be a non-empty string: ${field}`);
  }

  return value;
}

function getObjectField(
  input: Record<string, unknown>,
  field: string,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const value = input[field];
  if (value === undefined) {
    return fallback;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HBError('BAD_REQUEST', `Field must be an object: ${field}`);
  }

  return value as Record<string, unknown>;
}

function getNumberField(input: Record<string, unknown>, field: string, fallback: number): number {
  const value = input[field];
  if (value === undefined) {
    return fallback;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new HBError('BAD_REQUEST', `Field must be a positive number: ${field}`);
  }

  return value;
}

function getQueueMode(input: Record<string, unknown>, field: string, fallback: QueueMode): QueueMode {
  const value = input[field];
  if (value === undefined) {
    return fallback;
  }

  if (value === 'hold' || value === 'fail') {
    return value;
  }

  throw new HBError('BAD_REQUEST', `Field must be 'hold' or 'fail': ${field}`);
}
