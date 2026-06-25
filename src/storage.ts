import type { HeartbeatPayload, StoredHeartbeat } from "./types";

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
  const reportedAt = payload.reported_at ?? new Date().toISOString();
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

function parseRow(row: Record<string, unknown>): StoredHeartbeat {
  return {
    service_id: String(row.service_id),
    status: String(row.status),
    reported_at: String(row.reported_at),
    summary: row.summary == null ? null : String(row.summary),
    details: JSON.parse(String(row.details || "{}")) as Record<string, unknown>,
    links: JSON.parse(String(row.links || "{}")) as Record<string, string>,
  };
}

export async function getHeartbeat(db: D1Database, serviceId: string): Promise<StoredHeartbeat | null> {
  const row = await db
    .prepare("SELECT service_id, status, reported_at, summary, details, links FROM service_heartbeats WHERE service_id = ?")
    .bind(serviceId)
    .first<Record<string, unknown>>();
  return row ? parseRow(row) : null;
}

export async function listHeartbeats(db: D1Database): Promise<StoredHeartbeat[]> {
  const rows = await db
    .prepare("SELECT service_id, status, reported_at, summary, details, links FROM service_heartbeats ORDER BY reported_at DESC")
    .all<Record<string, unknown>>();
  return (rows.results ?? []).map(parseRow);
}