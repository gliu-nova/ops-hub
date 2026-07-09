import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authorizeHeartbeat,
  clearPmdHealthCache,
  deriveEmbeddedMarketMemoryStatus,
  fetchPmdHealthCached,
  fetchPmdJson,
  parseHeartbeatRow,
  pmdBaseUrl,
  resolveReportedAt,
  timingSafeEqualString,
  validateHeartbeatBody,
} from "./helpers";

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
  it("does not inherit twitter-bot status; uses nested fields", () => {
    expect(deriveEmbeddedMarketMemoryStatus({ ingested: 3 })).toBe("ok");
    expect(deriveEmbeddedMarketMemoryStatus({ status: "degraded" })).toBe("degraded");
    expect(deriveEmbeddedMarketMemoryStatus({ error: "sync failed" })).toBe("error");
    expect(deriveEmbeddedMarketMemoryStatus({ skipped: true, reason: "rate limit" })).toBe("degraded");
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
