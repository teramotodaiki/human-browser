import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { HBError } from './errors.ts';
import type { DaemonConfig } from './types.ts';

export const DEFAULT_CONFIG_PATH = join(homedir(), '.human-browser', 'config.json');
const LOOPBACK_HOST = '127.0.0.1';

export function resolveConfigPath(configPath?: string): string {
  return configPath ?? DEFAULT_CONFIG_PATH;
}

export async function readConfig(configPath?: string): Promise<DaemonConfig> {
  const resolved = resolveConfigPath(configPath);
  let raw: string;

  try {
    raw = await readFile(resolved, 'utf8');
  } catch {
    throw new HBError(
      'BAD_REQUEST',
      `Config not found: ${resolved}`,
      { config_path: resolved },
      { next_command: 'human-browser init' },
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HBError('BAD_REQUEST', `Invalid JSON config: ${resolved}`, { config_path: resolved });
  }

  validateConfig(parsed, resolved);
  return parsed;
}

function assertLoopbackHost(host: string, path: string): void {
  // The daemon is intentionally local-only. Enforcing loopback here prevents
  // accidental exposure to LAN/WAN when users edit config by hand.
  if (host !== LOOPBACK_HOST) {
    throw new HBError('BAD_REQUEST', `Config.daemon.host must be ${LOOPBACK_HOST}`, {
      config_path: path,
      host,
    });
  }
}

function validateConfig(input: unknown, path: string): asserts input is DaemonConfig {
  if (!input || typeof input !== 'object') {
    throw new HBError('BAD_REQUEST', 'Config must be an object', { config_path: path });
  }

  const cfg = input as Record<string, unknown>;
  const daemon = cfg.daemon as Record<string, unknown> | undefined;
  const auth = cfg.auth as Record<string, unknown> | undefined;
  const diagnostics = cfg.diagnostics as Record<string, unknown> | undefined;

  if (!daemon || typeof daemon.host !== 'string' || typeof daemon.port !== 'number') {
    throw new HBError('BAD_REQUEST', 'Config.daemon.host and config.daemon.port are required', {
      config_path: path,
    });
  }
  assertLoopbackHost(daemon.host, path);

  if (!auth || typeof auth.token !== 'string' || auth.token.length < 24) {
    throw new HBError('BAD_REQUEST', 'Config.auth.token is required and must be at least 24 characters', {
      config_path: path,
    });
  }

  if (!diagnostics || typeof diagnostics.max_events !== 'number') {
    throw new HBError('BAD_REQUEST', 'Config.diagnostics.max_events is required', {
      config_path: path,
    });
  }
}

export async function initConfig(options: {
  configPath?: string;
  host: string;
  port: number;
  maxEvents: number;
  force: boolean;
}): Promise<{ path: string; config: DaemonConfig; alreadyExisted: boolean }> {
  const resolved = resolveConfigPath(options.configPath);
  if (options.host !== LOOPBACK_HOST) {
    throw new HBError('BAD_REQUEST', `--host must be ${LOOPBACK_HOST}`, {
      host: options.host,
    });
  }

  let exists = false;
  let reusedToken: string | null = null;
  try {
    const existingRaw = await readFile(resolved, 'utf8');
    exists = true;
    if (options.force) {
      reusedToken = extractReusableToken(existingRaw);
    }
  } catch {
    exists = false;
  }

  if (exists && !options.force) {
    throw new HBError('BAD_REQUEST', `Config already exists: ${resolved}`, { config_path: resolved }, {
      next_command: 'human-browser init --force',
    });
  }

  const config: DaemonConfig = {
    daemon: {
      host: options.host,
      port: options.port,
    },
    auth: {
      token: reusedToken ?? randomUUID().replaceAll('-', ''),
    },
    diagnostics: {
      max_events: options.maxEvents,
    },
  };

  await mkdir(dirname(resolved), { recursive: true });
  // The token inside config is a secret shared with the extension.
  // Keep file permissions strict even if the file already existed.
  await writeFile(resolved, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(resolved, 0o600);

  return {
    path: resolved,
    config,
    alreadyExisted: exists,
  };
}

function extractReusableToken(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const token = (parsed as Record<string, unknown>).auth;
  if (!token || typeof token !== 'object') {
    return null;
  }

  const value = (token as Record<string, unknown>).token;
  if (typeof value !== 'string' || value.length < 24) {
    return null;
  }

  return value;
}
