// Build tools/terrain-lab.html from game.js.
//
//   node tools/build-terrain-lab.mjs            # write the lab
//   node tools/build-terrain-lab.mjs --check    # fail if it has drifted from game.js
//
// The lab exists to design terrain for a scenario, so its preview has to be the REAL generator, not a
// lookalike. Every shaping function is sliced out of game.js verbatim and embedded: change the game
// and re-run this, and the lab changes with it. A hand-written copy would drift within a week and then
// quietly show you a seabed the game would never build.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const game = readFileSync(join(root, "game.js"), "utf8");
const check = process.argv.includes("--check");

function slice(name) {
  const i = game.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`game.js has no function ${name}`);
  let depth = 0, j = game.indexOf("{", i), started = false;
  for (; j < game.length; j++) {
    const c = game[j];
    if (c === "{") { depth++; started = true; }
    else if (c === "}") { depth--; if (started && depth === 0) { j++; break; } }
  }
  return game.slice(i, j);
}

// The shaping pipeline, verbatim. makeTerrainChunk is the one that matters: it decides what is rock
// and what is water, and everything the lab shows is that decision rendered.
const ENGINE = ["terrainHash", "terrainNoise1", "terrainFbm1", "terrainNoise2",
                "terrainSpireLift", "terrainLutFor", "makeTerrainChunk", "surfaceDepth"]
  .map(slice).join("\n\n");

