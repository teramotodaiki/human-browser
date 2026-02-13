#!/usr/bin/env node

import { initConfig, readConfig } from '../shared/config.ts';
import { HBError, asStructuredError } from '../shared/errors.ts';
import type { DaemonApiResponse, DaemonConfig, StructuredError } from '../shared/types.ts';
import { startDaemon } from '../daemon/app.ts';

interface GlobalOptions {
  json: boolean;
  configPath?: string;
  timeoutMs: number;
  queueMode: 'hold' | 'fail';
}

interface Parsed {
  command: string;
  args: string[];
  options: GlobalOptions;
}

function parseGlobalArgs(argv: string[]): Parsed {
  const args = [...argv];
  let json = false;
  let configPath: string | undefined;
  let timeoutMs = 10000;
  let queueMode: 'hold' | 'fail' = 'hold';

  while (args.length > 0) {
    const token = args[0];
    if (!token || !token.startsWith('--')) {
      break;
    }

    args.shift();

    if (token === '--json') {
      json = true;
      continue;
    }

    if (token === '--config') {
      const value = args.shift();
      if (!value) {
        throw new HBError('BAD_REQUEST', '--config requires a path');
      }
      configPath = value;
      continue;
    }

    if (token === '--timeout') {
      const value = args.shift();
      if (!value) {
        throw new HBError('BAD_REQUEST', '--timeout requires milliseconds');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new HBError('BAD_REQUEST', '--timeout must be a positive number');
      }
      timeoutMs = parsed;
      continue;
    }

    if (token === '--queue-mode') {
      const value = args.shift();
      if (value !== 'hold' && value !== 'fail') {
        throw new HBError('BAD_REQUEST', '--queue-mode must be hold or fail');
      }
      queueMode = value;
      continue;
    }

    throw new HBError('BAD_REQUEST', `Unknown option: ${token}`);
  }

  const command = args.shift() ?? 'help';

  return {
    command,
    args,
    options: {
      json,
      configPath,
      timeoutMs,
      queueMode,
    },
  };
}

async function main(): Promise<void> {
  const parsed = parseGlobalArgs(process.argv.slice(2));

  switch (parsed.command) {
    case 'help': {
      printHelp();
      return;
    }
    case 'init': {
      await commandInit(parsed.args, parsed.options);
      return;
    }
    case 'daemon': {
      await commandDaemon(parsed.options);
      return;
    }
    default: {
      await commandDaemonRpc(parsed.command, parsed.args, parsed.options);
    }
  }
}

async function commandInit(args: string[], options: GlobalOptions): Promise<void> {
  let host = '127.0.0.1';
  let port = 18765;
  let maxEvents = 500;
  let force = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];

    if (token === '--host') {
      const value = args[i + 1];
      if (!value) {
        throw new HBError('BAD_REQUEST', '--host requires a value');
      }
      host = value;
      i += 1;
      continue;
    }

    if (token === '--port') {
      const value = args[i + 1];
      if (!value) {
        throw new HBError('BAD_REQUEST', '--port requires a value');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new HBError('BAD_REQUEST', '--port must be a positive number');
      }
      port = parsed;
      i += 1;
      continue;
    }

    if (token === '--max-events') {
      const value = args[i + 1];
      if (!value) {
        throw new HBError('BAD_REQUEST', '--max-events requires a value');
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new HBError('BAD_REQUEST', '--max-events must be a positive number');
      }
      maxEvents = parsed;
      i += 1;
      continue;
    }

    if (token === '--force') {
      force = true;
      continue;
    }

    throw new HBError('BAD_REQUEST', `Unknown init option: ${token}`);
  }

  const { path, config, alreadyExisted } = await initConfig({
    configPath: options.configPath,
    host,
    port,
    maxEvents,
    force,
  });

  const output = {
    config_path: path,
    replaced_existing: alreadyExisted,
    daemon_http_url: `http://${config.daemon.host}:${config.daemon.port}`,
    extension_ws_url: `ws://${config.daemon.host}:${config.daemon.port}/bridge`,
    token: config.auth.token,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    return;
  }

  process.stdout.write(`config_path: ${output.config_path}\n`);
  process.stdout.write(`daemon_http_url: ${output.daemon_http_url}\n`);
  process.stdout.write(`extension_ws_url: ${output.extension_ws_url}\n`);
  process.stdout.write(`token: ${output.token}\n`);
}

