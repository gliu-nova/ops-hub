import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeHeartbeat,
  clearPmdHealthCache,
  deriveEmbeddedMarketMemoryStatus,
  embeddedMarketMemory,
  fetchPmdHealthCached,
  fetchPmdJson,
  parseHeartbeatRow,
  pmdBaseUrl,
  resolveReportedAt,
  selectMarketMemory,
  selectPrimaryHeartbeat,
  timingSafeEqualString,
  validateHeartbeatBody,
} from "./helpers";
import type { StoredHeartbeat } from "./types";

function heartbeat(overrides: Partial<StoredHeartbeat> & Pick<StoredHeartbeat, "service_id" | "reported_at">): StoredHeartbeat {
  return {
    status: "ok",
    summary: null,
    details: {},
    links: {},
    ...overrides,
  };
}

describe("authorizeHeartbeat", () => {
  it("fails closed when secret is unset", () => {
    expect(authorizeHeartbeat(undefined, "Bearer x")).toBe("misconfigured");
    expect(authorizeHeartbeat("", "Bearer x")).toBe("misconfigured");
  });

  it("rejects missing or wrong bearer", () => {
    expect(authorizeHeartbeat("s3cret", undefined)).toBe("unauthorized");
    expect(authorizeHeartbeat("s3cret", "Bearer wrong")).toBe("unauthorized");
    expect(authorizeHeartbeat("s3cret", "s3cret")).toBe("unauthorized");
  });

  it("accepts correct bearer", () => {
    expect(authorizeHeartbeat("s3cret", "Bearer s3cret")).toBe("ok");
  });
});

describe("timingSafeEqualString", () => {
  it("matches equal strings and rejects unequal", () => {
    expect(timingSafeEqualString("abc", "abc")).toBe(true);
    expect(timingSafeEqualString("abc", "abd")).toBe(false);
    expect(timingSafeEqualString("abc", "ab")).toBe(false);
  });
});

describe("pmdBaseUrl", () => {
  it("strips /health suffix", () => {
    expect(pmdBaseUrl("https://example.com/health")).toBe("https://example.com");
    expect(pmdBaseUrl("https://example.com/health/")).toBe("https://example.com");
  });

  it("accepts bare origin without /health", () => {
    expect(pmdBaseUrl("https://example.com")).toBe("https://example.com");
    expect(pmdBaseUrl("https://example.com/")).toBe("https://example.com");
  });
});

describe("validateHeartbeatBody", () => {
  it("requires object with service_id and valid status", () => {
    expect(validateHeartbeatBody(null).ok).toBe(false);
    expect(validateHeartbeatBody([]).ok).toBe(false);
    expect(validateHeartbeatBody({}).ok).toBe(false);
    expect(validateHeartbeatBody({ service_id: "x", status: "healthy" }).ok).toBe(false);
  });

  it("accepts valid payload", () => {
    const result = validateHeartbeatBody({
      service_id: "twitter-bot",
      status: "ok",
      summary: "fine",
      details: { posts_today: 1 },
      links: { run: "https://example.com" },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.service_id).toBe("twitter-bot");
      expect(result.payload.status).toBe("ok");
    }
  });

  it("rejects non-string link values", () => {
    const result = validateHeartbeatBody({
      service_id: "x",
      status: "ok",
      links: { a: 1 },
    });
    expect(result.ok).toBe(false);
  });
});

describe("resolveReportedAt", () => {
  const now = new Date("2026-07-09T12:00:00.000Z");

  it("defaults and rejects invalid / far-future timestamps", () => {
    expect(resolveReportedAt(undefined, now)).toBe(now.toISOString());
    expect(resolveReportedAt("not-a-date", now)).toBe(now.toISOString());
    expect(resolveReportedAt("2026-07-09T18:00:00.000Z", now)).toBe(now.toISOString());
  });

  it("keeps valid past timestamps", () => {
    expect(resolveReportedAt("2026-07-09T11:00:00.000Z", now)).toBe("2026-07-09T11:00:00.000Z");
  });
});

describe("parseHeartbeatRow", () => {
  it("tolerates corrupt JSON details/links", () => {
    const row = parseHeartbeatRow({
      service_id: "twitter-bot",
      status: "ok",
      reported_at: "2026-07-09T11:00:00.000Z",
      summary: null,
      details: "{not-json",
      links: "[]",
    });
    expect(row.details).toEqual({});
    expect(row.links).toEqual({});
  });
});

describe("deriveEmbeddedMarketMemoryStatus", () => {
  it("does not inherit parent heartbeat status; uses nested fields", () => {
    expect(deriveEmbeddedMarketMemoryStatus({ ingested: 3 })).toBe("ok");
    expect(deriveEmbeddedMarketMemoryStatus({ status: "degraded" })).toBe("degraded");
    expect(deriveEmbeddedMarketMemoryStatus({ error: "sync failed" })).toBe("error");
    expect(deriveEmbeddedMarketMemoryStatus({ skipped: true, reason: "rate limit" })).toBe("degraded");
  });
});