// grain constants, also from the game, so the depth shading matches
const GRAIN_MAXD = game.match(/const GRAIN_MAXD = (\d+)/)[1];
const grain = {};
for (const k of ["grainStrength", "grainRim", "grainFalloff", "grainFloor"]) {
  grain[k] = Number(game.match(new RegExp(`${k}:\\s*([\\d.]+)`))[1]);
}
const CS = Number(game.match(/grid:\s*\{\s*cs:\s*(\d+)/)[1]);

const PRESETS = {
  "sea ice":        { at: "top",    thickness: 175, color: "#cfe4f2", label: "sea ice",           roughness: 0.50, porosity: 0.45, poreSize: 18, featureSize: 300, spires: 0,    spireHeight: 0,   spireWidth: 60, warp: 0 },
  "vent chimneys":  { at: "bottom", thickness: 200, color: "#3f3a44", label: "sulfide chimneys",  roughness: 0.30, porosity: 0.30, poreSize: 22, featureSize: 220, spires: 0.55, spireHeight: 300, spireWidth: 52, warp: 0 },
  "coral reef":     { at: "bottom", thickness: 300, color: "#d7a48a", label: "coral reef",        roughness: 0.55, porosity: 0.55, poreSize: 30, featureSize: 220, spires: 0.45, spireHeight: 220, spireWidth: 70, warp: 0.7 },
  "estuarine mud":  { at: "bottom", thickness: 220, color: "#4f3d2a", label: "estuarine mud",     roughness: 0.35, porosity: 0.45, poreSize: 30, featureSize: 400, spires: 0,    spireHeight: 0,   spireWidth: 60, warp: 0 },
  "streambed":      { at: "bottom", thickness: 200, color: "#6a6152", label: "streambed gravel",  roughness: 0.55, porosity: 0.50, poreSize: 32, featureSize: 320, spires: 0,    spireHeight: 0,   spireWidth: 60, warp: 0.25 },
  "lake bed":       { at: "bottom", thickness: 200, color: "#4a4530", label: "lake sediment",     roughness: 0.30, porosity: 0.40, poreSize: 30, featureSize: 450, spires: 0,    spireHeight: 0,   spireWidth: 60, warp: 0 },
};

const html = `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Terrain Lab · Bacteria!</title>
<style>
  /* A survey instrument: the readouts are the design. Ground and accent come from the game itself so
     what you build here looks like where it will live. */
  :root {
    --abyss:   #071318;   --panel:  #0d1f26;   --line: #17323c;
    --ink:     #dff5ee;   --muted:  #7fa3a0;
    --accent:  #57e0c0;   --rock:   #c8b48a;   --warn: #ffd24a;
    --bg: var(--abyss); --fg: var(--ink); --card: var(--panel);
    --radius: 10px;
    --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    --sans: "Trebuchet MS", "Segoe UI", system-ui, sans-serif;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg: #eef3f2; --fg: #0b2027; --card: #ffffff; --line: #cfdcd9; --muted: #4d6b6a; }
  }
  :root[data-theme="light"] { --bg: #eef3f2; --fg: #0b2027; --card: #ffffff; --line: #cfdcd9; --muted: #4d6b6a; }
  :root[data-theme="dark"]  { --bg: #071318; --fg: #dff5ee; --card: #0d1f26; --line: #17323c; --muted: #7fa3a0; }

  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font-family: var(--sans);
         line-height: 1.5; padding: 22px; }
  h1 { font-size: 19px; margin: 0; letter-spacing: .3px; }
  .sub { color: var(--muted); font-size: 13px; margin: 2px 0 18px; max-width: 68ch; }
  .wrap { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 18px; align-items: start; }
  /* The preview stays put while the controls scroll, so a tweak is always visible against its result. */
  .preview { position: sticky; top: 22px; }
  @media (max-width: 820px) { .wrap { grid-template-columns: 1fr; } .preview { position: static; } }

  .card { background: var(--card); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; }
  .card + .card { margin-top: 14px; }
  .card h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 1.4px; color: var(--muted);
             margin: 0 0 10px; font-weight: 600; }

  .row { display: grid; grid-template-columns: 1fr auto; gap: 6px 10px; align-items: center;
         margin-bottom: 9px; }
  .row label { font-size: 12.5px; }
  .row output { font-family: var(--mono); font-size: 12px; color: var(--accent);
                font-variant-numeric: tabular-nums; }
  .row input[type=range] { grid-column: 1 / -1; width: 100%; accent-color: var(--accent); margin: 0; }
  .hint { grid-column: 1 / -1; font-size: 11px; color: var(--muted); margin: -3px 0 0; }

  .seg { display: flex; gap: 6px; }
  .seg button { flex: 1; background: transparent; color: var(--fg); border: 1px solid var(--line);
                border-radius: 7px; padding: 6px 8px; font: inherit; font-size: 12.5px; cursor: pointer; }
  .seg button[aria-pressed="true"] { background: color-mix(in srgb, var(--accent) 18%, transparent);
                border-color: var(--accent); color: var(--accent); }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .presets button { background: transparent; border: 1px dashed var(--line); color: var(--muted);
                    border-radius: 999px; padding: 4px 10px; font: inherit; font-size: 11.5px; cursor: pointer; }
  .presets button:hover { border-style: solid; border-color: var(--accent); color: var(--accent); }
  #random { background: transparent; color: var(--fg); border: 1px solid var(--line); border-radius: 7px;
            padding: 7px; font: inherit; font-size: 12.5px; cursor: pointer; }
  #random:hover { border-color: var(--accent); color: var(--accent); }
  button:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  canvas { display: block; width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--line);
           background: #05131a; }
  .stats { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
  .stat { border: 1px solid var(--line); border-radius: 7px; padding: 6px 10px; min-width: 96px; }
  .stat b { display: block; font-family: var(--mono); font-size: 15px; font-variant-numeric: tabular-nums;
            color: var(--accent); }
  .stat span { font-size: 10.5px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); }
  .stat.warn b { color: var(--warn); }

  textarea { width: 100%; min-height: 190px; background: var(--bg); color: var(--fg); border: 1px solid var(--line);
             border-radius: 8px; padding: 10px; font-family: var(--mono); font-size: 12px; resize: vertical; }
  .bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 8px; }
  .bar button { background: var(--accent); color: #052; border: 0; border-radius: 7px; padding: 7px 14px;
                font: inherit; font-weight: 600; cursor: pointer; }
  .bar button.ghost { background: transparent; color: var(--fg); border: 1px solid var(--line); font-weight: 500; }
  .bar button.ghost:hover { border-color: var(--accent); color: var(--accent); }
  .presets button.mine { border-style: solid; border-color: color-mix(in srgb, var(--accent) 45%, transparent);
                         color: var(--accent); }
  .presets button.mine .x { margin-left: 6px; opacity: .6; }
  .presets button.mine .x:hover { opacity: 1; }
  .said { font-size: 12px; color: var(--accent); }
  .legend { font-size: 11.5px; color: var(--muted); margin-top: 8px; }
</style>

<h1>Terrain Lab</h1>
<p class="sub">Design a sea floor or an ice ceiling for a Bacteria! scenario. The preview runs the game's
  own generator, so what you see is what the level builds — including the pore network you can swim
  into. Paste the JSON into a scenario's <code>terrain</code> array.</p>

<div class="wrap">
  <div>
    <div class="card">
      <h2>Anchor</h2>
      <div class="seg" id="anchor">
        <button data-at="bottom" aria-pressed="true">Floor</button>
        <button data-at="top" aria-pressed="false">Ceiling</button>
      </div>
      <div class="row" style="margin-top:12px">
        <label for="color">Material colour</label>
        <input type="color" id="color" value="#3f3a44">
      </div>
      <div class="row">
        <label for="label">Label</label>
      </div>
      <input id="label" value="sulfide chimneys" style="width:100%;background:var(--bg);color:var(--fg);
             border:1px solid var(--line);border-radius:7px;padding:6px 9px;font:inherit;font-size:12.5px">
    </div>

    <div class="card">
      <h2>Mass</h2>
      <div class="row"><label for="thickness">Thickness</label><output id="thickness-o"></output>
        <input type="range" id="thickness" min="20" max="800" step="5">
        <p class="hint">How deep the layer runs, in pixels.</p></div>
      <div class="row"><label for="roughness">Roughness</label><output id="roughness-o"></output>
        <input type="range" id="roughness" min="0" max="1" step="0.01">
        <p class="hint">Rolling relief. 0 is a dead-flat slab.</p></div>
      <div class="row"><label for="featureSize">Relief scale</label><output id="featureSize-o"></output>
        <input type="range" id="featureSize" min="40" max="2000" step="10">
        <p class="hint">How wide those undulations are.</p></div>
      <div class="row"><label for="warp">Organic warp</label><output id="warp-o"></output>
        <input type="range" id="warp" min="0" max="1" step="0.01">
        <p class="hint">Bends the whole structure into veins and branches instead of round blobs — turn it
          up for coral, sponges, a reef.</p></div>
    </div>

    <div class="card">
      <h2>Pore network</h2>
      <div class="row"><label for="porosity">Porosity</label><output id="porosity-o"></output>
        <input type="range" id="porosity" min="0" max="1" step="0.01">
        <p class="hint">Voids through the mass — brine channels, burrows. This is the part cells can live in.</p></div>
      <div class="row"><label for="poreSize">Pore scale</label><output id="poreSize-o"></output>
        <input type="range" id="poreSize" min="6" max="200" step="1">
        <p class="hint">Fine channels or open caverns.</p></div>
    </div>

    <div class="card">
      <h2>Spires</h2>
      <div class="row"><label for="spires">Density</label><output id="spires-o"></output>
        <input type="range" id="spires" min="0" max="1" step="0.01">
        <p class="hint">How much of the width grows a tower. 0 for a flat sheet.</p></div>
      <div class="row"><label for="spireHeight">Height</label><output id="spireHeight-o"></output>
        <input type="range" id="spireHeight" min="0" max="800" step="10"></div>
      <div class="row"><label for="spireWidth">Girth</label><output id="spireWidth-o"></output>
        <input type="range" id="spireWidth" min="10" max="400" step="2">
        <p class="hint">40–70 is a slender chimney; 200 a broad pinnacle.</p></div>
    </div>

    <div class="card">
      <h2>Start from</h2>
      <div class="presets" id="presets"></div>
      <button id="random" class="ghost" style="margin-top:10px;width:100%">🎲 Randomize</button>
    </div>
  </div>

  <div class="preview">
    <div class="card">
      <h2>Cross-section · full world width (2600 px)</h2>
      <canvas id="view" width="1300" height="520"></canvas>
      <div class="stats" id="stats"></div>
      <p class="legend">Dark gaps inside the mass are pore space — a cell can swim in there. The dotted
        line marks the world boundary. <b title="A canvas holds every pixel as RGBA in RAM, so this is
        roughly width×height×4 — what the layer costs live in the game, not its file size. A PNG on disk
        would be far smaller, but it decompresses to this the moment it is drawn.">Canvas</b> is the
        uncompressed RAM the layer takes in-game, not a download size.</p>
    </div>
    <div class="card">
      <h2>Scenario JSON</h2>
      <textarea id="json" readonly spellcheck="false"></textarea>
      <div class="bar">
        <button id="seed">🌱 Seed a scenario</button>
        <button id="launch" class="ghost">▸ Test level</button>
        <button id="save" class="ghost">Save preset…</button>
        <button id="copy" class="ghost">Copy</button>
        <span class="said" id="said"></span>
      </div>
      <p class="legend" id="seedNote">Seed asks the level generator to build a whole scenario — organisms,
        chemistry, a lesson — around this exact terrain, and adds it to Scenarios for everyone in about
        fifteen minutes. Test level flies it privately, no generation.</p>
    </div>
  </div>
</div>

<script>
// ---- the game's own generator, sliced out of game.js by tools/build-terrain-lab.mjs ----------------
const WORLD_W = 2600, WORLD_H = 2000;
const GRAIN_MAXD = ${GRAIN_MAXD};
const CFG = { grid: { cs: ${CS} }, substrate: ${JSON.stringify(grain)} };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

${ENGINE}
// ---- end of the embedded generator ----------------------------------------------------------------

const PRESETS = ${JSON.stringify(PRESETS, null, 2)};
const KEYS = ["thickness","roughness","featureSize","porosity","poreSize","spires","spireHeight","spireWidth","warp"];
const state = { ...PRESETS["vent chimneys"] };

const $ = (id) => document.getElementById(id);
const fmt = { thickness: (v) => v + " px", featureSize: (v) => v + " px", poreSize: (v) => v + " px",
              spireHeight: (v) => v + " px", spireWidth: (v) => v + " px",
              roughness: (v) => (+v).toFixed(2), porosity: (v) => (+v).toFixed(2), spires: (v) => (+v).toFixed(2), warp: (v) => (+v).toFixed(2) };

function buildChunks(porosityOverride) {
  const thickness = clamp(state.thickness, 20, WORLD_H * 0.4);
  const porosity = porosityOverride == null ? state.porosity : porosityOverride;
  const layer = { at: state.at, thickness,
    roughness: state.roughness, porosity, poreSize: state.poreSize,
    featureSize: state.featureSize, spires: state.spires, spireHeight: state.spireHeight,
    spireWidth: state.spireWidth, warp: state.warp, seed: 9973, label: state.label, cy: 0 };
  const side = clamp(thickness, 64, 420);
  const lut = terrainLutFor(state.color);
  const reach = thickness + layer.spireHeight;
  const cols = Math.ceil(WORLD_W / side), rows = Math.ceil(reach / side);
  const out = [];
  for (let r = 0; r < rows; r++) {   // matches buildTerrain in game.js — no off-world seam row
    layer.cy = layer.at === "top" ? side / 2 + r * side : WORLD_H - side / 2 - r * side;
    for (let i = 0; i < cols; i++) {
      const c = makeTerrainChunk(layer, (i + 0.5) * side, side, lut, 9973, false);
      if (c) out.push(c);
    }
  }
  return { chunks: out, reach, side };
}

function render() {
  const { chunks, reach, side } = buildChunks();
  const cv = $("view"), ctx = cv.getContext("2d");
  const fromTop = state.at === "top";
  // frame the layer plus a strip of water, so you can judge how far it reaches into the sea
  const band = Math.min(WORLD_H, reach + 220);
  const top = fromTop ? -60 : WORLD_H - band + 60;
  const scale = cv.width / WORLD_W;
  cv.height = Math.round(band * scale);

  ctx.fillStyle = "#05131a";
  ctx.fillRect(0, 0, cv.width, cv.height);

  let solid = 0, bytes = 0;
  for (const p of chunks) {
    bytes += (p.n * p.cs) ** 2 * 4;
    const depth = surfaceDepth(p);
    for (let gj = 0; gj < p.n; gj++) for (let gi = 0; gi < p.n; gi++) {
      const idx = gj * p.n + gi;
      if (p.y >= 0 && p.y <= WORLD_H && p.grid[idx] > 0) solid++;
      if (p.grid[idx] <= 0) continue;
      const wx = p.x + (gi + 0.5) * p.cs - p.half;
      const wy = p.y + (gj + 0.5) * p.cs - p.half;
      ctx.fillStyle = p.terrainLut[Math.min(depth[idx], GRAIN_MAXD)];
      ctx.fillRect((wx - p.cs / 2) * scale, (wy - top - p.cs / 2) * scale,
                   p.cs * scale + 0.6, p.cs * scale + 0.6);
    }
  }

  // the world boundary
  ctx.save();
  ctx.strokeStyle = "rgba(87,224,192,.5)"; ctx.setLineDash([6, 5]); ctx.lineWidth = 1;
  const edgeY = (fromTop ? 0 : WORLD_H) - top;
  ctx.beginPath(); ctx.moveTo(0, edgeY * scale); ctx.lineTo(cv.width, edgeY * scale); ctx.stroke();
  ctx.restore();

  // Pore space means voids threaded through the MASS, so measure against the same layer with the pores
  // switched off. Comparing against the chunk area instead would mostly be counting the open water
  // above the spires, which tells you nothing about whether there is anywhere to shelter.
  let poreless = 0;
  for (const p of buildChunks(0).chunks) {
    if (p.y < 0 || p.y > WORLD_H) continue;
    for (let k = 0; k < p.grid.length; k++) if (p.grid[k] > 0) poreless++;
  }
  const pore = poreless ? clamp(1 - solid / poreless, 0, 1) : 0;
  let tallest = 0;
  for (let x = 0; x < WORLD_W; x += 4) {
    const h = terrainSpireLift({ spires: state.spires, spireHeight: state.spireHeight,
                                 spireWidth: state.spireWidth, seed: 9973 }, x);
    if (h > tallest) tallest = h;
  }
  const mb = bytes / 1048576;
  $("stats").innerHTML =
    stat(Math.round(pore * 100) + "%", "of mass is pore", pore < 0.05 && state.porosity > 0) +
    stat(Math.round(reach) + " px", "total reach") +
    stat(Math.round(tallest) + " px", "tallest spire") +
    stat(chunks.length, "chunks") +
    stat(mb.toFixed(1) + " MB", "canvas", mb > 14);

  const json = { at: state.at, thickness: Math.round(state.thickness), color: state.color, label: state.label,
                 roughness: +(+state.roughness).toFixed(2), porosity: +(+state.porosity).toFixed(2),
                 poreSize: Math.round(state.poreSize), featureSize: Math.round(state.featureSize) };
  if (state.spires > 0 && state.spireHeight > 0) {
    json.spires = +(+state.spires).toFixed(2);
    json.spireHeight = Math.round(state.spireHeight);
    json.spireWidth = Math.round(state.spireWidth);
  }
  if (state.warp > 0) json.warp = +(+state.warp).toFixed(2);
  $("json").value = '"terrain": [\\n  ' + JSON.stringify(json, null, 2).split("\\n").join("\\n  ") + "\\n]";
}
const stat = (v, l, warn) =>
  '<div class="stat' + (warn ? " warn" : "") + '"><b>' + v + "</b><span>" + l + "</span></div>";

function syncInputs() {
  for (const k of KEYS) { $(k).value = state[k]; $(k + "-o").textContent = fmt[k](state[k]); }
  $("color").value = state.color;
  $("label").value = state.label;
  for (const b of $("anchor").children) b.setAttribute("aria-pressed", String(b.dataset.at === state.at));
}

for (const k of KEYS) $(k).addEventListener("input", (e) => {
  state[k] = Number(e.target.value); $(k + "-o").textContent = fmt[k](state[k]); render();
});
$("color").addEventListener("input", (e) => { state.color = e.target.value; render(); });
$("label").addEventListener("input", (e) => { state.label = e.target.value; render(); });
$("anchor").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  state.at = b.dataset.at; syncInputs(); render();
});
// Your own saved presets live in localStorage, shown after the built-ins with a delete affremove.
const MINE_KEY = "bacteria_terrain_presets";
function myPresets() { try { return JSON.parse(localStorage.getItem(MINE_KEY)) || {}; } catch { return {}; } }
function saveMine(all) { try { localStorage.setItem(MINE_KEY, JSON.stringify(all)); } catch {} }
function renderPresets() {
  const built = Object.keys(PRESETS).map((n) => '<button data-p="' + n + '">' + esc(n) + "</button>").join("");
  const mine = Object.keys(myPresets()).map((n) =>
    '<button class="mine" data-mine="' + esc(n) + '">' + esc(n) + '<span class="x" data-del="' + esc(n) + '">×</span></button>').join("");
  $("presets").innerHTML = built + mine;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
$("presets").addEventListener("click", (e) => {
  const del = e.target.closest("[data-del]");
  if (del) { e.stopPropagation(); const all = myPresets(); delete all[del.dataset.del]; saveMine(all); renderPresets(); return; }
  const mineBtn = e.target.closest("[data-mine]");
  if (mineBtn) { Object.assign(state, myPresets()[mineBtn.dataset.mine]); syncInputs(); render(); return; }
  const b = e.target.closest("[data-p]"); if (!b) return;
  Object.assign(state, PRESETS[b.dataset.p]); syncInputs(); render();
});
renderPresets();

// Randomize: a plausible seabed or ceiling, not noise. Materials carry a matched colour and label, and
// spires/warp toggle on at random so you get chimneys and coral some of the time, flat mud others.
const RND_MATERIALS = {
  top: [["#cfe4f2", "sea ice"], ["#dbe9f2", "platelet ice"], ["#b9d4e6", "glacial ice"]],
  bottom: [["#3f3a44", "sulfide floor"], ["#4f3d2a", "estuarine mud"], ["#c9bda2", "reef carbonate"],
           ["#6a6152", "streambed gravel"], ["#4a4530", "lake sediment"], ["#d7a48a", "coral"],
           ["#7a5a3a", "sandy floor"], ["#5a5560", "basalt"]],
};
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
$("random").addEventListener("click", () => {
  const at = pick(["top", "bottom"]);
  const [color, label] = pick(RND_MATERIALS[at]);
  const spiry = Math.random() < 0.5, warpy = Math.random() < 0.5;
  Object.assign(state, {
    at, color, label,
    thickness: Math.round(rnd(120, 420)),
    roughness: +rnd(0.2, 0.9).toFixed(2),
    porosity: +rnd(0.2, 0.6).toFixed(2),
    poreSize: Math.round(rnd(14, 55)),
    featureSize: Math.round(rnd(150, 520)),
    spires: spiry ? +rnd(0.25, 0.6).toFixed(2) : 0,
    spireHeight: spiry ? Math.round(rnd(120, 340)) : 0,
    spireWidth: Math.round(rnd(40, 130)),
    warp: warpy ? +rnd(0.3, 0.8).toFixed(2) : 0,
  });
  syncInputs(); render();
});

$("save").addEventListener("click", () => {
  const name = prompt("Save this terrain as:", state.label || "my terrain");
  if (!name || !name.trim()) return;
  const all = myPresets();
  // store a plain copy of the current knobs, so editing state later doesn't mutate the saved one
  all[name.trim().slice(0, 40)] = JSON.parse(JSON.stringify(state));
  saveMine(all); renderPresets();
  $("said").textContent = "Saved to this browser"; setTimeout(() => { $("said").textContent = ""; }, 1800);
});

// The terrain array exactly as it goes on the wire — the same object the JSON panel shows.
function currentTerrain() {
  const json = { at: state.at, thickness: Math.round(state.thickness), color: state.color, label: state.label,
                 roughness: +(+state.roughness).toFixed(2), porosity: +(+state.porosity).toFixed(2),
                 poreSize: Math.round(state.poreSize), featureSize: Math.round(state.featureSize) };
  if (state.spires > 0 && state.spireHeight > 0) {
    json.spires = +(+state.spires).toFixed(2); json.spireHeight = Math.round(state.spireHeight); json.spireWidth = Math.round(state.spireWidth);
  }
  if (state.warp > 0) json.warp = +(+state.warp).toFixed(2);
  return [json];
}

// Seed a whole scenario built around this terrain. Posts to the game's own request endpoint, which
// validates the terrain, queues it, and returns the id the generated level will have — then we watch
// the library for it to land, exactly like the in-game paper form does.
let seedPoll = null;
$("seed").addEventListener("click", async () => {
  const name = prompt("Credit this level to a name? (optional — leave blank to stay anonymous)", "") || "";
  $("seed").disabled = true;
  $("said").textContent = "Sending…"; $("said").style.color = "";
  try {
    const r = await fetch("../scenario-request.php", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terrain: currentTerrain(), name: name.trim().slice(0, 40) }),
    });
    const body = await r.json();
    if (!r.ok || !body.ok) { $("seed").disabled = false; $("said").textContent = body.error || "Couldn't queue that — try again in a moment."; return; }
    $("said").textContent = "Queued! Building your level — about 15 min. It'll appear in Scenarios.";
    if (body.id) watchForScenario(body.id, Date.now());
  } catch (e) {
    $("seed").disabled = false; $("said").textContent = "Couldn't reach the server — try again in a moment.";
  }
});
const SCEN_BASE = "https://raw.githubusercontent.com/rec3141/bacteria-the-game-scenarios/main";
function watchForScenario(id, startedAt) {
  if (seedPoll) clearTimeout(seedPoll);
  if (Date.now() - startedAt > 30 * 60 * 1000) { $("seed").disabled = false; $("said").textContent = "Still building — it'll turn up in Scenarios when it's ready."; return; }
  seedPoll = setTimeout(() => {
    fetch(SCEN_BASE + "/scenarios/" + encodeURIComponent(id) + ".json", { cache: "no-cache" })
      .then((r) => {
        if (!r.ok) { watchForScenario(id, startedAt); return; }
        $("seed").disabled = false; $("said").textContent = "Your level is ready 🌱";
        window.open("../index.html?scenario=" + encodeURIComponent(id), "_blank", "noopener");
      })
      .catch(() => watchForScenario(id, startedAt));
  }, 20000);
}

// Fly the current terrain in the real game: a base64url'd terrain array on the game's own URL, which
// the game validates exactly like any scenario before building it.
$("launch").addEventListener("click", () => {
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(currentTerrain())))).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/, "");
  window.open("../index.html?labterrain=" + b64, "_blank", "noopener");
});
$("copy").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("json").value); $("said").textContent = "Copied"; }
  catch { $("json").select(); $("said").textContent = "Press Cmd/Ctrl+C"; }
  setTimeout(() => { $("said").textContent = ""; }, 1800);
});

syncInputs();
render();
</script>
`;

mkdirSync(join(root, "tools"), { recursive: true });
const out = join(root, "tools", "terrain-lab.html");
let current = null;
try { current = readFileSync(out, "utf8"); } catch { /* first build */ }
if (current === html) { console.log("terrain-lab.html is up to date with game.js"); process.exit(0); }
if (check) {
  console.error("tools/terrain-lab.html has drifted from game.js — run: node tools/build-terrain-lab.mjs");
  process.exit(1);
}
writeFileSync(out, html);
console.log(`wrote tools/terrain-lab.html (${(html.length / 1024).toFixed(1)} KB, generator embedded from game.js)`);
