/**
 * Dev/QA diagnostics — off in production unless SWING_DEBUG_ERRORS=true at build time.
 */
import { DEBUG_ERRORS_ENABLED } from '@/lib/env';
import { ApiError } from '@/lib/api/client';

export type FailureKind = 'api' | 'ws' | 'auth' | 'unknown';

export type FailureRecord = {
  at: string;
  kind: FailureKind;
  message: string;
  code?: string;
  requestId?: string;
  path?: string;
  status?: number;
};

const ring: FailureRecord[] = [];
const RING_MAX = 20;

function push(record: FailureRecord) {
  ring.unshift(record);
  if (ring.length > RING_MAX) ring.pop();
}

export function logFailure(record: Omit<FailureRecord, 'at'>) {
  const full: FailureRecord = { ...record, at: new Date().toISOString() };
  push(full);
  if (!DEBUG_ERRORS_ENABLED) return;
  const parts = [
    `[Swing ${full.kind}]`,
    full.code,
    full.path,
    full.status != null ? `status=${full.status}` : null,
    full.requestId ? `request_id=${full.requestId}` : null,
    full.message,
  ].filter(Boolean);
  console.warn(parts.join(' '));
}

export function recentFailures(): FailureRecord[] {
  return [...ring];
}

export function errorDebugDetails(err: unknown): string | null {
  if (!DEBUG_ERRORS_ENABLED) return null;
  if (err instanceof ApiError) {
    const lines = [`Code: ${err.code}`];
    if (err.requestId) lines.push(`Request ID: ${err.requestId}`);
    if (err.httpStatus) lines.push(`HTTP: ${err.httpStatus}`);
    if (err.path) lines.push(`Path: ${err.path}`);
    lines.push('Search server logs with request_id.');
    return lines.join('\n');
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return null;
}