async function commandDaemon(options: GlobalOptions): Promise<void> {
  const config = await readConfig(options.configPath);
  const daemon = await startDaemon(config);

  process.stdout.write(
    `[human-browser] daemon listening at http://${daemon.host}:${daemon.port} and ws://${daemon.host}:${daemon.port}/bridge\n`,
  );

  const shutdown = async (signal: string): Promise<void> => {
    process.stdout.write(`[human-browser] received ${signal}, shutting down\n`);
    await daemon.close();
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  await new Promise<void>(() => {
    // Keep process alive.
  });
}

async function commandDaemonRpc(command: string, args: string[], options: GlobalOptions): Promise<void> {
  const config = await readConfig(options.configPath);
  const request = toDaemonRequest(command, args);
  const data = await callDaemon(config, request.command, request.args, options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
    return;
  }

  renderText(command, data);
}

function toDaemonRequest(
  command: string,
  args: string[],
): {
  command: string;
  args: Record<string, unknown>;
} {
  switch (command) {
    case 'status':
    case 'tabs':
    case 'reconnect':
    case 'reset': {
      return { command, args: {} };
    }
    case 'use': {
      const target = args[0];
      if (!target) {
        throw new HBError('BAD_REQUEST', 'use requires <active|tab_id>');
      }
      return {
        command,
        args: {
          target: target === 'active' ? 'active' : Number(target),
        },
      };
    }
    case 'snapshot': {
      const parsed = parseNamedFlags(args, ['--tab']);
      const tab = parsed['--tab'];
      return {
        command,
        args: {
          target: tab === undefined ? undefined : parseTab(tab),
        },
      };
    }
    case 'click': {
      const ref = args[0];
      if (!ref) {
        throw new HBError('BAD_REQUEST', 'click requires <ref>');
      }
      const parsed = parseNamedFlags(args.slice(1), ['--snapshot']);
      return {
        command,
        args: {
          ref,
          snapshot_id: parsed['--snapshot'],
        },
      };
    }
    case 'fill': {
      const ref = args[0];
      const value = args[1];
      if (!ref || value === undefined) {
        throw new HBError('BAD_REQUEST', 'fill requires <ref> <value>');
      }
      const parsed = parseNamedFlags(args.slice(2), ['--snapshot']);
      return {
        command,
        args: {
          ref,
          value,
          snapshot_id: parsed['--snapshot'],
        },
      };
    }
    case 'keypress': {
      const key = args[0];
      if (!key) {
        throw new HBError('BAD_REQUEST', 'keypress requires <key>');
      }
      const parsed = parseNamedFlags(args.slice(1), ['--tab']);
      return {
        command,
        args: {
          key,
          tab_id: parsed['--tab'] === undefined ? undefined : parseTab(parsed['--tab']),
        },
      };
    }
    case 'scroll': {
      const xRaw = args[0];
      const yRaw = args[1];
      if (xRaw === undefined || yRaw === undefined) {
        throw new HBError('BAD_REQUEST', 'scroll requires <x> <y>');
      }
      const x = Number(xRaw);
      const y = Number(yRaw);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new HBError('BAD_REQUEST', 'scroll values must be numeric');
      }
      const parsed = parseNamedFlags(args.slice(2), ['--tab']);
      return {
        command,
        args: {
          x,
          y,
          tab_id: parsed['--tab'] === undefined ? undefined : parseTab(parsed['--tab']),
        },
      };
    }
    case 'navigate': {
      const url = args[0];
      if (!url) {
        throw new HBError('BAD_REQUEST', 'navigate requires <url>');
      }
      const parsed = parseNamedFlags(args.slice(1), ['--tab']);
      return {
        command,
        args: {
          url,
          tab_id: parsed['--tab'] === undefined ? undefined : parseTab(parsed['--tab']),
        },
      };
    }
    case 'diagnose': {
      const parsed = parseNamedFlags(args, ['--limit']);
      const limit = parsed['--limit'];
      return {
        command,
        args: {
          limit: limit === undefined ? 50 : Number(limit),
        },
      };
    }
    default:
      throw new HBError('BAD_REQUEST', `Unknown command: ${command}`);
  }
}

