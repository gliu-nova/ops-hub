import { Hono } from "hono";
import { cors } from "hono/cors";
import { ensureTables, getHeartbeat, listHeartbeats, upsertHeartbeat } from "./storage";
import type { Env, HeartbeatPayload, PmdHealth } from "./types";

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

async function fetchPmdHealth(url: string): Promise<PmdHealth | { status: "error"; error: string }> {
  try {
    const resp = await fetch(url, { headers: { accept: "application/json" } });
    if (!resp.ok) {
      return { status: "error", error: `HTTP ${resp.status}` };
    }
    return (await resp.json()) as PmdHealth;
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
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

app.get("/api/services/:id", async (c) => {
  const row = await getHeartbeat(c.env.DB, c.req.param("id"));
  if (!row) return c.json({ detail: "Not found" }, 404);
  return c.json(row);
});

export default app;