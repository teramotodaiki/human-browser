import type { ErrorCode, RecoveryHints, StructuredError } from './types.ts';

export class HBError extends Error {
  public readonly structured: StructuredError;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>, recovery?: RecoveryHints) {
    super(message);
    this.name = 'HBError';
    this.structured = { code, message, details, recovery };
  }
}

export function asStructuredError(err: unknown): StructuredError {
  if (err instanceof HBError) {
    return err.structured;
  }

  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const record = err as Record<string, unknown>;
    return {
      code: String(record.code) as StructuredError['code'],
      message: String(record.message),
      details:
        record.details && typeof record.details === 'object'
          ? (record.details as Record<string, unknown>)
          : undefined,
      recovery:
        record.recovery && typeof record.recovery === 'object'
          ? (record.recovery as StructuredError['recovery'])
          : undefined,
    };
  }

  if (err instanceof Error) {
    return {
      code: 'INTERNAL',
      message: err.message,
    };
  }

  return {
    code: 'INTERNAL',
    message: 'Unknown error',
  };
}
