import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  authorizeHeartbeat,
  fetchPmdHealthCached,
  fetchPmdJson,
  pmdBaseUrl,
  selectMarketMemory,
  selectPrimaryHeartbeat,
  validateHeartbeatBody,
} from "./helpers";
import { getHeartbeat, listHeartbeats, upsertHeartbeat } from "./storage";
import type { Env, PmdDetailResponse, PmdHealth, PmdSignal } from "./types";

const app = new Hono<{ Bindings: Env }>();

const DEFAULT_PMD_HEALTH_URL = "https://prediction-market-divergence.pages.dev/health";

/** Same-origin dashboard does not need open CORS; allow only configured origin if set. */
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.CORS_ORIGIN;
      if (!allowed) return null;
      if (allowed === "*") return "*";
      return origin === allowed ? origin : null;
    },
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

function pmdHealthUrl(env: Env): string {
  return env.PMD_HEALTH_URL ?? DEFAULT_PMD_HEALTH_URL;
}

async function fetchPmdDetail(healthUrl: string): Promise<PmdDetailResponse> {
  const base = pmdBaseUrl(healthUrl);
  const [health, opportunities, signals] = await Promise.all([
    fetchPmdJson<PmdHealth>(healthUrl),
    fetchPmdJson<{ opportunities: PmdSignal[]; count: number }>(`${base}/opportunities?limit=50`),
    fetchPmdJson<{ signals: PmdSignal[]; count: number }>(`${base}/signals?limit=50`),
  ]);
  return {
    updated_at: new Date().toISOString(),
    health,
    opportunities,
    signals,
  };
}

app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "ops-hub",
    environment: c.env.ENVIRONMENT ?? "production",
  }),
);

app.post("/heartbeat", async (c) => {
  const auth = authorizeHeartbeat(c.env.HEARTBEAT_SECRET, c.req.header("Authorization"));
  if (auth === "misconfigured") {
    return c.json({ detail: "HEARTBEAT_SECRET is not configured" }, 503);
  }
  if (auth === "unauthorized") {
    return c.json({ detail: "Unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ detail: "Invalid JSON body" }, 400);
  }

  const validated = validateHeartbeatBody(body);
  if (!validated.ok) {
    return c.json({ detail: validated.detail }, 400);
  }

  await upsertHeartbeat(c.env.DB, validated.payload);
  return c.json({ status: "ok", service_id: validated.payload.service_id });
});

app.get("/api/services", async (c) => {
  const heartbeats = await listHeartbeats(c.env.DB);
  const primary = selectPrimaryHeartbeat(heartbeats);
  const marketMemory = selectMarketMemory(heartbeats, primary);
  const pmdUrl = pmdHealthUrl(c.env);
  const pmd = await fetchPmdHealthCached<PmdHealth>(pmdUrl);
  return c.json({
    updated_at: new Date().toISOString(),
    // twitter_bot is a compatibility key (gliu.dev). Value is the newest bot-shaped heartbeat, not a name lookup.
    twitter_bot: primary,
    market_memory: marketMemory,
    prediction_market_divergence: pmd,
    links: {
      ...(primary?.links ?? {}),
      github_twitter_bot: primary?.links.actions,
      github_pmd: "https://github.com/gliu-nova/prediction-market-divergence",
      pmd_dashboard: `${pmdBaseUrl(pmdUrl)}/`,
    },
  });
});

app.get("/api/pmd", async (c) => {
  return c.json(await fetchPmdDetail(pmdHealthUrl(c.env)));
});

app.get("/api/pmd/markets", async (c) => {
  const base = pmdBaseUrl(pmdHealthUrl(c.env));
  const params = new URLSearchParams();
  for (const key of ["offset", "limit", "venue", "q"] as const) {
    const value = c.req.query(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  const url = `${base}/ingestion/markets${query ? `?${query}` : ""}`;
  return c.json(await fetchPmdJson(url));
});

app.get("/api/pmd/pairs", async (c) => {
  const base = pmdBaseUrl(pmdHealthUrl(c.env));
  const params = new URLSearchParams();
  for (const key of ["offset", "limit", "q"] as const) {
    const value = c.req.query(key);
    if (value) params.set(key, value);
  }
  const query = params.toString();
  const url = `${base}/ingestion/pairs${query ? `?${query}` : ""}`;
  return c.json(await fetchPmdJson(url));
});

app.get("/api/services/:id", async (c) => {
  const row = await getHeartbeat(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ detail: "Not found" }, 404);
  return c.json(row);
});

export default app;