function parseNamedFlags(args: string[], allowedFlags: string[]): Record<string, string> {
  const allowed = new Set(allowedFlags);
  const map: Record<string, string> = {};

  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!allowed.has(token)) {
      throw new HBError('BAD_REQUEST', `Unknown flag: ${token}`);
    }

    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new HBError('BAD_REQUEST', `Flag requires a value: ${token}`);
    }

    map[token] = value;
    i += 1;
  }

  return map;
}

function parseTab(raw: string): number | 'active' {
  if (raw === 'active') {
    return 'active';
  }

  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    throw new HBError('BAD_REQUEST', `tab must be numeric or active: ${raw}`);
  }

  return numeric;
}

async function callDaemon(
  config: DaemonConfig,
  command: string,
  args: Record<string, unknown>,
  options: GlobalOptions,
): Promise<Record<string, unknown>> {
  const response = await fetch(`http://${config.daemon.host}:${config.daemon.port}/v1/command`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hb-token': config.auth.token,
    },
    body: JSON.stringify({
      command,
      args,
      queue_mode: options.queueMode,
      timeout_ms: options.timeoutMs,
    }),
  });

  let payload: DaemonApiResponse;
  try {
    payload = (await response.json()) as DaemonApiResponse;
  } catch {
    throw new HBError('INTERNAL', 'Daemon returned invalid JSON');
  }

  if (!payload.ok) {
    throw new HBError(payload.error.code, payload.error.message, payload.error.details, payload.error.recovery);
  }

  return payload.data as Record<string, unknown>;
}

function renderText(command: string, data: Record<string, unknown>): void {
  switch (command) {
    case 'snapshot': {
      process.stdout.write(`snapshot_id=${String(data.snapshot_id)} tab_id=${String(data.tab_id)}\n`);
      process.stdout.write(`${String(data.tree)}\n`);
      return;
    }
    case 'status':
    case 'diagnose': {
      process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
      return;
    }
    default: {
      process.stdout.write(`${JSON.stringify(data)}\n`);
    }
  }
}

function printHelp(): void {
  process.stdout.write(
    [
      'human-browser CLI',
      '',
      'Usage:',
      '  hb [--json] [--config <path>] [--timeout <ms>] [--queue-mode hold|fail] <command> [args]',
      '',
      'Commands:',
      '  init [--host 127.0.0.1] [--port 18765] [--max-events 500] [--force]',
      '  daemon',
      '  status',
      '  tabs',
      '  use <active|tab_id>',
      '  snapshot [--tab <active|tab_id>]',
      '  click <ref> [--snapshot <snapshot_id>]',
      '  fill <ref> <value> [--snapshot <snapshot_id>]',
      '  keypress <key> [--tab <active|tab_id>]',
      '  scroll <x> <y> [--tab <active|tab_id>]',
      '  navigate <url> [--tab <active|tab_id>]',
      '  reconnect',
      '  reset',
      '  diagnose [--limit <N>]',
      '',
    ].join('\n'),
  );
}

try {
  await main();
} catch (error) {
  const structured = asStructuredError(error) as StructuredError;
  process.stderr.write(`${JSON.stringify({ ok: false, error: structured }, null, 2)}\n`);
  process.exit(1);
}