describe("selectPrimaryHeartbeat", () => {
  const staleBot: StoredHeartbeat = heartbeat({
    service_id: "twitter-bot",
    reported_at: "2026-09-08T00:32:18.000Z",
    details: { api_health: { fred: "ok" }, market_memory: { ingested: 1 } },
    links: { actions: "https://github.com/gliu-nova/twitter-bot/actions" },
  });
  const liveBot: StoredHeartbeat = heartbeat({
    service_id: "cross-asset-signal-engine",
    reported_at: "2026-09-15T11:32:21.000Z",
    details: {
      api_health: { fred: "ok" },
      posts_today: 0,
      market_memory: { ingested: 63, liquidations_mode: "coinalyze+okx", total_events: 11698 },
    },
    links: { actions: "https://github.com/gliu-nova/Cross-Asset-Signal-Engine/actions" },
  });
  const standaloneMm: StoredHeartbeat = heartbeat({
    service_id: "market-memory",
    reported_at: "2026-09-10T00:00:00.000Z",
    details: { ingested: 9, liquidations_mode: "okx", total_events: 100 },
  });

  it("selects the newest bot-shaped heartbeat regardless of service_id", () => {
    expect(selectPrimaryHeartbeat([staleBot, liveBot, standaloneMm])?.service_id).toBe(
      "cross-asset-signal-engine",
    );
  });

  it("falls back to the newest non-market-memory row when none are bot-shaped", () => {
    const other = heartbeat({
      service_id: "some-new-job",
      reported_at: "2026-09-15T12:00:00.000Z",
      details: { note: "plain heartbeat" },
    });
    expect(selectPrimaryHeartbeat([standaloneMm, other])?.service_id).toBe("some-new-job");
  });

  it("returns null for an empty list", () => {
    expect(selectPrimaryHeartbeat([])).toBeNull();
  });
});

describe("selectMarketMemory", () => {
  it("embeds nested sync details from the selected primary, not a stale sibling", () => {
    const stale = heartbeat({
      service_id: "twitter-bot",
      reported_at: "2026-09-08T00:32:18.000Z",
      details: { api_health: {}, market_memory: { ingested: 70, total_events: 11305 } },
    });
    const live = heartbeat({
      service_id: "renamed-bot",
      reported_at: "2026-09-15T11:32:21.000Z",
      details: { api_health: {}, market_memory: { ingested: 63, total_events: 11698 } },
    });
    const primary = selectPrimaryHeartbeat([stale, live]);
    const mm = selectMarketMemory([stale, live], primary);
    expect(mm?.details.ingested).toBe(63);
    expect(mm?.details.total_events).toBe(11698);
    expect(mm?.summary).toBe("Embedded in renamed-bot sync");
  });

  it("prefers a newer standalone market-memory heartbeat over embedded details", () => {
    const primary = heartbeat({
      service_id: "bot",
      reported_at: "2026-09-15T10:00:00.000Z",
      details: { api_health: {}, market_memory: { ingested: 1 } },
    });
    const standalone = heartbeat({
      service_id: "mm-worker",
      reported_at: "2026-09-15T11:00:00.000Z",
      details: { ingested: 4, liquidations_mode: "okx" },
    });
    const mm = selectMarketMemory([primary, standalone], primary);
    expect(mm?.service_id).toBe("mm-worker");
    expect(mm?.details.ingested).toBe(4);
  });

  it("returns null when neither embedded nor standalone market-memory exists", () => {
    const primary = heartbeat({
      service_id: "bot",
      reported_at: "2026-09-15T10:00:00.000Z",
      details: { api_health: { fred: "ok" } },
    });
    expect(selectMarketMemory([primary], primary)).toBeNull();
    expect(embeddedMarketMemory(primary)).toBeNull();
  });
});

describe("fetchPmdJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPmdHealthCache();
  });

  it("returns HTTP errors and retries once on 503", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchPmdJson<{ status: string }>("https://example.com/health");
    expect(result).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("maps abort/timeout to a clear error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("The operation was aborted", "TimeoutError")),
    );
    const result = await fetchPmdJson("https://example.com/health", { retry: false, timeoutMs: 10 });
    expect(result).toEqual({ status: "error", error: "timeout after 10ms" });
  });
});

describe("fetchPmdHealthCached", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearPmdHealthCache();
  });

  it("caches successful health responses briefly", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const a = await fetchPmdHealthCached<{ status: string }>("https://example.com/health", 1_000);
    const b = await fetchPmdHealthCached<{ status: string }>("https://example.com/health", 1_500);
    expect(a).toEqual({ status: "ok" });
    expect(b).toEqual({ status: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
