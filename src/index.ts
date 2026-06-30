import { Hono } from "hono";
import { cors } from "hono/cors";
import { ensureTables, getHeartbeat, listHeartbeats, upsertHeartbeat } from "./storage";
import type { Env, HeartbeatPayload, PmdDetailResponse, PmdHealth, PmdSignal } from "./types";

const app = new Hono<{ Bindings: Env }>();

app.use("*", cors({ origin: "*" }));
app.use("*", async (c, next) => {
  await ensureTables(c.env.DB);
  await next();
});

function authHeartbeat(c: { env: Env; req: { header: (name: string) => string | undefined } }): boolean {
  const secret = c.env.HEARTBEAT_SECRET;
  if (!secret) return true;
  const auth = c.req.header("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function pmdBaseUrl(healthUrl: string): string {
  return healthUrl.replace(/\/health\/?$/, "");
}

async function fetchPmdJson<T>(url: string): Promise<T | { status: "error"; error: string }> {
  try {
    const resp = await fetch(url, { headers: { accept: "application/json" } });
    if (!resp.ok) {
      return { status: "error", error: `HTTP ${resp.status}` };
    }
    return (await resp.json()) as T;
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

async function fetchPmdHealth(url: string): Promise<PmdHealth | { status: "error"; error: string }> {
  return fetchPmdJson<PmdHealth>(url);
}

async function fetchPmdDetail(healthUrl: string): Promise<PmdDetailResponse> {
  const base = pmdBaseUrl(healthUrl);
  const [health, opportunities, signals] = await Promise.all([
    fetchPmdHealth(healthUrl),
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
  if (!authHeartbeat(c)) {
    return c.json({ detail: "Unauthorized" }, 401);
  }
  const body = (await c.req.json()) as HeartbeatPayload;
  if (!body.service_id || !body.status) {
    return c.json({ detail: "service_id and status required" }, 400);
  }
  await upsertHeartbeat(c.env.DB, body);
  return c.json({ status: "ok", service_id: body.service_id });
});

app.get("/api/services", async (c) => {
  const heartbeats = await listHeartbeats(c.env.DB);
  const twitterBot = heartbeats.find((h) => h.service_id === "twitter-bot") ?? null;
  const marketMemory = heartbeats.find((h) => h.service_id === "market-memory") ?? null;
  const pmdUrl = c.env.PMD_HEALTH_URL ?? "https://prediction-market-divergence.pages.dev/health";
  const pmd = await fetchPmdHealth(pmdUrl);
  return c.json({
    updated_at: new Date().toISOString(),
    twitter_bot: twitterBot,
    market_memory: marketMemory ?? (twitterBot?.details?.market_memory ? {
      service_id: "market-memory",
      status: twitterBot.status,
      reported_at: twitterBot.reported_at,
      summary: "Embedded in twitter-bot sync",
      details: twitterBot.details.market_memory,
      links: twitterBot.links,
    } : null),
    prediction_market_divergence: pmd,
    links: {
      github_twitter_bot: "https://github.com/gliu-nova/twitter-bot/actions",
      github_market_memory: "https://github.com/gliu-nova/market-memory",
      github_pmd: "https://github.com/gliu-nova/prediction-market-divergence",
      pmd_dashboard: "https://prediction-market-divergence.pages.dev/",
    },
  });
});

app.get("/api/pmd", async (c) => {
  const pmdUrl = c.env.PMD_HEALTH_URL ?? "https://prediction-market-divergence.pages.dev/health";
  return c.json(await fetchPmdDetail(pmdUrl));
});

app.get("/api/pmd/markets", async (c) => {
  const pmdUrl = c.env.PMD_HEALTH_URL ?? "https://prediction-market-divergence.pages.dev/health";
  const base = pmdBaseUrl(pmdUrl);
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
  const pmdUrl = c.env.PMD_HEALTH_URL ?? "https://prediction-market-divergence.pages.dev/health";
  const base = pmdBaseUrl(pmdUrl);
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