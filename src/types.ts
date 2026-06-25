export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  HEARTBEAT_SECRET?: string;
  PMD_HEALTH_URL?: string;
  ENVIRONMENT?: string;
}

export interface HeartbeatPayload {
  service_id: string;
  status: "ok" | "degraded" | "error";
  reported_at?: string;
  summary?: string;
  details?: Record<string, unknown>;
  links?: Record<string, string>;
}

export interface StoredHeartbeat {
  service_id: string;
  status: string;
  reported_at: string;
  summary: string | null;
  details: Record<string, unknown>;
  links: Record<string, string>;
}

export interface PmdHealth {
  status: string;
  last_poll_at: string | null;
  markets_tracked: number;
  active_opportunities: number;
  signals_total: number;
  sources?: Record<string, string>;
}