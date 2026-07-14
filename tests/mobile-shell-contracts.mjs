import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(resolve(root, "index.html"), "utf8");

const viewport = html.match(/<meta name="viewport" content="([^"]+)"/);
assert(viewport, "viewport metadata is missing");
assert.match(viewport[1], /viewport-fit=cover/, "viewport must expose safe-area insets");
assert.doesNotMatch(viewport[1], /maximum-scale/, "viewport must not cap accessibility zoom");
assert.doesNotMatch(viewport[1], /user-scalable/, "viewport must not disable accessibility zoom");

for (const side of ["top", "right", "bottom", "left"]) {
  assert.match(
    html,
    new RegExp(`--safe-${side}: env\\(safe-area-inset-${side}, 0px\\)`),
    `safe-area variable is missing for ${side}`,
  );
}

for (const selector of ["#wrap", ".screen", "#pagefoot", "#admin", "#demoCap"]) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rules = [...html.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  assert(rules.some((match) => /var\(--safe-/.test(match[1])), `${selector} ignores safe areas`);
}

assert.match(html, /height: 100dvh/, "outer shell must use the dynamic viewport height");
assert.match(html, /max-height: 62dvh/, "scrolling menus must use the dynamic viewport height");
assert.match(html, /50dvh/, "touch-stage height cap must use the dynamic viewport height");

console.log("Mobile shell contracts OK: zoom, safe areas, and dynamic viewport sizing checked.");
