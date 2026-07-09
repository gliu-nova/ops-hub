import type { HeartbeatPayload, StoredHeartbeat } from "./types";

export const HEARTBEAT_STATUSES = ["ok", "degraded", "error"] as const;
export type HeartbeatStatus = (typeof HEARTBEAT_STATUSES)[number];

const PMD_FETCH_TIMEOUT_MS = 5_000;
const PMD_RETRY_STATUSES = new Set([429, 502, 503]);
const PMD_HEALTH_CACHE_TTL_MS = 20_000;

export type AuthResult = "ok" | "unauthorized" | "misconfigured";

/** Constant-time string compare for bearer secrets. */
export function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.byteLength, bBytes.byteLength);
  let diff = aBytes.byteLength ^ bBytes.byteLength;
  for (let i = 0; i < len; i++) {
    const x = i < aBytes.byteLength ? aBytes[i] : 0;
    const y = i < bBytes.byteLength ? bBytes[i] : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

export function authorizeHeartbeat(secret: string | undefined, authorizationHeader: string | undefined): AuthResult {
  if (!secret) return "misconfigured";
  const expected = `Bearer ${secret}`;
  const actual = authorizationHeader ?? "";
  return timingSafeEqualString(actual, expected) ? "ok" : "unauthorized";
}

/**
 * Normalize a PMD health URL to the service origin (no trailing slash).
 * Accepts `…/health` or a bare origin/base URL.
 */
export function pmdBaseUrl(healthUrl: string): string {
  const trimmed = healthUrl.trim().replace(/\/+$/, "");
  if (/\/health$/i.test(trimmed)) {
    return trimmed.replace(/\/health$/i, "");
  }
  return trimmed;
}

export function resolveReportedAt(raw: unknown, now = new Date()): string {
  if (typeof raw !== "string" || !raw.trim()) {
    return now.toISOString();
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    return now.toISOString();
  }
  // Reject / clamp future timestamps more than 2 minutes ahead (clock skew).
  if (ms > now.getTime() + 2 * 60_000) {
    return now.toISOString();
  }
  return new Date(ms).toISOString();
}

export type HeartbeatValidation =
  | { ok: true; payload: HeartbeatPayload }
  | { ok: false; detail: string };

export function validateHeartbeatBody(body: unknown): HeartbeatValidation {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, detail: "JSON object required" };
  }
  const record = body as Record<string, unknown>;
  const serviceId = record.service_id;
  const status = record.status;
  if (typeof serviceId !== "string" || !serviceId.trim()) {
    return { ok: false, detail: "service_id and status required" };
  }
  if (typeof status !== "string" || !HEARTBEAT_STATUSES.includes(status as HeartbeatStatus)) {
    return { ok: false, detail: "status must be ok, degraded, or error" };
  }
  const payload: HeartbeatPayload = {
    service_id: serviceId.trim(),
    status: status as HeartbeatStatus,
  };
  if (record.reported_at !== undefined) {
    if (typeof record.reported_at !== "string") {
      return { ok: false, detail: "reported_at must be an ISO timestamp string" };
    }
    payload.reported_at = resolveReportedAt(record.reported_at);
  }
  if (record.summary !== undefined) {
    if (record.summary !== null && typeof record.summary !== "string") {
      return { ok: false, detail: "summary must be a string" };
    }
    payload.summary = record.summary as string | undefined;
  }
  if (record.details !== undefined) {
    if (record.details === null || typeof record.details !== "object" || Array.isArray(record.details)) {
      return { ok: false, detail: "details must be an object" };
    }
    payload.details = record.details as Record<string, unknown>;
  }
  if (record.links !== undefined) {
    if (record.links === null || typeof record.links !== "object" || Array.isArray(record.links)) {
      return { ok: false, detail: "links must be an object" };
    }
    const links: Record<string, string> = {};
    for (const [k, v] of Object.entries(record.links as Record<string, unknown>)) {
      if (typeof v !== "string") {
        return { ok: false, detail: "links values must be strings" };
      }
      links[k] = v;
    }
    payload.links = links;
  }
  return { ok: true, payload };
}

export function safeParseJsonObject(raw: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(String(raw || "{}")) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

export function safeParseJsonStringRecord(raw: unknown): Record<string, string> {
  const obj = safeParseJsonObject(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function parseHeartbeatRow(row: Record<string, unknown>): StoredHeartbeat {
  return {
    service_id: String(row.service_id),
    status: String(row.status),
    reported_at: String(row.reported_at),
    summary: row.summary == null ? null : String(row.summary),
    details: safeParseJsonObject(row.details),
    links: safeParseJsonStringRecord(row.links),
  };
}

/** Derive market-memory status from embedded details; do not inherit twitter-bot status. */
export function deriveEmbeddedMarketMemoryStatus(details: Record<string, unknown>): HeartbeatStatus {
  const nestedStatus = details.status;
  if (typeof nestedStatus === "string" && HEARTBEAT_STATUSES.includes(nestedStatus as HeartbeatStatus)) {
    return nestedStatus as HeartbeatStatus;
  }
  if (details.error != null && details.error !== "" && details.error !== false) {
    return "error";
  }
  if (details.skipped === true && (details.reason || details.warning)) {
    return "degraded";
  }
  return "ok";
}

export type PmdFetchError = { status: "error"; error: string };

let pmdHealthCache: { url: string; expiresAt: number; value: unknown } | null = null;

export function clearPmdHealthCache(): void {
  pmdHealthCache = null;
}

async function fetchOnce(url: string, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function fetchPmdJson<T>(
  url: string,
  options?: { timeoutMs?: number; retry?: boolean },
): Promise<T | PmdFetchError> {
  const timeoutMs = options?.timeoutMs ?? PMD_FETCH_TIMEOUT_MS;
  const retry = options?.retry ?? true;
  try {
    let resp = await fetchOnce(url, timeoutMs);
    if (retry && PMD_RETRY_STATUSES.has(resp.status)) {
      resp = await fetchOnce(url, timeoutMs);
    }
    if (!resp.ok) {
      return { status: "error", error: `HTTP ${resp.status}` };
    }
    return (await resp.json()) as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/abort|timeout/i.test(message)) {
      return { status: "error", error: `timeout after ${timeoutMs}ms` };
    }
    return { status: "error", error: message };
  }
}

export async function fetchPmdHealthCached<T>(
  url: string,
  now = Date.now(),
): Promise<T | PmdFetchError> {
  if (pmdHealthCache && pmdHealthCache.url === url && pmdHealthCache.expiresAt > now) {
    return pmdHealthCache.value as T | PmdFetchError;
  }
  const value = await fetchPmdJson<T>(url);
  pmdHealthCache = {
    url,
    expiresAt: now + PMD_HEALTH_CACHE_TTL_MS,
    value,
  };
  return value;
}
