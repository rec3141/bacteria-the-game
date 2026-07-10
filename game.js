/* Bacteria! — a reimagining of the 2014 Stencyl/Flash game.
 * Vanilla JS + Canvas, no dependencies. Original sounds recovered from the SWF.
 *
 * You are a bacterium in a wide, wrapping patch of ocean, dwarfed by particles
 * of marine snow, fecal pellets, diatoms and chitin. The particles are SOLID:
 * you cannot swim through them, but you can dissolve them with extracellular
 * enzymes — carving tunnels, burrowing to the nutrient-rich core, and sheltering
 * inside where the big protist grazers can't reach. Absorb enough dissolved
 * nutrient and the rod elongates and divides; each daughter forages on its own.
 *
 * The world is a torus (edges wrap) and much larger than the screen; the camera
 * follows your controlled cell. Temperature & salinity set viscosity (swim speed,
 * metabolic rate) and diffusivity (how fast dissolved nutrient drifts away).
 */
(() => {
  "use strict";

  // ------------------------------------------------------------ world / view
  const VIEW_W = 800, VIEW_H = 600;
  const WORLD_W = 2600, WORLD_H = 2000;

  const CFG = {
    cell: {
      radius: 5, baseHalf: 9, maxHalf: 22, lenBaseEnergy: 55, elongK: 0.11,
      thrust: 780, maxSpeed: 240, uptake: 14,
      startEnergy: 110, maxEnergy: 230, divideThreshold: 155,
      swimCost: 1.2, enzymeCost: 4, antibioticCost: 6, invulnTime: 2.2,
      runMin: 1.8, runMax: 3.4, tumbleDur: 0.4, tumbleTurn: 7.0, playerTumbleTurn: 2.2,
      enzymeCooldown: [2.5, 4.5],
      cystBelow: 14, cystWake: 45, cystMetab: 0.035, // low-energy autonomous cells encyst: dormant, near-zero
                                                    // metabolism, phage-immune & predation-resistant, tail dropped
      cystReviveEnergy: 40,       // energy a cyst is given when resuscitated as the player character
      crisprEnergy: 9,            // energy gained when a CRISPR cell destroys a virus it's immune to
      cystDiffuse: 55,            // cysts drift passively (brownian) with the water
      exprBoost: 0.16,            // enzyme-radius gain per expression level (stacking gold-phage upgrade)
      chemoRange0: 400, chemoRangePer: 130, // chemotaxis sensing range grows with chemoLevel
      chemoTurn0: 1.15, chemoTurnPer: 0.5,  // ...and its steering sharpness too
      fedLinger: 2.2, maxCells: 100000, // effectively uncapped (perf backstop only)
    },
    respirationBase: 0.9,
    grid: { cs: 7 },                 // destructible-particle voxel size (px)
    substrate: {
      count: 60, moteEnergy: 7,      // ~2x the old food (~10.5k voxels), spread across a power-law size spectrum
      sizeMin: 30, sizeMax: 200, sizeExp: 1.9, // Junge-like size spectrum: abundance ∝ size^-sizeExp → many small, few large
      carveRate: 4.5,                // density removed /sec per covered voxel
      lifeMin: 130, lifeMax: 300,    // each particle has its own lifespan (staggered)
      dissolveTime: 9,               // at end of life it erodes voxel-by-voxel over this many seconds
      driftMin: 5, driftMax: 12,     // slow drift so particles ease in from offscreen, never pop into view
      minPerRes: 2,                  // always keep at least this many particles dominant in EACH resource (so every enzyme has food)
    },
    enzyme: { life: 5.0, maxRadius: 24, growTime: 0.4 },
    toxin: { life: 4.5, maxRadius: 40, growTime: 0.4, dose: 55, potency: 18, radiusPer: 0.14 }, // anti-protist antibiotic: instant `dose` hit on release + lingering `potency`/s; both ×level. ~2-3 hits kill a protist
    nutrient: { life: 16, radius: 3.2, maxCount: 600 },
    predator: {
      count: 4, radius: 22, wanderSpeed: 50, chaseSpeed: 85, senseRange: 170, satiatedTime: 4.5,
      startEnergy: 100, mealEnergy: 58, metabolism: 1.15, // eats cells for energy, drains over time
      maturity: 10, lifespan: [55, 100],                 // senescence: dies of old age
      reproEnergy: 150, reproCooldown: 13,               // reproduction, gated only by feeding (no abundance cap)
      safetyMax: 600,                                    // perf backstop only — never binds ecologically
      minCount: 2, immigrateEvery: 14,                   // a drifter arrives if the population crashes
      cystMealFactor: 0.45, cystEatChance: 0.35,         // cysts aren't hunted; a bumped one is usually resisted, rarely eaten (for little energy)
      killMotes: 8,                                      // biomass released as food when an antibiotic KILLS a protist (natural death releases nothing)
    },
    phage: {
      greenCount: 6, radius: 3.6, life: [16, 24], maxCount: 4000, diffuse: 22, // maxCount is a perf backstop only (was 220) — let epidemics get nasty
      infectHalo: 5,        // adsorption reach beyond the cell body
      burst: [3, 6],        // green progeny released when an infected cell dies
      latent: [9, 15],      // seconds from green infection to lysis
      greenSeed: [5, 9], greenFloor: 9, // background viral reservoir: top up near cells when green runs low
      hostTolerance: 2,     // kill-the-winner: a phage infects only cells within this many upgrade-tiers of its host
      goldLife: [90, 140],  // gold phage lingers far longer than green — you can chase it down
                            // (one is always kept on the board, respawning near the player when used)
    },
    scorePerEnergy: 0.4, scorePerDivide: 200,
  };

  // Resource classes: each exoenzyme dissolves only its matching resource. Voxels
  // are colour-coded by resource so a particle reads as its biochemical makeup.
  const RESOURCES = [
    { key: "lipid",   enzyme: "lipase",       color: "#efd98a" }, // 0 — fats/oils, wheat-yellow
    { key: "protein", enzyme: "protease",     color: "#e0645a" }, // 1 — proteinaceous, coral-red
    { key: "carb",    enzyme: "carbohydrase", color: "#6fa8ff" }, // 2 — sugars/polysaccharide, blue
  ];

  // Marine particle types — large solid aggregates (radii in px; the cell is ~10px long).
  // `mix` = [lipid, protein, carb] composition weights, matching each particle's real makeup.
  const PARTICLES = {
    marineSnow:  { label: "marine snow",     mix: [0.15, 0.30, 0.55], rMin: 120, rMax: 185, shape: "aggregate" },
    fecalPellet: { label: "fecal pellet",    mix: [0.28, 0.52, 0.20], rMin: 80,  rMax: 130, shape: "ellipse", squash: 0.6 },
    diatom:      { label: "diatom frustule", mix: [0.45, 0.30, 0.25], rMin: 90,  rMax: 140, shape: "ellipse", squash: 0.42, leavesShell: true },
    chitin:      { label: "chitin fragment", mix: [0.00, 0.30, 0.70], rMin: 90,  rMax: 150, shape: "shard" },
  };
  const PARTICLE_KEYS = Object.keys(PARTICLES);
  // which resource each kind is dominant in, and the reverse map (resource → kinds) — for keeping food of every type on the board
  const RES_KINDS = [[], [], []];
  for (const k of PARTICLE_KEYS) { const mix = PARTICLES[k].mix; let d = 0; for (let i = 1; i < 3; i++) if (mix[i] > mix[d]) d = i; RES_KINDS[d].push(k); }

  // ------------------------------------------------------------------- canvas
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const el = {
    energyFill: document.getElementById("energyFill"), energyTxt: document.getElementById("energyTxt"),
    gen: document.getElementById("gen"), score: document.getElementById("score"), colony: document.getElementById("colony"),
    title: document.getElementById("title"), over: document.getElementById("over"),
    overTitle: document.getElementById("overTitle"), overMsg: document.getElementById("overMsg"),
    startBtn: document.getElementById("startBtn"), restartBtn: document.getElementById("restartBtn"),
    enz: [document.getElementById("enz0"), document.getElementById("enz1"), document.getElementById("enz2")],
    abilChemo: document.getElementById("abilChemo"), abilCrispr: document.getElementById("abilCrispr"),
    enzTox: document.getElementById("enzTox"),
    chart: document.getElementById("chart"), legend: document.getElementById("chartlegend"),
    scores: document.getElementById("scores"), scoresList: document.getElementById("scoresList"),
    scoresKey: document.getElementById("scoresKey"), scoresTitle: document.getElementById("scoresTitle"),
    scoresBtn: document.getElementById("scoresBtn"), scoresBtn2: document.getElementById("scoresBtn2"),
    scoresBack: document.getElementById("scoresBack"),
    currentRun: document.getElementById("currentRun"), endGameBtn: document.getElementById("endGameBtn"),
    toast: document.getElementById("toast"),
    help: document.getElementById("help"), helpBtn: document.getElementById("helpBtn"), helpBack: document.getElementById("helpBack"),
    analysisChart: document.getElementById("analysisChart"), analysisStats: document.getElementById("analysisStats"),
    nameInput: document.getElementById("nameInput"),
    scoreDetail: document.getElementById("scoreDetail"), detailChart: document.getElementById("detailChart"),
    detailStats: document.getElementById("detailStats"), detailTitle: document.getElementById("detailTitle"),
    detailBack: document.getElementById("detailBack"),
  };
  const actx = el.analysisChart ? el.analysisChart.getContext("2d") : null;
  el.enz.forEach((e, i) => { if (e) e.style.color = RESOURCES[i].color; }); // colour labels once
  if (el.abilChemo) el.abilChemo.style.color = "#ffd24a"; // chemotaxis = gold
  if (el.abilCrispr) el.abilCrispr.style.color = "#c39bff"; // CRISPR = violet
  if (el.enzTox) el.enzTox.style.color = "#f05ad0"; // antibiotic = magenta
  const cctx = el.chart ? el.chart.getContext("2d") : null;

  // -------------------------------------------------------------------- audio
  const Audio = (() => {
    const files = { eat: "assets/sounds/sound_40.mp3", enzyme: "assets/sounds/sound_145.mp3",
      divide: "assets/sounds/sound_18.mp3", death: "assets/sounds/sound_42.mp3",
      hit: "assets/sounds/sound_146.mp3", spawn: "assets/sounds/sound_37.mp3" };
    let actx = null; const buffers = {};
    async function init() {
      if (actx) { if (actx.state === "suspended") actx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = new AC();
      await Promise.all(Object.entries(files).map(async ([n, url]) => {
        try { buffers[n] = await actx.decodeAudioData(await (await fetch(url)).arrayBuffer()); } catch (e) {}
      }));
    }
    function play(name, vol = 1) {
      if (!actx || !buffers[name]) return;
      const s = actx.createBufferSource(); s.buffer = buffers[name];
      const g = actx.createGain(); g.gain.value = vol; s.connect(g).connect(actx.destination); s.start();
    }
    return { init, play, ctx: () => actx };
  })();

  // Ambient generative music read off a real bacterial DNA sequence (a stretch of the
  // E. coli 16S rRNA gene) — the last item from the original game's wishlist. Each base
  // steps a note through a minor-pentatonic scale; a low drone + tape-echo give it the
  // "existential angst of a bacterium" mood.
  const Music = (() => {
    const DNA = "AAATTGAAGAGTTTGATCATGGCTCAGATTGAACGCTGGCGGCAGGCCTAACACATGCAAGTCGAACGGTAACAGGAAGAAGCTTGCTTCTTTGCTGACGAGTGGCGGACGGGTGAGTAATGTCTGGGAAACTGCCTGATGGAGGGGGATAACTACTGGAAACGGTAGCTAATACCGCATAACGTCGCAAGACCAAAGAGGGGGACCTTCGGGCCTCTTGCCATCGGATGTGCCCAGATGGGATTAGCTAGTAGGTGGGGTAACGGCTCACCTAGGCGACGATCCCTAGCTGGTCTGAGAGGATGACCAGCCACACTGGAACTGAGACACGGTCCAGACTCCTACGGGAGGCAGCAGTGGGGAATATTGCACAATGGGCGCAAGCCTGATGCAGCCATGCC";
    const BASE = { A: 0, C: 1, G: 2, T: 3 };
    const PENT = [0, 3, 5, 7, 10]; // minor pentatonic — moody
    const scale = [];
    for (let o = 0; o < 3; o++) for (const s of PENT) scale.push(110 * Math.pow(2, o + s/12)); // 3 octaves from A2
    const BEAT = 0.42;
    let ctx, master, delay, on = false, idx = 0, prev = 0, nextT = 0, timer = null, drone = [];

    function voice(freq, t, dur, vol) {
      const o = ctx.createOscillator(); o.type = "triangle"; o.frequency.value = freq;
      const f = ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol, t + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      o.connect(f); f.connect(g); g.connect(master); g.connect(delay);
      o.start(t); o.stop(t + dur + 0.1);
    }
    function schedule() {
      if (!on || !ctx) return;
      while (nextT < ctx.currentTime + 0.35) {
        const b = BASE[DNA[idx % DNA.length]] || 0;
        const note = scale[(b*4 + prev) % scale.length];
        voice(note, nextT, 0.9, 0.055);
        if (b === 2) voice(note*2, nextT + BEAT*0.5, 0.6, 0.028); // a sparkle on G
        prev = b; idx++; nextT += BEAT;
      }
      timer = setTimeout(schedule, 90);
    }
    function startDrone() {
      for (const fr of [55, 82.41]) { // A1 root + E2 fifth
        const o = ctx.createOscillator(); o.type = "sine"; o.frequency.value = fr;
        const g = ctx.createGain(); g.gain.value = 0.028;
        o.connect(g); g.connect(master); o.start(); drone.push(o);
      }
    }
    function start(audioCtx) {
      if (on || !audioCtx) return;
      ctx = audioCtx;
      master = ctx.createGain(); master.gain.value = 0.3; master.connect(ctx.destination);
      delay = ctx.createDelay(1.0); delay.delayTime.value = BEAT;
      const fb = ctx.createGain(); fb.gain.value = 0.3; delay.connect(fb); fb.connect(delay); delay.connect(master);
      on = true; nextT = ctx.currentTime + 0.15; startDrone(); schedule();
    }
    function toggle() {
      if (!ctx) return on;
      if (on) { on = false; if (timer) clearTimeout(timer); master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.15);
        for (const o of drone) { try { o.stop(); } catch (e) {} } drone = []; }
      else { on = true; master.gain.setTargetAtTime(0.3, ctx.currentTime, 0.3); nextT = ctx.currentTime + 0.1; startDrone(); schedule(); }
      return on;
    }
    return { start, toggle, playing: () => on };
  })();

  // -------------------------------------------------------------- environment
  const env = {
    tempC: 20, salinity: 35, viscosity: 1, diffusivity: 1, metabolismMult: 1,
    update() {
      const tv = 1.4 - this.tempC/40, sv = 0.6 + this.salinity/70*0.6;
      this.viscosity = clamp(tv*sv, 0.45, 1.9);
      this.diffusivity = clamp((this.tempC+5)/25 / (0.7 + this.salinity/120), 0.3, 2.4);
      this.metabolismMult = Math.pow(2, (this.tempC-20)/10);
    },
  };

  // ------------------------------------------------------------------- input
  const keys = {};
  addEventListener("keydown", (e) => {
    if (e.key === "?") { toggleHelp(); return; }
    if (e.key === "Escape") { if (helpOpen) { hideHelp(); return; } togglePause(); return; }
    if (e.key.toLowerCase() === "m") { Music.toggle(); return; } // toggle DNA music
    if (helpOpen || paused) return; // swallow gameplay input while a menu is up
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (e.key === " ") playerEnzyme();
    if (e.key.toLowerCase() === "x") cycleEnzyme();
  });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
  function axis() {
    let x = 0, y = 0;
    if (keys["a"]||keys["arrowleft"]) x -= 1; if (keys["d"]||keys["arrowright"]) x += 1;
    if (keys["w"]||keys["arrowup"]) y -= 1; if (keys["s"]||keys["arrowdown"]) y += 1;
    return { x, y };
  }

  // --------------------------------------------------------- helpers (torus)
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rand(a, b) { return a + Math.random()*(b-a); }
  function wrapX(v) { return ((v % WORLD_W) + WORLD_W) % WORLD_W; }
  function wrapY(v) { return ((v % WORLD_H) + WORLD_H) % WORLD_H; }
  function dWrap(a, b, size) { let d = a - b; if (d > size/2) d -= size; else if (d < -size/2) d += size; return d; }
  function dx(a, b) { return dWrap(a, b, WORLD_W); }
  function dy(a, b) { return dWrap(a, b, WORLD_H); }
  function toroDist2(ax, ay, bx, by) { const x = dx(ax, bx), y = dy(ay, by); return x*x + y*y; }
  function segDist(px, py, x1, y1, x2, y2) {
    const ex = x2-x1, ey = y2-y1, l2 = ex*ex + ey*ey || 1;
    let t = clamp(((px-x1)*ex + (py-y1)*ey)/l2, 0, 1);
    return Math.hypot(px - (x1+t*ex), py - (y1+t*ey));
  }
  function angleTo(from, to) { let d = to - from; while (d > Math.PI) d -= 2*Math.PI; while (d < -Math.PI) d += 2*Math.PI; return d; }

  // --------------------------------------------------------------- game state
  let state = null, cells = [], substrates = [], enzymes = [], toxins = [], nutrients = [],
      predators = [], phages = [], particles = [], flagPhase = 0, cam = { x: 0, y: 0 }, paused = false;

  function cellHalfLen(c) {
    return clamp(CFG.cell.baseHalf + Math.max(0, c.energy - CFG.cell.lenBaseEnergy)*CFG.cell.elongK,
                 CFG.cell.baseHalf, CFG.cell.maxHalf);
  }
  // cell poles in LOCAL coords relative to the cell centre (for torus-safe checks)
  function cellPolesLocal(c) {
    const hl = cellHalfLen(c) - CFG.cell.radius, ax = Math.cos(c.angle), ay = Math.sin(c.angle);
    return [ax*hl, ay*hl, -ax*hl, -ay*hl];
  }
  function cellDistTo(c, x, y) {
    const p = cellPolesLocal(c);
    return segDist(dx(x, c.x), dy(y, c.y), p[0], p[1], p[2], p[3]);
  }

  function makeCell(x, y, energy, angle, gen) {
    return { x: wrapX(x), y: wrapY(y), vx: 0, vy: 0, angle, energy, gen: gen || 1,
      controlled: false, alive: true, invuln: CFG.cell.invulnTime, cyst: false,
      tumbling: false, runTimer: rand(CFG.cell.runMin, CFG.cell.runMax), tumbleT: 0, tumbleTarget: angle,
      fed: 0, enzCd: rand(CFG.cell.enzymeCooldown[0], CFG.cell.enzymeCooldown[1]),
      infectedGreen: false, lysisT: 0, chemotaxis: false, chemoLevel: 0, crispr: false, antibiotic: 0,
      enzLvl: [0, 0, 1] }; // per-enzyme expression level [lipase, protease, carbohydrase]; 0 = locked, carb starts at 1
  }
  function ownedEnzymes(c) { const o = []; for (let i = 0; i < 3; i++) if (c.enzLvl[i] > 0) o.push(i); return o; }

  function makePhage(type, x, y, host) {
    const a = rand(0, 6.28), s = rand(4, 12);
    const lifeRange = type === "gold" ? CFG.phage.goldLife : CFG.phage.life; // gold lingers so it's reachable
    return { x: x == null ? rand(0, WORLD_W) : wrapX(x), y: y == null ? rand(0, WORLD_H) : wrapY(y),
      vx: Math.cos(a)*s, vy: Math.sin(a)*s, type, r: type === "gold" ? 4.5 : CFG.phage.radius,
      life: rand(lifeRange[0], lifeRange[1]), dead: false, stuck: false,
      host: type === "green" ? (host != null ? host : (Math.random()*3)|0) : 0 }; // adaptation tier this phage can infect
  }
  // "kill the winner": a phage only infects cells closely related to its host ecotype
  // kill-the-winner keyed to ADAPTATION LEVEL: a phage tracks the upgrade tier of the cell it lysed,
  // and infects only cells within hostTolerance tiers of it. Every upgrade you take shifts your tier,
  // so you can OUTRUN a virus cohort by upgrading (they turn green) until new phages evolve to your tier.
  function upgradeTier(c) { return (c.enzLvl[0] + c.enzLvl[1] + c.enzLvl[2] - 1) + c.chemoLevel + (c.crispr ? 1 : 0) + (c.antibiotic || 0); }
  function hostMatch(phHost, tier) { return Math.abs(phHost - tier) <= CFG.phage.hostTolerance; }

  // ----------------------------------------------------- destructible particle
  function shapeInside(spec, lx, ly, R, subs, seed) {
    if (spec.shape === "aggregate") {
      if (lx*lx + ly*ly > R*R) return false;
      for (const s of subs) if ((lx-s.x)**2 + (ly-s.y)**2 < s.r*s.r) return true;
      return false;
    }
    if (spec.shape === "ellipse") {
      const b = R*spec.squash; return (lx*lx)/(R*R) + (ly*ly)/(b*b) <= 1;
    }
    // shard: irregular radial polygon
    const ang = Math.atan2(ly, lx), rr = R*(0.72 + 0.26*Math.sin(ang*3 + seed) + 0.1*Math.sin(ang*7 + seed*2));
    return lx*lx + ly*ly <= rr*rr;
  }

  function powerLawSize() { // sample a particle radius from a Junge-like spectrum (PDF ∝ R^-sizeExp): many small, few large
    const S = CFG.substrate, a = S.sizeMin, b = S.sizeMax, p = S.sizeExp, u = Math.random();
    if (Math.abs(p - 1) < 1e-6) return a * Math.pow(b/a, u);
    const e = 1 - p, ae = Math.pow(a, e);
    return Math.pow(ae + u*(Math.pow(b, e) - ae), 1/e);
  }
  function pickBalancedKind(exclude) { // if a resource is below its floor, spawn a particle dominant in it; else random
    const have = [0, 0, 0];
    for (const p of substrates) if (p !== exclude && p.dom != null) have[p.dom]++;
    let need = -1, low = CFG.substrate.minPerRes;
    for (let r = 0; r < 3; r++) if (RES_KINDS[r].length && have[r] < low) { low = have[r]; need = r; }
    if (need >= 0) return RES_KINDS[need][(Math.random()*RES_KINDS[need].length)|0];
    return PARTICLE_KEYS[(Math.random()*PARTICLE_KEYS.length)|0];
  }
  function makeSubstrate(kind) {
    const k = kind || pickBalancedKind();
    const spec = PARTICLES[k];
    const R = powerLawSize(); // size follows a global power-law spectrum, independent of kind (which now sets shape + resource)
    const rot = rand(0, Math.PI*2), seed = rand(0, 100);
    const cs = CFG.grid.cs, n = Math.ceil(2*R/cs) + 2, half = n*cs/2;
    // sub-blob centres for aggregates
    const subs = [];
    if (spec.shape === "aggregate") for (let i = 0; i < 7; i++) {
      const a = rand(0, 6.28), d = rand(0, R*0.55); subs.push({ x: Math.cos(a)*d, y: Math.sin(a)*d, r: rand(0.3, 0.5)*R });
    }
    // patchy resource layout: Voronoi seeds so each resource forms blocks, not a
    // uniform per-voxel blend. Seed TYPES are allotted proportionally to the mix so
    // the particle reliably reads as its real composition despite Voronoi area noise.
    const nSeed = clamp(Math.round(R/16), 8, 18);
    const counts = [Math.round(spec.mix[0]*nSeed), Math.round(spec.mix[1]*nSeed), 0];
    counts[2] = Math.max(0, nSeed - counts[0] - counts[1]);
    const bag = [];
    for (let ti = 0; ti < 3; ti++) for (let k = 0; k < counts[ti]; k++) bag.push(ti);
    for (let i = bag.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; const tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp; }
    const rseeds = bag.map(() => ({ x: rand(-R, R), y: rand(-R, R), res: 0 }));
    for (let i = 0; i < rseeds.length; i++) rseeds[i].res = bag[i];

    const grid = new Float32Array(n*n);
    const gtype = new Uint8Array(n*n);
    const orgByType = [0, 0, 0];
    let solidCount = 0;
    const cr = Math.cos(-rot), sr = Math.sin(-rot);
    for (let gj = 0; gj < n; gj++) for (let gi = 0; gi < n; gi++) {
      const lx = (gi+0.5)*cs - half, ly = (gj+0.5)*cs - half;
      const rx = lx*cr - ly*sr, ry = lx*sr + ly*cr; // un-rotate into shape frame
      if (!shapeInside(spec, rx, ry, R, subs, seed)) continue;
      const idx = gj*n + gi; grid[idx] = 1; solidCount++;
      let best = 0, bd = Infinity;                 // nearest resource seed
      for (const rs of rseeds) { const d = (rx-rs.x)**2 + (ry-rs.y)**2; if (d < bd) { bd = d; best = rs.res; } }
      gtype[idx] = best; orgByType[best]++;
    }
    let dom = 0; for (let i = 1; i < 3; i++) if (orgByType[i] > orgByType[dom]) dom = i;
    const da = rand(0, 6.28), ds = rand(CFG.substrate.driftMin, CFG.substrate.driftMax);
    return { kind: k, spec, x: rand(0, WORLD_W), y: rand(0, WORLD_H), vx: Math.cos(da)*ds, vy: Math.sin(da)*ds,
      R, rot, seed, cs, n, half, grid, gtype, orgByType, dom, tint: RESOURCES[dom].color,
      organic: solidCount, organic0: solidCount, dirty: true, cache: null,
      age: 0, maxAge: rand(CFG.substrate.lifeMin, CFG.substrate.lifeMax), phase: "live",
      dissolveOrder: null, dissolveI: 0, dissolveAcc: 0, dissolveRate: 0 };
  }

  function solidAt(p, gi, gj) {
    if (gi < 0 || gi >= p.n || gj < 0 || gj >= p.n) return false;
    return p.grid[gj*p.n + gi] > 0;
  }

  // push a circle (world wx,wy,radius) out of a particle's solid voxels; returns {x,y} or null
  function pushCircleOut(p, wx, wy, radius) {
    const lx = dx(wx, p.x), ly = dy(wy, p.y);
    if (Math.abs(lx) > p.half + radius || Math.abs(ly) > p.half + radius) return null;
    const cs = p.cs, half = p.half, reach = radius + cs*0.5;
    const gi0 = Math.floor((lx + half - reach)/cs), gi1 = Math.floor((lx + half + reach)/cs);
    const gj0 = Math.floor((ly + half - reach)/cs), gj1 = Math.floor((ly + half + reach)/cs);
    let px = 0, py = 0, hit = false;
    for (let gj = gj0; gj <= gj1; gj++) for (let gi = gi0; gi <= gi1; gi++) {
      if (!solidAt(p, gi, gj)) continue;
      const clx = (gi+0.5)*cs - half, cly = (gj+0.5)*cs - half;
      const ex = lx - clx, ey = ly - cly, d = Math.hypot(ex, ey) || 0.001;
      const overlap = reach - d;
      if (overlap > 0) { px += ex/d*overlap; py += ey/d*overlap; hit = true; }
    }
    return hit ? { x: px, y: py } : null;
  }

  // resolve a moving circle against all particles: shift out and kill inward velocity
  function collideCircle(obj, radius) {
    for (const p of substrates) {
      const push = pushCircleOut(p, obj.x, obj.y, radius);
      if (!push) continue;
      const mag = Math.hypot(push.x, push.y) || 1;
      obj.x = wrapX(obj.x + push.x); obj.y = wrapY(obj.y + push.y);
      const nx = push.x/mag, ny = push.y/mag, vn = obj.vx*nx + obj.vy*ny;
      if (vn < 0) { obj.vx -= vn*nx; obj.vy -= vn*ny; }
    }
  }

  function makePredator(x, y, energy, age) {
    return { x: x == null ? rand(0, WORLD_W) : wrapX(x), y: y == null ? rand(0, WORLD_H) : wrapY(y),
      vx: 0, vy: 0, r: CFG.predator.radius, satiated: 0,
      heading: rand(0, 6.28), wobble: rand(0, 6.28), pseudo: rand(0, 6.28),
      age: age || 0, energy: energy == null ? CFG.predator.startEnergy : energy,
      lifespan: rand(CFG.predator.lifespan[0], CFG.predator.lifespan[1]),
      reproCd: CFG.predator.reproCooldown, toxT: 0, dead: false };
  }

  function newGame() {
    const first = makeCell(WORLD_W/2, WORLD_H/2, CFG.cell.startEnergy, -Math.PI/2, 1);
    first.controlled = true; cells = [first]; // start as a single founder cell
    substrates = [];
    for (let i = 0; i < CFG.substrate.count; i++) substrates.push(makeSubstrate());
    predators = [];
    for (let i = 0; i < CFG.predator.count; i++) {
      let x, y; // keep initial protists away from the lone founder
      do { x = rand(0, WORLD_W); y = rand(0, WORLD_H); } while (toroDist2(x, y, WORLD_W/2, WORLD_H/2) < 550*550);
      predators.push(makePredator(x, y, null, rand(0, 25)));
    }
    enzymes = []; toxins = []; nutrients = []; particles = [];
    phages = [];
    for (let i = 0; i < CFG.phage.greenCount; i++) { // seed OFFSCREEN so no virus is on the opening view — they diffuse in
      const a = rand(0, 6.28), d = Math.hypot(VIEW_W, VIEW_H)/2 + rand(80, 500);
      phages.push(makePhage("green", wrapX(first.x + Math.cos(a)*d), wrapY(first.y + Math.sin(a)*d)));
    }
    // first gold is spawned by the always-on-board respawn logic (same buried-in-particle rule)
    cam.x = first.x; cam.y = first.y;
    state = { gen: 1, score: 0, running: true, elapsed: 0, activeEnzyme: 2, // start with carbohydrase
      greenSeedT: rand(CFG.phage.greenSeed[0], CFG.phage.greenSeed[1]),
      predImmigrateT: CFG.predator.immigrateEvery,
      chartT: 0, history: [], fullT: 0, fullHist: [], fullInterval: 1, upgrades: [] };
    Audio.play("spawn", 0.5);
  }

  function controlledCell() { return cells.find((c) => c.controlled && c.alive); }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) { const a = rand(0, 6.28), s = rand(30, 120);
      particles.push({ x, y, vx: Math.cos(a)*s, vy: Math.sin(a)*s, life: rand(.3, .7), color }); }
  }

  // ------------------------------------------------------------------ actions
  function releaseEnzyme(c, res) {
    if (c.energy < CFG.cell.enzymeCost) return false;
    c.energy -= CFG.cell.enzymeCost;
    const p = cellPolesLocal(c);
    const maxR = CFG.enzyme.maxRadius * (1 + (c.enzLvl[res]-1)*CFG.cell.exprBoost); // this enzyme's expression → radius
    enzymes.push({ x: wrapX(c.x + p[0]), y: wrapY(c.y + p[1]), r: 4, life: CFG.enzyme.life, age: 0, res, maxR });
    return true;
  }
  const AB = 3; // antibiotic deployable id (0-2 are the enzymes)
  function ownedDeployables(c) { const o = ownedEnzymes(c); if (c.antibiotic > 0) o.push(AB); return o; }
  function playerEnzyme() {
    if (!state || !state.running) return;
    const c = controlledCell(); if (!c) return;
    if (!ownedDeployables(c).includes(state.activeEnzyme)) state.activeEnzyme = ownedDeployables(c)[0] ?? 2;
    if (state.activeEnzyme === AB) { if (releaseAntibiotic(c)) Audio.play("enzyme", 0.55); }
    else if (releaseEnzyme(c, state.activeEnzyme)) Audio.play("enzyme", 0.7);
  }
  function releaseAntibiotic(c) {
    if (c.antibiotic <= 0 || c.energy < CFG.cell.antibioticCost) return false;
    c.energy -= CFG.cell.antibioticCost;
    const p = cellPolesLocal(c), lvl = c.antibiotic;
    const maxR = CFG.toxin.maxRadius * (1 + (lvl-1)*CFG.toxin.radiusPer); // reach grows with level
    const tx = wrapX(c.x + p[0]), ty = wrapY(c.y + p[1]);
    toxins.push({ x: tx, y: ty, r: 4, life: CFG.toxin.life, age: 0, maxR, potency: CFG.toxin.potency*lvl });
    // instant dose to every protist caught in the release — the reliable "hit" (the cloud is lingering bonus)
    const dose = CFG.toxin.dose*lvl, rr = maxR*maxR;
    for (const pr of predators) if (toroDist2(tx, ty, pr.x, pr.y) <= rr) { pr.energy -= dose; pr.toxT = 0.5; }
    return true;
  }
  function cycleEnzyme() {
    if (!state || !state.running) return;
    const c = controlledCell(); if (!c) return;
    const owned = ownedDeployables(c); if (owned.length < 2) return; // nothing else to load
    const cur = owned.indexOf(state.activeEnzyme);
    state.activeEnzyme = owned[(cur + 1) % owned.length];
    Audio.play("eat", 0.3);
  }

  function divide(c) {
    if (cells.length >= CFG.cell.maxCells) return;
    const hl = cellHalfLen(c), ax = Math.cos(c.angle), ay = Math.sin(c.angle), e = c.energy/2, g = c.gen+1;
    const d1 = makeCell(c.x + ax*hl*0.5, c.y + ay*hl*0.5, e, c.angle + rand(-0.4, 0.4), g);
    const d2 = makeCell(c.x - ax*hl*0.5, c.y - ay*hl*0.5, e, c.angle + Math.PI + rand(-0.4, 0.4), g);
    d1.controlled = c.controlled; d1.invuln = d2.invuln = 1.2;
    // acquired genes (chemotaxis + enzyme repertoire) are heritable
    d1.chemotaxis = d2.chemotaxis = c.chemotaxis;
    d1.chemoLevel = d2.chemoLevel = c.chemoLevel;
    d1.crispr = d2.crispr = c.crispr;
    d1.antibiotic = d2.antibiotic = c.antibiotic;
    d1.enzLvl = c.enzLvl.slice(); d2.enzLvl = c.enzLvl.slice();
    if (c.infectedGreen) { d2.infectedGreen = true; d2.lysisT = c.lysisT; burst(c.x, c.y, "#7CFC5A", 8); } // virus segregates into one daughter; d1 (your lineage) stays clean
    cells.splice(cells.indexOf(c), 1, d1, d2);
    if (g > state.gen) state.gen = g;
    state.score += CFG.scorePerDivide;
    burst(c.x, c.y, "#ffd24a", 14);
    if (c.controlled) Audio.play("divide", 0.7);
  }

  function cellStrength(c) { return (c.enzLvl[0]+c.enzLvl[1]+c.enzLvl[2]-1) + c.chemoLevel + (c.crispr ? 2 : 0) + c.energy*0.01; }
  function transferControl(c) {
    const others = cells.filter((o) => o.alive && o !== c);
    if (!others.length) return;
    // take over your most-evolved surviving cell, not just the nearest
    let best = others[0], bs = -Infinity;
    for (const o of others) { const s = cellStrength(o); if (s > bs) { bs = s; best = o; } }
    best.controlled = true; best.invuln = Math.max(best.invuln, 1.2);
    if (best.cyst) { best.cyst = false; best.energy = Math.max(best.energy, CFG.cell.cystReviveEnergy); } // resuscitate a cyst
    Audio.play("hit", 0.8);
  }
  function releaseGreenPhages(c) {
    const n = Math.floor(rand(CFG.phage.burst[0], CFG.phage.burst[1] + 1)), host = upgradeTier(c); // progeny track this host's adaptation tier
    for (let i = 0; i < n && phages.length < CFG.phage.maxCount; i++) phages.push(makePhage("green", c.x, c.y, host));
    burst(c.x, c.y, "#7CFC5A", 12);
    if (c.controlled) Audio.play("hit", 0.7);
  }
  // all cell deaths funnel through here so infected hosts always lyse into phages
  function onCellDeath(c, cause) {
    c.alive = false;
    if (c.infectedGreen) releaseGreenPhages(c);
    burst(c.x, c.y, cause === "predator" ? "#ff7a6b" : cause === "lysis" ? "#7CFC5A" : "#9fb0aa", 18);
    if (c.controlled) transferControl(c);
  }
  function killCell(c, byPredator) {
    if (!c.alive || c.invuln > 0) return;
    onCellDeath(c, byPredator ? "predator" : "starve");
  }

  // Shared annotated renderer: the run's ecotype chart + vertical markers where each upgrade happened.
  // Used by the game-over screen (live state) and by the high-score detail view (a saved record).
  function annotateRun(g, W, H, hist, upgrades, dur) {
    renderEcoChart(g, W, H, hist);
    if (!upgrades || !upgrades.length) return;
    const d = Math.max(1, dur), fs = H > 150 ? 11 : 9, rows = H > 150 ? 4 : 3;
    for (const u of upgrades) { // bright vertical line for gene acquisitions, faint for level-ups
      const x = clamp(u.t/d, 0, 1)*W;
      g.globalAlpha = u.acquired ? 0.95 : 0.28; g.strokeStyle = u.color; g.lineWidth = u.acquired ? 1.6 : 1;
      g.beginPath(); g.moveTo(x, fs + 2); g.lineTo(x, H - 2); g.stroke();
    }
    g.globalAlpha = 1; g.font = fs + "px 'Trebuchet MS', sans-serif"; g.textAlign = "center";
    upgrades.forEach((u, k) => {                       // abbreviated tags: C/L/P/T/Ab + level, staggered rows
      const x = clamp(u.t/d, 0, 1)*W;
      g.globalAlpha = u.acquired ? 1 : 0.65; g.fillStyle = u.color;
      g.fillText(u.abbr, clamp(x, 12, W-12), fs - 1 + (k % rows)*(fs + 1));
    });
    g.globalAlpha = 1;
  }
  function runStatsHtml(hist, upgrades) {
    let peakCol = 0, peakP = 0, peakV = 0;
    for (const s of hist) { let t = 0; for (let i = 0; i < 8; i++) t += s.eco[i]; if (t > peakCol) peakCol = t; if (s.p > peakP) peakP = s.p; if ((s.v||0) > peakV) peakV = s.v; }
    return `<b>${upgrades ? upgrades.length : 0}</b> adaptations · peak colony <b>${peakCol}</b> · peak protists <b>${peakP}</b> · peak viruses <b>${peakV}</b>`;
  }
  function drawAnalysis() {
    if (!actx || !state) return;
    annotateRun(actx, el.analysisChart.width, el.analysisChart.height, state.fullHist, state.upgrades, state.elapsed);
    if (el.analysisStats) el.analysisStats.innerHTML = runStatsHtml(state.fullHist, state.upgrades);
  }
  function gameOver() {
    state.running = false;
    recordGame();
    el.overTitle.textContent = "Extinction!";
    el.overMsg.innerHTML = `Your lineage reached <b>generation ${state.gen}</b> with a final score of <b>${Math.round(state.score)}</b>.`;
    drawAnalysis();
    if (el.nameInput) el.nameInput.value = playerName; // prefill with the remembered name
    Audio.play("death", 0.9);
    setTimeout(() => el.over.classList.remove("hidden"), 400);
  }
  function setPlayerName(val) { // remember the name, and stamp it onto the run just recorded
    playerName = (val || "").slice(0, 18);
    try { localStorage.setItem(NAME_KEY, playerName); } catch (e) {}
    if (justFinishedTs != null) try {
      const arr = loadScores(), rec = arr.find((r) => r.date === justFinishedTs);
      if (rec) { rec.name = playerName; localStorage.setItem(HS_KEY, JSON.stringify(arr)); }
    } catch (e) {}
    if (lastRec) { lastRec.name = playerName; submitScore(lastRec); } // update the shared leaderboard entry (upsert by id)
  }

  // ------------------------------------------------------------------- update
  function update(dt) {
    if (!state || !state.running) return;
    state.elapsed += dt; env.update();
    for (const c of cells) if (c.alive) updateCell(c, dt);
    // dividing before lysis lets a cell shed the virus into one daughter and escape clean
    for (const c of cells) if (c.alive && c.energy >= CFG.cell.divideThreshold) divide(c);
    const hadControlled = cells.some((c) => c.controlled && c.alive);
    cells = cells.filter((c) => c.alive);
    if (!cells.length) { gameOver(); return; }
    if (!hadControlled && !cells.some((c) => c.controlled)) cells[0].controlled = true;
    // particle lifecycle: drift slowly; when fully eaten or past its lifespan, respawn
    // (past-lifespan particles erode away voxel-by-voxel rather than vanishing)
    for (const s of substrates) {
      s.x = wrapX(s.x + s.vx*dt); s.y = wrapY(s.y + s.vy*dt);
      if (s.phase === "live") {
        s.age += dt;
        if (s.organic <= 0) { recycleSubstrate(s); continue; }
        if (s.age >= s.maxAge) startDissolve(s);
      } else {                                   // dissolving — erode a chunk of voxels per second
        s.dissolveAcc += s.dissolveRate*dt;
        while (s.dissolveAcc >= 1 && s.dissolveI < s.dissolveOrder.length) {
          s.dissolveAcc -= 1; const idx = s.dissolveOrder[s.dissolveI++];
          if (s.grid[idx] > 0) { s.orgByType[s.gtype[idx]]--; s.grid[idx] = 0; s.organic--; s.dirty = true; }
        }
        if (s.organic <= 0 || s.dissolveI >= s.dissolveOrder.length) recycleSubstrate(s);
      }
    }
    updateEnzymes(dt); updateToxins(dt); updateNutrients(dt); updatePredators(dt); updatePhages(dt);
    for (const q of particles) { q.x += q.vx*dt; q.y += q.vy*dt; q.vx *= 0.9; q.vy *= 0.9; q.life -= dt; }
    particles = particles.filter((q) => q.life > 0);
    // camera follows the controlled cell
    const pc = controlledCell(); if (pc) { cam.x = pc.x; cam.y = pc.y; }
    // sample per-ecotype abundances for the time-series chart
    const greenCount = phages.reduce((a, p) => a + (p.type === "green"), 0);
    state.chartT -= dt;
    if (state.chartT <= 0) {
      state.chartT = CHART.interval;
      const s = ecoSample();
      state.history.push({ eco: s.eco, buckets: s.buckets, p: predators.length, v: greenCount });
      if (state.history.length > CHART.samples) state.history.shift();
      updateLegend(s.eco, predators.length, greenCount);
    }
    // full-game log for the high-score record — whole arc, coarser, decimated when long
    state.fullT -= dt;
    if (state.fullT <= 0) {
      state.fullT = state.fullInterval;
      const fs = ecoSample();
      state.fullHist.push({ eco: fs.eco, buckets: fs.buckets, p: predators.length, v: greenCount });
      if (state.fullHist.length > 600) { state.fullHist = state.fullHist.filter((_, i) => i % 2 === 0); state.fullInterval *= 2; }
    }
    flagPhase += dt*12;
  }

  function updateCell(c, dt) {
    const visc = env.viscosity;
    // a phage can't complete its lytic cycle in a dormant cyst — the timer pauses there
    if (c.infectedGreen && !c.cyst) { c.lysisT -= dt; if (c.lysisT <= 0) { onCellDeath(c, "lysis"); return; } }
    // encystment: a starving AUTONOMOUS cell forms a resistant cyst (the player never does)
    if (c.controlled) c.cyst = false;
    else if (c.cyst && c.energy >= CFG.cell.cystWake) c.cyst = false;
    else if (!c.cyst && c.energy <= CFG.cell.cystBelow) c.cyst = true;

    if (c.controlled) {
      const a = axis();
      if (a.x !== 0 || a.y !== 0) {
        c.tumbling = false; const len = Math.hypot(a.x, a.y); c.angle = Math.atan2(a.y, a.x);
        const th = CFG.cell.thrust/visc; c.vx += (a.x/len)*th*dt; c.vy += (a.y/len)*th*dt;
        c.energy -= CFG.cell.swimCost*dt;
      } else { c.tumbling = true; c.angle += Math.sin(state.elapsed*3 + c.x)*CFG.cell.playerTumbleTurn*dt; }
    } else autonomousMove(c, dt);

    const drag = Math.exp(-2.2*visc*dt); c.vx *= drag; c.vy *= drag;
    const sp = Math.hypot(c.vx, c.vy), vmax = CFG.cell.maxSpeed/Math.sqrt(visc);
    if (sp > vmax) { c.vx = c.vx/sp*vmax; c.vy = c.vy/sp*vmax; }
    c.x = wrapX(c.x + c.vx*dt); c.y = wrapY(c.y + c.vy*dt);

    // collide the rod against solid particles at both poles and the centre
    const pl = cellPolesLocal(c);
    const pts = [[c.x + pl[0], c.y + pl[1]], [c.x, c.y], [c.x + pl[2], c.y + pl[3]]];
    for (const [sx, sy] of pts) {
      const probe = { x: sx, y: sy, vx: c.vx, vy: c.vy };
      collideCircle(probe, CFG.cell.radius);
      c.x = wrapX(c.x + (probe.x - sx)); c.y = wrapY(c.y + (probe.y - sy));
      c.vx = probe.vx; c.vy = probe.vy;
    }

    const sizeF = cellHalfLen(c)/CFG.cell.baseHalf;
    const metab = c.cyst ? CFG.cell.cystMetab : 1;
    c.energy -= CFG.respirationBase*env.metabolismMult*sizeF*metab*dt;
    if (c.invuln > 0) c.invuln -= dt;
    if (c.energy <= 0) { c.energy = 0; killCell(c, false); return; }
    c.energy = Math.min(c.energy, CFG.cell.maxEnergy);

    const reach = CFG.cell.radius + CFG.cell.uptake + CFG.nutrient.radius;
    for (const nnn of nutrients) {
      if (nnn.dead) continue;
      if (cellDistTo(c, nnn.x, nnn.y) < reach) {
        nnn.dead = true; c.energy += CFG.substrate.moteEnergy; c.fed = CFG.cell.fedLinger;
        state.score += CFG.substrate.moteEnergy*CFG.scorePerEnergy;
        if (c.controlled) Audio.play("eat", 0.4);
      }
    }
  }

  function nearestOrganicSub(c, range) {
    let best = null, bd = range*range;
    for (const s of substrates) { if (s.organic <= 0) continue; const d = toroDist2(c.x, c.y, s.x, s.y); if (d < bd) { bd = d; best = s; } }
    return best;
  }
  function autonomousMove(c, dt) {
    const visc = env.viscosity;
    if (c.cyst) { const D = env.diffusivity*CFG.cell.cystDiffuse; c.vx += rand(-D, D)*dt; c.vy += rand(-D, D)*dt; return; } // cysts drift passively
    if (c.fed > 0) c.fed -= dt;
    const fedF = c.fed > 0 ? 0.4 : 1;
    // chemotaxis: bias toward nearest food-bearing particle; sensitivity grows with chemoLevel
    let desired = null, chemoTurn = 0;
    if (c.chemotaxis) {
      const range = CFG.cell.chemoRange0 + c.chemoLevel*CFG.cell.chemoRangePer;
      chemoTurn = CFG.cell.chemoTurn0 + c.chemoLevel*CFG.cell.chemoTurnPer;
      const s = nearestOrganicSub(c, range); if (s) desired = Math.atan2(dy(s.y, c.y), dx(s.x, c.x));
    }
    if (c.tumbling) {
      c.angle += clamp(angleTo(c.angle, c.tumbleTarget), -CFG.cell.tumbleTurn*dt, CFG.cell.tumbleTurn*dt);
      c.tumbleT -= dt;
      if (c.tumbleT <= 0) { c.tumbling = false; c.runTimer = rand(CFG.cell.runMin, CFG.cell.runMax)*(c.fed > 0 ? 0.4 : 1); }
    } else {
      if (desired != null) c.angle += clamp(angleTo(c.angle, desired), -chemoTurn*dt, chemoTurn*dt); // steer up-gradient
      const th = CFG.cell.thrust/visc*fedF;
      c.vx += Math.cos(c.angle)*th*dt; c.vy += Math.sin(c.angle)*th*dt;
      c.energy -= CFG.cell.swimCost*fedF*dt; c.runTimer -= dt;
      if (c.runTimer <= 0) {
        c.tumbling = true; c.tumbleT = CFG.cell.tumbleDur;
        c.tumbleTarget = desired != null ? desired + rand(-0.6, 0.6) : c.angle + rand(-Math.PI, Math.PI);
      }
    }
    c.enzCd -= dt;
    if (c.enzCd <= 0) {
      c.enzCd = rand(CFG.cell.enzymeCooldown[0], CFG.cell.enzymeCooldown[1]);
      let near = null, bd = Infinity;
      for (const s of substrates) { if (s.organic <= 0) continue; const d = toroDist2(c.x, c.y, s.x, s.y); if (d < (s.R + 30)**2 && d < bd) { bd = d; near = s; } }
      if (near && c.energy > CFG.cell.enzymeCost*2.2) {
        // dominant remaining resource this cell can actually digest
        let res = -1;
        for (let i = 0; i < 3; i++) if (c.enzLvl[i] > 0 && near.orgByType[i] > 0 && (res < 0 || near.orgByType[i] > near.orgByType[res])) res = i;
        if (res >= 0) releaseEnzyme(c, res);
      }
    }
  }

  function updateEnzymes(dt) {
    for (const z of enzymes) {
      z.age += dt; z.life -= dt;
      const grow = Math.min(1, z.age/CFG.enzyme.growTime);
      z.r = (z.maxR || CFG.enzyme.maxRadius)*grow*(0.6 + 0.4*clamp(z.life/CFG.enzyme.life, 0, 1));
      // carve overlapping solid voxels into dissolved nutrient motes
      for (const p of substrates) {
        if (p.organic <= 0) continue;
        const lx = dx(z.x, p.x), ly = dy(z.y, p.y);
        if (Math.abs(lx) > p.half + z.r || Math.abs(ly) > p.half + z.r) continue;
        const cs = p.cs, half = p.half;
        const gi0 = Math.max(0, Math.floor((lx+half-z.r)/cs)), gi1 = Math.min(p.n-1, Math.floor((lx+half+z.r)/cs));
        const gj0 = Math.max(0, Math.floor((ly+half-z.r)/cs)), gj1 = Math.min(p.n-1, Math.floor((ly+half+z.r)/cs));
        const r2 = z.r*z.r;
        for (let gj = gj0; gj <= gj1; gj++) for (let gi = gi0; gi <= gi1; gi++) {
          const idx = gj*p.n + gi; if (p.grid[idx] <= 0) continue;
          if (p.gtype[idx] !== z.res) continue; // this enzyme only dissolves its resource
          const clx = (gi+0.5)*cs - half, cly = (gj+0.5)*cs - half;
          if ((clx-lx)**2 + (cly-ly)**2 > r2) continue;
          p.grid[idx] -= CFG.substrate.carveRate*dt; p.dirty = true;
          if (p.grid[idx] <= 0) {
            p.grid[idx] = 0; p.organic--; p.orgByType[z.res]--;
            if (nutrients.length < CFG.nutrient.maxCount) {
              const wx = wrapX(p.x + clx), wy = wrapY(p.y + cly), a = rand(0, 6.28);
              nutrients.push({ x: wx, y: wy, vx: Math.cos(a)*rand(3, 10), vy: Math.sin(a)*rand(3, 10), life: CFG.nutrient.life, dead: false, res: z.res });
            }
            // when fully consumed the lifecycle sweep respawns it (drifting in from offscreen)
          }
        }
      }
    }
    enzymes = enzymes.filter((z) => z.life > 0);
  }
  function updateToxins(dt) { // antibiotic clouds drain the energy of any protist inside them → they starve
    const P = CFG.toxin;
    for (const z of toxins) {
      z.age += dt; z.life -= dt;
      const grow = Math.min(1, z.age/P.growTime);
      z.r = z.maxR*grow*(0.6 + 0.4*clamp(z.life/P.life, 0, 1));
      const r2 = z.r*z.r;
      for (const pr of predators) if (toroDist2(z.x, z.y, pr.x, pr.y) <= r2) { pr.energy -= z.potency*dt; pr.toxT = 0.5; } // mark recently poisoned → death here counts as a KILL
    }
    toxins = toxins.filter((z) => z.life > 0);
  }

  function startDissolve(p) {
    const order = [];
    for (let i = 0; i < p.grid.length; i++) if (p.grid[i] > 0) order.push(i);
    for (let i = order.length - 1; i > 0; i--) { const j = (Math.random()*(i+1))|0; const t = order[i]; order[i] = order[j]; order[j] = t; }
    p.dissolveOrder = order; p.dissolveI = 0; p.dissolveAcc = 0;
    p.dissolveRate = Math.max(1, order.length / CFG.substrate.dissolveTime);
    p.phase = "dissolving";
  }
  function recycleSubstrate(p) {
    // don't strand an embedded gold phage — carry it off so a fresh one respawns in a new particle
    for (const ph of phages) if (ph.type === "gold" && toroDist2(ph.x, ph.y, p.x, p.y) < p.R*p.R) ph.dead = true;
    Object.assign(p, makeSubstrate(pickBalancedKind(p))); // keep every resource above its floor as particles cycle
    // reborn offscreen, drifting into the play area so it eases into view instead of popping in
    const a = rand(0, 6.28), dist = Math.hypot(VIEW_W, VIEW_H)/2 + p.half + 140, spd = rand(CFG.substrate.driftMin, CFG.substrate.driftMax);
    p.x = wrapX(cam.x + Math.cos(a)*dist); p.y = wrapY(cam.y + Math.sin(a)*dist);
    p.vx = -Math.cos(a)*spd; p.vy = -Math.sin(a)*spd;
  }

  function updateNutrients(dt) {
    const D = env.diffusivity*7;
    for (const n of nutrients) {
      if (n.dead) continue;
      n.vx += rand(-D, D)*dt; n.vy += rand(-D, D)*dt; n.vx *= 0.95; n.vy *= 0.95;
      n.x = wrapX(n.x + n.vx*dt); n.y = wrapY(n.y + n.vy*dt);
      n.life -= dt; if (n.life <= 0) n.dead = true;
    }
    nutrients = nutrients.filter((n) => !n.dead);
  }

  function releaseBiomass(pr) { // an antibiotic-killed protist bursts into edible nutrient motes
    burst(pr.x, pr.y, TOXIN_COLOR, 14);
    for (let i = 0; i < CFG.predator.killMotes && nutrients.length < CFG.nutrient.maxCount; i++) {
      const a = rand(0, 6.28), sp = rand(12, 34);
      nutrients.push({ x: wrapX(pr.x + Math.cos(a)*rand(2, pr.r)), y: wrapY(pr.y + Math.sin(a)*rand(2, pr.r)),
        vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: CFG.nutrient.life, dead: false, res: null });
    }
  }
  function updatePredators(dt) {
    const P = CFG.predator, newborns = [];
    for (const pr of predators) {
      pr.age += dt;
      pr.energy -= P.metabolism*dt;      // grazing metabolism
      if (pr.reproCd > 0) pr.reproCd -= dt;
      if (pr.toxT > 0) pr.toxT -= dt;
      if (pr.satiated > 0) pr.satiated -= dt;
      const hunting = pr.satiated <= 0;
      let target = null, td = P.senseRange**2;
      if (hunting) for (const c of cells) { if (!c.alive || c.cyst) continue; const d = toroDist2(pr.x, pr.y, c.x, c.y); if (d < td) { td = d; target = c; } }
      // no active prey in range → drift toward the nearest cyst bank to graze it
      if (hunting && !target) for (const c of cells) { if (!c.alive || !c.cyst) continue; const d = toroDist2(pr.x, pr.y, c.x, c.y); if (d < td) { td = d; target = c; } }
      if (target) pr.heading = Math.atan2(dy(target.y, pr.y), dx(target.x, pr.x));
      else { pr.wobble += dt; pr.heading += Math.sin(pr.wobble*1.7)*dt*2; }
      const base = target ? P.chaseSpeed : P.wanderSpeed;
      const spd = (hunting ? base : base*0.5)/Math.sqrt(env.viscosity);
      pr.vx = Math.cos(pr.heading)*spd; pr.vy = Math.sin(pr.heading)*spd;
      pr.x = wrapX(pr.x + pr.vx*dt); pr.y = wrapY(pr.y + pr.vy*dt);
      collideCircle(pr, pr.r); // protists are too big to enter tunnels
      pr.pseudo += dt*4;
      if (hunting) for (const c of cells) {
        if (!c.alive || c.invuln > 0 || cellDistTo(c, pr.x, pr.y) >= pr.r + CFG.cell.radius*0.6) continue;
        if (c.cyst && Math.random() >= P.cystEatChance*dt) continue; // tough cyst usually resists a bump
        {
          pr.energy += c.cyst ? P.mealEnergy*P.cystMealFactor : P.mealEnergy;
          killCell(c, true); pr.satiated = P.satiatedTime; break;
        }
      }
      // reproduction: a mature, well-fed protist divides (population capped)
      if (pr.age > P.maturity && pr.energy >= P.reproEnergy && pr.reproCd <= 0 &&
          predators.length + newborns.length < P.safetyMax) {
        pr.energy /= 2; pr.reproCd = P.reproCooldown;
        const off = makePredator(pr.x + rand(-24, 24), pr.y + rand(-24, 24), pr.energy, 0);
        newborns.push(off);
        burst(pr.x, pr.y, "#ff9ec0", 10);
      }
      // death: antibiotic KILL (energy gone while poisoned) releases biomass as food; natural death (senescence/starvation) releases nothing
      if (pr.age >= pr.lifespan || pr.energy <= 0) {
        pr.dead = true;
        if (pr.energy <= 0 && pr.toxT > 0) releaseBiomass(pr);
        else burst(pr.x, pr.y, "#b9a9b0", 8); // natural death — inert grey puff
      }
    }
    if (newborns.length || predators.some((p) => p.dead))
      predators = predators.filter((p) => !p.dead).concat(newborns);
    // immigration floor: a fresh protist drifts in if the population has crashed
    state.predImmigrateT -= dt;
    if (state.predImmigrateT <= 0) {
      state.predImmigrateT = CFG.predator.immigrateEvery;
      if (predators.length < CFG.predator.minCount) {
        let x, y; const pc = controlledCell();
        do { x = rand(0, WORLD_W); y = rand(0, WORLD_H); } while (pc && toroDist2(x, y, pc.x, pc.y) < 500*500);
        predators.push(makePredator(x, y, null, rand(0, 20)));
      }
    }
  }

  function phageInSolid(ph) { // is this phage sitting inside a particle's solid matrix?
    for (const p of substrates) {
      if (p.organic <= 0) continue;
      const lx = dx(ph.x, p.x), ly = dy(ph.y, p.y);
      if (Math.abs(lx) > p.half || Math.abs(ly) > p.half) continue;
      if (solidAt(p, Math.floor((lx + p.half)/p.cs), Math.floor((ly + p.half)/p.cs))) return true;
    }
    return false;
  }
  function updatePhages(dt) {
    const D = env.diffusivity*CFG.phage.diffuse;
    for (const ph of phages) {
      if (ph.type === "green") {
        // green phages never decay — they diffuse until they stick to a particle and wait
        ph.stuck = phageInSolid(ph);
        if (!ph.stuck) { ph.vx += rand(-D, D)*dt; ph.vy += rand(-D, D)*dt; ph.vx *= 0.96; ph.vy *= 0.96;
          ph.x = wrapX(ph.x + ph.vx*dt); ph.y = wrapY(ph.y + ph.vy*dt); }
        else { ph.vx = ph.vy = 0; }
      } else {                                          // gold holds its drift (stays with its host particle)
        ph.x = wrapX(ph.x + ph.vx*dt); ph.y = wrapY(ph.y + ph.vy*dt);
        ph.life -= dt; if (ph.life <= 0) { ph.dead = true; continue; }
      }
      // adsorb to the first cell it contacts
      const infectDist = CFG.cell.radius + ph.r + CFG.phage.infectHalo;
      for (const c of cells) {
        if (!c.alive || c.cyst) continue;            // cysts are impervious to viruses
        const hl = cellHalfLen(c) + ph.r + CFG.phage.infectHalo + 2;
        if (toroDist2(ph.x, ph.y, c.x, c.y) > hl*hl) continue;
        if (cellDistTo(c, ph.x, ph.y) > infectDist) continue;
        if (ph.type === "green") {
          if (c.infectedGreen) continue;             // already infected — drift on
          if (!hostMatch(ph.host, upgradeTier(c))) { // kill-the-winner: this phage can't infect this cell's tier
            if (c.crispr) { c.energy = Math.min(c.energy + CFG.cell.crisprEnergy, CFG.cell.maxEnergy); ph.dead = true; break; } // CRISPR harvests the immune virus for energy
            continue;
          }
          c.infectedGreen = true; c.lysisT = rand(CFG.phage.latent[0], CFG.phage.latent[1]);
          ph.dead = true;
        } else {                                     // gold: transduce a random upgrade
          // one option per enzyme (acquire it if locked, else level up its expression)
          // + chemotaxis; genes aren't guaranteed each time so runs skew per-skill
          const pool = ["chemo", "enz0", "enz1", "enz2", "antibiotic"];
          if (!c.crispr) pool.push("crispr");           // one-time: phage-immune-harvesting defense system
          const pick = pool[(Math.random()*pool.length)|0];
          let msg, color, acquired, abbr;
          if (pick === "crispr") {
            c.crispr = true; acquired = true; msg = "CRISPR"; color = CRISPR_COLOR; abbr = "Cr";
          } else if (pick === "antibiotic") {
            acquired = c.antibiotic === 0; c.antibiotic++;
            msg = "Antibiotic " + c.antibiotic; color = TOXIN_COLOR; abbr = "Ab" + c.antibiotic;
          } else if (pick === "chemo") {
            acquired = !c.chemotaxis;
            if (acquired) { c.chemotaxis = true; c.chemoLevel = 1; } else c.chemoLevel++;
            msg = "Chemotaxis " + c.chemoLevel; color = "#ffd24a"; abbr = "T" + c.chemoLevel; // T = chemoTaxis
          } else {
            const i = +pick[3]; c.enzLvl[i]++; acquired = c.enzLvl[i] === 1; // 0→1 = newly acquired gene
            const name = RESOURCES[i].enzyme;
            msg = name[0].toUpperCase() + name.slice(1) + " " + c.enzLvl[i]; color = RESOURCES[i].color;
            abbr = ["L", "P", "C"][i] + c.enzLvl[i]; // Lipase / Protease / Carbohydrase
          }
          ph.dead = true;
          burst(c.x, c.y, "#ffd24a", 16);
          if (c.controlled) {
            Audio.play("spawn", 0.6); showUpgradeToast(msg, color);
            state.upgrades.push({ t: state.elapsed, label: msg, abbr, color, acquired });
          }
        }
        break;
      }
    }
    phages = phages.filter((p) => !p.dead);
    if (phages.length > CFG.phage.maxCount) phages.length = CFG.phage.maxCount;
    // background viral reservoir: when green phage runs low, seed one OFFSCREEN (it diffuses in — never pops into view)
    state.greenSeedT -= dt;
    if (state.greenSeedT <= 0) {
      state.greenSeedT = rand(CFG.phage.greenSeed[0], CFG.phage.greenSeed[1]);
      const green = phages.reduce((a, p) => a + (p.type === "green"), 0);
      if (cells.length && green < CFG.phage.greenFloor && phages.length < CFG.phage.maxCount) {
        const a = rand(0, 6.28), d = Math.hypot(VIEW_W, VIEW_H)/2 + rand(80, 400);
        const rc = cells[(Math.random()*cells.length)|0]; // reservoir tracks a random colony member's tier (±1 drift)
        const host = Math.max(0, upgradeTier(rc) + ((Math.random()*3)|0) - 1);
        phages.push(makePhage("green", cam.x + Math.cos(a)*d, cam.y + Math.sin(a)*d, host));
      }
    }
    // always keep one gold phage on the board — respawns the instant one is used,
    // usually buried inside a distant particle so you have to dig it out
    if (!phages.some((p) => p.type === "gold") && phages.length < CFG.phage.maxCount) {
      const pc = controlledCell();
      const owned = pc ? ownedEnzymes(pc) : [2]; // resources this cell can dig through
      let gx, gy, host = null, placed = false;
      if (Math.random() < 0.75 && substrates.length) {
        // embed it in a distant particle, in a voxel of a resource the cell can actually eat
        for (let k = 0; k < 14 && !placed; k++) {
          const p = substrates[(Math.random()*substrates.length)|0];
          if (p.phase !== "live") continue;
          if (pc && toroDist2(p.x, p.y, pc.x, pc.y) <= 650*650) continue;
          if (!owned.some((r) => p.orgByType[r] > 0)) continue;
          const cs = p.cs, half = p.half, inner = [], outer = [];
          for (let gj = 0; gj < p.n; gj++) for (let gi = 0; gi < p.n; gi++) {
            const idx = gj*p.n + gi;
            if (p.grid[idx] <= 0 || owned.indexOf(p.gtype[idx]) < 0) continue;
            const lx = (gi+0.5)*cs - half, ly = (gj+0.5)*cs - half;
            (lx*lx + ly*ly > (0.45*p.R)**2 ? outer : inner).push([lx, ly]); // prefer reachable outer voxels
          }
          const pool = outer.length ? outer : inner; if (!pool.length) continue;
          const v = pool[(Math.random()*pool.length)|0];
          gx = wrapX(p.x + v[0]); gy = wrapY(p.y + v[1]); host = p; placed = true;
        }
      }
      if (!placed) {                                          // open water, well away
        const a = rand(0, 6.28), d = rand(700, 1200);
        gx = pc ? pc.x + Math.cos(a)*d : rand(0, WORLD_W);
        gy = pc ? pc.y + Math.sin(a)*d : rand(0, WORLD_H);
      }
      const goldPh = makePhage("gold", gx, gy);
      if (host) { goldPh.vx = host.vx; goldPh.vy = host.vy; } // drift along with its host particle
      phages.push(goldPh);
    }
  }

  // ------------------------------------------------------------------- render
  // world -> screen (nearest wrapped image to the camera)
  function sx(wx) { return VIEW_W/2 + dx(wx, cam.x); }
  function sy(wy) { return VIEW_H/2 + dy(wy, cam.y); }
  const onScreen = (x, y, m) => x > -m && x < VIEW_W + m && y > -m && y < VIEW_H + m;

  function draw() {
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    drawWater();
    for (const p of substrates) drawSubstrate(p);
    for (const z of enzymes) drawEnzyme(z);
    for (const z of toxins) drawToxin(z);
    for (const n of nutrients) drawNutrient(n);
    for (const q of particles) drawParticle(q);
    for (const ph of phages) drawPhage(ph);
    for (const pr of predators) drawPredator(pr);
    for (const c of cells) drawCell(c);
    drawMinimap();
  }

  const waterDots = Array.from({ length: 70 }, () => ({ x: Math.random()*VIEW_W, y: Math.random()*VIEW_H, r: Math.random()*2 + 0.5 }));
  function drawWater() {
    ctx.save(); ctx.globalAlpha = 0.2; ctx.fillStyle = "#bfeee0";
    const ox = ((cam.x*0.3)%40+40)%40, oy = ((cam.y*0.3)%40+40)%40;
    for (const d of waterDots) {
      const px = ((d.x - ox)%VIEW_W + VIEW_W)%VIEW_W, py = ((d.y - oy)%VIEW_H + VIEW_H)%VIEW_H;
      ctx.beginPath(); ctx.arc(px, py, d.r, 0, 6.28); ctx.fill();
    }
    ctx.restore();
  }

  function renderParticleCache(p) {
    const size = p.n*p.cs;
    if (!p.cache) { p.cache = document.createElement("canvas"); p.cache.width = size; p.cache.height = size; }
    const g = p.cache.getContext("2d");
    g.clearRect(0, 0, size, size);
    const cs = p.cs;
    for (let gj = 0; gj < p.n; gj++) for (let gi = 0; gi < p.n; gi++) {
      const idx = gj*p.n + gi, v = p.grid[idx]; if (v <= 0) continue;
      g.fillStyle = RESOURCES[p.gtype[idx]].color; // colour = resource class
      g.globalAlpha = 0.6 + 0.4*v;
      g.fillRect(gi*cs, gj*cs, cs+0.5, cs+0.5);
    }
    g.globalAlpha = 1;
    p.dirty = false;
  }
  function drawSubstrate(p) {
    const cx = sx(p.x), cy = sy(p.y);
    if (!onScreen(cx, cy, p.half + 20)) return;
    if (p.dirty || !p.cache) renderParticleCache(p);
    ctx.drawImage(p.cache, cx - p.half, cy - p.half);
  }

  const ENZ_RGB = ["239,217,138", "224,100,90", "111,168,255"]; // matches RESOURCES colours
  function drawEnzyme(z) {
    const cx = sx(z.x), cy = sy(z.y); if (!onScreen(cx, cy, z.r + 4)) return;
    const rgb = ENZ_RGB[z.res] || "190,130,255";
    ctx.save(); ctx.translate(cx, cy);
    const g = ctx.createRadialGradient(0, 0, z.r*0.2, 0, 0, z.r);
    g.addColorStop(0, `rgba(${rgb},0.30)`); g.addColorStop(0.8, `rgba(${rgb},0.13)`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, z.r, 0, 6.28); ctx.fill();
    ctx.restore();
  }
  function drawToxin(z) { // magenta antibiotic haze — distinct from the resource-coloured enzyme clouds
    const cx = sx(z.x), cy = sy(z.y); if (!onScreen(cx, cy, z.r + 4)) return;
    ctx.save(); ctx.translate(cx, cy);
    const g = ctx.createRadialGradient(0, 0, z.r*0.2, 0, 0, z.r);
    g.addColorStop(0, "rgba(240,90,208,0.34)"); g.addColorStop(0.72, "rgba(240,90,208,0.15)"); g.addColorStop(1, "rgba(240,90,208,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, z.r, 0, 6.28); ctx.fill();
    ctx.restore();
  }
  function drawNutrient(n) {
    const cx = sx(n.x), cy = sy(n.y); if (!onScreen(cx, cy, 6)) return;
    ctx.save(); ctx.globalAlpha = clamp(n.life/2, 0.25, 1);
    ctx.fillStyle = n.res != null ? RESOURCES[n.res].color : "#9dffcf";
    ctx.beginPath(); ctx.arc(cx, cy, CFG.nutrient.radius, 0, 6.28); ctx.fill(); ctx.restore();
  }
  function drawParticle(q) {
    const cx = sx(q.x), cy = sy(q.y); if (!onScreen(cx, cy, 6)) return;
    ctx.save(); ctx.globalAlpha = clamp(q.life*1.6, 0, 1); ctx.fillStyle = q.color;
    ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, 6.28); ctx.fill(); ctx.restore();
  }

  function drawPhage(ph) {
    const cx = sx(ph.x), cy = sy(ph.y); if (!onScreen(cx, cy, 20)) return;
    ctx.save(); ctx.translate(cx, cy);
    if (ph.type === "gold") {
      // a bright pulsing golden STAR with a white core — unmistakable against yellow food
      const pulse = 1 + 0.13*Math.sin(flagPhase*0.9 + ph.x*0.04);
      const R = 17*pulse;
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, R);
      g.addColorStop(0, "rgba(255,244,170,0.95)"); g.addColorStop(0.4, "rgba(255,196,40,0.5)"); g.addColorStop(1, "rgba(255,196,40,0)");
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.28); ctx.fill();
      ctx.fillStyle = "#fff2ac"; ctx.strokeStyle = "#8a5a00"; ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const a = i/8*6.28 - Math.PI/2, rr = (i % 2 ? 2.6 : 7.5)*pulse; ctx[i ? "lineTo" : "moveTo"](Math.cos(a)*rr, Math.sin(a)*rr); }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(0, 0, 1.7, 0, 6.28); ctx.fill();
      ctx.restore(); return;
    }
    // green phage — colour-coded by danger to YOU: red = can infect your cell, green = harmless
    const pc = controlledCell(), danger = pc && hostMatch(ph.host, upgradeTier(pc));
    const col = danger ? "#ff5a52" : "#7CFC5A", r = 3.8;
    ctx.fillStyle = "rgba(8,12,10,0.6)"; ctx.beginPath(); ctx.arc(0, 0, r + 1.7, 0, 6.28); ctx.fill(); // dark halo → pops against same-colour blocks
    ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.beginPath();
    ctx.moveTo(0, r); ctx.lineTo(0, r + 3.5); ctx.stroke();                    // tail fiber
    ctx.fillStyle = col; ctx.strokeStyle = danger ? "#4a0d0a" : "#0d4a18"; ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) { const a = i/6*6.28 - Math.PI/2; ctx[i ? "lineTo" : "moveTo"](Math.cos(a)*r, Math.sin(a)*r - 1); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = danger ? "#ffd6d2" : "#dcffd2"; ctx.beginPath(); ctx.arc(0, -0.8, 1.3, 0, 6.28); ctx.fill(); // bright core
    ctx.restore();
  }

  function drawCell(c) {
    const cx = sx(c.x), cy = sy(c.y); if (!onScreen(cx, cy, 40)) return;
    const hl = cellHalfLen(c), rad = CFG.cell.radius;
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(c.angle);
    if (c.invuln > 0 && Math.floor(c.invuln*10) % 2 === 0) ctx.globalAlpha = 0.5;
    if (c.cyst) {
      // resting cyst: no flagellum, contracted, thick resistant wall, muted colour
      const chl = Math.max(rad, hl*0.7);
      ctx.fillStyle = "#5f7a63"; ctx.strokeStyle = "#2e3f2b"; ctx.lineWidth = 2.4;
      roundedCapsule(ctx, chl, rad*1.1); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = "rgba(190,210,180,0.45)"; ctx.lineWidth = 1;
      roundedCapsule(ctx, chl - 2.5, rad*0.66); ctx.stroke(); // inner coat
      if (c.chemotaxis) { ctx.strokeStyle = "rgba(255,210,90,0.5)"; ctx.lineWidth = 1; roundedCapsule(ctx, chl + 1.6, rad*1.1 + 1.3); ctx.stroke(); }
      ctx.restore(); return;
    }
    ctx.strokeStyle = c.controlled ? "rgba(120,240,210,0.75)" : "rgba(150,220,200,0.4)";
    ctx.lineWidth = 1.6; ctx.beginPath();
    for (let i = 0; i <= 14; i++) { const t = i/14; ctx[i ? "lineTo" : "moveTo"](-hl - t*22, Math.sin(flagPhase + t*8 + c.x*0.1)*4*t); }
    ctx.stroke();
    const g = ctx.createLinearGradient(-hl, 0, hl, 0);
    if (c.controlled) { g.addColorStop(0, "#3fbfa0"); g.addColorStop(0.5, "#8dffdc"); g.addColorStop(1, "#3fbfa0"); }
    else { g.addColorStop(0, "#3a9d92"); g.addColorStop(0.5, "#7fd8c4"); g.addColorStop(1, "#3a9d92"); }
    ctx.fillStyle = g; ctx.strokeStyle = c.controlled ? "#1f6f5c" : "#2a5f56"; ctx.lineWidth = 1.6;
    roundedCapsule(ctx, hl, rad); ctx.fill(); ctx.stroke();
    // green infection: sickly tint + viral specks, agitating as lysis nears
    if (c.infectedGreen) {
      const urg = 1 - clamp(c.lysisT/CFG.phage.latent[1], 0, 1);
      ctx.fillStyle = `rgba(120,255,90,${0.2 + 0.25*urg + 0.1*Math.sin(flagPhase*2)})`;
      roundedCapsule(ctx, hl, rad); ctx.fill();
      ctx.fillStyle = "rgba(30,90,20,0.85)";
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc((i-1)*hl*0.4, Math.sin(i*2 + flagPhase)*rad*0.4, 1.2, 0, 6.28); ctx.fill(); }
    }
    // chemotaxis gene: golden outline
    if (c.chemotaxis) { ctx.strokeStyle = "rgba(255,210,90,0.9)"; ctx.lineWidth = 1.3; roundedCapsule(ctx, hl + 1.6, rad + 1.3); ctx.stroke(); }
    // CRISPR gene: dashed violet outline (a spacer-array look)
    if (c.crispr) { ctx.strokeStyle = "rgba(195,155,255,0.95)"; ctx.lineWidth = 1.4; ctx.setLineDash([2.2, 2]); roundedCapsule(ctx, hl + 3.4, rad + 3); ctx.stroke(); ctx.setLineDash([]); }
    const near = (c.energy - CFG.cell.lenBaseEnergy)/(CFG.cell.divideThreshold - CFG.cell.lenBaseEnergy);
    if (near > 0.75) { ctx.strokeStyle = "rgba(20,80,66,0.6)"; ctx.lineWidth = 1.5;
      const pinch = rad*(1 - (near-0.75)/0.25*0.7); ctx.beginPath(); ctx.moveTo(0, -pinch); ctx.lineTo(0, pinch); ctx.stroke(); }
    ctx.restore();
  }
  function roundedCapsule(c, hl, r) {
    c.beginPath(); c.moveTo(-hl+r, -r); c.lineTo(hl-r, -r); c.arc(hl-r, 0, r, -Math.PI/2, Math.PI/2);
    c.lineTo(-hl+r, r); c.arc(-hl+r, 0, r, Math.PI/2, -Math.PI/2); c.closePath();
  }

  function drawPredator(pr) {
    const cx = sx(pr.x), cy = sy(pr.y); if (!onScreen(cx, cy, pr.r + 8)) return;
    // life-stage cues: juveniles are smaller, elders shrink and grey out
    const lifeFrac = clamp(pr.age/pr.lifespan, 0, 1);
    const grow = clamp(pr.age/CFG.predator.maturity, 0.55, 1);
    const r = pr.r*grow*(1 - 0.18*Math.max(0, lifeFrac - 0.55)/0.45);
    const old = Math.max(0, lifeFrac - 0.6)/0.4; // 0..1 over final 40% of life
    ctx.save(); ctx.translate(cx, cy);
    if (pr.satiated > 0) ctx.globalAlpha = 0.5;
    const g = ctx.createRadialGradient(0, 0, 3, 0, 0, r + 6);
    const mix = (a, b) => Math.round(a + (b - a)*old);
    g.addColorStop(0, `rgba(${mix(255,190)},${mix(150,180)},${mix(170,185)},0.9)`);
    g.addColorStop(0.7, `rgba(${mix(200,150)},${mix(70,140)},${mix(110,150)},0.72)`);
    g.addColorStop(1, "rgba(150,40,90,0.2)");
    ctx.fillStyle = g; ctx.beginPath();
    for (let i = 0; i <= 9; i++) { const a = i/9*6.28, rr = r*(0.85 + 0.25*Math.sin(a*3 + pr.pseudo)); ctx[i ? "lineTo" : "moveTo"](Math.cos(a)*rr, Math.sin(a)*rr); }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(90,20,50,0.8)"; ctx.beginPath(); ctx.arc(Math.cos(pr.pseudo)*3, Math.sin(pr.pseudo)*3, r*0.3, 0, 6.28); ctx.fill();
    ctx.restore();
  }

  function drawMinimap() {
    const mw = 150, mh = mw*WORLD_H/WORLD_W, mx = VIEW_W - mw - 12, my = VIEW_H - mh - 12;
    ctx.save();
    ctx.globalAlpha = 0.85; ctx.fillStyle = "rgba(4,20,26,0.7)"; ctx.strokeStyle = "rgba(120,220,200,0.4)";
    ctx.lineWidth = 1; ctx.fillRect(mx, my, mw, mh); ctx.strokeRect(mx, my, mw, mh);
    const kx = mw/WORLD_W, ky = mh/WORLD_H;
    for (const p of substrates) { ctx.fillStyle = p.tint; const r = Math.max(2, p.R*kx);
      ctx.beginPath(); ctx.arc(mx + p.x*kx, my + p.y*ky, r, 0, 6.28); ctx.fill(); }
    // colony dots coloured by generation (same palette as the chart); cysts hidden (too many, too cluttered)
    for (const c of cells) if (!c.controlled && !c.cyst) {
      ctx.fillStyle = levelColor(ecoMask(c), upgradeTier(c));
      ctx.fillRect(mx + c.x*kx - 1, my + c.y*ky - 1, 2, 2);
    }
    ctx.fillStyle = "#ff7a6b";
    for (const pr of predators) { ctx.beginPath(); ctx.arc(mx + pr.x*kx, my + pr.y*ky, 2.5, 0, 6.28); ctx.fill(); }
    // gold phage — a bright STAR so it stands out from round dots
    for (const ph of phages) if (ph.type === "gold") drawMiniStar(mx + ph.x*kx, my + ph.y*ky, 5.5, 2.4, "#ffd24a");
    // your cell — a white-ringed teal DIAMOND, unmistakable
    const pc = controlledCell();
    if (pc) drawMiniDiamond(mx + pc.x*kx, my + pc.y*ky, 4.5, "#8dffdc");
    ctx.restore();
  }
  function drawMiniDiamond(x, y, r, fill) {
    ctx.beginPath(); ctx.moveTo(x, y-r); ctx.lineTo(x+r, y); ctx.lineTo(x, y+r); ctx.lineTo(x-r, y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.2; ctx.stroke();
  }
  function drawMiniStar(x, y, rOut, rIn, fill) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i/10*6.28 - Math.PI/2, r = i % 2 ? rIn : rOut; ctx[i ? "lineTo" : "moveTo"](x + Math.cos(a)*r, y + Math.sin(a)*r); }
    ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = "rgba(60,40,0,0.6)"; ctx.lineWidth = 0.8; ctx.stroke();
  }

  // ---------------------------------------------------------------- eco chart
  // An ecotype is the set of acquired capabilities. Carbohydrase is universal, so
  // the differentiators are lipase(1) | protease(2) | chemotaxis(4) → 8 ecotypes.
  // Colours: dataviz skill's validated 8-hue categorical palette (dark, CVD-safe order).
  const CHART = { interval: 0.5, samples: 200, W: 800, H: 96, surface: "#06181d" };
  const ECO_COLOR = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];
  const PROTIST_COLOR = "#ff9ec0", VIRUS_COLOR = "#8bf06a", CYST_COLOR = "#9aa6a0", CRISPR_COLOR = "#c39bff", TOXIN_COLOR = "#f05ad0";
  function ecoMask(c) { return (c.enzLvl[0] > 0 ? 1 : 0) | (c.enzLvl[1] > 0 ? 2 : 0) | (c.chemotaxis ? 4 : 0); }
  function ecoLabel(mask) {
    if (mask === 0) return "carb only";
    const parts = [];
    if (mask & 1) parts.push("lipase"); if (mask & 2) parts.push("protease"); if (mask & 4) parts.push("chemotaxis");
    return "+" + parts.join(" +");
  }
  function updateLegend(eco, preds, green) {
    if (!el.legend) return;
    // colours encode GENERATION (ecotype+tier), not a fixed ecotype hue — so list ecotype COUNTS as text (no misleading swatch)
    let colony = 0; for (let m = 0; m < 8; m++) colony += eco[m];
    let html = `<span><i class="gen-swatch"></i>colony <b>${colony}</b></span>`;
    for (let m = 0; m < 8; m++) if (eco[m] > 0) html += `<span class="ecoq">${ecoLabel(m)} <b>${eco[m]}</b></span>`;
    html += `<span><i class="eco-line" style="border-color:${PROTIST_COLOR}"></i>protists <b>${preds}</b></span>`;
    html += `<span><i class="eco-line" style="border-color:${VIRUS_COLOR}"></i>viruses <b>${green || 0}</b></span>`;
    html += `<span id="chartTitle">ecotype abundance vs. time</span>`;
    el.legend.innerHTML = html;
  }
  function ecoCounts() { const e = [0,0,0,0,0,0,0,0]; for (const c of cells) e[ecoMask(c)]++; return e; }
  // per-ecotype count + average upgrade level (total enzyme levels above base + chemoLevel) for the chart
  function ecoSample() {
    // bucket active cells by GENERATION = (ecotype, upgrade tier). Each bucket becomes its own flat-coloured
    // polygon in the stack — a new lineage gets a new colour, and cells keep it until they upgrade again.
    const eco = [0,0,0,0,0,0,0,0], buckets = {};
    for (const c of cells) {
      const m = ecoMask(c); eco[m]++;          // cysts included in their generation bucket (coloured, not a separate grey band)
      const key = m*64 + Math.min(63, upgradeTier(c)); // mask (0-7) high bits, tier low bits
      buckets[key] = (buckets[key] || 0) + 1;
    }
    return { eco, buckets };
  }
  function sampleBuckets(s) { // legacy high-score saves stored eco[]/lvl[] not buckets — synthesize one bucket per ecotype
    if (s.buckets) return s.buckets;
    const b = {}; if (s.eco) for (let m = 0; m < 8; m++) if (s.eco[m]) b[m*64 + Math.round(s.lvl ? s.lvl[m] : 0)] = s.eco[m];
    return b;
  }
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16), r = ((n>>16)&255)/255, g = ((n>>8)&255)/255, b = (n&255)/255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx+mn)/2; let h = 0, s = 0;
    if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d/(2-mx-mn) : d/(mx+mn);
      h = mx === r ? (g-b)/d + (g < b ? 6 : 0) : mx === g ? (b-r)/d + 2 : (r-g)/d + 4; h *= 60; }
    return [h, s*100, l*100];
  }
  const ECO_HSL = ECO_COLOR.map(hexToHsl);
  function levelColor(m, lvl) { // DISCRETE staggered colour per generation → sharp transitions, not a smooth rainbow
    const L = Math.round(lvl), hsl = ECO_HSL[m];
    const hue = (((hsl[0] + L*58) % 360) + 360) % 360;        // big hue jumps so consecutive levels contrast
    const light = clamp(hsl[2] + (L % 2 ? -13 : 9), 24, 74);  // alternate darker/lighter to separate them further
    return `hsl(${hue.toFixed(0)}, ${hsl[1].toFixed(0)}%, ${light.toFixed(0)}%)`;
  }
  // Shared renderer: stacked absolute ecotype areas + protist line. Used by the live
  // chart (scrolling window) and by each saved high-score mini-chart (whole game).
  // `denom` sets the x-span (fixed window for live scroll; hist length for saved fill).
  function renderEcoChart(g, W, H, hist, denom) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = CHART.surface; g.fillRect(0, 0, W, H);
    let maxY = 10, vMax = 10; // viruses get their OWN hidden axis (they hit the ~220 cap and would squash the cells)
    for (const s of hist) { let tot = 0; for (let i = 0; i < 8; i++) tot += s.eco[i]; if (tot > maxY) maxY = tot; if (s.p > maxY) maxY = s.p; if ((s.v || 0) > vMax) vMax = s.v; }
    const n = denom || Math.max(hist.length, 2), pad = H < 70 ? 8 : 14;
    const xAt = (i) => i/(n-1)*W, yAt = (v) => H - (v/maxY)*(H-pad) - 2;
    g.strokeStyle = "rgba(255,255,255,0.06)"; g.lineWidth = 1;
    for (let k = 1; k <= 3; k++) { const y = H - k/4*(H-pad) - 2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = "rgba(215,245,238,0.5)"; g.font = "10px 'Trebuchet MS', sans-serif"; g.textAlign = "left";
    g.fillText(String(Math.round(maxY)), 3, 10); g.fillText("0", 3, H - 3);
    if (hist.length > 1) {
      const last = hist.length - 1;
      // one FLAT-coloured polygon per GENERATION bucket (ecotype+tier), stacked from the baseline.
      // Each new lineage = a new colour that grows in and fades out as its population rises and falls — no gradients.
      const bks = hist.map(sampleBuckets), cum = hist.map(() => 0);
      const keySet = new Set(); for (const b of bks) for (const k in b) keySet.add(+k);
      const keys = [...keySet].sort((a, b) => a - b); // stable order: mask-major, tier-minor → bands don't jump around
      for (const key of keys) {
        const mask = key >> 6, tier = key & 63;
        g.fillStyle = levelColor(mask, tier);
        g.beginPath(); g.moveTo(xAt(0), yAt(cum[0]));
        for (let i = 1; i <= last; i++) g.lineTo(xAt(i), yAt(cum[i]));
        for (let i = last; i >= 0; i--) g.lineTo(xAt(i), yAt(cum[i] + (bks[i][key] || 0)));
        g.closePath(); g.fill();
        for (let i = 0; i <= last; i++) cum[i] += (bks[i][key] || 0);
      }
      g.strokeStyle = PROTIST_COLOR; g.lineWidth = H < 70 ? 1.3 : 1.8; g.beginPath();
      for (let i = 0; i < hist.length; i++) { const x = xAt(i), y = yAt(hist[i].p); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      // virus (green-phage) count — dashed line on its OWN hidden axis (scaled to vMax, not the cell axis)
      const yAtV = (v) => H - (v/vMax)*(H-pad) - 2;
      g.strokeStyle = VIRUS_COLOR; g.lineWidth = H < 70 ? 1.1 : 1.5; g.setLineDash([3, 3]); g.beginPath();
      for (let i = 0; i < hist.length; i++) { const x = xAt(i), y = yAtV(hist[i].v || 0); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.setLineDash([]);
    }
  }
  function drawChart() {
    if (!cctx || !state) return;
    renderEcoChart(cctx, CHART.W, CHART.H, state.history, CHART.samples);
  }

  // ---------------------------------------------------------------- high scores
  const HS_KEY = "bacteria_highscores_v1", HS_MAX = 100, NAME_KEY = "bacteria_player_name";
  const API_URL = "scores.php"; // shared leaderboard on the game's own origin; if it's absent/offline we fall back to localStorage
  let playerName = ""; try { playerName = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}
  let globalScores = null;      // last-fetched shared leaderboard (null = not loaded / offline → use local)
  let lastRec = null;           // the run just finished (so a later name edit re-submits the same id)
  function loadScores() { try { return JSON.parse(localStorage.getItem(HS_KEY)) || []; } catch (e) { return []; } }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  let justFinishedTs = null; // marks the run just completed, to highlight it in the list
  function recordGame() {
    if (!state) return;
    const id = Date.now();
    const rec = { id, score: Math.round(state.score), gen: state.gen, date: id, dur: Math.round(state.elapsed), hist: state.fullHist, upgrades: state.upgrades, name: playerName };
    justFinishedTs = id; lastRec = rec;
    try {
      const arr = loadScores(); arr.push(rec); arr.sort((a, b) => b.score - a.score);
      localStorage.setItem(HS_KEY, JSON.stringify(arr.slice(0, HS_MAX)));
    } catch (e) { /* storage unavailable — high scores just won't persist */ }
    submitScore(rec); // push to the shared leaderboard (fire-and-forget, safe if the backend isn't there)
  }
  function submitScore(rec) { // POST a run to the shared leaderboard; ignored gracefully if offline / no backend
    if (typeof fetch !== "function" || !rec) return;
    try {
      fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(rec) })
        .then((r) => (r.ok ? r.json() : null))
        .then((list) => { if (Array.isArray(list)) { globalScores = list; refreshScoreListIfOpen(); } })
        .catch(() => {});
    } catch (e) {}
  }
  function fetchScores() { // GET the shared leaderboard; on success it replaces the local list in the UI
    if (typeof fetch !== "function") return;
    try {
      fetch(API_URL, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((list) => { if (Array.isArray(list)) { globalScores = list; refreshScoreListIfOpen(); } })
        .catch(() => {});
    } catch (e) {}
  }
  function refreshScoreListIfOpen() { if (el.scores && !el.scores.classList.contains("hidden") && el.scoreDetail && el.scoreDetail.classList.contains("hidden")) renderScoreList(); }
  function renderScoreList() {
    if (!el.scoresList) return;
    const arr = globalScores || loadScores(); // shared list when we have it, else this browser's local runs
    if (!arr.length) el.scoresList.innerHTML = `<p class="empty">No runs yet — play a game and your colony's evolutionary history will appear here.</p>`;
    else { el.scoresList.innerHTML = ""; arr.forEach((r, i) => el.scoresList.appendChild(scoreRow(`#${i+1}`, r, r.date === justFinishedTs))); }
  }
  function fmtDur(s) { const m = Math.floor(s/60); return m + ":" + String(s % 60).padStart(2, "0"); }
  function fmtDate(ms) { const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
  function scoreRow(rankHtml, rec, current) {
    const row = document.createElement("div"); row.className = "score-row clickable" + (current ? " current" : "");
    const meta = document.createElement("div"); meta.className = "score-meta";
    let m = `<span class="rank">${rankHtml}</span>`;
    if (rec.name) m += `<span class="pname">${escapeHtml(rec.name)}</span>`;
    m += `<b class="sc">${rec.score}</b><span>generation ${rec.gen}</span><span>survived ${fmtDur(rec.dur)}</span>`;
    if (rec.date) m += `<span class="date">${fmtDate(rec.date)}</span>`;
    meta.innerHTML = m;
    const cv = document.createElement("canvas"); cv.width = 340; cv.height = 58; cv.className = "score-chart";
    renderEcoChart(cv.getContext("2d"), 340, 58, rec.hist || []);
    row.appendChild(meta); row.appendChild(cv);
    row.addEventListener("click", () => openScoreDetail(rankHtml, rec)); // click → full annotated run
    return row;
  }
  function openScoreDetail(rankHtml, rec) {
    if (!el.scoreDetail || !el.detailChart) return;
    annotateRun(el.detailChart.getContext("2d"), el.detailChart.width, el.detailChart.height, rec.hist || [], rec.upgrades, rec.dur);
    if (el.detailStats) el.detailStats.innerHTML = runStatsHtml(rec.hist || [], rec.upgrades);
    if (el.detailTitle) el.detailTitle.innerHTML =
      `${rankHtml}${rec.name ? " · " + escapeHtml(rec.name) : ""} · <b>${rec.score}</b> · generation ${rec.gen} · survived ${fmtDur(rec.dur)}`;
    [el.scoresList, el.scoresKey, el.currentRun].forEach((e) => e && e.classList.add("hidden"));
    el.scoreDetail.classList.remove("hidden");
  }
  function closeScoreDetail() {
    if (el.scoreDetail) el.scoreDetail.classList.add("hidden");
    showScores(); // rebuilds & re-shows the list (and the current-run row if paused mid-game)
  }
  function showScores() {
    const active = !!(state && state.running); // paused mid-game
    if (el.scoreDetail) el.scoreDetail.classList.add("hidden"); // always open on the list, not a stale detail
    [el.scoresList, el.scoresKey].forEach((e) => e && e.classList.remove("hidden"));
    if (el.scoresTitle) el.scoresTitle.textContent = paused ? "Paused" : "High Scores";
    if (el.scoresBack) el.scoresBack.textContent = paused ? "Resume" : "Back";
    if (el.endGameBtn) el.endGameBtn.classList.toggle("hidden", !active);
    if (el.currentRun) {
      if (active) {
        el.currentRun.innerHTML = `<div class="label">Current run</div>`;
        el.currentRun.appendChild(scoreRow("live", { score: Math.round(state.score), gen: state.gen, dur: Math.round(state.elapsed), hist: state.fullHist, upgrades: state.upgrades, name: playerName }, true));
        el.currentRun.classList.remove("hidden");
      } else el.currentRun.classList.add("hidden");
    }
    if (el.scoresKey) { // colours now encode GENERATION (ecotype + upgrade tier), so no fixed per-ecotype swatch
      el.scoresKey.innerHTML =
        `<span><i class="gen-swatch"></i>colony — a new colour each generation</span>` +
        `<span><i class="eco-line" style="border-color:${PROTIST_COLOR}"></i>protists</span>` +
        `<span><i class="eco-line" style="border-color:${VIRUS_COLOR}"></i>viruses <em>(own scale)</em></span>`;
    }
    renderScoreList();       // draw from cache/local immediately…
    fetchScores();           // …then refresh from the shared leaderboard when it responds
    el.scores.classList.remove("hidden");
  }
  function hideScores() { el.scores.classList.add("hidden"); if (el.scoreDetail) el.scoreDetail.classList.add("hidden"); }
  let helpOpen = false;
  function showHelp() { if (el.help) { el.help.classList.remove("hidden"); helpOpen = true; } }
  function hideHelp() { if (el.help) { el.help.classList.add("hidden"); helpOpen = false; } }
  function toggleHelp() { helpOpen ? hideHelp() : showHelp(); }
  function pauseGame() { if (!state || !state.running || paused) return; paused = true; showScores(); }
  function resumeGame() { paused = false; hideScores(); }
  function endGame() { if (!state || !state.running) return; paused = false; hideScores(); gameOver(); }
  let _toastTimer = null;
  function positionToast() { // anchor the announcement just above the controlled cell (was fixed at the top, over the HUD)
    const pc = controlledCell(); if (!pc || !el.toast) return;
    el.toast.style.left = Math.round(sx(pc.x)) + "px";
    el.toast.style.top = Math.round(Math.max(6, sy(pc.y) - 52)) + "px";
  }
  function showUpgradeToast(msg, color) {
    if (!el.toast) return;
    el.toast.textContent = msg;
    if (color) { el.toast.style.color = color; el.toast.style.borderColor = color; }
    positionToast();
    el.toast.classList.add("show");
    if (_toastTimer) clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2600);
  }
  function togglePause() {
    if (paused) resumeGame();
    else if (state && state.running && el.title.classList.contains("hidden") && el.over.classList.contains("hidden")) pauseGame();
  }

  // ------------------------------------------------------------------ hud sync
  function syncHud() {
    if (!state) return;
    if (el.toast && el.toast.classList.contains("show")) positionToast(); // keep the announcement pinned above the cell
    const c = controlledCell(), e = c ? c.energy : 0;
    el.energyFill.style.width = Math.min(100, e/CFG.cell.divideThreshold*100) + "%"; // full = ready to divide (cells split at the threshold, never reaching maxEnergy)
    el.energyTxt.textContent = Math.round(e);
    el.colony.textContent = cells.length; el.gen.textContent = state.gen; el.score.textContent = Math.round(state.score);
    const pc = controlledCell();
    for (let i = 0; i < 3; i++) if (el.enz[i]) {
      const lvl = pc ? pc.enzLvl[i] : (i === 2 ? 1 : 0), owned = lvl > 0;
      el.enz[i].classList.toggle("owned", owned);
      el.enz[i].classList.toggle("active", owned && i === state.activeEnzyme);
      el.enz[i].textContent = RESOURCES[i].enzyme + (owned ? " " + lvl : ""); // show each enzyme's level
    }
    if (el.enzTox) { const lvl = pc ? pc.antibiotic : 0, owned = lvl > 0;
      el.enzTox.classList.toggle("owned", owned);
      el.enzTox.classList.toggle("active", owned && state.activeEnzyme === 3);
      el.enzTox.textContent = "antibiotic" + (owned ? " " + lvl : ""); }
    if (el.abilChemo) { const on = !!(pc && pc.chemotaxis); el.abilChemo.classList.toggle("owned", on); el.abilChemo.textContent = "chemotaxis" + (on ? " " + pc.chemoLevel : ""); }
    if (el.abilCrispr) el.abilCrispr.classList.toggle("owned", !!(pc && pc.crispr));
  }

  // -------------------------------------------------------------------- loop
  let last = 0;
  function frame(now) {
    const dt = last ? Math.min((now-last)/1000, 0.05) : 0; last = now;
    if (!paused) update(dt);
    draw(); syncHud(); drawChart();
    requestAnimationFrame(frame);
  }

  function start() { Audio.init(); Music.start(Audio.ctx()); justFinishedTs = null; el.title.classList.add("hidden"); el.over.classList.add("hidden"); newGame(); }
  el.startBtn.addEventListener("click", start);
  el.restartBtn.addEventListener("click", start);
  if (el.scoresBtn) el.scoresBtn.addEventListener("click", showScores);
  if (el.scoresBtn2) el.scoresBtn2.addEventListener("click", showScores);
  if (el.scoresBack) el.scoresBack.addEventListener("click", () => { if (paused) resumeGame(); else hideScores(); });
  if (el.helpBtn) el.helpBtn.addEventListener("click", showHelp);
  if (el.helpBack) el.helpBack.addEventListener("click", hideHelp);
  if (el.endGameBtn) el.endGameBtn.addEventListener("click", endGame);
  if (el.detailBack) el.detailBack.addEventListener("click", closeScoreDetail);
  if (el.nameInput) el.nameInput.addEventListener("input", (e) => setPlayerName(e.target.value));

  // temperature & salinity are held neutral for now (reserved for future levels:
  // estuary, sea ice, hydrothermal vent, ...)
  env.tempC = 20; env.salinity = 35; env.update();
  requestAnimationFrame(frame);

})();
