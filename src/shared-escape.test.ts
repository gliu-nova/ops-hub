import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const root = path.dirname(fileURLToPath(import.meta.url));
const sharedPath = path.resolve(root, "../public/js/shared.js");

function loadShared() {
  const code = readFileSync(sharedPath, "utf8");
  const sandbox: { OpsHub?: { escapeHtml: (v: unknown) => string }; globalThis: unknown } = {
    globalThis: undefined,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return sandbox.OpsHub!;
}

describe("public/js/shared.js escapeHtml", () => {
  it("escapes script-bearing heartbeat summaries", () => {
    const { escapeHtml } = loadShared();
    const raw = `<img src=x onerror="alert(1)"> & <script>alert(1)</script>`;
    const escaped = escapeHtml(raw);
    expect(escaped).not.toContain("<script>");
    expect(escaped).toContain("&lt;script&gt;");
    expect(escaped).toContain("&amp;");
    expect(escaped).toContain("&quot;");
  });
});
