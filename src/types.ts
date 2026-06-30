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

export interface PmdIngestionSummary {
  total_markets: number;
  kalshi_markets: number;
  polymarket_markets: number;
  matched_pairs: number;
}

export interface PmdOutputSummary {
  active_opportunities: number;
  signals_total: number;
  last_opportunities_found: number;
}

export interface PmdHealth {
  status: string;
  last_poll_at: string | null;
  last_error?: string | null;
  markets_tracked: number;
  active_opportunities: number;
  signals_total: number;
  sources?: Record<string, string>;
  ingestion?: PmdIngestionSummary;
  output?: PmdOutputSummary;
}

export interface PmdSignal {
  id: string;
  title: string;
  score: number;
  difference_pct_points: number;
  is_active: boolean;
  created_at: string;
  market_a: { venue: string; probability: number; market_id: string };
  market_b?: { venue: string; probability: number; market_id: string } | null;
  tweet_hint?: string;
}

export interface PmdDetailResponse {
  updated_at: string;
  health: PmdHealth | { status: "error"; error: string };
  opportunities: { opportunities: PmdSignal[]; count: number } | { status: "error"; error: string };
  signals: { signals: PmdSignal[]; count: number } | { status: "error"; error: string };
}