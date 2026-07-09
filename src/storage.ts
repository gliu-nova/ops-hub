import { parseHeartbeatRow, resolveReportedAt } from "./helpers";
import type { HeartbeatPayload, StoredHeartbeat } from "./types";

/**
 * Kept for local/dev convenience. Prefer `npm run db:local` / migrations in deploy.
 * Not invoked on the request hot path.
 */
export async function ensureTables(db: D1Database): Promise<void> {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS service_heartbeats (
      service_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      reported_at TEXT NOT NULL,
      summary TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      links TEXT NOT NULL DEFAULT '{}'
    )`,
  ).run();
}

export async function upsertHeartbeat(db: D1Database, payload: HeartbeatPayload): Promise<void> {
  const reportedAt = resolveReportedAt(payload.reported_at);
  await db
    .prepare(
      `INSERT INTO service_heartbeats (service_id, status, reported_at, summary, details, links)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(service_id) DO UPDATE SET
         status = excluded.status,
         reported_at = excluded.reported_at,
         summary = excluded.summary,
         details = excluded.details,
         links = excluded.links`,
    )
    .bind(
      payload.service_id,
      payload.status,
      reportedAt,
      payload.summary ?? null,
      JSON.stringify(payload.details ?? {}),
      JSON.stringify(payload.links ?? {}),
    )
    .run();
}

export async function getHeartbeat(db: D1Database, serviceId: string): Promise<StoredHeartbeat | null> {
  const row = await db
    .prepare("SELECT service_id, status, reported_at, summary, details, links FROM service_heartbeats WHERE service_id = ?")
    .bind(serviceId)
    .first<Record<string, unknown>>();
  return row ? parseHeartbeatRow(row) : null;
}

export async function listHeartbeats(db: D1Database): Promise<StoredHeartbeat[]> {
  const rows = await db
    .prepare("SELECT service_id, status, reported_at, summary, details, links FROM service_heartbeats ORDER BY reported_at DESC")
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map(parseHeartbeatRow);
}
