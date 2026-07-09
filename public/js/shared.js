/** Shared dashboard helpers (loaded by index.html and pmd.html). */
(function (global) {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatRelativeTime(iso) {
    if (!iso) return "never";
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return escapeHtml(iso);
    const minutes = Math.floor((Date.now() - then) / 60000);
    if (minutes < 1) return "just now";
    if (minutes === 1) return "1 minute ago";
    if (minutes < 60) return `${minutes} minutes ago`;
    const hours = Math.floor(minutes / 60);
    if (hours === 1) return "1 hour ago";
    if (hours < 48) return `${hours} hours ago`;
    const days = Math.floor(hours / 24);
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }

  function freshnessBadge(iso, healthyMinutes, delayedMinutes) {
    if (!iso) return '<span class="badge badge-bad">No data</span>';
    const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (minutes <= healthyMinutes) return '<span class="badge badge-ok">Healthy</span>';
    if (minutes <= delayedMinutes) return '<span class="badge badge-warn">Delayed</span>';
    return '<span class="badge badge-bad">Stale</span>';
  }

  function statusClass(status) {
    if (status === "ok") return "ok";
    if (status === "degraded") return "warn";
    return "bad";
  }

  function healthVenues(health) {
    if (health?.venues) return health.venues;
    const ingestion = health?.ingestion || {};
    const output = health?.output || {};
    const active = output.active_opportunities ?? health?.active_opportunities ?? 0;
    const total = output.signals_total ?? health?.signals_total ?? 0;
    const pairs = ingestion.matched_pairs ?? 0;
    return {
      kalshi: {
        markets_ingested: ingestion.kalshi_markets ?? 0,
        markets_in_pairs: pairs,
        markets_enriched: null,
        snapshots_stored: null,
        active_signals: active,
        signals_total: total,
      },
      polymarket: {
        markets_ingested: ingestion.polymarket_markets ?? 0,
        markets_in_pairs: pairs,
        markets_enriched: null,
        snapshots_stored: null,
        active_signals: active,
        signals_total: total,
      },
    };
  }

  global.OpsHub = {
    escapeHtml,
    formatRelativeTime,
    freshnessBadge,
    statusClass,
    healthVenues,
  };
})(typeof window !== "undefined" ? window : globalThis);
