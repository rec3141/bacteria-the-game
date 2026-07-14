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

  const BUILD = "__BUILD__"; // stamped by deploy.sh with the git commit; used to detect a newer live build

  // ------------------------------------------------------------ world / view
  let VIEW_W = 800, VIEW_H = 680; // canvas backing size; on mobile it tracks the stage so the game fills the screen
  // The canvas USED to be a fixed 800×680 that CSS scaled down to fit the phone. It now tracks the
  // stage's real size, so that implicit downscale is gone — and anything tuned in the old design
  // space (the touch zoom, the minimap) has to re-apply it or it comes out magnified twice.
  const DESIGN_W = 800;
  // Read live from CFG.touch.zoom (not a const any more) so the tuning slider actually moves the view.
  const touchZoom = () => CFG.touch.zoom;
  const viewScale = () => VIEW_W / DESIGN_W;          // 1 on a full-size canvas, ~0.46 on a phone
  // The world is a torus of this size. It's `let`, not `const`, because the TUTORIAL shrinks it to
  // the size of the viewport: a petri dish you can see all of at once. The camera then never has to
  // move, nothing being explained can wander off-screen, and the director owns the whole cast.
  const WORLD_DEF_W = 2600, WORLD_DEF_H = 2000;
  let WORLD_W = WORLD_DEF_W, WORLD_H = WORLD_DEF_H;
  function setWorld(w, h) { WORLD_W = Math.max(560, Math.round(w)); WORLD_H = Math.max(460, Math.round(h)); }

  const CFG = {
    cell: {
      radius: 5, baseHalf: 9, maxHalf: 22, lenBaseEnergy: 55, elongK: 0.11,
      // Low Reynolds number (see updateCell): speed is thrust/drag, not accumulated momentum.
      // thrust and dragRate therefore only matter as a RATIO — 21270/60 = 354 px/s of free-swim
      // speed, which maxSpeed then caps at 240. Raising dragRate alone makes the cell slower AND
      // crisper; raising both together keeps the speed and just kills the glide.
      thrust: 21270, dragRate: 60, cystDragRate: 2.2, maxSpeed: 240, uptake: 14,
      startEnergy: 110, maxEnergy: 230, divideThreshold: 175, // energy a cell must bank before it splits.
                           // 200 was too high to be REACHABLE: an autonomous carb-only cell tops out around
                           // 110-170 energy, so it never divided — it just encysted, and a colony left to
                           // itself stalled and died. Measured in a no-predator/no-virus sanctuary over 150s:
                           // 200 -> 49 cells (37 divisions), 175 -> 120 (108), 155 -> 178 (166).
      // (demo/tutorial knobs live in CFG.demo)
      // DRIFT: every time YOU adapt, one other cell also changes — see driftAnotherCell.
      driftOnUpgrade: 1,        // 0 = off (the population then just tracks your genome)
      driftGainChance: 0.5,     // 0.5 = a coin flip between gaining a gene and losing one
      swimCost: 1.2, enzymeCost: 4, antibioticCost: 6, invulnTime: 2.2,
      runMin: 1.8, runMax: 3.4, tumbleDur: 0.4, tumbleTurn: 7.0, playerTumbleTurn: 2.2,
      enzymeCooldown: [1.0, 2.0],  // how often an autonomous cell CHECKS for a particle worth digesting.
                                   // Was 2.5-4.5s, which left a cell sitting on top of food doing nothing for
                                   // seconds at a time (the timer re-rolls even when nothing is in range).
                                   // Unaided colony peak over 150s, no player help: 2.5-4.5 -> 14, 1.2-2.2 -> 32,
                                   // 0.6-1.2 -> 42. Below ~1.5s the differences are lost in run-to-run noise.
      cystBelow: 14, cystWake: 45, cystMetab: 0.035, // low-energy autonomous cells encyst: dormant, near-zero
                                                    // metabolism, phage-immune & predation-resistant, tail dropped
      cystReviveEnergy: 40,       // energy a cyst is given when resuscitated as the player character
      crisprEnergy: 9,            // energy gained when a CRISPR cell destroys a virus it's immune to
      cystDiffuse: 55,            // cysts drift passively (brownian) with the water
      exprBoost: 0.16,            // enzyme-radius gain per expression level (stacking gold-phage upgrade)
      chemoRange0: 300, chemoRangePer: 140, // chemotaxis sensing range grows with chemoLevel
      chemoBias: 0.9,                       // run-length extension per level when heading up-gradient (biased random walk)
      fedLinger: 2.2, maxCells: 100000, // effectively uncapped (perf backstop only)
      startUpgrades: 0,    // pre-load the starting cell with this many RANDOM adaptations, drawn from the
                           // same pool a gold phage gives. 0 = the normal game; raise it to start a run
                           // mid-evolution instead of grinding there to test the late game.
      genomeUpkeep: 0.05, // extra respiration per adaptation tier — the metabolic cost of a bigger genome (streamlining pressure)
      touchLatchSecs: 0.25, // phone stick: hold it at FULL deflection this long to lock in a run
                            // that keeps going after you lift your thumb (tap the center to stop)
      touchRunSecs: 2.0,   // ...and the locked run winds down over this long rather than sticking
                           // on forever — the knob eases back to center as it runs out
    },
    respirationBase: 0.9,
    // TOUCH ONLY: scales how fast things SWIM (your cells and the protists, together — halving
    // only your own would hand the grazers a 2x speed advantage). The phone magnifies the world
    // ~1.7x onto a small pane, so the same world-speed reads as far quicker in the hand.
    // Thrust and top speed scale together, so acceleration feel is unchanged — just slower.
    touchSpeedScale: 0.625,
    // THE TUTORIAL DISH. A circular world the size of the viewport: nothing being explained can leave
    // the screen, the camera never moves, and the director controls every organism in it. When the
    // lesson ends the rim dissolves and the dish opens into the whole ocean.
    demo: { food: 4, foodScale: 0.42, dishPad: 30, rimFade: 1.8,
            driftRate: 0.75,     // how fast the screensaver camera glides to its subject (was 2.6 = a snap)
            nearWindow: 0.9,     // prefer a new subject within this many screens of the camera
            panSpeed: 340, panHold: 2.2,   // arrow keys pan the screensaver; it resumes drifting after panHold
            // what the ocean is stocked with the moment the dish opens — an empty sea is a poor reveal
            openCells: 26, openProtists: 6, openPhages: 30, openFood: 26 },
    // TOUCH-ONLY tuning. The phone is not a smaller desktop, it's a different game: a cramped view,
    // a thumb instead of a keyboard, and players who will give it ninety seconds. These knobs exist
    // to make it FUN there, not to make it match. Desktop is untouched by all of them.
    touch: {
      zoom: 1.2,           // was 1.6875 — the phone showed ~59% of the sea the desktop did, which is
                           // most of why it felt frantic. 1.2 gives back most of the view.
      autoEnzyme: 1,       // the cell dissolves what it can reach, on its own (see autoEnzyme)
      autoEnzymeEvery: 0.45,
    },
    grid: { cs: 7 },                 // destructible-particle voxel size (px)
    substrate: {
      count: 60, moteEnergy: 7,     // count = the food the sea supports at FULL light; the diel target
                                    // scales it by the light (see diel.foodFloor), so this is the noon ceiling
      bloomEvery: 0.5,              // seconds per particle added/removed as the field tracks that target
      sizeMin: 30, sizeMax: 200, sizeExp: 1.6, // Junge-like size spectrum: abundance ∝ size^-sizeExp → many small, few large (lower exp = flatter = more big particles)
      carveRate: 4.5,                // density removed /sec per covered voxel
      lifeMin: 130, lifeMax: 300,    // each particle has its own lifespan (staggered)
      dissolveTime: 9,               // at end of life it erodes voxel-by-voxel over this many seconds
      driftMin: 9, driftMax: 20,     // drift in from offscreen (faster = food rebounds quicker after you strip an area), still eased-in, no popping
      minPerRes: 2,                  // always keep at least this many particles dominant in EACH resource (so every enzyme has food)
      // Depth shading ("grain"): a voxel is lit by its distance to the particle's SURFACE,
      // not by noise — so the mass reads as solid, and a face you just carved open brightens
      // by itself. Deterministic (a pure function of the grid), so it never shimmers.
      grainStrength: 1,              // 0 = the old flat fill; 1 = full effect (blend factor)
      grainRim: 1.16,                // brightness multiplier on surface voxels (depth 1)
      grainFalloff: 0.2,             // brightness lost per voxel step deeper into the mass:
                                     // reaches the floor ~7 voxels in, so only particles bigger
                                     // than ~50px radius grow an unreadable core — small ones stay
                                     // legible, and the mystery scales with the size of the prize
      grainFloor: 0.1,               // buried core keeps a whisper of its hue, so it still reads as
                                     // matter you can't see into rather than a hole in the particle
    },
    enzyme: { life: 5.0, maxRadius: 24, growTime: 0.4 },
    toxin: { life: 4.5, maxRadius: 40, growTime: 0.4, dose: 55, potency: 18, radiusPer: 0.34, // anti-protist antibiotic: fixed `dose` hit + lingering `potency`/s (NOT scaled by level); leveling GROWS the radius (radiusPer) so it hits more protists at once
             crossDist: 3, crossFactor: 1 }, // cross-reactive: bacteria a genetic distance ≥ crossDist from the releaser also take damage (×crossFactor)
    nutrient: { life: 16, radius: 3.2, maxCount: 600 },
    // trophic role-swap: when your whole population dies you flip to the other trophic level
    // instead of a game-over — bacteria extinct → you become a protist (grazer); protists extinct → back to a bacterium.
    cycle: { reseedBacteria: 16, reseedProtists: 4, protistThrust: 240, protistEatScore: 30,
             preyFloor: 20, preyEvery: 5,     // as a grazer, bacteria keep drifting in to hunt
             // TURBO (Space / the release button while you're a protist): a short sprint bought
             // with energy. Grabbing a gold phage as a grazer lengthens the burst — that's the
             // protist's version of an adaptation, and it stacks for the rest of the run.
             turboSecs: 0.25, turboMult: 2.6, turboCost: 7, turboGoldBonus: 0.12, turboMaxSecs: 1.5 },
    // "A day in the life": a 24h clock compressed into day.lengthSec (240s = a 4-minute day, so 1h
    // of sea time every 10s). Don't quote a rate here — lengthSec is a knob. Conditions follow a diel cycle.
    // tod (time-of-day) runs 0→1 over the day, starting at DAWN (6am). Curves below drive it.
    // WHERE and WHEN this run happens. Latitude + day-of-year give the real sun: its declination,
    // its altitude through the day, and therefore true sunrise/sunset — including midnight sun and
    // polar night above the Arctic Circle. Scenarios will set these.
    day: { lengthSec: 240, startHour: 0, latitude: 45, dayOfYear: 172 }, // start at midnight; 172 = June solstice
    diel: {
      tempBase: 17, tempAmp: 5, tempLag: 0.05,   // warmest early afternoon (temp lags the sun)
      foodFloor: 0.35,                            // night food supply as a fraction of the midday bloom
      grazeNight: 1.0,                            // extra grazing pressure at night (diel vertical migration)
      lightGamma: 1.8,                            // shapes the daylight curve: >1 deepens night, sharpens noon
      twilight: 0.21,                             // light fades through twilight rather than snapping off at the
                                                  // horizon; 0.21 ~ 12 deg below it (nautical dusk)
      // The WATER's color is the clock: lerped from midnight navy to midday teal. It used to be a
      // fixed background with a pale wash painted OVER the world at noon, which filmed over the
      // organisms (washed out) and banded as the low alpha faded (jittery).
      waterNight: [2, 9, 22], waterDay: [18, 78, 92],
      goldTint: 0.16,                             // warm glow when the sun is low (dawn/dusk)
      q10: 2.0, q10RefC: 20,                      // metabolism ×q10 per +10 °C above the reference temp
    },
    predator: {
      count: 4, radius: 22, wanderSpeed: 50, chaseSpeed: 85, senseRange: 170, satiatedTime: 4.5,
      startEnergy: 100, mealEnergy: 58, metabolism: 4, // eats cells for energy, drains over time (raised 25% to curb the boom from doubled food)
      maturity: 8,                                       // no senescence — a grazer dies of STARVATION
                                                         // (or antibiotics), never of old age
      reproEnergy: 320, reproCooldown: 11,               // reproduction, gated only by feeding — faster so grazers can chase a bacterial boom
      safetyMax: 600,                                    // perf backstop only — never binds ecologically
      minCount: 2, immigrateEvery: 8,                    // starting immigration/respawn interval (halves on each protist extinction)
      immigratePerPrey: 0.04, immigrateCap: 150, immigrateMax: 14, // grazers immigrate toward a target that rises with bacterial abundance; more per step so they can catch a boom
      respawnFloor: 0.5,                                 // the respawn interval halves on each protist extinction, down to this floor
      cystMealFactor: 0.45, cystEatChance: 0.35,         // cysts aren't hunted; a bumped one is usually resisted, rarely eaten (for little energy)
      killMotes: 8,                                      // biomass released as food when an antibiotic KILLS a protist (natural death releases nothing)
      virusEnergy: 5,                                    // protists also graze free-floating viruses — a small meal, and a top-down brake on phage blooms
    },
    phage: {
      greenCount: 18, radius: 3.6, life: [16, 24], maxCount: 4000, diffuse: 22, // maxCount is a perf backstop only (was 220) — let epidemics get nasty
      infectHalo: 5,        // adsorption reach beyond the cell body
      burst: [4, 8],        // green progeny released when an infected cell dies (bumped up — protist grazing + genome upkeep now keep viruses in check)
      latent: [9, 15],      // seconds from green infection to lysis
      greenSeed: [5, 9], greenFloor: 27, seedBatch: 3, // reservoir: every greenSeed s, top the sampled lineage up (a few at a time) to ≥greenFloor phages tuned to ITS tier
      hostTolerance: 2,     // kill-the-winner: a phage infects only cells within this many upgrade-tiers of its host
      goldLife: [90, 140],  // gold phage lingers far longer than green — you can chase it down
      // Gold IS the fun: it's the only thing that changes what you can do. Desktop keeps its scarcity
      // (1 on the board), but on a phone — where a run is short and a player gives you ninety seconds
      // — scarcity just means most players never see an adaptation at all. So the phone gets 3, closer
      // in, and levels up several times faster. This is the biggest single lever on mobile.
      goldCount: 1, goldCountTouch: 3,
      goldMinDist: 650, goldMinDistTouch: 300, // how far away a fresh gold is buried

      goldGrabTouch: 3,     // ON TOUCH ONLY: multiplies the gold phage's grab radius. Catching it with
                            // a thumb on a small screen is far fiddlier than with a keyboard.
    },
  };
  // Snapshot the shipped values before anything can touch them — the tuning panel
  // (` key) reads these for its slider ranges, its reset, and to tell whether a run
  // was played on modified numbers.
  const CFG_DEFAULTS = JSON.parse(JSON.stringify(CFG));

  // Resource classes: each exoenzyme dissolves only its matching resource. Voxels
  // are color-coded by resource so a particle reads as its biochemical makeup.
  const RESOURCES = [
    { key: "lipid",   enzyme: "lipase",       color: "#efd98a", cal: 9 }, // 0 — fats/oils, wheat-yellow (9 kcal/g)
    { key: "protein", enzyme: "protease",     color: "#ef8b3c", cal: 4 }, // 1 — proteinaceous, orange (4 kcal/g).
                                                                       // Deliberately NOT red: the reds are spoken for by
                                                                       // infectious phages, protists and the antibiotic.
    { key: "carb",    enzyme: "carbohydrase", color: "#6fa8ff", cal: 4 }, // 2 — sugars/polysaccharide, blue (4 kcal/g)
  ];
  const BIOMASS_CAL = 4; // protist biomass motes (res = null) count as protein-grade calories

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
    gen: document.getElementById("gen"), score: document.getElementById("score"), colony: document.getElementById("colony"), colonyWord: document.getElementById("colonyWord"),
    time: document.getElementById("time"), roleTag: document.getElementById("roleTag"),
    genome: document.getElementById("genome"), helix: document.getElementById("helix"),
    title: document.getElementById("title"), over: document.getElementById("over"), chartwrap: document.getElementById("chartwrap"), hud: document.getElementById("hud"),
    stage: document.getElementById("stage"), game: document.getElementById("game"),
    touch: document.getElementById("touch"), stickZone: document.getElementById("stickZone"),
    stickBase: document.getElementById("stickBase"), stickKnob: document.getElementById("stickKnob"),
    tEnz: document.getElementById("tEnz"),
    tLin: document.getElementById("tLin"), tPause: document.getElementById("tPause"),
    admin: document.getElementById("admin"), adminBody: document.getElementById("adminBody"),
    adminDoc: document.getElementById("adminDoc"),
    adminSearch: document.getElementById("adminSearch"), adminCount: document.getElementById("adminCount"),
    adminName: document.getElementById("adminName"), adminSave: document.getElementById("adminSave"),
    adminLoad: document.getElementById("adminLoad"), adminReset: document.getElementById("adminReset"),
    adminFile: document.getElementById("adminFile"), adminStatus: document.getElementById("adminStatus"),
    overTitle: document.getElementById("overTitle"), overMsg: document.getElementById("overMsg"),
    startBtn: document.getElementById("startBtn"), restartBtn: document.getElementById("restartBtn"),
    continueBtn: document.getElementById("continueBtn"),
    updateBtn: document.getElementById("updateBtn"),
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
    helpBtn2: document.getElementById("helpBtn2"), helpBtn3: document.getElementById("helpBtn3"),
    dayLen: document.getElementById("dayLen"),   // filled from CFG.day.lengthSec — it's a tunable knob
    circosPop: document.getElementById("circosPop"), circosCanvas: document.getElementById("circosCanvas"),
    circosCap: document.getElementById("circosCap"), detailCircos: document.getElementById("detailCircos"),
    demoCap: document.getElementById("demoCap"),   // attract-mode caption, over the ocean
    scoreTabs: document.getElementById("scoreTabs"),   // desktop / mobile leaderboard switch
    themeMeta: document.querySelector('meta[name="theme-color"]'),
    analysisClado: document.getElementById("analysisClado"), detailClado: document.getElementById("detailClado"),
    tutorialBtn: document.getElementById("tutorialBtn"), demoExit: document.getElementById("demoExit"),
    demoPlay: document.getElementById("demoPlay"), demoBack: document.getElementById("demoBack"),
    tutBar: document.getElementById("tutBar"), tutPrev: document.getElementById("tutPrev"), tutNext: document.getElementById("tutNext"),
    menuBtn: document.getElementById("menuBtn"), menuBtn2: document.getElementById("menuBtn2"),
    feedbackBtn: document.getElementById("feedbackBtn"), feedbackBtn2: document.getElementById("feedbackBtn2"),
    feedback: document.getElementById("feedback"), fbText: document.getElementById("fbText"),
    fbName: document.getElementById("fbName"), fbCtx: document.getElementById("fbCtx"),
    fbStatus: document.getElementById("fbStatus"), fbSend: document.getElementById("fbSend"),
    fbCancel: document.getElementById("fbCancel"),
    science: document.getElementById("science"), sciBody: document.getElementById("sciBody"), sciBack: document.getElementById("sciBack"),
    sciBtn: document.getElementById("sciBtn"), sciBtn2: document.getElementById("sciBtn2"), sciBtn3: document.getElementById("sciBtn3"),
    analysisChart: document.getElementById("analysisChart"), analysisStats: document.getElementById("analysisStats"),
    nameInput: document.getElementById("nameInput"),
    scoreDetail: document.getElementById("scoreDetail"), detailChart: document.getElementById("detailChart"),
    detailStats: document.getElementById("detailStats"), detailTitle: document.getElementById("detailTitle"),
    detailBack: document.getElementById("detailBack"),
    analysisSubChart: document.getElementById("analysisSubChart"), detailSubChart: document.getElementById("detailSubChart"),
    analysisSubLabel: document.getElementById("analysisSubLabel"), detailSubLabel: document.getElementById("detailSubLabel"),
  };
  const actx = el.analysisChart ? el.analysisChart.getContext("2d") : null;
  const asctx = el.analysisSubChart ? el.analysisSubChart.getContext("2d") : null;
  el.enz.forEach((e, i) => { if (e) e.style.setProperty("--gc", RESOURCES[i].color); }); // per-gene color (used when owned)
  if (el.abilChemo) el.abilChemo.style.setProperty("--gc", "#ffd24a"); // chemotaxis = gold
  if (el.abilCrispr) el.abilCrispr.style.setProperty("--gc", "#c39bff"); // CRISPR = violet
  if (el.enzTox) el.enzTox.style.setProperty("--gc", "#f05ad0"); // antibiotic = magenta
  const cctx = el.chart ? el.chart.getContext("2d") : null;
  const hlxCtx = el.helix ? el.helix.getContext("2d") : null;
  const el_subchart = document.getElementById("subchart");
  const sctx = el_subchart ? el_subchart.getContext("2d") : null;
  const el_subchartlegend = document.getElementById("subchartlegend");

  // -------------------------------------------------------------------- audio
  const Audio = (() => {
    const files = { eat: "assets/sounds/sound_40.mp3", enzyme: "assets/sounds/sound_145.mp3",
      divide: "assets/sounds/sound_18.mp3", death: "assets/sounds/sound_42.mp3",
      hit: "assets/sounds/sound_146.mp3", upgrade: "assets/sounds/sound_147.mp3",
      spawn: "assets/sounds/sound_37.mp3" };
    const SFX_MASTER = 0.05;  // ~10% of the music bus (0.3) — effects sit well under the ambient track
    let actx = null, sfxBus = null, muted = false; const buffers = {};
    async function init() {
      if (actx) { if (actx.state === "suspended") actx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = new AC();
      sfxBus = actx.createGain(); sfxBus.gain.value = SFX_MASTER; sfxBus.connect(actx.destination);
      await Promise.all(Object.entries(files).map(async ([n, url]) => {
        try { buffers[n] = await actx.decodeAudioData(await (await fetch(url)).arrayBuffer()); } catch (e) {}
      }));
    }
    function play(name, vol = 1) {
      if (muted || !actx || !buffers[name]) return;
      const s = actx.createBufferSource(); s.buffer = buffers[name];
      const g = actx.createGain(); g.gain.value = vol; s.connect(g).connect(sfxBus); s.start();
    }
    return { init, play, ctx: () => actx, setMuted: (m) => { muted = m; } };
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
    function set(want) { if (ctx && !!want !== on) toggle(); } // drive music to a specific on/off state
    return { start, toggle, set, playing: () => on };
  })();

  // M cycles the audio: all on → music off → effects off → both off
  const AUDIO_MODES = [
    { music: true,  sfx: true,  label: "🔊 sound on" },
    { music: false, sfx: true,  label: "🎵 music off" },
    { music: true,  sfx: false, label: "🔈 effects off" },
    { music: false, sfx: false, label: "🔇 muted" },
  ];
  let audioMode = 0, _flashT = null;
  function applyAudioMode() { const m = AUDIO_MODES[audioMode]; Music.set(m.music); Audio.setMuted(!m.sfx); }
  function cycleAudio() { audioMode = (audioMode + 1) % AUDIO_MODES.length; applyAudioMode(); flashAudioState(AUDIO_MODES[audioMode].label); }
  function flashAudioState(label) {
    const host = el.stage || (typeof document !== "undefined" && document.body); if (!host || !host.appendChild) return;
    let m = document.getElementById("audioFlash");
    if (!m) { m = document.createElement("div"); m.id = "audioFlash"; host.appendChild(m); }
    m.textContent = label; m.classList.add("show");
    if (_flashT) clearTimeout(_flashT);
    _flashT = setTimeout(() => m.classList.remove("show"), 1100);
  }

  // -------------------------------------------------------------- environment
  const env = {
    tempC: 20, salinity: 35, viscosity: 1, diffusivity: 1, metabolismMult: 1,
    update() {
      const tv = 1.4 - this.tempC/40, sv = 0.6 + this.salinity/70*0.6;
      this.viscosity = clamp(tv*sv, 0.45, 1.9);
      this.diffusivity = clamp((this.tempC+5)/25 / (0.7 + this.salinity/120), 0.3, 2.4);
      // Q10: metabolic rate multiplies by q10 for every 10 degrees above the reference temp.
      this.metabolismMult = Math.pow(CFG.diel.q10, (this.tempC - CFG.diel.q10RefC)/10);
    },
  };
  const TAU = Math.PI*2;
  // diel cycle: drive light/temp/food-supply/grazing from the time of day (tod 0→1 across the day).
  // Daylight over tod 0–0.5 (6am–6pm), night 0.5–1; the sun peaks at tod 0.25 (noon).
  // ---------------------------------------------------------------- solar geometry
  // The real sun, from latitude and day-of-year. One continuous function across the whole 24h —
  // no day phase and night phase running under different rules — but now it's the actual sun,
  // so sunrise and sunset fall out of the geometry instead of being assumed to be 6am and 6pm.
  // Above the Arctic Circle that gives midnight sun and polar night for free.
  const DEG = Math.PI/180;
  // Solar declination (Cooper's approximation): +23.44 deg at the June solstice, -23.44 at December.
  function solarDeclination(doy) { return 23.44*DEG * Math.sin(TAU * (284 + doy) / 365); }
  // sin(solar altitude): +1 = straight overhead, 0 = on the horizon, negative = below it.
  function sunElev(tod) {
    const lat = CFG.day.latitude*DEG, dec = solarDeclination(CFG.day.dayOfYear);
    const H = (dayHour(tod) - 12) * 15 * DEG;   // hour angle: 0 at solar noon, +-180 deg at midnight
    return Math.sin(lat)*Math.sin(dec) + Math.cos(lat)*Math.cos(dec)*Math.cos(H);
  }
  // Sunrise / sunset in local hours, from cos(H) = -tan(lat)tan(dec). When |cos H| > 1 the sun never
  // crosses the horizon at all — that's polar day or polar night, and it's a real answer, not an error.
  function sunTimes() {
    const lat = CFG.day.latitude*DEG, dec = solarDeclination(CFG.day.dayOfYear);
    const cosH = -Math.tan(lat)*Math.tan(dec);
    if (cosH <= -1) return { polar: "day",   sunrise: null, sunset: null, daylightHours: 24 };
    if (cosH >=  1) return { polar: "night", sunrise: null, sunset: null, daylightHours: 0 };
    const H = Math.acos(cosH)/DEG/15;           // half the daylength, in hours
    return { polar: null, sunrise: 12 - H, sunset: 12 + H, daylightHours: 2*H };
  }
  // The sea's color, lerped straight from midnight navy to midday teal. Coloring the WATER (rather
  // than washing a film over the finished frame) is what keeps the organisms at full contrast: at
  // noon the sea is bright and the cells still read sharply against it.
  function waterColor(light) {
    const N = CFG.diel.waterNight, D = CFG.diel.waterDay, t = clamp(light, 0, 1);
    const ch = (i) => Math.round(N[i] + (D[i] - N[i])*t);
    return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
  }
  // How much food the sea supports at this light level. Shared by updateDiel and the initial seed —
  // the board used to be seeded with the FULL substrate.count no matter the time of day, so a run
  // starting at midnight opened with 60 particles against a target of 21 and could only drift down.
  const foodTargetFor = (light) => Math.round(CFG.substrate.count *
    (CFG.diel.foodFloor + (1 - CFG.diel.foodFloor)*clamp(light, 0, 1)));
  function dielLight(tod) {
    // Light doesn't snap off the moment the sun touches the horizon — it fades out through twilight
    // as the sun keeps sinking. So the ramp is continuous, and deep night is genuinely dark because
    // the sun is genuinely down, not because a curve was clamped.
    const tw = CFG.diel.twilight;
    const t = clamp((sunElev(tod) + tw) / (1 + tw), 0, 1);
    return Math.pow(t, CFG.diel.lightGamma);                        // gamma deepens night, sharpens noon
  }
  // floor-mod, not %: the temperature lag evaluates the sun at (tod - lag), which goes negative
  // just after midnight, and JS's % would hand back a negative hour and wreck the hour angle.
  function dayHour(tod) { const h = (CFG.day.startHour + tod*24) % 24; return (h + 24) % 24; }
  function updateDiel() {
    // WRAP: a run can now span several days (Continue at the end of each one), so the sun has to
    // come round again. This was a clamp back when a run was exactly one day and stopped there.
    const D = CFG.diel, tod = (state.elapsed / CFG.day.lengthSec) % 1;
    const light = dielLight(tod);
    state.tod = tod; state.light = light;
    env.tempC = D.tempBase + D.tempAmp*Math.sin((tod - D.tempLag)*TAU); // warmest early afternoon
    env.salinity = 35;
    env.update();
    // in the dish the director sets the cast; out in the ocean the sun does
    state.foodTarget = (state.demo && state.demoFood) ? state.demoFood : foodTargetFor(light);
    state.graze = 0.6 + D.grazeNight*(1 - light); // grazers press harder at night
  }
  // composition succession over the day: fresh diatoms (lipid) bloom in the light → grazing makes
  // fecal pellets (protein) → it all ages into marine snow / chitin (carb detritus) by night.
  function dielKind() {
    const light = state ? (state.light || 0) : 0.5, tod = state ? (state.tod || 0) : 0;
    const afternoon = Math.max(0, Math.sin((tod - 0.12)*TAU)); // grazing response lags the bloom
    const night = 1 - light;
    const w = { diatom: 0.15 + 1.6*light, fecalPellet: 0.15 + 1.3*afternoon, marineSnow: 0.25 + 1.1*night, chitin: 0.3 };
    let tot = 0; for (const k in w) tot += w[k];
    let r = Math.random()*tot;
    for (const k in w) { r -= w[k]; if (r <= 0) return k; }
    return "marineSnow";
  }

  // ------------------------------------------------------------------- input
  const keys = {};
  addEventListener("keydown", (e) => {
    // Typing in a field (leaderboard name, tuning inputs) must not also drive the
    // cell — otherwise "m" mutes the music and Space fires an enzyme mid-word.
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    // match e.code too: on non-US layouts the key left of "1" doesn't emit a backtick
    if (e.key === "`" || e.code === "Backquote") { e.preventDefault(); toggleAdmin(); return; } // live-tuning panel
    if (adminOpen && e.key === "/" && el.adminSearch) { e.preventDefault(); el.adminSearch.focus(); el.adminSearch.select(); return; }
    if (e.key === "Escape") { if (adminOpen) { toggleAdmin(false); return; } if (sciOpen) { hideScience(); return; } if (helpOpen) { hideHelp(); return; }
      if (el.feedback && !el.feedback.classList.contains("hidden")) { hideFeedback(); return; }
      if (demo && demo.watch) { endTutorial(); return; }   // leave the tutorial, back to the menu
      if (!(state && state.demo)) togglePause(); return; }
    if (e.key.toLowerCase() === "m") { cycleAudio(); return; } // cycle: all on → music off → effects off → muted
    // Attract mode is running behind the title: any real keypress means "let me play", so drop
    // straight into a run rather than making them find the button.
    if (demo && !helpOpen && !sciOpen && !adminOpen && el.title && !el.title.classList.contains("hidden")
        && (e.key === "Enter" || e.key === " " || e.key.startsWith("Arrow") || "wasd".includes(e.key.toLowerCase()))) {
      e.preventDefault(); start(); return;
    }
    if (helpOpen || sciOpen || paused) return; // swallow gameplay input while a menu is up
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," ","Tab"].includes(e.key)) e.preventDefault();
    keys[e.key.toLowerCase()] = true;
    if (e.key === " ") playerEnzyme();
    if (!e.repeat && e.key === "Tab") cycleEnzyme();      // switch loaded enzyme / antibiotic
    if (!e.repeat && e.key === "Shift") switchControl();  // switch which lineage you're steering
  });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; });
  // on-screen thumbstick (mobile). Tap/flick a direction and the cell RUNS that way
  // for a few seconds on its own (no need to hold); dragging keeps re-aiming it, and
  // tapping the center stops. Direction only — the mover normalizes magnitude.
  // The stick LATCHES: push it to full deflection and hold that heading for
  // CFG.cell.touchLatchSecs, and the run locks in — let go and the cell keeps swimming that
  // way until you stop it (tap the stick's center). Below full deflection it's an ordinary
  // analog stick: you steer only while your thumb is down. Committing on a dwell-at-max is
  // predictable in a way a flick isn't — a flick's direction depends on exactly when the
  // browser last sampled your finger, which is not something a player can feel.
  // The dwell runs on a TIMER, not on the game loop: a thumb held perfectly still fires no
  // pointer events at all, and the loop can be throttled (background tab), so counting dt
  // would make the latch depend on things the player can't see.
  // touchVec carries DIRECTION AND MAGNITUDE (|v| ≤ 1): how far you pushed the stick is how hard
  // the cell swims. The mover reads the magnitude as a thrust multiplier.
  const touchVec = { x: 0, y: 0, active: false };
  const touchLatchVec = { x: 0, y: 0 }; // the committed run's vector, so the decay can ease it out
  let touchLatched = false;  // a locked-in run survives the finger lifting
  let touchRunT = 0;         // ...but only for this long: it winds down instead of sticking on
  let touchAtMax = false;    // thumb is out at the rim right now
  let _latchTimer = null;
  function axis() {
    // latched, or thumb currently down and off-center
    if ((touchLatched || touchVec.active) && (touchVec.x || touchVec.y)) return { x: touchVec.x, y: touchVec.y };
    let x = 0, y = 0;
    if (keys["a"]||keys["arrowleft"]) x -= 1; if (keys["d"]||keys["arrowright"]) x += 1;
    if (keys["w"]||keys["arrowup"]) y -= 1; if (keys["s"]||keys["arrowdown"]) y += 1;
    return { x, y };
  }

  // --------------------------------------------------------- helpers (torus)
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  // how fast swimming things move; halved on a phone (read live, so the tuning slider works)
  const swimScale = () => (isTouch ? CFG.touchSpeedScale : 1);
  // The speed a cell's thrust can actually sustain against drag. At low Reynolds number that IS
  // the cell's speed — there is no momentum to accumulate — so this is a velocity, not a target to
  // accelerate toward. `f` scales the thrust: how far the stick is pushed, or a fed cell's amble.
  const swimSpeed = (f, visc) => Math.min(CFG.cell.thrust*f/(CFG.cell.dragRate*visc),
                                          CFG.cell.maxSpeed/Math.sqrt(visc)) * swimScale();
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
  let ZOOM = 1; // world magnification — bumped on touch devices so cells aren't tiny on a small screen
  let isTouch = false; // coarse-pointer device → mobile control + HUD layout (minimap top-left, etc.)
  let chartLog = false; // generation-history charts: log vs. linear y-axis (toggled by clicking a chart)
  let subMode = 0;      // lower chart: 0 = food available, 1 = cause of mortality (toggled by clicking it)

  function cellHalfLen(c) {
    return clamp(CFG.cell.baseHalf + Math.max(0, c.energy - CFG.cell.lenBaseEnergy)*CFG.cell.elongK,
                 CFG.cell.baseHalf, CFG.cell.maxHalf);
  }
  // cell poles in LOCAL coords relative to the cell center (for torus-safe checks)
  function cellPolesLocal(c) {
    const hl = cellHalfLen(c) - CFG.cell.radius, ax = Math.cos(c.angle), ay = Math.sin(c.angle);
    return [ax*hl, ay*hl, -ax*hl, -ay*hl];
  }
  function cellDistTo(c, x, y) {
    const p = cellPolesLocal(c);
    return segDist(dx(x, c.x), dy(y, c.y), p[0], p[1], p[2], p[3]);
  }

  // The adaptation pool a gold phage transduces: one option per enzyme (acquire it if locked, else
  // raise its expression), plus chemotaxis / antibiotic / CRISPR. Genes aren't guaranteed each time,
  // so runs skew per-skill. Shared with cell.startUpgrades, which pre-loads the starting cell.
  // Losing a gene is as real as gaining one — carrying a gene you aren't using costs upkeep, and
  // streamlining is what actually happens to marine genomes. This is the other half of the drift.
  // The founding carbohydrase is never lost: without it a cell can eat nothing at all.
  function loseRandomUpgrade(c) {
    const opts = [];
    if (c.enzLvl[0] > 0) opts.push(0);
    if (c.enzLvl[1] > 0) opts.push(1);
    if (c.enzLvl[2] > 1) opts.push(2);              // down to the founding level, never below
    if (c.chemoLevel > 0) opts.push("chemo");
    if (c.crispr) opts.push("crispr");
    if (c.antibiotic > 0) opts.push("antibiotic");
    if (!opts.length) return null;
    const pick = opts[(Math.random()*opts.length)|0];
    let locus, color;
    if (pick === "crispr") { c.crispr = false; locus = "Cr"; color = CRISPR_COLOR; }
    else if (pick === "antibiotic") { c.antibiotic--; locus = "Ab"; color = TOXIN_COLOR; }
    else if (pick === "chemo") { c.chemoLevel--; if (!c.chemoLevel) c.chemotaxis = false; locus = "T"; color = "#ffd24a"; }
    else { c.enzLvl[pick]--; locus = ["L","P","C"][pick]; color = RESOURCES[pick].color; }
    // drop the LAST log entry for that locus, so the genome and its history still agree
    const ups = (c.ups || []).slice();
    for (let k = ups.length - 1; k >= 0; k--) if (locusOf(ups[k]) === locus) { ups.splice(k, 1); break; }
    c.ups = ups;
    return { color };
  }
  // DRIFT. Your cell taking a gene is a single event in one lineage; on its own the population just
  // tracks you, and the chart becomes one colour marching up the screen. So every time you adapt,
  // somewhere else in the sea another cell also changes — it gains a random gene, or it loses one.
  // That keeps a spread of genomes alive around you, which is what makes the ecotype chart (and
  // kill-the-winner, which needs variety in adaptation level to bite) mean anything.
  function driftAnotherCell(source) {
    if (!CFG.cell.driftOnUpgrade) return;
    const pool = cells.filter((c) => c.alive && !c.cyst && c !== source);
    if (!pool.length) return;
    const c = pool[(Math.random()*pool.length)|0];
    const gain = Math.random() < CFG.cell.driftGainChance;
    const u = gain ? grantRandomUpgrade(c) : loseRandomUpgrade(c);
    if (u) burst(c.x, c.y, u.color, gain ? 8 : 5);   // you can SEE diversity happening out there
  }
  function grantRandomUpgrade(c) {
    const u = grantRandomUpgrade_(c);
    // concat, not push: daughters share the parent's array by reference until one of them adapts, and
    // a push would rewrite the other lineage's history too.
    c.ups = (c.ups || []).concat([{ t: state ? state.elapsed : 0, label: u.msg, abbr: u.abbr, color: u.color, acquired: u.acquired }]);
    return u;
  }
  function grantRandomUpgrade_(c) {
    const pool = ["chemo", "enz0", "enz1", "enz2", "antibiotic"];
    if (!c.crispr) pool.push("crispr");            // one-time: phage-immune-harvesting defense system
    const pick = pool[(Math.random()*pool.length)|0];
    if (pick === "crispr") {
      c.crispr = true;
      return { msg: "CRISPR", color: CRISPR_COLOR, abbr: "Cr", acquired: true };
    }
    if (pick === "antibiotic") {
      const acquired = c.antibiotic === 0; c.antibiotic++;
      return { msg: "Antibiotic " + c.antibiotic, color: TOXIN_COLOR, abbr: "Ab" + c.antibiotic, acquired };
    }
    if (pick === "chemo") {
      const acquired = !c.chemotaxis;
      if (acquired) { c.chemotaxis = true; c.chemoLevel = 1; } else c.chemoLevel++;
      return { msg: "Chemotaxis " + c.chemoLevel, color: "#ffd24a", abbr: "T" + c.chemoLevel, acquired };
    }
    const i = +pick[3]; c.enzLvl[i]++;             // 0 -> 1 = newly acquired gene, else more expression
    const name = RESOURCES[i].enzyme;
    return { msg: name[0].toUpperCase() + name.slice(1) + " " + c.enzLvl[i],
             color: RESOURCES[i].color, abbr: ["L", "P", "C"][i] + c.enzLvl[i],
             acquired: c.enzLvl[i] === 1 };
  }
  function makeCell(x, y, energy, angle, gen) {
    return { x: wrapX(x), y: wrapY(y), vx: 0, vy: 0, angle, energy, gen: gen || 1,
      controlled: false, alive: true, invuln: CFG.cell.invulnTime, cyst: false,
      tumbling: false, runTimer: rand(CFG.cell.runMin, CFG.cell.runMax), tumbleT: 0, tumbleTarget: angle,
      fed: 0, enzCd: rand(CFG.cell.enzymeCooldown[0], CFG.cell.enzymeCooldown[1]),
      infectedGreen: false, lysisT: 0, chemotaxis: false, chemoLevel: 0, crispr: false, antibiotic: 0, toxT: 0,
      // This cell's OWN adaptation log, in the order it was acquired — inherited whole by its
      // daughters. The player's run-level log (state.upgrades) only ever knew about the cell you were
      // steering; this is what lets every lineage on the chart show its own genome.
      ups: [],
      enzLvl: [0, 0, 1] }; // per-enzyme expression level [lipase, protease, carbohydrase]; 0 = locked, carb starts at 1
  }
  // Build an adaptation log from a genome, for cells that were never *granted* anything — immigrants
  // drift in with a ready-made genome, so their true acquisition order is unknowable. Canonical order
  // is the honest answer: it says WHAT the lineage carries without inventing a history it never had.
  function genomeUps(c) {
    const u = [], push = (label, abbr, color, acquired) => u.push({ t: 0, label, abbr, color, acquired });
    for (let i = 0; i < 3; i++) {
      const base = i === 2 ? 1 : 0;                  // carbohydrase is the starting gene, not an adaptation
      const name = RESOURCES[i].enzyme;
      for (let k = base + 1; k <= c.enzLvl[i]; k++)
        push(name[0].toUpperCase() + name.slice(1) + " " + k, ["L","P","C"][i] + k, RESOURCES[i].color, k === 1);
    }
    for (let k = 1; k <= (c.chemoLevel || 0); k++) push("Chemotaxis " + k, "T" + k, "#ffd24a", k === 1);
    if (c.crispr) push("CRISPR", "Cr", CRISPR_COLOR, true);
    for (let k = 1; k <= (c.antibiotic || 0); k++) push("Antibiotic " + k, "Ab" + k, TOXIN_COLOR, k === 1);
    return u;
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
  // genome as a vector of loci → "genetic distance" (Manhattan) between two cells, for cross-reactive antibiotics
  function genomeOf(c) { return [c.enzLvl[0], c.enzLvl[1], c.enzLvl[2], c.chemoLevel, c.crispr ? 1 : 0, c.antibiotic || 0]; }
  function genDist(g, c) {
    return Math.abs(g[0]-c.enzLvl[0]) + Math.abs(g[1]-c.enzLvl[1]) + Math.abs(g[2]-c.enzLvl[2])
         + Math.abs(g[3]-c.chemoLevel) + Math.abs(g[4]-(c.crispr?1:0)) + Math.abs(g[5]-(c.antibiotic||0));
  }

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
    return dielKind(); // otherwise the composition follows the daily production→grazing→detritus succession
  }
  function makeSubstrate(kind) {
    const k = kind || pickBalancedKind();
    const spec = PARTICLES[k];
    // In the dish, scale them down: at full size two particles fill the glass and there's nowhere
    // left to show a cell swimming, a grazer hunting, or a virus drifting.
    const R = powerLawSize() * (demoWorld ? CFG.demo.foodScale : 1);
    const rot = rand(0, Math.PI*2), seed = rand(0, 100);
    const cs = CFG.grid.cs, n = Math.ceil(2*R/cs) + 2, half = n*cs/2;
    // sub-blob centers for aggregates
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

  // Resolve the rod against every solid particle: three probes — both poles and the centre.
  // (The gaps BETWEEN probes are why a very long cell can still clip a one-voxel wall; substepping
  // stops the tunnelling, not the sampling. Worth more probes on a long cell if that ever shows.)
  function collideRod(c) {
    const pl = cellPolesLocal(c);
    const pts = [[c.x + pl[0], c.y + pl[1]], [c.x, c.y], [c.x + pl[2], c.y + pl[3]]];
    for (const [px, py] of pts) {
      const probe = { x: px, y: py, vx: c.vx, vy: c.vy };
      collideCircle(probe, CFG.cell.radius);
      c.x = wrapX(c.x + (probe.x - px)); c.y = wrapY(c.y + (probe.y - py));
      c.vx = probe.vx; c.vy = probe.vy;
    }
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
      vx: 0, vy: 0, r: CFG.predator.radius, satiated: 0, controlled: false,
      heading: rand(0, 6.28), wobble: rand(0, 6.28), pseudo: rand(0, 6.28),
      age: age || 0, energy: energy == null ? CFG.predator.startEnergy : energy,
      reproCd: CFG.predator.reproCooldown, toxT: 0, turboT: 0, dead: false };
  }

  function newGame(isDemo) {
    demoWorld = !!isDemo;                    // set FIRST: makeSubstrate reads it while seeding
    // THE TUTORIAL IS A PETRI DISH. Shrink the world to the viewport, so everything the director
    // stages is on screen from the moment it exists and the camera can sit perfectly still. A real
    // run gets the whole ocean back.
    if (isDemo) setWorld(VIEW_W, VIEW_H); else setWorld(WORLD_DEF_W, WORLD_DEF_H);
    const first = makeCell(WORLD_W/2, WORLD_H/2, CFG.cell.startEnergy, -Math.PI/2, 1);
    for (let i = 0; i < Math.round(CFG.cell.startUpgrades); i++) grantRandomUpgrade(first); // testing aid
    // In the demo NOTHING is controlled: the attract mode is the simulation running itself, and a
    // cell left "controlled" with no one at the keys would just sit there tumbling in place.
    first.controlled = !isDemo; cells = [first]; // start as a single founder cell
    substrates = [];
    // A run opens at day.startHour (midnight by default). The DEMO opens at midday instead: a dark,
    // empty, becalmed midnight sea is the worst possible advert for the game. Noon is the bloom.
    const tod0 = isDemo ? 0.5 : 0;
    // In the dish the DIRECTOR owns the cast: a handful of particles and nothing else. Every protist,
    // every phage arrives because a beat introduced it, which is the only way a lesson stays a lesson.
    const seedFood = isDemo ? CFG.demo.food : foodTargetFor(dielLight(tod0));
    for (let i = 0; i < seedFood; i++) substrates.push(makeSubstrate());
    predators = [];
    if (!isDemo) for (let i = 0; i < CFG.predator.count; i++) {
      let x, y; // keep initial protists away from the lone founder
      do { x = rand(0, WORLD_W); y = rand(0, WORLD_H); } while (toroDist2(x, y, WORLD_W/2, WORLD_H/2) < 550*550);
      predators.push(makePredator(x, y, null, rand(0, 25)));
    }
    enzymes = []; toxins = []; nutrients = []; particles = [];
    phages = [];
    if (!isDemo) for (let i = 0; i < CFG.phage.greenCount; i++) { // seed OFFSCREEN so no virus is on the opening view — they diffuse in
      const a = rand(0, 6.28), d = Math.hypot(VIEW_W, VIEW_H)/2 + rand(80, 500);
      phages.push(makePhage("green", wrapX(first.x + Math.cos(a)*d), wrapY(first.y + Math.sin(a)*d)));
    }
    // first gold is spawned by the always-on-board respawn logic (same buried-in-particle rule)
    cam.x = first.x; cam.y = first.y;
    state = { gen: 1, score: 0, running: true, elapsed: tod0*CFG.day.lengthSec, activeEnzyme: 2, role: "bacterium", // start with carbohydrase, as a bacterium
      day: 1, runId: Date.now(),   // runId is stable across days: continuing UPDATES the leaderboard entry, never adds a second one
      greenSeedT: rand(CFG.phage.greenSeed[0], CFG.phage.greenSeed[1]),
      predImmigrateT: CFG.predator.immigrateEvery, preyT: 0, turboBonus: 0,
      predRespawn: CFG.predator.immigrateEvery, predExtinct: false, // respawn interval halves each time protists go fully extinct
      mortLive: [0, 0, 0, 0], mortFull: [0, 0, 0, 0], // cause-of-death tallies (grazing/viral/starvation/antibiotic) per sample interval
      tod: tod0, light: dielLight(tod0), foodTarget: seedFood, graze: 1, foodT: 0, // diel state (updateDiel refreshes each frame)
      chartT: 0, history: [], fullT: 0, fullHist: [], fullInterval: 1, upgrades: [],
      lineages: {},   // bucket key (ecotype+tier, i.e. one colored band) → that lineage's genome
      roleSwaps: [],  // when you flipped trophic level — the biggest event a run can have
      dead: [],       // seed bank: genomes of everything that has died, for cysts to revive from

      // Stamped ONCE, at the start of the run, not per day: continuing into day 2 re-submits the
      // same run id, and a run must not be able to change which board it belongs to halfway through.
      device: isTouch ? "touch" : "desktop",
      demo: !!isDemo, demoFood: isDemo ? CFG.demo.food : null };
    updateDiel();
    if (!isDemo) Audio.play("spawn", 0.5);
  }

  function controlledCell() { return cells.find((c) => c.controlled && c.alive); }
  function controlledProtist() { return predators.find((p) => p.controlled); }

  // ------------------------------------------------------------------- attract mode
  // The sim already plays itself — cells forage, divide, encyst, get eaten and lyse with nobody at
  // the keys. So the tutorial is not a second simulation: it's a DIRECTOR. Each beat STAGES its
  // mechanic (put a grazer next to a cell; hand a cell a gene), points the camera at it, and
  // captions it. Staging beats waiting: left to chance a phage might not lyse anything for 30s, and
  // a tutorial that might not happen is not a tutorial.
  // When the beats run out it doesn't stop — it drifts on as a screensaver behind the title menu.
  let demo = null;
  const alive = (e) => e && e.alive !== false && !e.dead;
  const anyCell = () => cells.find((c) => c.alive && !c.cyst) || cells[0];
  function demoFocus(e, secs) { if (e) { demo.focus = e; demo.hold = secs || 0; } }
  // Put a fresh entity somewhere sensible inside the dish, near the middle, clear of the rim.
  function dishSpot(distFromCentre) {
    const a = rand(0, TAU), d = distFromCentre != null ? distFromCentre : rand(60, dishRadius()*0.55);
    return { x: WORLD_W/2 + Math.cos(a)*d, y: WORLD_H/2 + Math.sin(a)*d };
  }
  const near = (e, dist) => { const a = rand(0, TAU); return { x: e.x + Math.cos(a)*dist, y: e.y + Math.sin(a)*dist }; };
  const centre = (e) => { if (e) { e.x = WORLD_W/2; e.y = WORLD_H/2; } return e; };
  const DEMO_BEATS = [
    { cap: "This is one <b>bacterium</b>. It cannot steer: it swims in a straight line — a <b>run</b> — then <b>tumbles</b> to a random new heading, and repeats. It is not looking for anything. It cannot.",
      secs: 9, setup: () => centre(anyCell()) },
    // THE FOOD. Introduce the three resources by colour, on an actual particle, before anything eats one.
    { cap: "Its food is <b>marine snow</b> — dead plankton and waste, sinking. Each particle is a patchwork of three things: <b class='c-lip'>lipid</b>, <b class='c-pro'>protein</b> and <b class='c-carb'>carbohydrate</b>. Watch the colours.",
      secs: 10, setup: () => centre(substrates.find((p) => p.phase === "live")) || null },
    { cap: "A bacterium is far too small to swallow any of it. So it digests from the OUTSIDE: it releases an <b>enzyme</b>, the matching blocks dissolve, and it absorbs what comes loose. One enzyme per resource — and it starts with only <b class='c-carb'>carbohydrase</b>.",
      secs: 12, setup: () => {                       // park a cell on the doorstep of a particle
        const c = anyCell(), s = centre(substrates.find((p) => p.phase === "live"));
        if (c && s) { const a = rand(0, TAU); c.x = s.x + Math.cos(a)*(s.R + 24); c.y = s.y + Math.sin(a)*(s.R + 24);
          c.angle = Math.atan2(dy(s.y, c.y), dx(s.x, c.x)); c.tumbling = false; c.enzCd = 0.2; }
        return c;
      } },
    { cap: "Fed well enough, it <b>elongates and divides</b>. Every cell becomes two, so a colony goes exponential — 1, 2, 4, 8…",
      secs: 9, setup: () => centre(anyCell()),
      tick: (c, t) => { if (alive(c) && t > 2.5) c.energy = CFG.cell.divideThreshold + 1; } },  // nudge it over the line, on camera
    // THE PREDATOR. Focus the PROTIST, not the cell — it's the thing being introduced.
    { cap: "This is a <b style='color:#ff9ec0'>protist</b>: a single-celled hunter one trophic level up. It doesn't dissolve its food — it engulfs bacteria whole. This is the link that carries all this carbon up the food web.",
      secs: 11, setup: () => {
        const c = anyCell(); if (!c) return null;
        const pr = makePredator(WORLD_W/2, WORLD_H/2, CFG.predator.startEnergy, 0);
        predators.push(pr);
        const p = near(pr, 120); c.x = p.x; c.y = p.y;   // its dinner, beside it
        return pr;                                       // the grazer is the subject
      } },
    // THE VIRUSES. Both colours, side by side, with the phage itself in the ring.
    { cap: "<b style='color:#8bf06a'>Green</b> and <b style='color:#ff5a52'>red</b> are the same creature — a <b>phage</b> — coloured by what it can do to YOU. <b style='color:#8bf06a'>Green</b> can't infect this cell. <b style='color:#ff5a52'>Red</b> can. A phage cannot chase: it drifts until it collides.",
      secs: 12, setup: () => {
        const c = centre(anyCell()); if (!c) return null;
        demo.hero = c;                                // red/green is judged against this cell
        const tier = upgradeTier(c);
        let shown = null;
        for (let i = 0; i < 3; i++) {                 // reds: tuned to this cell's tier
          const p = near(c, rand(70, 130));
          const ph = makePhage("green", p.x, p.y, tier);
          phages.push(ph); if (!shown) shown = ph;
        }
        for (let i = 0; i < 3; i++) {                 // greens: tuned far away, harmless to it
          const p = near(c, rand(70, 130));
          phages.push(makePhage("green", p.x, p.y, tier + CFG.phage.hostTolerance + 3));
        }
        return shown;                                 // ring the virus, not the cell
      } },
    { cap: "A <b style='color:#ff5a52'>red</b> one that lands injects its DNA, turns the cell into a factory, and bursts it open — a <b>lysis</b> that seeds the water with more phages. This is the commonest death in the ocean.",
      secs: 10, setup: () => {
        const c = centre(anyCell()); if (!c) return null;
        demo.hero = c;
        c.infectedGreen = true; c.lysisT = 5;         // on a schedule, not on a dice roll
        return c;
      } },
    // THE GOLD. Ring the phage first — it's the thing you'll spend the game chasing.
    { cap: "And this one — the <b style='color:#ffd24a'>gold phage</b> — doesn't kill. It rewrites: it carries a new gene INTO the cell. It is the only thing in this sea that changes what you can do, and it is rare.",
      secs: 8, setup: () => {
        const c = anyCell(); if (!c) return null;
        demo.hero = c;
        const ph = makePhage("gold", WORLD_W/2, WORLD_H/2);
        ph.vx = ph.vy = 0;
        phages.push(ph);
        demo.gold = ph;
        const p = near(ph, 150); c.x = p.x; c.y = p.y;
        return ph;                                     // the gold is the subject; the cell comes to it
      },
      tick: (ph, t) => {                               // swim the cell in, on cue
        const c = demo.hero;
        if (ph && !ph.dead && alive(c) && t > 1.2) {
          const k = 1 - Math.exp(-1.1*0.016);
          c.x += (ph.x - c.x)*k; c.y += (ph.y - c.y)*k;
          c.angle = Math.atan2(ph.y - c.y, ph.x - c.x);
        }
      } },
    { cap: "Caught. This lineage just gained <b class='c-lip'>lipase</b> — it can dissolve the <b class='c-lip'>fatty</b> blocks it used to swim straight past. Everything it does from now on, its daughters inherit.",
      secs: 9, setup: () => {
        const c = centre((demo.hero && alive(demo.hero)) ? demo.hero : anyCell()); if (!c) return null;
        if (demo.gold && !demo.gold.dead) demo.gold.dead = true;
        c.enzLvl[0] = Math.max(1, c.enzLvl[0]);      // lipase — deliberately, so it answers the food beat
        c.ups = (c.ups || []).concat([{ t: state.elapsed, label: "Lipase 1", abbr: "L1", color: RESOURCES[0].color, acquired: true }]);
        burst(c.x, c.y, "#ffd24a", 22);
        Audio.play("upgrade", 0.5);
        return c;
      } },
  ];
  // ============================================================ interactive tutorial
  // The attract loop is a film: it plays itself, on a timer, behind the menu. The TUTORIAL is not a
  // film — you drive. Each step names one thing to do and waits for you to actually do it; the timer
  // is gone. Back/Skip exist for anyone who wants out of a step, but the default path through is to
  // play it. Both share the dish, the director's control of the cast, and the still camera.
  let tut = null;
  const ctrlCell = () => cells.find((c) => c.controlled && c.alive);
  function tutDid(flag) { if (tut && !tut.done) tut.flags[flag] = true; }
  function grantCrispr(c) {                     // the tutorial promises CRISPR, so it delivers CRISPR
    c.crispr = true;
    c.ups = (c.ups || []).concat([{ t: state ? state.elapsed : 0, label: "CRISPR", abbr: "Cr", color: CRISPR_COLOR, acquired: true }]);
    return { msg: "CRISPR", color: CRISPR_COLOR, abbr: "Cr", acquired: true };
  }
  function clearCast(keepFood) {                // each step stages its own scene, and only its own
    predators.length = 0; phages.length = 0; toxins.length = 0;
    if (!keepFood) substrates.length = 0;
  }
  function spawnCarbParticle() {                // chitin is 70% carbohydrate — the one you can already eat
    const s = makeSubstrate("chitin");
    const p = dishSpot(dishRadius()*0.55);
    s.x = p.x; s.y = p.y; s.vx = s.vy = 0;
    substrates.push(s);
    return s;
  }
  const TUT_STEPS = [
    { cap: "You are this <b>bacterium</b>. Swim with the <b>arrow keys</b> or <b>WASD</b> — and notice that you stop the instant you let go. At this size, water is as thick as honey.",
      goal: "Swim to the <b>ringed</b> particle — the <b class='c-carb'>blue</b> blocks in it are carbohydrate",
      setup: () => { clearCast(); const s = spawnCarbParticle(); tut.target = s; demo.focus = s; centre(ctrlCell()); },
      done: () => { const c = ctrlCell(), s = tut.target;
        return !!(c && s && Math.hypot(dx(c.x, s.x), dy(c.y, s.y)) < s.R + 46); } },

    { cap: "You are far too small to swallow it. So you digest it from the OUTSIDE: <b>Space</b> releases your <b class='c-carb'>carbohydrase</b>, the <b class='c-carb'>blue</b> blocks dissolve, and you absorb what comes loose.",
      goal: "Face the particle and press <b>Space</b> — eat something",
      setup: () => { if (!tut.target || tut.target.organic <= 0) { clearCast(); tut.target = spawnCarbParticle(); }
        demo.focus = tut.target; tut.score0 = state.score; },
      done: () => state.score > (tut.score0 || 0) + 2 },

    { cap: "This is a <b style='color:#ff9ec0'>protist</b> — a single-celled hunter, and bacteria are what it eats. It doesn't dissolve you from outside the way you eat a particle: it engulfs you whole. You cannot outswim it forever.<br><em style='opacity:.8'>There is something a bacterium can do about a grazer. You don't have it yet.</em>",
      goal: "Let it catch you. <b>Get eaten.</b>",
      setup: () => { clearCast(true); const c = centre(ctrlCell());
        const pr = makePredator(WORLD_W/2 + 170, WORLD_H/2, CFG.predator.startEnergy, 0);
        predators.push(pr); demo.focus = pr; if (c) c.invuln = 0; },
      done: () => !!tut.flags.eaten },

    { cap: "<b style='color:#ff5a52'>Red</b> phages can infect <em>you</em>; <b style='color:#8bf06a'>green</b> ones can't. A phage cannot chase — it drifts, and waits to collide.",
      goal: "Swim into a <b style='color:#ff5a52'>red</b> phage. <b>Get infected.</b>",
      setup: () => { clearCast(true); const c = centre(ctrlCell()); if (!c) return;
        demo.hero = c; c.invuln = 0; c.infectedGreen = false;
        const tier = upgradeTier(c);
        for (let i = 0; i < 7; i++) { const p = near(c, rand(120, 210)); const ph = makePhage("green", p.x, p.y, tier); ph.vx = ph.vy = 0; phages.push(ph); if (i === 0) demo.focus = ph; } },
      done: () => { const c = ctrlCell(); return !!(tut.flags.infected || (c && c.infectedGreen)); } },

    { cap: "Not every phage kills. The <b style='color:#ffd24a'>gold</b> one carries a gene INTO you instead — it is the only thing in this sea that changes what you can <em>do</em>.",
      goal: "Catch the <b style='color:#ffd24a'>gold phage</b> — it carries <b>CRISPR</b>",
      setup: () => { clearCast(true); const c = centre(ctrlCell()); if (!c) return;
        c.infectedGreen = false; c.crispr = false;      // a clean slate, so the gene is the news
        const p = near(c, 190); const ph = makePhage("gold", p.x, p.y); ph.vx = ph.vy = 0;
        phages.push(ph); demo.focus = ph; },
      done: () => { const c = ctrlCell(); return !!(tut.flags.adapted || (c && c.crispr)); } },

    { cap: "<b>CRISPR</b> is a real immune system: it files away the DNA of viruses that attacked you and shreds them on sight. A phage that cannot infect you stops being a threat and becomes <b>lunch</b>.",
      goal: "Swim into a <b style='color:#8bf06a'>green</b> phage. <b>Eat it.</b>",
      setup: () => { clearCast(true); const c = centre(ctrlCell()); if (!c) return;
        demo.hero = c; if (!c.crispr) grantCrispr(c);   // Skip'd past the last step? You still get the gene.
        const tier = upgradeTier(c);
        for (let i = 0; i < 8; i++) { const p = near(c, rand(110, 200));
          const ph = makePhage("green", p.x, p.y, tier + CFG.phage.hostTolerance + 4);  // immune to you = edible
          ph.vx = ph.vy = 0; phages.push(ph); if (i === 0) demo.focus = ph; } },
      done: () => !!tut.flags.atePhage },
  ];
  function startTutorial() {
    stopDemo();
    newGame(true);                              // demo state: dish world, no score, no leaderboard
    const first = cells[0];
    first.controlled = true;                    // ...but YOU drive this one
    demo = { i: -1, t: 0, secs: Infinity, focus: null, idle: false, idleT: 0,
             dish: true, rim: 0, hero: first, gold: null, watch: true, interactive: true };
    tut = { i: -1, flags: {}, done: false, doneT: 0, target: null, score0: 0 };
    if (el.title) el.title.classList.add("hidden");
    if (el.demoExit) el.demoExit.classList.remove("hidden");
    if (el.tutBar) el.tutBar.classList.remove("hidden");
    gotoTutStep(0);
  }
  function stopTutorial() {
    tut = null;
    if (el.tutBar) el.tutBar.classList.add("hidden");
  }
  function gotoTutStep(i) {
    if (!tut) return;
    tut.i = clamp(i, 0, TUT_STEPS.length - 1);
    tut.flags = {}; tut.done = false; tut.doneT = 0;
    const c = ctrlCell();
    if (c) { c.energy = Math.max(c.energy, CFG.cell.startEnergy); c.infectedGreen = false; }
    TUT_STEPS[tut.i].setup();
    renderTutStep();
  }
  function renderTutStep(done) {
    const st = TUT_STEPS[tut.i];
    if (el.demoCap) {
      el.demoCap.innerHTML =
        `<i>step ${tut.i + 1} / ${TUT_STEPS.length}</i><span>${st.cap}</span>` +
        (done ? `<b class="tutgoal ok">✓ done</b>` : `<b class="tutgoal">▸ ${st.goal}</b>`);
      el.demoCap.classList.remove("hidden");
      el.demoCap.classList.add("tut");        // sits above the Back/Skip bar
    }
    if (el.tutPrev) el.tutPrev.disabled = tut.i === 0;
    if (el.tutNext) el.tutNext.textContent = tut.i === TUT_STEPS.length - 1 ? "Finish ▶" : "Skip ▶";
  }
  function tutNext() {
    if (!tut) return;
    if (tut.i >= TUT_STEPS.length - 1) { finishTutorial(); return; }
    gotoTutStep(tut.i + 1);
  }
  // The reward for finishing is the ocean itself: the glass dissolves, the dish opens out, and the
  // sea runs on by itself. Control is handed back to the cells — from here you're watching, and the
  // camera drifts. Nudge it with the arrow keys whenever you want a closer look at something.
  function finishTutorial() {
    stopTutorial();
    if (el.demoCap) el.demoCap.classList.add("hidden");
    cells.forEach((c) => (c.controlled = false));
    if (demo) {
      demo.interactive = false; demo.idle = true; demo.idleT = 0;
      demo.i = DEMO_BEATS.length; demo.secs = Infinity;
      openDemoWorld();
    }
  }
  function tutPrev() { if (tut) gotoTutStep(tut.i - 1); }
  function updateTutorial(dt) {
    if (!tut || !demo) return;
    // Your cell being eaten is the LESSON in step 3, not a failure — so the sea hands you another one
    // instead of flipping you to a protist. (A tutorial that ends by taking the game away is a joke.)
    if (!cells.some((c) => c.alive)) {
      const c = makeCell(WORLD_W/2, WORLD_H/2, CFG.cell.startEnergy, rand(0, TAU), 1);
      c.controlled = true; c.invuln = 1.5; cells.push(c);
      demo.hero = c;
    } else if (!ctrlCell()) { const c = cells.find((x) => x.alive); if (c) { c.controlled = true; demo.hero = c; } }
    if (tut.done) {                              // held on "✓ done" for a beat, then move on
      tut.doneT -= dt;
      if (tut.doneT <= 0) tutNext();
      return;
    }
    if (TUT_STEPS[tut.i].done()) {
      tut.done = true; tut.doneT = 1.6;
      Audio.play("upgrade", 0.5);
      renderTutStep(true);
    }
  }

  // The attract film: plays itself, on a timer, behind the title menu.
  function startDemo() {
    newGame(true);
    demo = { i: -1, t: 0, secs: 0, focus: null, hold: 0, idle: false, idleT: 0,
             dish: true, rim: 0, hero: null, gold: null };
    nextDemoBeat();
  }
  function stopDemo() {
    stopTutorial();
    demo = null;
    if (el.demoCap) el.demoCap.classList.add("hidden");
    if (el.demoExit) el.demoExit.classList.add("hidden");
  }
  // The attract loop plays behind the title menu, which covers most of it — fine as a backdrop, no
  // good as a lesson. WATCHING the tutorial pulls the menu away so you can actually see the ocean,
  // and replays it from beat 1.
  function watchTutorial() { startTutorial(); }
  function endTutorial() {                    // back to the menu; the attract loop resumes behind it
    stopTutorial();
    if (el.demoExit) el.demoExit.classList.add("hidden");
    startDemo();                             // the title needs its living ocean back
    if (el.title) el.title.classList.remove("hidden");
  }
  // Once you'd started a run there was NO WAY BACK to the title — so no way to reach the tutorial,
  // or the attract loop, without reloading the page. Every screen you can be stuck on now has a door.
  function toTitle() {
    paused = false;
    if (el.demoExit) el.demoExit.classList.add("hidden");
    if (el.over) el.over.classList.add("hidden");
    if (el.scores) el.scores.classList.add("hidden");
    if (el.scoreDetail) el.scoreDetail.classList.add("hidden");
    hideCircos();
    startDemo();                              // the sea goes back to playing itself behind the menu
    if (el.title) el.title.classList.remove("hidden");
  }
  function nextDemoBeat() {
    if (!demo) return;
    demo.i++; demo.t = 0;
    if (demo.i >= DEMO_BEATS.length) {              // the lesson is over — the dish becomes the ocean
      demo.idle = true; demo.idleT = 0; demo.secs = Infinity;
      openDemoWorld();
      if (el.demoCap) el.demoCap.classList.add("hidden");
      return;
    }
    const b = DEMO_BEATS[demo.i];
    demo.secs = b.secs;
    demo.focus = b.setup() || anyCell();
    if (el.demoCap) {
      el.demoCap.innerHTML = `<i>${demo.i + 1}/${DEMO_BEATS.length}</i><span>${b.cap}</span>`;
      el.demoCap.classList.remove("hidden", "tut");
    }
  }
  // Screensaver: no captions, just drift to whatever is worth watching — something dying loudly,
  // a grazer mid-hunt, the gold phage, or failing all that the thick of the colony.
  // Pick the next thing to watch. The old version rolled dice over the whole ocean, so the camera
  // hurled itself across the world every few seconds — twitchy, and you lost the thread of whatever
  // you were looking at. Now it prefers something ALREADY IN THE SAME WINDOW: the shot changes, the
  // place doesn't. It only travels when the neighbourhood has nothing left worth watching.
  function demoInteresting() {
    const R = Math.max(VIEW_W, VIEW_H)*CFG.demo.nearWindow;
    const cand = [];
    const add = (e, w) => {
      if (!alive(e)) return;
      const d = Math.hypot(dx(e.x, cam.x), dy(e.y, cam.y));
      cand.push({ e, w, d, near: d < R });
    };
    for (const c of cells) if (c.alive && c.infectedGreen) add(c, 5);      // about to burst
    for (const p of phages) if (p.type === "gold" && !p.dead) add(p, 4);   // the prize (never in the demo sim)
    for (const p of predators) add(p, 3);                                  // a hunt
    for (const c of cells) if (c.alive && !c.cyst) add(c, 1);              // ordinary life
    if (!cand.length) return anyCell();
    const near = cand.filter((x) => x.near);
    const pool = near.length ? near : cand;
    const best = Math.max(...pool.map((x) => x.w));
    const top = pool.filter((x) => x.w >= best);          // most interesting…
    top.sort((a, b) => a.d - b.d);                        // …and of those, the closest
    const pick = top[Math.min(top.length - 1, (Math.random()*Math.min(3, top.length))|0)];
    return pick.e;
  }
  function updateDemo(dt) {
    if (!demo || !state || !state.demo) return;
    demo.t += dt;
    if (demo.interactive) {                   // YOU are driving: no timer, no beats — objectives
      updateTutorial(dt);
      cam.x = WORLD_W/2; cam.y = WORLD_H/2;   // the dish is the whole world; the camera holds still
      confineToDish();
      return;
    }
    const b = !demo.idle && DEMO_BEATS[demo.i];
    if (b && b.tick) b.tick(demo.focus, demo.t);
    if (!alive(demo.focus)) demo.focus = demo.idle ? demoInteresting() : anyCell();   // it died mid-shot
    if (demo.idle) {
      // YOU can take the camera: hold a direction and it pans. Let go and, after a moment, it goes
      // back to drifting on its own — the sim is never taken away from you, and never held hostage.
      const a = demo.watch ? axis() : { x: 0, y: 0 };
      if (a.x || a.y) {
        const sp = CFG.demo.panSpeed*dt;
        cam.x = wrapX(cam.x + a.x*sp); cam.y = wrapY(cam.y + a.y*sp);
        demo.manualT = CFG.demo.panHold; demo.focus = null;
        return;
      }
      if (demo.manualT > 0) {
        demo.manualT -= dt;
        if (demo.manualT <= 0) { demo.focus = demoInteresting(); demo.idleT = rand(9, 15); }
        return;
      }
      demo.idleT -= dt;
      if (demo.idleT <= 0 || !alive(demo.focus)) { demo.idleT = rand(9, 15); demo.focus = demoInteresting(); }
    } else if (demo.t >= demo.secs) nextDemoBeat();
    if (demo.rim > 0) demo.rim = Math.max(0, demo.rim - dt/CFG.demo.rimFade);   // the glass dissolves
    if (demo.dish) {
      // Inside the dish the camera does not move AT ALL. The whole world is on screen, so there is
      // nothing to chase — and a still camera is what lets the eye follow the ring instead of fighting it.
      cam.x = WORLD_W/2; cam.y = WORLD_H/2;
      // Instead the SUBJECT comes to the stage: whatever the beat is about is drawn gently to the
      // middle of the glass and held there. A soft spring, not a clamp — the protist still hunts and
      // the cell still swims, they just do it where you're looking.
      const f = demo.focus;
      if (f && !demo.idle && alive(f)) {
        // A subject swims at 240px/s; a gentle tether just loses. Reel it in hard once it leaves the
        // middle fifth, so it can still swim, hunt and drift — but always in front of you.
        const lim = dishRadius()*0.2;
        const ex = f.x - WORLD_W/2, ey = f.y - WORLD_H/2, d = Math.hypot(ex, ey);
        if (d > lim) {
          const pull = (d - lim)*(1 - Math.exp(-3.4*dt));
          f.x -= ex/d*pull; f.y -= ey/d*pull;
        }
      }
      confineToDish();
      return;
    }
    // Out in the open ocean the camera GLIDES to whatever is worth watching. 2.6/s was a snap — it
    // arrived before your eye did, which is what made it feel twitchy.
    const f = demo.focus;
    if (f) {
      const k = 1 - Math.exp(-CFG.demo.driftRate*dt);
      cam.x = wrapX(cam.x + dx(f.x, cam.x)*k);
      cam.y = wrapY(cam.y + dy(f.y, cam.y)*k);
    }
  }
  // ---- the dish ------------------------------------------------------------
  // Inside the dish the DIRECTOR is the only source of organisms — no immigration, no viral
  // reservoir, no gold respawn. A tutorial where things wander in uninvited isn't a tutorial.
  const dishOn = () => !!(demo && demo.dish);
  // dishOn() is useless while newGame is still seeding — `demo` and `state` don't exist yet — so the
  // dish needs its own flag, set before the first particle is made.
  let demoWorld = false;
  const dishRadius = () => Math.min(WORLD_W, WORLD_H)/2 - CFG.demo.dishPad;
  // Hold everything inside the glass. The world is a torus, but the DISH is plain circular geometry:
  // an organism that reaches the rim is set back on it and has its outward velocity removed, so it
  // slides along the glass instead of grinding into it or wrapping round to the far side.
  function confineToDish() {
    if (!demo || !demo.dish) return;
    const cx = WORLD_W/2, cy = WORLD_H/2, R = dishRadius();
    const hold = (e, rad) => {
      const ex = e.x - cx, ey = e.y - cy, d = Math.hypot(ex, ey) || 1e-6, lim = Math.max(8, R - rad);
      if (d <= lim) return;
      const nx = ex/d, ny = ey/d;
      e.x = cx + nx*lim; e.y = cy + ny*lim;
      if (e.vx != null) { const vn = e.vx*nx + e.vy*ny; if (vn > 0) { e.vx -= vn*nx; e.vy -= vn*ny; } }
      if (e.tvx != null) { const tn = e.tvx*nx + e.tvy*ny; if (tn > 0) { e.tvx -= tn*nx; e.tvy -= tn*ny; } }
    };
    for (const c of cells) hold(c, cellHalfLen(c) + 2);
    for (const p of predators) hold(p, p.r);
    for (const ph of phages) hold(ph, ph.r + 2);
    for (const s of substrates) hold(s, s.R*0.92);
    for (const n of nutrients) hold(n, 2);
  }
  // The lesson is over: the rim dissolves and the dish becomes the ocean. Everything is shifted so it
  // stays where it looks like it is — the world grows around the organisms rather than under them.
  function openDemoWorld() {
    if (!demo || !demo.dish) return;
    const ox = (WORLD_DEF_W - WORLD_W)/2, oy = (WORLD_DEF_H - WORLD_H)/2;
    setWorld(WORLD_DEF_W, WORLD_DEF_H);
    const shift = (e) => { e.x += ox; e.y += oy; };
    [cells, predators, phages, substrates, nutrients, particles, enzymes, toxins].forEach((list) => list.forEach(shift));
    cam.x += ox; cam.y += oy;
    demo.dish = false; demo.rim = 1;      // rim fades out over CFG.demo.rimFade seconds
    demoWorld = false;                    // particles spawning into the open ocean are full size again
    state.demoFood = null;                // the sea refills to its real diel target — the ocean arrives
    // STOCK IT. Opening into an empty ocean with four cells in it is an anticlimax — the whole point
    // of the reveal is that there's more out there than the dish could hold. Fill the world with a
    // living community: a diverse bacterial population, grazers hunting it, and a viral reservoir.
    phages = phages.filter((p) => p.type !== "gold");   // no gold follows you out of the dish
    immigrateBacteria(CFG.demo.openCells);
    for (let i = 0; i < CFG.demo.openProtists; i++) {
      const a = rand(0, TAU), d = rand(400, 1000);
      predators.push(makePredator(wrapX(cam.x + Math.cos(a)*d), wrapY(cam.y + Math.sin(a)*d), null, rand(0, 25)));
    }
    for (let i = 0; i < CFG.demo.openPhages; i++) {
      const a = rand(0, TAU), d = rand(300, 1100);
      phages.push(makePhage("green", wrapX(cam.x + Math.cos(a)*d), wrapY(cam.y + Math.sin(a)*d)));
    }
    for (let i = 0; i < CFG.demo.openFood; i++) substrates.push(makeSubstrate());
  }
  function drawDish() {
    if (!demo || (!demo.dish && !(demo.rim > 0))) return;
    const a = demo.dish ? 1 : demo.rim;
    const R = dishRadius(), x = sx(WORLD_W/2), y = sy(WORLD_H/2);
    ctx.save();
    ctx.globalAlpha = a*0.62;             // everything outside the glass is darkened away
    ctx.fillStyle = "#02090c";
    ctx.beginPath(); ctx.rect(-6000, -6000, 24000, 24000); ctx.arc(x, y, R, 0, TAU, true); ctx.fill();
    ctx.globalAlpha = a;
    ctx.strokeStyle = "rgba(87,224,192,.20)"; ctx.lineWidth = 10;
    ctx.beginPath(); ctx.arc(x, y, R + 5, 0, TAU); ctx.stroke();
    ctx.strokeStyle = "rgba(190,245,232,.42)"; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.stroke();
    ctx.restore();
  }
  function drawDemoFocus() {                        // a soft ring so you know what you're being shown
    if (!demo || !demo.focus || demo.idle || !alive(demo.focus)) return;
    const f = demo.focus;
    // a particle is sized by R, a protist/phage by r, a cell by its length — the ring has to fit
    // whatever it's pointing at, or it points at nothing
    const rad = f.R || f.r || cellHalfLen(f) || 10;
    const r = rad + 14 + Math.sin(state.elapsed*3)*2.5;
    ctx.save();
    ctx.strokeStyle = "rgba(87,224,192,.75)"; ctx.lineWidth = 1.8;
    ctx.setLineDash([5, 5]); ctx.lineDashOffset = -state.elapsed*14;
    ctx.beginPath(); ctx.arc(sx(f.x), sy(f.y), r, 0, TAU); ctx.stroke();   // drawn INSIDE the zoom transform, like the cells
    ctx.restore();
  }
  function controlledEntity() { return state && state.role === "protist" ? controlledProtist() : controlledCell(); }
  // ---- trophic role-swap: flip the player between bacterium and protist on extinction ----
  // THE SEED BANK. Every cell that dies leaves its genome behind, and that pool is what the sea
  // restocks from. It matters most after a protist takeover: the bacteria that drift back in should
  // be the ones that ALREADY EVOLVED in this run — waking out of cysts, as they really would —
  // rather than a fresh set of invented strains that erase the run's evolutionary history the moment
  // your lineage dies. Sampling the pool uniformly means common ecotypes come back often and rare
  // ones rarely: the distribution of the dead is the distribution of the revived.
  function rememberGenome(c) {
    if (!state || c.cyst === undefined) return;
    state.dead = state.dead || [];
    state.dead.push({ enzLvl: c.enzLvl.slice(), chemotaxis: !!c.chemotaxis, chemoLevel: c.chemoLevel || 0,
                      crispr: !!c.crispr, antibiotic: c.antibiotic || 0, ups: (c.ups || []).slice(0, 32) });
    if (state.dead.length > 400) state.dead.shift();   // a rolling bank, not an ever-growing one
  }
  function reviveGenome(c) {                            // returns false if the bank is empty
    const bank = (state && state.dead) || [];
    if (!bank.length) return false;
    const g = bank[(Math.random()*bank.length)|0];
    c.enzLvl = g.enzLvl.slice(); c.chemotaxis = g.chemotaxis; c.chemoLevel = g.chemoLevel;
    c.crispr = g.crispr; c.antibiotic = g.antibiotic; c.ups = (g.ups || []).slice();
    return true;
  }
  function immigrateBacteria(n) { // a diversity of bacteria drift in from offscreen (varied genomes)
    for (let i = 0; i < n && cells.length < CFG.cell.maxCells; i++) {
      const a = rand(0, 6.28), d = Math.hypot(VIEW_W, VIEW_H)/2 + rand(60, 380);
      const c = makeCell(cam.x + Math.cos(a)*d, cam.y + Math.sin(a)*d, CFG.cell.startEnergy, rand(0, 6.28), 1);
      // Prefer to REVIVE something this run already evolved (a cyst waking up). Only if nothing has
      // died yet — the opening minutes — do we invent a genome from scratch.
      if (!reviveGenome(c)) {
        if (Math.random() < 0.55) c.enzLvl[0] = 1 + (Math.random() < 0.3 ? 1 : 0);
        if (Math.random() < 0.55) c.enzLvl[1] = 1 + (Math.random() < 0.3 ? 1 : 0);
        c.enzLvl[2] = 1 + (Math.random() < 0.35 ? 1 : 0);
        if (Math.random() < 0.40) { c.chemotaxis = true; c.chemoLevel = 1 + (Math.random() < 0.3 ? 1 : 0); }
        if (Math.random() < 0.22) c.crispr = true;
        if (Math.random() < 0.30) c.antibiotic = 1;
        c.ups = genomeUps(c);   // it arrived already carrying these — read the log off the genome
      }
      c.invuln = 2.5;
      cells.push(c);
    }
  }
  function becomeProtist() { // your bacteria all died → you become a grazing protist; fresh prey drifts in
    state.role = "protist";
    cells.forEach((c) => (c.controlled = false));
    if (!predators.length) for (let i = 0; i < CFG.cycle.reseedProtists; i++)
      predators.push(makePredator(cam.x + rand(-140, 140), cam.y + rand(-140, 140), CFG.predator.startEnergy, rand(0, 10)));
    const p = predators[0]; p.controlled = true; p.energy = Math.max(p.energy, CFG.predator.startEnergy); p.age = 0;
    cam.x = p.x; cam.y = p.y;
    immigrateBacteria(CFG.cycle.reseedBacteria);
    // No promise of a way back: the grazers have their own immigration (minCount, respawnFloor) and
    // effectively never all die, so becomeBacterium() almost never fires. Tell the player what they
    // CAN do instead of something that won't happen.
    if (state.roleSwaps) state.roleSwaps.push({ t: +state.elapsed.toFixed(1), to: "protist" });
    flashRole("You are now a PROTIST", "your kind died out — graze the bacteria instead · Space to sprint");
    Audio.play("spawn", 0.6);
  }
  // Only fires if every grazer dies at once — which their immigration makes very unlikely. Kept as a
  // safety net so a wiped-out protist population can never leave you controlling nothing.
  function becomeBacterium() { // the protists died out → you rejoin the bacteria
    state.role = "bacterium";
    predators.forEach((p) => (p.controlled = false));
    if (!cells.length) immigrateBacteria(CFG.cycle.reseedBacteria);
    const c = cells[0]; if (c) { c.controlled = true; c.invuln = Math.max(c.invuln, 2); cam.x = c.x; cam.y = c.y; }
    if (state.roleSwaps) state.roleSwaps.push({ t: +state.elapsed.toFixed(1), to: "bacterium" });
    flashRole("You are now a BACTERIUM", "the grazers died out — forage, evolve, divide");
    Audio.play("spawn", 0.6);
  }
  let _roleT = null;
  function flashRole(title, sub) {
    const host = el.stage || (typeof document !== "undefined" && document.body); if (!host || !host.appendChild) return;
    let m = document.getElementById("roleFlash");
    if (!m) { m = document.createElement("div"); m.id = "roleFlash"; host.appendChild(m); }
    m.innerHTML = `<b>${title}</b><span>${sub || ""}</span>`;
    m.classList.add("show");
    if (_roleT) clearTimeout(_roleT);
    _roleT = setTimeout(() => m.classList.remove("show"), 3400);
  }
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
  // A grazer has no enzymes, so Space (and the phone's release button) becomes a sprint instead.
  function protistTurbo() {
    const pr = controlledProtist(); if (!pr) return;
    if (pr.turboT > 0) return;                       // already sprinting — no stacking
    const C = CFG.cycle;
    if (pr.energy <= C.turboCost) return;            // too starved to sprint
    pr.energy -= C.turboCost;
    pr.turboT = Math.min(C.turboSecs + (state.turboBonus || 0), C.turboMaxSecs);
    Audio.play("enzyme", 0.5);
  }
  function playerEnzyme() {
    if (!state || !state.running) return;
    if (state.role === "protist") { protistTurbo(); return; }   // Space = turbo when you're the grazer
    const c = controlledCell(); if (!c) return;
    if (!ownedDeployables(c).includes(state.activeEnzyme)) state.activeEnzyme = ownedDeployables(c)[0] ?? 2;
    if (state.activeEnzyme === AB) { if (releaseAntibiotic(c)) Audio.play("enzyme", 0.55); }
    else if (releaseEnzyme(c, state.activeEnzyme)) Audio.play("enzyme", 0.7);
  }
  // TOUCH ONLY. On a phone the interesting decision is WHERE TO SWIM, not when to press a button —
  // and asking a thumb to hold a stick, aim, and tap release at the right instant is why mobile felt
  // like work. So the cell digests whatever it can reach, by itself, exactly as a real one would.
  // The release button still works and is still the only way to fire the antibiotic, which is a
  // choice (who to poison) rather than a chore.
  function autoEnzyme(c, dt) {
    c.autoEnzT = (c.autoEnzT || 0) - dt;
    if (c.autoEnzT > 0) return;
    if (c.energy < CFG.cell.enzymeCost*2) return;        // never starve yourself digesting
    const owned = ownedEnzymes(c);
    if (!owned.length) return;
    // Measure from the FRONT POLE, which is where releaseEnzyme actually puts the cloud — not from
    // the cell's centre. Measuring from the centre fires at particles the cell is facing away from,
    // and the cloud lands in open water and dissolves nothing. So this is also what makes auto-fire
    // mean "dissolve the particle AHEAD", the same rule the keyboard has.
    const pol = cellPolesLocal(c);
    const ex = c.x + pol[0], ey = c.y + pol[1];
    let best = null, bd = Infinity, bres = null;
    for (const s of substrates) {
      if (s.organic <= 0 || s.phase !== "live") continue;
      const res = owned.find((i) => s.orgByType[i] > 0);          // something in there we can actually digest
      if (res == null) continue;
      const bite = CFG.enzyme.maxRadius * (1 + (c.enzLvl[res] - 1)*CFG.cell.exprBoost); // this enzyme's reach
      const d = Math.sqrt(toroDist2(ex, ey, s.x, s.y)) - s.R;     // pole → the particle's SURFACE
      if (d > bite*0.95 || d >= bd) continue;
      bd = d; best = s; bres = res;
    }
    if (!best) return;
    state.activeEnzyme = bres;                            // load the right one, so the HUD tells the truth
    if (releaseEnzyme(c, bres)) { Audio.play("enzyme", 0.5); c.autoEnzT = CFG.touch.autoEnzymeEvery; }
    else c.autoEnzT = 0.3;
  }
  function releaseAntibiotic(c) {
    if (c.antibiotic <= 0 || c.energy < CFG.cell.antibioticCost) return false;
    c.energy -= CFG.cell.antibioticCost;
    const p = cellPolesLocal(c), lvl = c.antibiotic;
    const maxR = CFG.toxin.maxRadius * (1 + (lvl-1)*CFG.toxin.radiusPer); // leveling GROWS the reach (bigger AoE), not the damage
    const tx = wrapX(c.x + p[0]), ty = wrapY(c.y + p[1]), gsnap = genomeOf(c);
    toxins.push({ x: tx, y: ty, r: 4, life: CFG.toxin.life, age: 0, maxR, potency: CFG.toxin.potency, genome: gsnap });
    // instant dose to every protist caught in the release — the reliable "hit" (the cloud is lingering bonus)
    const dose = CFG.toxin.dose, rr = maxR*maxR;
    for (const pr of predators) if (toroDist2(tx, ty, pr.x, pr.y) <= rr) { pr.energy -= dose; pr.toxT = 0.5; }
    // cross-reactive: also hit bacteria genetically distant from the releaser (kin are spared)
    for (const oc of cells) {
      if (oc === c || !oc.alive || oc.cyst || oc.invuln > 0) continue;
      if (toroDist2(tx, ty, oc.x, oc.y) <= rr && genDist(gsnap, oc) >= CFG.toxin.crossDist) { oc.energy -= dose*CFG.toxin.crossFactor; oc.toxT = 0.5; }
    }
    return true;
  }
  // a deployable's color + short label — same colors the gene chips use, so the phone's
  // release button and the genome row can never disagree about what "carb" looks like
  const TOXIN_UI = "#f05ad0";
  const deployColor = (id) => (id === AB ? TOXIN_UI : RESOURCES[id].color);
  function cycleEnzyme(dir) {                // dir -1 steps back; default forward
    if (!state || !state.running) return;
    const c = controlledCell(); if (!c) return;
    const owned = ownedDeployables(c); if (owned.length < 2) return; // nothing else to load
    const step = dir === -1 ? -1 : 1;
    let cur = owned.indexOf(state.activeEnzyme); if (cur < 0) cur = 0;
    state.activeEnzyme = owned[(cur + step + owned.length) % owned.length];
    Audio.play("eat", 0.3);
  }
  // directly load a specific deployable by tapping its gene (id 0-2 enzymes, 3 antibiotic); ignored if not owned
  function selectEnzyme(id) {
    if (!state || !state.running) return;
    const c = controlledCell(); if (!c) return;
    if (!ownedDeployables(c).includes(id)) return;
    if (state.activeEnzyme === id) return;
    state.activeEnzyme = id; Audio.play("eat", 0.3);
  }
  // hand control to a DIFFERENT lineage — cycle through the distinct generations (ecotype+tier) present,
  // so you can shepherd several populations at different adaptation tiers (diversity = virus resilience).
  // the distinct lineages alive right now, one healthy representative each, in a stable order.
  // Shared by switchControl and the lineage button, so the button shows exactly what a swipe
  // would hand you.
  function lineageReps() {
    const reps = new Map();
    for (const c of cells) { if (!c.alive || c.cyst) continue;
      const k = ecoMask(c)*64 + upgradeTier(c), r = reps.get(k);
      if (!r || c.energy > r.energy) reps.set(k, c);
    }
    return { reps, ks: [...reps.keys()].sort((a, b) => a - b) };
  }
  const lineageKeyColor = (k) => levelColor(Math.floor(k/64), k % 64); // key → the color it's drawn in
  function switchControl(dir) {              // dir -1 steps back through the lineages; default forward
    if (!state || !state.running) return;
    const step = dir === -1 ? -1 : 1;
    if (state.role === "protist") {          // as a grazer, hop between protists instead
      const i = predators.findIndex((p) => p.controlled);
      if (i >= 0 && predators.length > 1) {
        predators[i].controlled = false;
        predators[(i + step + predators.length) % predators.length].controlled = true;
        Audio.play("hit", 0.5);
      }
      return;
    }
    const cur = controlledCell(); if (!cur) return;
    const { reps, ks } = lineageReps();
    let target = null;
    if (reps.size >= 2) {                    // cycle to the next distinct lineage
      let i = ks.indexOf(ecoMask(cur)*64 + upgradeTier(cur)); if (i < 0) i = 0;
      target = reps.get(ks[(i + step + ks.length) % ks.length]);
    } else {                                 // only one lineage — jump to the farthest other cell (a separate cluster)
      let bd = -1; for (const c of cells) { if (c === cur || !c.alive || c.cyst) continue;
        const d = toroDist2(c.x, c.y, cur.x, cur.y); if (d > bd) { bd = d; target = c; } }
    }
    if (target && target !== cur) {
      cur.controlled = false; target.controlled = true;
      cam.x = target.x; cam.y = target.y;   // snap the camera to the new cell
      Audio.play("eat", 0.5);
    }
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
    d1.ups = d2.ups = c.ups || [];   // the adaptation log is heritable too (shared until one of them adapts)
    if (c.infectedGreen) { d2.infectedGreen = true; d2.lysisT = c.lysisT; burst(c.x, c.y, "#7CFC5A", 8); } // virus segregates into one daughter; d1 (your lineage) stays clean
    cells.splice(cells.indexOf(c), 1, d1, d2);
    if (c.controlled) state.gen++; // count a generation only when the cell YOU are steering divides
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
    for (let i = 0; i < n && phages.length < CFG.phage.maxCount; i++) {
      const a = rand(0, 6.28), d = rand(5, 13); // scatter a few px so virions don't spawn stacked on each other
      phages.push(makePhage("green", c.x + Math.cos(a)*d, c.y + Math.sin(a)*d, host));
    }
    burst(c.x, c.y, "#7CFC5A", 12);
    if (c.controlled) Audio.play("hit", 0.7);
  }
  // cause-of-mortality buckets: 0 grazing, 1 viral lysis, 2 starvation, 3 antibiotic
  const MORT_IDX = { predator: 0, lysis: 1, starve: 2, toxin: 3 };
  // all cell deaths funnel through here so infected hosts always lyse into phages
  function onCellDeath(c, cause) {
    c.alive = false;
    if (state) { const k = MORT_IDX[cause]; if (k != null) { state.mortLive[k]++; state.mortFull[k]++; } }
    rememberGenome(c);   // the sea keeps a seed bank of everything that has ever lived in it
    if (c.infectedGreen) releaseGreenPhages(c);
    burst(c.x, c.y, cause === "predator" ? "#ff7a6b" : cause === "lysis" ? "#7CFC5A" : "#9fb0aa", 18);
    if (c.controlled) transferControl(c);
  }
  function killCell(c, byPredator) {
    if (!c.alive || c.invuln > 0) return;
    onCellDeath(c, byPredator ? "predator" : (c.toxT > 0 ? "toxin" : "starve")); // energy-zero death: antibiotic if recently poisoned, else starvation
  }

  // The trophic role-swap is the biggest thing that can happen in a run — your whole kind dies and
  // you come back as the thing that was eating you. It deserves more than a colour change on the
  // chart: a full-height divider, so "before I was bacteria / after I was the grazer" is unmissable.
  function drawRoleSwaps(g, W, H, swaps, dur) {
    if (!swaps || !swaps.length) return;
    const d = Math.max(1, dur), fs = H > 150 ? 11 : 9;
    for (const s of swaps) {
      const x = clamp(s.t/d, 0, 1)*W, toProtist = s.to === "protist";
      const col = toProtist ? PROTIST_COLOR : "#57e0c0";
      g.save();
      g.strokeStyle = col; g.lineWidth = 2; g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); g.setLineDash([]);
      if (H > 90) {                                  // only the big charts have room to say what it was
        const label = toProtist ? "▲ became protist" : "▼ back to bacteria";
        g.font = "bold " + fs + "px 'Trebuchet MS', sans-serif";
        const w = g.measureText(label).width + 10;
        const lx = clamp(x + 4, 2, W - w - 2);
        g.fillStyle = "rgba(4,17,21,.85)"; g.fillRect(lx, H - fs - 8, w, fs + 5);
        g.fillStyle = col; g.textAlign = "left"; g.textBaseline = "middle";
        g.fillText(label, lx + 5, H - fs/2 - 5);
      }
      g.restore();
    }
  }
  // vertical markers where each adaptation happened — overlaid on both the ecotype and substrate charts
  function drawAdaptationMarkers(g, W, H, upgrades, dur) {
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
  // Shared annotated renderers (game-over screen + high-score detail view): ecotype and substrate charts,
  // both with adaptation markers so you can read "new enzyme → its substrate gets eaten → colony booms".
  function annotateRun(g, W, H, hist, upgrades, dur, swaps) { renderEcoChart(g, W, H, hist); drawAdaptationMarkers(g, W, H, upgrades, dur); drawRoleSwaps(g, W, H, swaps, dur); }
  function annotateSub(g, W, H, hist, upgrades, dur, swaps) { renderSubChart(g, W, H, hist); drawAdaptationMarkers(g, W, H, upgrades, dur); drawRoleSwaps(g, W, H, swaps, dur); }
  function runStatsHtml(hist, upgrades) {
    let peakCol = 0, peakP = 0, peakV = 0;
    for (const s of hist) { let t = 0; for (let i = 0; i < 8; i++) t += s.eco[i]; if (t > peakCol) peakCol = t; if (s.p > peakP) peakP = s.p; if ((s.v||0) > peakV) peakV = s.v; }
    return `<b>${upgrades ? upgrades.length : 0}</b> adaptations · peak bacteria <b>${peakCol}</b> · peak protists <b>${peakP}</b> · peak viruses <b>${peakV}</b>`;
  }
  function drawAnalysis() {
    if (!actx || !state) return;
    annotateRun(actx, el.analysisChart.width, el.analysisChart.height, state.fullHist, state.upgrades, state.elapsed, state.roleSwaps);
    if (asctx) annotateSub(asctx, el.analysisSubChart.width, el.analysisSubChart.height, state.fullHist, state.upgrades, state.elapsed, state.roleSwaps);
    if (el.analysisSubLabel) el.analysisSubLabel.textContent = subLabelText();
    if (el.analysisClado) drawClado(el.analysisClado, analysisRec());
    if (el.analysisStats) el.analysisStats.innerHTML = runStatsHtml(state.fullHist, state.upgrades);
  }
  // the live run, shaped like a saved record — so the charts, circos and cladogram take one type
  const analysisRec = () => state && ({ hist: state.fullHist, upgrades: state.upgrades, lineages: state.lineages,
                                        gen: state.gen, score: state.score, dur: state.elapsed, roleSwaps: state.roleSwaps });
  function gameOver(dayComplete) {
    state.running = false;
    recordGame();
    const cal = `<b>${Math.round(state.score).toLocaleString()}</b> calories`;
    // a run played with the tuning panel open isn't comparable to anyone else's — say so
    const tuned = cfgTuned() ? `<br><span style="font-size:12px;opacity:.7;color:#ffd24a">tuned run — kept local, not sent to the shared leaderboard</span>` : "";
    const dayN = state.day || 1;
    const days = dayN === 1 ? "A full day" : `${dayN} full days`;
    // If your bacteria died out, you did NOT spend the day as a bacterium — you spent it as the thing
    // that was eating you. Saying "a full day in the life of a bacterium" over a run whose lineage
    // went extinct at 09:40 is the screen telling the player a story that didn't happen.
    const swaps = state.roleSwaps || [];
    const ext = swaps.find((s) => s.to === "protist");
    const gen = `<b>generation ${state.gen}</b>`;
    let msg;
    if (state.role === "protist" && ext) {
      const when = `<b>${clockAt(ext.t)}</b>`;
      msg = dayComplete
        ? `${days} — but not as a bacterium. Your kind went extinct at ${when}, and you saw the day out a trophic level up, grazing the cells that outlived you. Your lineage peaked at ${gen}; you ate ${cal} in all.`
        : `Your bacteria went extinct at ${when} and you finished as a <b>protist</b>, grazing the survivors. Your lineage peaked at ${gen}; you ate ${cal} in all.`;
    } else if (ext) {                       // extinct, then the grazers died too and you came back
      msg = (dayComplete ? `${days} in the life. ` : "") +
        `Your kind went extinct at <b>${clockAt(ext.t)}</b> — and came back, when the grazers died out in their turn. Your lineage reached ${gen} and consumed ${cal}.`;
    } else {
      msg = dayComplete
        ? `${days} in the life of a bacterium. Your lineage reached ${gen} and consumed ${cal}.`
        : `Your lineage reached ${gen} and consumed ${cal}.`;
    }
    el.overTitle.textContent = dayComplete
      ? (state.role === "protist" ? `You survived day ${dayN} — as a protist 🌅` : `You survived day ${dayN} 🌅`)
      : "Run ended";
    el.overMsg.innerHTML = msg + tuned;
    // you can only carry on from a day you SURVIVED — not from a run that ended
    if (el.continueBtn) el.continueBtn.classList.toggle("hidden", !dayComplete);
    drawAnalysis();
    if (el.nameInput) el.nameInput.value = playerName; // prefill with the remembered name
    Audio.play(dayComplete ? "spawn" : "death", dayComplete ? 0.7 : 0.9);
    setTimeout(() => el.over.classList.remove("hidden"), 400);
  }
  function setPlayerName(val) { // remember the name, and stamp it onto the run just recorded
    playerName = (val || "").slice(0, 18);
    try { localStorage.setItem(NAME_KEY, playerName); } catch (e) {}
    if (justFinishedTs != null) try {
      const arr = loadScores(), rec = arr.find((r) => r.date === justFinishedTs);
      if (rec) { rec.name = playerName; localStorage.setItem(HS_KEY, JSON.stringify(arr)); }
    } catch (e) {}
    if (lastRec) { lastRec.name = playerName; scheduleNameUpdate(lastRec); }
  }

  // ------------------------------------------------------------------- update
  function update(dt) {
    if (!state || !state.running) return;
    state.elapsed += dt; updateDiel();               // advance the day; drive light/temp/food/grazing
    // end of a day: you made it. Offer to carry on into the next one (see continueDay).
    // The demo has no player to congratulate and no score to record — the sun just keeps going round.
    if (state.elapsed >= state.day * CFG.day.lengthSec) { if (state.demo) state.day++; else { gameOver(true); return; } }
    // A locked run winds down instead of sticking on: the knob eases back to center and the
    // rim's glow fades, so you can watch it run out rather than being stuck swimming. Held
    // thumb pauses the countdown — that's you steering, not coasting.
    if (touchLatched && !touchVec.active) {
      touchRunT -= dt;
      const frac = clamp(touchRunT / Math.max(0.01, CFG.cell.touchRunSecs), 0, 1);
      if (touchRunT <= 0) {
        touchVec.x = touchVec.y = 0;
        setLatched(false);
        parkKnob(0, 0);
      } else {
        // now that the stick is analog, the knob's position IS the speed — so easing it back to
        // center has to actually slow the cell, not just look like it. The run coasts to a stop.
        touchVec.x = touchLatchVec.x*frac; touchVec.y = touchLatchVec.y*frac;
        parkKnob(touchLatchVec.x*stickMaxR*frac, touchLatchVec.y*stickMaxR*frac);
        if (el.stickBase) el.stickBase.style.setProperty("--lock", frac.toFixed(3));
      }
    }
    for (const c of cells) if (c.alive) updateCell(c, dt);
    // dividing before lysis lets a cell shed the virus into one daughter and escape clean
    for (const c of cells) if (c.alive && c.energy >= CFG.cell.divideThreshold) divide(c);
    const hadControlled = cells.some((c) => c.controlled && c.alive);
    cells = cells.filter((c) => c.alive);
    // trophic role-swap: bacteria extinct → you become a protist (not game over). The demo has no
    // one to promote, so it just restocks the sea and keeps running — an attract loop can't end.
    if (state.role === "bacterium" && !cells.length) {
      if (tut) { /* updateTutorial hands you a fresh cell — being eaten is a lesson, not an ending */ }
      else if (state.demo) immigrateBacteria(CFG.cycle.reseedBacteria);
      else { becomeProtist(); return; }
    }
    // don't hand the demo a controlled cell behind our backs — that's what this guard is for
    if (!state.demo && state.role === "bacterium" && cells.length && !hadControlled && !cells.some((c) => c.controlled)) cells[0].controlled = true;
    // particle lifecycle: drift slowly; when fully eaten or past its lifespan, respawn
    // (past-lifespan particles erode away voxel-by-voxel rather than vanishing)
    for (const s of substrates) {
      s.x = wrapX(s.x + s.vx*dt); s.y = wrapY(s.y + s.vy*dt);
      if (s.phase === "live") {
        s.age += dt;
        if (s.organic <= 0) { retireSubstrate(s); continue; }
        if (s.age >= s.maxAge) startDissolve(s);
      } else {                                   // dissolving — erode a chunk of voxels per second
        s.dissolveAcc += s.dissolveRate*dt;
        while (s.dissolveAcc >= 1 && s.dissolveI < s.dissolveOrder.length) {
          s.dissolveAcc -= 1; const idx = s.dissolveOrder[s.dissolveI++];
          if (s.grid[idx] > 0) { s.orgByType[s.gtype[idx]]--; s.grid[idx] = 0; s.organic--; s.dirty = true; }
        }
        if (s.organic <= 0 || s.dissolveI >= s.dissolveOrder.length) retireSubstrate(s);
      }
    }
    // diel food supply: shrink the field toward the production target when spent; grow it back as the bloom returns
    if (substrates.some((s) => s.remove)) substrates = substrates.filter((s) => !s.remove);
    // The field tracks the diel target in BOTH directions, at a visible rate. It used to only ever
    // grow (one per frame, so it snapped up), and shrink solely when a particle happened to be eaten
    // or aged out — which in a 240s run never happens fast enough, so the bloom never receded.
    state.foodT -= dt;
    if (state.foodT <= 0) {
      state.foodT = CFG.substrate.bloomEvery;
      if (substrates.length < state.foodTarget) substrates.push(spawnDriftingSubstrate());
      else if (substrates.length > state.foodTarget) {
        // the bloom recedes: an excess particle starts dissolving and erodes away voxel by voxel,
        // rather than simply vanishing
        const live = substrates.filter((p) => p.phase === "live" && p.organic > 0);
        if (live.length) startDissolve(live[(Math.random()*live.length)|0]);
      }
    }
    updateEnzymes(dt); updateToxins(dt); updateNutrients(dt); updatePredators(dt); updatePhages(dt);
    // while you're a protist: keep control on a living grazer. Falling back to a bacterium needs EVERY
    // grazer dead at once, which their immigration all but rules out — so in practice, grazer is for keeps.
    if (state.role === "protist" && !controlledProtist()) {
      if (predators.length) predators[0].controlled = true; else becomeBacterium();
    }
    // Prey supply. The grazers have their own immigration keeping them topped up; the bacteria had
    // none — becomeProtist() seeded 16 once and that was it. Eat those and the sea went permanently
    // sterile, so you starved as a protist with nothing left to hunt. Keep prey drifting in.
    if (state.role === "protist") {
      state.preyT -= dt;
      if (state.preyT <= 0) {
        state.preyT = CFG.cycle.preyEvery;
        const short = CFG.cycle.preyFloor - cells.length;
        if (short > 0) immigrateBacteria(Math.min(short, 8));
      }
    }
    for (const q of particles) { q.x += q.vx*dt; q.y += q.vy*dt; q.vx *= 0.9; q.vy *= 0.9; q.life -= dt; }
    particles = particles.filter((q) => q.life > 0);
    // camera follows whichever entity you're controlling (cell or protist)
    const pc = controlledEntity(); if (pc) { cam.x = pc.x; cam.y = pc.y; }
    updateDemo(dt);   // no player to follow in attract mode — the director drives the camera instead
    // sample per-ecotype abundances for the time-series chart
    const greenCount = phages.reduce((a, p) => a + (p.type === "green"), 0);
    const subTotals = [0, 0, 0]; // total available organic of each resource on the board (lipid/protein/carb)
    for (const p of substrates) { const o = p.orgByType; subTotals[0] += o[0]; subTotals[1] += o[1]; subTotals[2] += o[2]; }
    state.chartT -= dt;
    if (state.chartT <= 0) {
      state.chartT = CHART.interval;
      const s = ecoSample();
      state.history.push({ eco: s.eco, buckets: s.buckets, sub: subTotals.slice(), p: predators.length, v: greenCount, mort: state.mortLive });
      state.mortLive = [0, 0, 0, 0]; // reset the per-interval death tally for the next sample
      if (state.history.length > CHART.samples) state.history.shift();
      updateLegend(s.eco, predators.length, greenCount);
    }
    // full-game log for the high-score record — whole arc, coarser, decimated when long
    state.fullT -= dt;
    if (state.fullT <= 0) {
      state.fullT = state.fullInterval;
      const fs = ecoSample();
      state.fullHist.push({ eco: fs.eco, buckets: fs.buckets, sub: subTotals.slice(), p: predators.length, v: greenCount, mort: state.mortFull });
      state.mortFull = [0, 0, 0, 0];
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
    else if (!c.cyst && c.energy <= CFG.cell.cystBelow) {
      if (c.infectedGreen) { onCellDeath(c, "lysis"); return; } // an infected cell can't wait it out in a cyst — starvation bursts it, releasing virions
      c.cyst = true;
    }

    // LOW REYNOLDS NUMBER. A bacterium has no useful inertia: viscous drag overwhelms momentum, so
    // its velocity is whatever its thrust sustains against drag, reached (and lost) almost at once.
    // It does not coast — a real cell that stops swimming halts within an atom's width. So thrust
    // sets a TARGET VELOCITY (tvx, tvy) and the cell relaxes onto it; it does not accumulate speed.
    c.tvx = 0; c.tvy = 0;
    if (c.controlled) {
      const a = axis();
      if (a.x !== 0 || a.y !== 0) {
        c.tumbling = false; const len = Math.hypot(a.x, a.y); c.angle = Math.atan2(a.y, a.x);
        // |a| is how far the stick is pushed (keyboard always gives a full 1), and speed is
        // proportional to thrust — so a half-push really is half speed.
        const sp = swimSpeed(Math.min(1, len), visc);
        c.tvx = (a.x/len)*sp; c.tvy = (a.y/len)*sp;
        c.energy -= CFG.cell.swimCost*dt;
      } else { c.tumbling = true; c.angle += Math.sin(state.elapsed*3 + c.x)*CFG.cell.playerTumbleTurn*dt; }
      if (isTouch && CFG.touch.autoEnzyme) autoEnzyme(c, dt);   // the phone fires its own enzymes
    } else autonomousMove(c, dt);        // sets tvx/tvy, or drifts a cyst by hand

    // Relax onto the target: dv/dt = k(v* - v), solved in CLOSED FORM rather than stepped. With k
    // this stiff an Euler step would tie the cell's speed to the frame rate (and blow up at k·dt>2);
    // the exponential is exact at any dt. A cyst is inert, so it keeps the old lazy drag and drifts.
    const k = (c.cyst ? CFG.cell.cystDragRate : CFG.cell.dragRate) * visc;
    const relax = Math.exp(-k*dt);
    c.vx = c.tvx + (c.vx - c.tvx)*relax;
    c.vy = c.tvy + (c.vy - c.tvy)*relax;
    const sp = Math.hypot(c.vx, c.vy), vmax = CFG.cell.maxSpeed/Math.sqrt(visc)*swimScale();
    if (sp > vmax) { c.vx = c.vx/sp*vmax; c.vy = c.vy/sp*vmax; }
    // MOVE IN SUBSTEPS, and collide after each one.
    // Under the old momentum physics a cell crept up on a wall: a collision killed its speed, and
    // thrust rebuilt it at ~13 px/s per frame, so it only ever nudged the surface. Now (low Reynolds)
    // velocity snaps back to ~63% of full thrust the very next frame, so the cell rams the wall at
    // speed, every frame, forever. One big step can bury a probe deep inside a particle — and deep
    // inside, pushCircleOut's summed voxel overlaps point every which way and cancel, so instead of
    // ejecting the cell it can walk it straight through. Capping each step to ~2px keeps every
    // penetration shallow, which is the only regime that push-out reliably resolves.
    const stepDist = Math.hypot(c.vx, c.vy)*dt;
    // BROAD PHASE FIRST. collideRod walks every particle's voxels, so substepping it blindly would
    // multiply the hot path by 8 and tank the frame rate (it did). Almost every cell, almost every
    // frame, is in open water — one cheap bounding-box pass proves that, and then it just moves.
    const bpReach = stepDist + cellHalfLen(c) + CFG.cell.radius + 4;
    let near = false;
    for (const p of substrates) {
      if (Math.abs(dx(c.x, p.x)) < p.half + bpReach && Math.abs(dy(c.y, p.y)) < p.half + bpReach) { near = true; break; }
    }
    if (!near) { c.x = wrapX(c.x + c.vx*dt); c.y = wrapY(c.y + c.vy*dt); }
    else {
      const steps = clamp(Math.ceil(stepDist/2), 1, 8);
      for (let s = 0; s < steps; s++) {
        c.x = wrapX(c.x + c.vx*dt/steps); c.y = wrapY(c.y + c.vy*dt/steps);
        collideRod(c);
      }
    }

    const sizeF = cellHalfLen(c)/CFG.cell.baseHalf;
    const metab = c.cyst ? CFG.cell.cystMetab : 1;
    const genomeF = 1 + upgradeTier(c)*CFG.cell.genomeUpkeep; // a bigger genome costs more upkeep (streamlining pressure)
    c.energy -= CFG.respirationBase*env.metabolismMult*sizeF*metab*genomeF*dt;
    if (c.invuln > 0) c.invuln -= dt;
    if (c.toxT > 0) c.toxT -= dt; // antibiotic-poisoned marker fades (so a death here still counts as antibiotic)
    if (c.energy <= 0) { c.energy = 0; killCell(c, false); return; }
    c.energy = Math.min(c.energy, CFG.cell.maxEnergy);

    const reach = CFG.cell.radius + CFG.cell.uptake + CFG.nutrient.radius;
    for (const nnn of nutrients) {
      if (nnn.dead) continue;
      if (cellDistTo(c, nnn.x, nnn.y) < reach) {
        nnn.dead = true; c.energy += CFG.substrate.moteEnergy; c.fed = CFG.cell.fedLinger;
        state.score += nnn.res != null ? RESOURCES[nnn.res].cal : BIOMASS_CAL; // calories by composition (fat 9, protein/carb 4)
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
    // Chemotaxis as a real biased random walk: the cell only senses whether the nearest
    // food is getting CLOSER, and if so it tumbles less often (runs longer up-gradient).
    // There's no steering — headings change only at (random) tumbles, so paths are straight
    // runs, not curves — and the bias (run extension) strengthens with chemoLevel.
    let upGrad = false;
    if (c.chemotaxis) {
      const range = CFG.cell.chemoRange0 + c.chemoLevel*CFG.cell.chemoRangePer;
      const s = nearestOrganicSub(c, range);
      if (s) { const d = Math.hypot(dx(s.x, c.x), dy(s.y, c.y));
        if (c.prevFoodDist != null && d < c.prevFoodDist) upGrad = true; // concentration rising along this run
        c.prevFoodDist = d;
      } else c.prevFoodDist = null;
    }
    if (c.tumbling) {
      c.angle += clamp(angleTo(c.angle, c.tumbleTarget), -CFG.cell.tumbleTurn*dt, CFG.cell.tumbleTurn*dt);
      c.tumbleT -= dt;
      if (c.tumbleT <= 0) { c.tumbling = false; c.runTimer = rand(CFG.cell.runMin, CFG.cell.runMax)*fedF; }
    } else {
      // a run: thrust straight ahead. Speed is thrust/drag (see updateCell), so a fed cell's
      // lower thrust is simply a slower amble — and a tumbling cell, thrusting at nothing, stops.
      const sp = swimSpeed(fedF, visc);
      c.tvx = Math.cos(c.angle)*sp; c.tvy = Math.sin(c.angle)*sp;
      c.energy -= CFG.cell.swimCost*fedF*dt;
      // up-gradient → suppress tumbling (longer run); the suppression scales with chemoLevel
      c.runTimer -= upGrad ? dt/(1 + CFG.cell.chemoBias*c.chemoLevel) : dt;
      if (c.runTimer <= 0) {
        c.tumbling = true; c.tumbleT = CFG.cell.tumbleDur;
        c.tumbleTarget = c.angle + rand(-Math.PI, Math.PI); // fully random reorientation — no bias in the tumble itself
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
    // autonomous chemical defense: a cell that evolved the antibiotic zaps protists that close in.
    // Kept deliberately sparing — it's a last-ditch defense, not a constant kill field, so protists
    // aren't wiped out around every colony (long cooldown + fires only when a grazer is right on top).
    if (c.antibiotic > 0 && c.energy > CFG.cell.antibioticCost*3.5) {
      c.toxCd = (c.toxCd || 0) - dt;
      if (c.toxCd <= 0) {
        const maxR = CFG.toxin.maxRadius * (1 + (c.antibiotic-1)*CFG.toxin.radiusPer), rr = (maxR*0.6)**2;
        let threatened = false;
        for (const pr of predators) if (toroDist2(c.x, c.y, pr.x, pr.y) <= rr) { threatened = true; break; }
        if (threatened) { releaseAntibiotic(c); c.toxCd = rand(4.5, 8); } else c.toxCd = 0.6; // else re-check shortly
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
      // cross-reactive: the cloud also drains genetically distant bacteria (kin/self are spared)
      if (z.genome) for (const oc of cells) {
        if (oc.cyst || oc.invuln > 0 || !oc.alive) continue;
        if (toroDist2(z.x, z.y, oc.x, oc.y) <= r2 && genDist(z.genome, oc) >= P.crossDist) { oc.energy -= z.potency*P.crossFactor*dt; oc.toxT = 0.5; }
      }
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
  // A point anywhere in the world you cannot currently see — for bringing things in from
  // offscreen without popping them into view.
  //
  // It samples the WHOLE world and rejects the visible box, rather than picking a point on
  // a ring around the camera. That distinction is the whole fix: a camera-centered ring ties
  // the ecology to the viewport, so a player who stops moving respawns every particle onto
  // one fixed annulus around themselves. The colony grows where the food is, and the map
  // turns into a donut of bacteria with a starved hole where the player sits. Food has to be
  // distributed by the WORLD, not by where you happen to be looking.
  function offscreenPoint(margin) {
    const hw = (VIEW_W/2)/ZOOM + margin, hh = (VIEW_H/2)/ZOOM + margin;
    for (let i = 0; i < 40; i++) {
      const x = rand(0, WORLD_W), y = rand(0, WORLD_H);
      if (Math.abs(dx(x, cam.x)) > hw || Math.abs(dy(y, cam.y)) > hh) return { x, y };
    }
    return { x: rand(0, WORLD_W), y: rand(0, WORLD_H) }; // view somehow covers the world — just place it
  }
  // drop a particle out there, keeping the random drift makeSubstrate already gave it, so it
  // eases into view instead of popping in
  function driftInOffscreen(p) { const q = offscreenPoint(p.half + 60); p.x = q.x; p.y = q.y; }
  function recycleSubstrate(p) {
    // don't strand an embedded gold phage — carry it off so a fresh one respawns in a new particle
    for (const ph of phages) if (ph.type === "gold" && toroDist2(ph.x, ph.y, p.x, p.y) < p.R*p.R) ph.dead = true;
    Object.assign(p, makeSubstrate(pickBalancedKind(p))); // keep every resource above its floor as particles cycle
    // reborn somewhere offscreen — anywhere in the sea, not on a ring around you
    driftInOffscreen(p);
  }
  function spawnDriftingSubstrate() { const p = makeSubstrate(pickBalancedKind()); driftInOffscreen(p); return p; }
  // a spent particle either recycles (steady state) or is let go when the food field is above the
  // current diel production target (so the field shrinks at night and blooms back by day).
  function retireSubstrate(s) {
    if (state && substrates.length > state.foodTarget) {
      for (const ph of phages) if (ph.type === "gold" && toroDist2(ph.x, ph.y, s.x, s.y) < s.R*s.R) ph.dead = true;
      s.remove = true;
    } else recycleSubstrate(s);
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
      pr.energy -= P.metabolism*env.metabolismMult*dt;  // grazing metabolism, Q10-scaled like everything else
      if (pr.turboT > 0) pr.turboT = Math.max(0, pr.turboT - dt);
      if (pr.reproCd > 0) pr.reproCd -= dt;
      if (pr.toxT > 0) pr.toxT -= dt;
      if (pr.satiated > 0) pr.satiated -= dt;
      const hunting = pr.satiated <= 0;
      if (pr.controlled) {                              // YOU are steering this protist (trophic role-swap)
        const a = axis();
        if (a.x !== 0 || a.y !== 0) {
          pr.heading = Math.atan2(a.y, a.x);
          const boost = pr.turboT > 0 ? CFG.cycle.turboMult : 1;   // Space = a burst of speed
          const spd = CFG.cycle.protistThrust*swimScale()*boost/Math.sqrt(env.viscosity);
          pr.vx = Math.cos(pr.heading)*spd; pr.vy = Math.sin(pr.heading)*spd;
        } else {
          // A protist is a microbe too: it stops when it stops pushing. `*= 0.8` decayed once per
          // FRAME, so a 120Hz display halted it twice as fast as a 60Hz one — this is per second.
          const relax = Math.exp(-CFG.cell.dragRate*env.viscosity*dt);
          pr.vx *= relax; pr.vy *= relax;
        }
      } else {
        let target = null, td = P.senseRange**2;
        if (hunting) for (const c of cells) { if (!c.alive || c.cyst) continue; const d = toroDist2(pr.x, pr.y, c.x, c.y); if (d < td) { td = d; target = c; } }
        // no active prey in range → drift toward the nearest cyst bank to graze it
        if (hunting && !target) for (const c of cells) { if (!c.alive || !c.cyst) continue; const d = toroDist2(pr.x, pr.y, c.x, c.y); if (d < td) { td = d; target = c; } }
        if (target) pr.heading = Math.atan2(dy(target.y, pr.y), dx(target.x, pr.x));
        else { pr.wobble += dt; pr.heading += Math.sin(pr.wobble*1.7)*dt*2; }
        const base = (target ? P.chaseSpeed : P.wanderSpeed)*swimScale();
        const spd = (hunting ? base : base*0.5)/Math.sqrt(env.viscosity);
        pr.vx = Math.cos(pr.heading)*spd; pr.vy = Math.sin(pr.heading)*spd;
      }
      pr.x = wrapX(pr.x + pr.vx*dt); pr.y = wrapY(pr.y + pr.vy*dt);
      collideCircle(pr, pr.r); // protists are too big to enter tunnels
      pr.pseudo += dt*4;
      if (hunting) for (const c of cells) {
        if (!c.alive || c.invuln > 0 || cellDistTo(c, pr.x, pr.y) >= pr.r + CFG.cell.radius*0.6) continue;
        if (c.cyst && Math.random() >= P.cystEatChance*dt) continue; // tough cyst usually resists a bump
        {
          pr.energy += c.cyst ? P.mealEnergy*P.cystMealFactor : P.mealEnergy;
          if (pr.controlled) state.score += CFG.cycle.protistEatScore; // you score calories while grazing as a protist
          if (c.controlled) tutDid("eaten");
          killCell(c, true); pr.satiated = P.satiatedTime; break;
        }
      }
      // protists also graze free-floating viruses on contact — a small meal and a
      // top-down brake on phage blooms (helps with the viral crisis)
      for (const ph of phages) {
        if (ph.type !== "green" || ph.dead) continue;
        const rr = pr.r + ph.r;
        if (toroDist2(pr.x, pr.y, ph.x, ph.y) < rr*rr) { ph.dead = true; pr.energy += P.virusEnergy; }
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
      // Starvation is the only clock a grazer needs. Senescence used to kill it as well, and since
      // an unfed protist starves at startEnergy/metabolism (~69s) while its lifespan rolled 55-100s,
      // the two clocks just raced each other — a well-fed grazer would drop dead with a full bar.
      if (pr.energy <= 0) {
        pr.dead = true;
        if (pr.energy <= 0 && pr.toxT > 0) releaseBiomass(pr);
        else burst(pr.x, pr.y, "#b9a9b0", 8); // natural death — inert gray puff
      }
    }
    if (newborns.length || predators.some((p) => p.dead))
      predators = predators.filter((p) => !p.dead).concat(newborns);
    // each time protists go fully extinct, halve their respawn interval (persists through the run),
    // so a world that keeps wiping its grazers reseeds them faster and faster
    if (predators.length === 0) {
      if (!state.predExtinct) { state.predExtinct = true; state.predRespawn = Math.max(CFG.predator.respawnFloor, state.predRespawn/2); }
    } else state.predExtinct = false;
    // immigration: grazers drift in toward a target that RISES with bacterial abundance
    // (density-dependent top-down pressure), and never below the crash floor.
    if (!dishOn()) state.predImmigrateT -= dt;
    if (state.predImmigrateT <= 0) {
      const P = CFG.predator;
      state.predImmigrateT = state.predRespawn;
      const target = clamp(P.minCount + cells.length*P.immigratePerPrey*(state.graze || 1), P.minCount, P.immigrateCap);
      const n = Math.min(P.immigrateMax, Math.ceil(target - predators.length));
      const pc = controlledCell();
      for (let k = 0; k < n; k++) {
        let x, y;
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
      if (ph.dead) continue; // already grazed by a protist this tick
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
      // A GRAZER can grab the gold phage too — it's the protist's version of an adaptation, and it
      // lengthens your turbo burst for the rest of the run. (Without this the gold star on the map
      // was just taunting you: as a protist there was nothing you could do with it.)
      if (ph.type === "gold" && !ph.dead && state.role === "protist") {
        const pr = controlledProtist();
        if (pr) {
          const grab = (pr.r + ph.r + CFG.phage.infectHalo) * (isTouch ? CFG.phage.goldGrabTouch : 1);
          if (toroDist2(ph.x, ph.y, pr.x, pr.y) < grab*grab) {
            const C = CFG.cycle;
            state.turboBonus = Math.min((state.turboBonus || 0) + C.turboGoldBonus,
                                        C.turboMaxSecs - C.turboSecs);
            const total = Math.min(C.turboSecs + state.turboBonus, C.turboMaxSecs);
            ph.dead = true;
            showUpgradeToast(`Turbo ${total.toFixed(2)}s`, "#ffd24a");
            Audio.play("upgrade", 0.7);
            continue;                                  // consumed — don't also run the cell loop
          }
        }
      }
      // adsorb to the first cell it contacts. On a phone the GOLD phage gets a much bigger grab
      // radius: it's the one thing you actively chase, and threading a 14px capture window with a
      // thumb on a 4-inch screen is a different sport. Green phages keep their normal reach —
      // catching the gold should get easier on mobile, not catching a plague.
      const reach = (ph.type === "gold" && isTouch) ? CFG.phage.goldGrabTouch : 1;
      const infectDist = (CFG.cell.radius + ph.r + CFG.phage.infectHalo) * reach;
      for (const c of cells) {
        if (!c.alive || c.cyst) continue;            // cysts are impervious to viruses
        if (ph.type === "gold" && !c.controlled) continue; // only YOU can grab the gold phage — daughters can't steal your adaptation
        const hl = cellHalfLen(c) + infectDist + 2;
        if (toroDist2(ph.x, ph.y, c.x, c.y) > hl*hl) continue;
        if (cellDistTo(c, ph.x, ph.y) > infectDist) continue;
        if (ph.type === "green") {
          if (c.infectedGreen) continue;             // already infected — drift on
          if (!hostMatch(ph.host, upgradeTier(c))) { // kill-the-winner: this phage can't infect this cell's tier
            if (c.crispr) { c.energy = Math.min(c.energy + CFG.cell.crisprEnergy, CFG.cell.maxEnergy); ph.dead = true;
              if (c.controlled) tutDid("atePhage"); burst(ph.x, ph.y, CRISPR_COLOR, 8); break; } // CRISPR harvests the immune virus for energy
            continue;
          }
          c.infectedGreen = true; c.lysisT = rand(CFG.phage.latent[0], CFG.phage.latent[1]);
          if (c.controlled) tutDid("infected");
          ph.dead = true;
        } else {                                     // gold: transduce a random upgrade
          // The tutorial promises CRISPR by name, and then has to teach eating a phage with it — so
          // there it grants CRISPR outright rather than rolling the dice on the lesson.
          const { msg, color, abbr, acquired } = (tut && !c.crispr) ? grantCrispr(c) : grantRandomUpgrade(c);
          if (c.controlled) tutDid("adapted");
          ph.dead = true;
          burst(c.x, c.y, "#ffd24a", 16);
          if (c.controlled) {
            Audio.play("spawn", 0.6); showUpgradeToast(msg, color);
            state.upgrades.push({ t: state.elapsed, label: msg, abbr, color, acquired });
            driftAnotherCell(c);   // the sea evolves too — someone else gains or loses a gene
          }
        }
        break;
      }
    }
    phages = phages.filter((p) => !p.dead);
    if (phages.length > CFG.phage.maxCount) phages.length = CFG.phage.maxCount;
    // background viral reservoir: when green phage runs low, seed one OFFSCREEN (it diffuses in — never pops into view)
    if (!dishOn()) state.greenSeedT -= dt;
    if (state.greenSeedT <= 0) {
      state.greenSeedT = rand(CFG.phage.greenSeed[0], CFG.phage.greenSeed[1]);
      // pick an (abundance-weighted) lineage and make sure SOME phage can infect it. Gating per-tier, not on
      // total phage count, is what keeps kill-the-winner working: a newly-evolved tier attracts fresh viruses
      // instead of booming unchecked just because there's already a big cloud tuned to older tiers.
      const rc = cells.length ? cells[(Math.random()*cells.length)|0] : null;
      if (rc && !rc.cyst && phages.length < CFG.phage.maxCount) {
        const tier = upgradeTier(rc);
        let matching = 0; for (const p of phages) if (p.type === "green" && hostMatch(p.host, tier)) matching++;
        const need = Math.min(CFG.phage.seedBatch, CFG.phage.greenFloor - matching);
        for (let k = 0; k < need && phages.length < CFG.phage.maxCount; k++) {
          const q = offscreenPoint(40); // offscreen, but spread over the sea — a ring around the camera would shell the player in viruses
          const host = Math.max(0, tier + ((Math.random()*3)|0) - 1);
          phages.push(makePhage("green", q.x, q.y, host));
        }
      }
    }
    // keep the board stocked with gold — respawns the instant one is used, usually buried inside a
    // distant particle so you have to dig it out. On touch there are several, and they're closer in.
    // NO GOLD IN THE SIM. The attract ocean isn't a game — there's nobody to catch it, so a gold
    // phage there is just a lure the camera keeps drifting to and an implied objective that doesn't
    // exist. Diversity in the demo comes from the population it's seeded with, and from drift.
    // (The TUTORIAL still gets one: that beat spawns it by hand, deliberately.)
    const goldWant = (state && state.demo) ? 0 : (isTouch ? CFG.phage.goldCountTouch : CFG.phage.goldCount);
    const goldMin = isTouch ? CFG.phage.goldMinDistTouch : CFG.phage.goldMinDist;
    const goldHave = phages.reduce((n, p) => n + (p.type === "gold" && !p.dead ? 1 : 0), 0);
    if (goldHave < goldWant && phages.length < CFG.phage.maxCount) {
      const pc = controlledCell();
      const owned = pc ? ownedEnzymes(pc) : [2]; // resources this cell can dig through
      let gx, gy, host = null, placed = false;
      if (Math.random() < 0.75 && substrates.length) {
        // embed it in a distant particle, in a voxel of a resource the cell can actually eat
        for (let k = 0; k < 14 && !placed; k++) {
          const p = substrates[(Math.random()*substrates.length)|0];
          if (p.phase !== "live") continue;
          if (pc && toroDist2(p.x, p.y, pc.x, pc.y) <= goldMin*goldMin) continue;
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
    // The sea itself carries the time of day: deep navy at midnight, bright teal at noon. Coloring
    // the WATER (rather than washing a translucent film over the finished frame, as this used to)
    // keeps the organisms at full contrast — noon is brighter without everything going milky.
    ctx.fillStyle = waterColor(state && state.light != null ? state.light : 0.6);
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawWater(); // ambient background stays unscaled so the corners never go empty
    ctx.save();
    if (ZOOM !== 1) { ctx.translate(VIEW_W/2, VIEW_H/2); ctx.scale(ZOOM, ZOOM); ctx.translate(-VIEW_W/2, -VIEW_H/2); }
    drawDish();                       // the glass, and the dark beyond it
    for (const p of substrates) drawSubstrate(p);
    for (const z of enzymes) drawEnzyme(z);
    for (const z of toxins) drawToxin(z);
    for (const n of nutrients) drawNutrient(n);
    for (const q of particles) drawParticle(q);
    for (const ph of phages) drawPhage(ph);
    for (const pr of predators) drawPredator(pr);
    for (const c of cells) drawCell(c);
    drawDemoFocus();      // inside the zoom transform, so the ring tracks the cell exactly
    ctx.restore();
    drawDayNight(); // time-of-day color wash (screen space, over the world, under the minimap)
    if (!dishOn()) drawMinimap(); // HUD-space, never zoomed — pointless when the dish IS the view
  }
  // The page around the stage was a fixed midnight gradient while the sea inside it went from navy to
  // bright teal — at noon the game looked like a lit window cut into a dark wall. Drive the page from
  // the same diel light, darker than the water so the stage still reads as the lit thing.
  let _bgLight = -1;
  function syncPageBackdrop() {
    const light = state && state.light != null ? state.light : 0.6;
    if (Math.abs(light - _bgLight) < 0.01) return;      // only touch the DOM when it would actually change
    _bgLight = light;
    const N = CFG.diel.waterNight, D = CFG.diel.waterDay, t = clamp(light, 0, 1);
    const mix = (i, k) => Math.round((N[i] + (D[i] - N[i])*t) * k);
    const rgb = (k) => `rgb(${mix(0,k)},${mix(1,k)},${mix(2,k)})`;
    document.body.style.background =
      `radial-gradient(circle at 50% 30%, ${rgb(0.72)} 0%, ${rgb(0.42)} 55%, ${rgb(0.26)} 100%)`;
    if (el.themeMeta) el.themeMeta.setAttribute("content", rgb(0.42));
  }
  function drawDayNight() {
    if (!state) return;
    const D = CFG.diel, light = state.light || 0;
    // The darkening/brightening lives in the water color itself now (see waterColor), so nothing is
    // painted over the world except this: a warm glow while the sun is low. It peaks at dawn and dusk
    // and is gone by mid-morning, so it never dulls the daytime picture.
    const gold = clamp((0.4 - light)/0.4, 0, 1) * clamp(light*5, 0, 1);
    if (gold > 0.01) { ctx.fillStyle = `rgba(255,150,60,${(D.goldTint*gold).toFixed(3)})`; ctx.fillRect(0, 0, VIEW_W, VIEW_H); }
  }

  let waterDots = makeWaterDots();
  // Dots live in NORMALIZED space (u,v in 0..1) so a canvas resize just re-scales them instead of
  // re-randomizing the whole field — a resize used to snap the starfield to a brand-new layout.
  function makeWaterDots() { return Array.from({ length: 70 }, () => ({ u: Math.random(), v: Math.random(), r: Math.random()*2 + 0.5 })); }
  function drawWater() {
    ctx.save(); ctx.globalAlpha = 0.2; ctx.fillStyle = "#bfeee0";
    // Parallax: the field slides against the camera and wraps at the canvas edge. The offset used to
    // be pre-modded by 40 — ((cam.x*0.3) % 40) — which is a SAWTOOTH: it ramps 0->40 then snaps back
    // to 0, so the whole starfield jumped 40px at once every ~133px of camera travel. Wrapping at
    // VIEW_W/VIEW_H instead makes it slide.
    const ox = cam.x*0.3, oy = cam.y*0.3;
    for (const d of waterDots) {
      const px = (((d.u*VIEW_W - ox) % VIEW_W) + VIEW_W) % VIEW_W;
      const py = (((d.v*VIEW_H - oy) % VIEW_H) + VIEW_H) % VIEW_H;
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
    const G = CFG.substrate, grain = G.grainStrength > 0;
    const depth = grain ? surfaceDepth(p) : null;
    const lut = grain ? grainLut() : null;
    for (let gj = 0; gj < p.n; gj++) for (let gi = 0; gi < p.n; gi++) {
      const idx = gj*p.n + gi, v = p.grid[idx]; if (v <= 0) continue;
      const res = p.gtype[idx];
      // color = resource class, shaded by how deeply buried the voxel is
      g.fillStyle = grain ? lut[res][Math.min(depth[idx], GRAIN_MAXD)] : RESOURCES[res].color;
      g.globalAlpha = 0.6 + 0.4*v;
      g.fillRect(gi*cs, gj*cs, cs+0.5, cs+0.5);
    }
    g.globalAlpha = 1;
    p.dirty = false;
  }
  // How many voxel steps from this voxel to the nearest empty cell (off-grid counts as
  // empty). Two-pass city-block distance transform — O(n²), and it only runs when the
  // particle is re-cached (i.e. when something carved it), which is exactly when the
  // surface moved. Reuses one buffer per particle so carving doesn't churn the heap.
  const GRAIN_MAXD = 14; // deeper than this is all core; clamps the LUT
  function surfaceDepth(p) {
    const n = p.n, N = n*n;
    let d = p.depthBuf;
    if (!d || d.length !== N) d = p.depthBuf = new Int16Array(N);
    const INF = 30000;
    for (let k = 0; k < N; k++) d[k] = p.grid[k] > 0 ? INF : 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {   // forward: up + left
      const k = j*n + i; if (d[k] === 0) continue;
      const up = j > 0 ? d[k-n] : 0, left = i > 0 ? d[k-1] : 0;
      const m = (up < left ? up : left) + 1;
      if (m < d[k]) d[k] = m;
    }
    for (let j = n-1; j >= 0; j--) for (let i = n-1; i >= 0; i--) { // backward: down + right
      const k = j*n + i; if (d[k] === 0) continue;
      const dn = j < n-1 ? d[k+n] : 0, rt = i < n-1 ? d[k+1] : 0;
      const m = (dn < rt ? dn : rt) + 1;
      if (m < d[k]) d[k] = m;
    }
    return d;
  }
  // depth → color, precomputed: 3 resources × 15 depths. Rebuilt only when a grain knob
  // moves, so tuning it live costs nothing per voxel.
  const RES_RGB = RESOURCES.map((r) => {
    const v = parseInt(r.color.slice(1), 16);
    return [v >> 16 & 255, v >> 8 & 255, v & 255];
  });
  let _grainLut = null, _grainKey = "";
  function grainLut() {
    const G = CFG.substrate;
    const key = `${G.grainStrength}|${G.grainRim}|${G.grainFalloff}|${G.grainFloor}`;
    if (_grainLut && _grainKey === key) return _grainLut;
    const byte = (x) => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));
    _grainKey = key;
    _grainLut = RES_RGB.map((rgb) => {
      const row = [];
      for (let d = 0; d <= GRAIN_MAXD; d++) {
        const lit = clamp(G.grainRim - G.grainFalloff*(Math.max(1, d) - 1), G.grainFloor, 6);
        const f = 1 + (lit - 1)*G.grainStrength;   // strength 0 → factor 1 → the old flat fill
        row.push(`rgb(${byte(rgb[0]*f)},${byte(rgb[1]*f)},${byte(rgb[2]*f)})`);
      }
      return row;
    });
    return _grainLut;
  }
  function drawSubstrate(p) {
    const cx = sx(p.x), cy = sy(p.y);
    if (!onScreen(cx, cy, p.half + 20)) return;
    if (p.dirty || !p.cache) renderParticleCache(p);
    ctx.drawImage(p.cache, cx - p.half, cy - p.half);
  }

  const ENZ_RGB = ["239,217,138", "239,139,60", "111,168,255"]; // matches RESOURCES colors
  function drawEnzyme(z) {
    const cx = sx(z.x), cy = sy(z.y); if (!onScreen(cx, cy, z.r + 4)) return;
    const rgb = ENZ_RGB[z.res] || "190,130,255";
    ctx.save(); ctx.translate(cx, cy);
    const g = ctx.createRadialGradient(0, 0, z.r*0.2, 0, 0, z.r);
    g.addColorStop(0, `rgba(${rgb},0.30)`); g.addColorStop(0.8, `rgba(${rgb},0.13)`); g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, z.r, 0, 6.28); ctx.fill();
    ctx.restore();
  }
  function drawToxin(z) { // magenta antibiotic haze — distinct from the resource-colored enzyme clouds
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
    // green phage — color-coded by danger to YOU: red = can infect your cell, green = harmless
    // In the tutorial there IS no controlled cell, so red/green would have nothing to be relative to
    // and every phage would read harmless. Judge them against the cell the lesson is about instead.
    const pc = controlledCell() || (demo && alive(demo.hero) ? demo.hero : null);
    const danger = pc && hostMatch(ph.host, upgradeTier(pc));
    const col = danger ? "#ff5a52" : "#7CFC5A", r = 3.8;
    ctx.fillStyle = "rgba(8,12,10,0.6)"; ctx.beginPath(); ctx.arc(0, 0, r + 1.7, 0, 6.28); ctx.fill(); // dark halo → pops against same-color blocks
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
      // resting cyst: no flagellum, contracted, thick resistant wall, muted color
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
    // life-stage cues: juveniles are smaller; a STARVING grazer shrinks and grays out. This tracks
    // ENERGY, not age — starvation is the only thing that kills a protist now, so the visual
    // telegraphs the clock that's actually running instead of an invisible one.
    const grow = clamp(pr.age/CFG.predator.maturity, 0.55, 1);
    const spent = 1 - clamp(pr.energy/CFG.predator.startEnergy, 0, 1); // 0 = well fed, 1 = starving
    const r = pr.r*grow*(1 - 0.18*clamp((spent - 0.55)/0.45, 0, 1));
    const old = clamp((spent - 0.6)/0.4, 0, 1); // grays out as its reserves run out
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
    if (pr.controlled) { // the protist YOU are steering. No ring — the camera already centers you,
                         // and the minimap marks you. A turbo burst flares instead.
      if (pr.turboT > 0) {
        ctx.globalAlpha = clamp(pr.turboT/CFG.cycle.turboSecs, 0, 1);
        ctx.strokeStyle = "#ffd24a"; ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(0, 0, r + 6, 0, 6.28); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawMinimap() {
    // Desktop: small, bottom-right, showing everything including the colony.
    // Phone: BIGGER, top-left, and deliberately sparser — the colony dots are dropped and the
    // marks that remain (you, protists, gold phage) are drawn at double size. A dot swarm that
    // reads fine on a monitor is unreadable mush at a third of the size in your hand, so the
    // phone map answers only the two questions worth answering at a glance: what's hunting me,
    // and where's the gold.
    // Sizes are in DESIGN space (the old 800px canvas) and scaled to whatever canvas we actually
    // have. 220px was 27.5% of an 800px canvas; on a 370px phone canvas it would be 59% — which is
    // how the map ended up swallowing the ocean once the canvas became responsive.
    const vs = isTouch ? viewScale() : 1;
    const mw = (isTouch ? 220 : 150) * vs, mh = mw*WORLD_H/WORLD_W;
    const pad = 12 * vs;
    const mx = isTouch ? pad : VIEW_W - mw - pad, my = isTouch ? pad : VIEW_H - mh - pad;
    const ps = (isTouch ? 2 : 1) * vs;   // mark scale, same design-space correction
    ctx.save();
    // The frame is translucent on desktop, but at phone size a particle drifting behind a
    // 220px map bleeds straight through it and swamps the marks. Nearly opaque there.
    ctx.globalAlpha = isTouch ? 1 : 0.85;
    ctx.fillStyle = isTouch ? "rgba(4,20,26,0.94)" : "rgba(4,20,26,0.7)";
    ctx.strokeStyle = "rgba(120,220,200,0.4)";
    ctx.lineWidth = 1; ctx.fillRect(mx, my, mw, mh); ctx.strokeRect(mx, my, mw, mh);
    const kx = mw/WORLD_W, ky = mh/WORLD_H;
    // CENTERED on the player: everything is drawn relative to your cell (toroidal wrap via dx/dy),
    // so you stay in the middle and the world scrolls under you — much easier to navigate the wrap.
    const pc = controlledEntity(), cx0 = mx + mw/2, cy0 = my + mh/2; // cell OR protist — the map follows whoever you are
    // Anchor on the CAMERA, not on the cell. In play the camera is glued to your cell, so this is the
    // same picture — but the attract sim has no controlled cell, and the map used to fall back to raw
    // world coordinates and sit still while the camera drifted somewhere else entirely.
    const anchor = pc || cam;
    const MX = (ex) => cx0 + dx(ex, anchor.x)*kx;
    const MY = (ey) => cy0 + dy(ey, anchor.y)*ky;
    ctx.beginPath(); ctx.rect(mx, my, mw, mh); ctx.clip(); // keep marks inside the frame
    // particles are omitted — the map shows only the living things
    if (!isTouch) { // colony dots colored by generation (same palette as the chart); cysts hidden
      for (const c of cells) if (!c.controlled && !c.cyst) {
        ctx.fillStyle = levelColor(ecoMask(c), upgradeTier(c));
        ctx.fillRect(MX(c.x) - 1, MY(c.y) - 1, 2, 2);
      }
    }
    ctx.fillStyle = "#ff7a6b";
    for (const pr of predators) { ctx.beginPath(); ctx.arc(MX(pr.x), MY(pr.y), 2.5*ps, 0, 6.28); ctx.fill(); }
    // gold phage — a bright STAR so it stands out from round dots
    for (const ph of phages) if (ph.type === "gold" && !ph.dead) drawMiniStar(MX(ph.x), MY(ph.y), 5.5*ps, 2.4*ps, "#ffd24a");
    // your cell — a white-ringed teal DIAMOND, dead center
    if (pc) drawMiniDiamond(cx0, cy0, 4.5*ps, "#8dffdc");
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
  // Colors: dataviz skill's validated 8-hue categorical palette (dark, CVD-safe order).
  const CHART = { interval: 0.5, samples: 200, W: 800, H: 96, subH: 64, surface: "#06181d" };
  const ECO_COLOR = ["#3987e5", "#199e70", "#c98500", "#008300", "#9085e9", "#e66767", "#d55181", "#d95926"];
  const PROTIST_COLOR = "#ff9ec0", VIRUS_COLOR = "#8bf06a", CYST_COLOR = "#9aa6a0", CRISPR_COLOR = "#c39bff", TOXIN_COLOR = "#f05ad0";
  // cause-of-mortality series (index order matches MORT_IDX: grazing / viral / starvation / antibiotic)
  const MORT_COLORS = [PROTIST_COLOR, VIRUS_COLOR, CYST_COLOR, TOXIN_COLOR];
  const MORT_LABELS = ["grazing", "viral", "starvation", "antibiotic"];
  function subVals(s) { return subMode ? (s && s.mort ? s.mort : [0,0,0,0]) : (s && s.sub ? s.sub : [0,0,0]); }
  function subColors() { return subMode ? MORT_COLORS : RESOURCES.map((r) => r.color); }
  function subLabelText() { return subMode ? "Cause of mortality (grazing · viral · starvation · antibiotic)" : "Food available (lipid · protein · carb)"; }
  function updateSubLegend() {
    if (!el_subchartlegend) return;
    const items = subMode
      ? MORT_LABELS.map((l, k) => `<span><i style="background:${MORT_COLORS[k]}"></i>${l}</span>`).join("")
      : RESOURCES.map((r) => `<span><i style="background:${r.color}"></i>${r.key}</span>`).join("");
    el_subchartlegend.innerHTML = items + `<span id="subchartTitle">${subMode ? "cause of mortality" : "food available"} vs. time · click to swap</span>`;
  }
  function toggleSubMode() { subMode ^= 1; updateSubLegend(); }
  function ecoMask(c) { return (c.enzLvl[0] > 0 ? 1 : 0) | (c.enzLvl[1] > 0 ? 2 : 0) | (c.chemotaxis ? 4 : 0); }
  function updateLegend(eco, preds, green) {
    if (!el.legend) return;
    // Just the totals. The per-ecotype breakdown ("carb only 1 · +lipase 6 · +protease 1 · …") grew a
    // line per gene combination and crowded the legend off the chart; the color bands already show
    // the composition, and the run analysis on death gives the detail.
    let colony = 0; for (let m = 0; m < 8; m++) colony += eco[m];
    let html = `<span><i class="gen-swatch"></i>${colony === 1 ? "bacterium" : "bacteria"} <b>${colony}</b></span>`;
    html += `<span><i class="eco-line" style="border-color:${PROTIST_COLOR}"></i>protists <b>${preds}</b></span>`;
    html += `<span><i class="eco-line" style="border-color:${VIRUS_COLOR}"></i>viruses <b>${green || 0}</b></span>`;
    // In log mode the stack is Σlog(cells) per lineage, whose height is n·log(GM) — so the number
    // worth showing alongside it is the GEOMETRIC MEAN lineage size, not the total.
    if (chartLog) {
      const gm = geoMeanLineage(ecoSample().buckets);
      if (gm) html += `<span>geo-mean lineage <b>${gm.toFixed(1)}</b></span>`;
    }
    html += `<span id="chartTitle">${chartLog ? "Σlog(cells) per lineage" : "ecotype abundance"} vs. time · click for ${chartLog ? "linear" : "log"}</span>`;
    el.legend.innerHTML = html;
  }
  // geometric mean of the living lineages' sizes — the centre of a log-scaled stack
  function geoMeanLineage(buckets) {
    const v = Object.values(buckets || {}).filter((n) => n > 0);
    if (!v.length) return 0;
    let s = 0; for (const n of v) s += Math.log(n);
    return Math.exp(s/v.length);
  }
  function ecoCounts() { const e = [0,0,0,0,0,0,0,0]; for (const c of cells) e[ecoMask(c)]++; return e; }
  // per-ecotype count + average upgrade level (total enzyme levels above base + chemoLevel) for the chart
  function ecoSample() {
    // bucket active cells by GENERATION = (ecotype, upgrade tier). Each bucket becomes its own flat-colored
    // polygon in the stack — a new lineage gets a new color, and cells keep it until they upgrade again.
    const eco = [0,0,0,0,0,0,0,0], buckets = {};
    for (const c of cells) {
      const m = ecoMask(c); eco[m]++;          // cysts included in their generation bucket (colored, not a separate gray band)
      const key = m*64 + Math.min(63, upgradeTier(c)); // mask (0-7) high bits, tier low bits
      buckets[key] = (buckets[key] || 0) + 1;
      // Remember what each colored band on the chart actually IS, the first time we see it: the band
      // is a lineage (an ecotype at an adaptation level), and this is the genome behind that color.
      // Recorded once per lineage, not per sample — a per-sample copy would balloon the saved run.
      if (state && state.lineages && !state.lineages[key] && Object.keys(state.lineages).length < 64) {
        state.lineages[key] = { t: +state.elapsed.toFixed(1), ups: (c.ups || []).slice(0, 32) };
      }
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
  function levelColor(m, lvl) { // DISCRETE staggered color per generation → sharp transitions, not a smooth rainbow
    const L = Math.round(lvl), hsl = ECO_HSL[m];
    const hue = (((hsl[0] + L*58) % 360) + 360) % 360;        // big hue jumps so consecutive levels contrast
    const light = clamp(hsl[2] + (L % 2 ? -13 : 9), 24, 74);  // alternate darker/lighter to separate them further
    return `hsl(${hue.toFixed(0)}, ${hsl[1].toFixed(0)}%, ${light.toFixed(0)}%)`;
  }
  // Shared renderer: stacked absolute ecotype areas + protist line. Used by the live
  // chart (scrolling window) and by each saved high-score mini-chart (whole game).
  // `denom` sets the x-span (fixed window for live scroll; hist length for saved fill).
  // THE LOG SCALE, and why it changed.
  // It used to stack raw counts and log the CUMULATIVE total — log(Σx). On a stacked chart that is
  // close to useless: the bottom band gets nearly the whole axis, and a rare lineage sitting on top
  // of a boom is squeezed into a hairline, because what you see is the log of everything BELOW it.
  // Now each band contributes log(x+1) of its OWN size and those are stacked — Σlog(x). Every
  // lineage then gets a thickness set by its own abundance, so 2 cells is visible next to 200.
  // (This is the geometric mean, drawn: Σlog(xᵢ) = n·log(GM), so the stack's total height IS the
  // count of lineages times the log of their geometric mean. A colony of many similar lineages is
  // tall; one monster lineage plus stragglers is short. That's the diversity you wanted to see.)
  const bandVal = (x) => (chartLog ? Math.log10(x + 1) : x);
  // One scale, shared by the renderer and the hover hit-test, so the two can never drift apart.
  function ecoScale(hist, H) {
    const bks = hist.map(sampleBuckets);
    const keySet = new Set(); for (const b of bks) for (const k in b) keySet.add(+k);
    const keys = [...keySet].sort((a, b) => a - b);   // stable: mask-major, tier-minor — bands don't jump
    let maxY = chartLog ? 1 : 10, vMax = 10, peakCells = 0;
    for (let i = 0; i < hist.length; i++) {
      let tot = 0, cells = 0;
      for (const k in bks[i]) { tot += bandVal(bks[i][k]); cells += bks[i][k]; }
      if (tot > maxY) maxY = tot;
      if (cells > peakCells) peakCells = cells;
      const pv = bandVal(hist[i].p || 0);
      if (pv > maxY) maxY = pv;
      if ((hist[i].v || 0) > vMax) vMax = hist[i].v;
    }
    const pad = H < 70 ? 8 : 14;
    // v is ALREADY in stacked units (cells, or Σlog-cells) — so the axis itself is linear in them
    const yAt = (v) => H - (v/maxY)*(H - pad) - 2;
    return { bks, keys, maxY, vMax, peakCells, pad, yAt };
  }
  function renderEcoChart(g, W, H, hist, denom) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = CHART.surface; g.fillRect(0, 0, W, H);
    const S = ecoScale(hist, H);
    const n = denom || Math.max(hist.length, 2);
    const xAt = (i) => i/(n-1)*W, yAt = S.yAt;
    g.strokeStyle = "rgba(255,255,255,0.06)"; g.lineWidth = 1;
    for (let k = 1; k <= 3; k++) { const y = H - k/4*(H - S.pad) - 2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = "rgba(215,245,238,0.5)"; g.font = "10px 'Trebuchet MS', sans-serif"; g.textAlign = "left";
    // In log mode the axis is in Σlog units, which is not a cell count — so label it with the peak
    // CELLS (what you actually want to know) and mark the axis as Σlog rather than printing a number
    // that means nothing.
    g.fillText(chartLog ? S.peakCells + " ·Σlog" : String(Math.round(S.maxY)), 3, 10);
    g.fillText("0", 3, H - 3);
    if (hist.length > 1) {
      const last = hist.length - 1;
      // one FLAT-colored polygon per GENERATION bucket (ecotype+tier), stacked from the baseline.
      // Each new lineage = a new color that grows in and fades out as its population rises and falls.
      const bks = S.bks, cum = hist.map(() => 0);
      for (const key of S.keys) {
        const mask = key >> 6, tier = key & 63;
        g.fillStyle = levelColor(mask, tier);
        g.beginPath(); g.moveTo(xAt(0), yAt(cum[0]));
        for (let i = 1; i <= last; i++) g.lineTo(xAt(i), yAt(cum[i]));
        for (let i = last; i >= 0; i--) g.lineTo(xAt(i), yAt(cum[i] + bandVal(bks[i][key] || 0)));
        g.closePath(); g.fill();
        for (let i = 0; i <= last; i++) cum[i] += bandVal(bks[i][key] || 0);
      }
      g.strokeStyle = PROTIST_COLOR; g.lineWidth = H < 70 ? 1.3 : 1.8; g.beginPath();
      for (let i = 0; i < hist.length; i++) { const x = xAt(i), y = yAt(bandVal(hist[i].p || 0)); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
      // virus (green-phage) count — dashed line on its OWN hidden axis (scaled to vMax, not the cell axis)
      const lgVMax = Math.log10(S.vMax + 1) || 1;
      const yAtV = chartLog ? (v) => H - (Math.log10(v + 1)/lgVMax)*(H - S.pad) - 2 : (v) => H - (v/S.vMax)*(H - S.pad) - 2;
      g.strokeStyle = VIRUS_COLOR; g.lineWidth = H < 70 ? 1.1 : 1.5; g.setLineDash([3, 3]); g.beginPath();
      for (let i = 0; i < hist.length; i++) { const x = xAt(i), y = yAtV(hist[i].v || 0); i ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke(); g.setLineDash([]);
    }
  }
  // Second chart: available food of each resource type stacked over time. Watch a band get eaten down right
  // after you acquire its enzyme — that consumption is what fuels the colony boom you see on the ecotype chart.
  function renderSubChart(g, W, H, hist, denom) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = CHART.surface; g.fillRect(0, 0, W, H);
    const colors = subColors(), K = colors.length;
    // per-sample values; for mortality we CUMULATE so the bands grow smoothly and the
    // end-of-window proportions read directly as the grazing/viral/etc. split.
    const vals = hist.map((s) => subVals(s).slice());
    if (subMode) { const run = new Array(K).fill(0); for (let i = 0; i < vals.length; i++) for (let k = 0; k < K; k++) { run[k] += vals[i][k] || 0; vals[i][k] = run[k]; } }
    let maxY = subMode ? 1 : 10;
    for (const v of vals) { let tot = 0; for (let k = 0; k < K; k++) tot += v[k] || 0; if (tot > maxY) maxY = tot; }
    const n = denom || Math.max(hist.length, 2), pad = H < 70 ? 8 : 14;
    const xAt = (i) => i/(n-1)*W, yAt = (v) => H - (v/maxY)*(H-pad) - 2;
    g.strokeStyle = "rgba(255,255,255,0.06)"; g.lineWidth = 1;
    for (let k = 1; k <= 3; k++) { const y = H - k/4*(H-pad) - 2; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    g.fillStyle = "rgba(215,245,238,0.5)"; g.font = "10px 'Trebuchet MS', sans-serif"; g.textAlign = "left";
    g.fillText(String(Math.round(maxY)) + (subMode ? " deaths" : ""), 3, 10); g.fillText("0", 3, H - 3);
    if (vals.length > 1) {
      const last = vals.length - 1, cum = vals.map(() => 0);
      for (let k = 0; k < K; k++) {
        g.fillStyle = colors[k];
        g.beginPath(); g.moveTo(xAt(0), yAt(cum[0]));
        for (let i = 1; i <= last; i++) g.lineTo(xAt(i), yAt(cum[i]));
        for (let i = last; i >= 0; i--) g.lineTo(xAt(i), yAt(cum[i] + (vals[i][k] || 0)));
        g.closePath(); g.fill();
        for (let i = 0; i <= last; i++) cum[i] += (vals[i][k] || 0);
      }
    }
  }
  function drawHelix(pc) {
    if (!hlxCtx || !el.genome) return;
    const gw = el.genome.clientWidth, gh = el.genome.clientHeight;
    if (!gw || !gh) return;                          // not laid out yet (or headless)
    const w = Math.round(gw), h = Math.round(gh);
    if (el.helix.width !== w) el.helix.width = w;
    if (el.helix.height !== h) el.helix.height = h;
    const g = hlxCtx; g.clearRect(0, 0, w, h);
    const col = pc ? levelColor(ecoMask(pc), upgradeTier(pc)) : "#8dffdc"; // lineage = generation color of the steered cell
    const cy = h/2, amp = h*0.40, P = 26;
    g.strokeStyle = col; g.lineCap = "round";
    for (const ph of [0, Math.PI]) {                 // two anti-phase strands
      g.globalAlpha = 0.55; g.lineWidth = 2; g.beginPath();
      for (let x = 0; x <= w; x += 2) { const y = cy + amp*Math.sin(x/P*6.2832 + ph); x ? g.lineTo(x, y) : g.moveTo(x, y); }
      g.stroke();
    }
    g.globalAlpha = 0.3; g.lineWidth = 1.3;          // base-pair rungs where the strands are farthest apart
    for (let x = P/4; x <= w; x += P/2) { const a = x/P*6.2832; g.beginPath(); g.moveTo(x, cy+amp*Math.sin(a)); g.lineTo(x, cy+amp*Math.sin(a+Math.PI)); g.stroke(); }
    g.globalAlpha = 1;
  }
  function drawChart() {
    if (!state) return;
    if (cctx) renderEcoChart(cctx, CHART.W, CHART.H, state.history, CHART.samples);
    if (sctx) renderSubChart(sctx, CHART.W, CHART.subH, state.history, CHART.samples);
  }

  // ---------------------------------------------------------------- high scores
  // SCORE_NORMALIZER_START — kept pure so tests can execute this exact production block.
  const SCORE_CLIENT_LIMITS = { rows: 100, hist: 800, upgrades: 200, lineages: 64 };
  const scoreClientObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
  function scoreClientNumber(value, min, max, fallback = 0) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }
  function scoreClientInteger(value, min, max, fallback = 0) {
    return Math.round(scoreClientNumber(value, min, max, fallback));
  }
  function scoreClientVector(value, length, max) {
    if (!Array.isArray(value) || value.length !== length || value.some((v) => !Number.isFinite(v))) return null;
    return value.map((v) => scoreClientInteger(v, 0, max));
  }
  function scoreClientBuckets(value) {
    if (!scoreClientObject(value)) return null;
    const out = {};
    for (const [rawKey, rawCount] of Object.entries(value).slice(0, 64)) {
      const key = Number(rawKey);
      if (!Number.isInteger(key) || key < 0 || key > 511 || !Number.isFinite(rawCount)) continue;
      out[key] = scoreClientInteger(rawCount, 0, 100000);
    }
    return out;
  }
  function normalizeClientUpgrade(value, maxTime = 86400) {
    if (!scoreClientObject(value)) return null;
    const abbr = (typeof value.abbr === "string" ? value.abbr : "").replace(/[^A-Za-z0-9]/g, "").slice(0, 12);
    if (!abbr) return null;
    const rawColor = typeof value.color === "string" ? value.color.slice(0, 9) : "";
    return {
      t: scoreClientNumber(value.t, 0, maxTime),
      label: (typeof value.label === "string" ? value.label : abbr).replace(/[\x00-\x1F<>]/g, "").slice(0, 64) || abbr,
      abbr,
      color: /^#[0-9A-Fa-f]{3,8}$/.test(rawColor) ? rawColor : "#9fc3ba",
      acquired: value.acquired === true,
    };
  }
  function normalizeClientUpgrades(value, limit = SCORE_CLIENT_LIMITS.upgrades) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).map((item) => normalizeClientUpgrade(item)).filter(Boolean);
  }
  function normalizeClientSample(value) {
    if (!scoreClientObject(value)) return null;
    const eco = scoreClientVector(value.eco, 8, 100000);
    if (!eco) return null;
    const out = { eco, p: scoreClientInteger(value.p, 0, 1000000), v: scoreClientInteger(value.v, 0, 1000000) };
    const buckets = scoreClientBuckets(value.buckets); if (buckets) out.buckets = buckets;
    const sub = scoreClientVector(value.sub, 3, 1000000); if (sub) out.sub = sub;
    const mort = scoreClientVector(value.mort, 4, 1000000); if (mort) out.mort = mort;
    const lvl = scoreClientVector(value.lvl, 8, 63); if (lvl) out.lvl = lvl;
    return out;
  }
  function normalizeClientLineages(value) {
    if (!scoreClientObject(value)) return {};
    const out = {};
    for (const [rawKey, lineage] of Object.entries(value).slice(0, SCORE_CLIENT_LIMITS.lineages)) {
      const key = Number(rawKey);
      if (!Number.isInteger(key) || key < 0 || key > 511 || !scoreClientObject(lineage)) continue;
      out[key] = { t: scoreClientNumber(lineage.t, 0, 86400), ups: normalizeClientUpgrades(lineage.ups, 32) };
    }
    return out;
  }
  function normalizeScoreRecord(value) {
    if (!scoreClientObject(value)) return null;
    const date = scoreClientInteger(value.date, 0, Number.MAX_SAFE_INTEGER, Date.now());
    return {
      id: scoreClientInteger(value.id, 0, Number.MAX_SAFE_INTEGER, date),
      name: (typeof value.name === "string" ? value.name : "").replace(/[\x00-\x1F<>]/g, "").slice(0, 18),
      score: scoreClientInteger(value.score, 0, 100000000),
      gen: scoreClientInteger(value.gen, 0, 1000000),
      dur: scoreClientInteger(value.dur, 0, 86400),
      date,
      hist: Array.isArray(value.hist) ? value.hist.slice(0, SCORE_CLIENT_LIMITS.hist).map(normalizeClientSample).filter(Boolean) : [],
      upgrades: normalizeClientUpgrades(value.upgrades),
      device: value.device === "touch" ? "touch" : "desktop",
      day: scoreClientInteger(value.day, 1, 3650, 1),
      lineages: normalizeClientLineages(value.lineages),
      roleSwaps: Array.isArray(value.roleSwaps)
        ? value.roleSwaps.slice(0, 32).filter(Number.isFinite).map((v) => scoreClientNumber(v, 0, 86400)) : [],
    };
  }
  function normalizeScoreList(value) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, SCORE_CLIENT_LIMITS.rows).map(normalizeScoreRecord).filter(Boolean);
  }
  // SCORE_NORMALIZER_END
  const HS_KEY = "bacteria_highscores_v1", HS_MAX = 100, NAME_KEY = "bacteria_player_name";
  const API_URL = "scores.php"; // shared leaderboard on the game's own origin; if it's absent/offline we fall back to localStorage
  let playerName = ""; try { playerName = localStorage.getItem(NAME_KEY) || ""; } catch (e) {}
  let globalScores = null;      // last-fetched shared leaderboard (null = not loaded / offline → use local)
  let lastRec = null;           // the run just finished (so a later name edit re-submits the same id)
  let scoreWriteQueue = Promise.resolve(); // serialize writes so an older request can never land last
  const NAME_UPDATE_DELAY = 500;
  let nameUpdateTimer = null, pendingNameUpdate = null;
  function loadScores() { try { return normalizeScoreList(JSON.parse(localStorage.getItem(HS_KEY))); } catch (e) { return []; } }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  let justFinishedTs = null; // marks the run just completed, to highlight it in the list
  function recordGame() {
    if (!state) return;
    // Keyed on the RUN, not on the moment. Surviving another day re-records under the same id, so
    // the board UPDATES that one entry instead of stacking a fresh row for every day you get
    // through — the backend upserts by id, and the local list replaces by id below.
    const id = state.runId || Date.now();
    const rec = { id, score: Math.round(state.score), gen: state.gen, date: id, dur: Math.round(state.elapsed), hist: state.fullHist, upgrades: state.upgrades, name: playerName,
                  day: state.day || 1, device: state.device || "desktop", lineages: state.lineages, roleSwaps: state.roleSwaps,
                  tuned: cfgTuned() || undefined }; // undefined → omitted by JSON.stringify, so untuned runs are unchanged on the wire
    justFinishedTs = id; lastRec = rec;
    try {
      const arr = loadScores().filter((r) => r.id !== id); // replace this run's row rather than duplicating it
      arr.push(rec); arr.sort((a, b) => b.score - a.score);
      localStorage.setItem(HS_KEY, JSON.stringify(arr.slice(0, HS_MAX)));
    } catch (e) { /* storage unavailable — high scores just won't persist */ }
    submitScore(rec); // push to the shared leaderboard (fire-and-forget, safe if the backend isn't there)
  }
  function queueScoreWrite(payload) {
    if (typeof fetch !== "function" || !payload) return;
    const body = JSON.stringify(payload); // snapshot now; later local edits cannot mutate a queued request
    scoreWriteQueue = scoreWriteQueue.catch(() => null)
      .then(() => fetch(API_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body }))
      .then((r) => (r.ok ? r.json() : null))
      .then((list) => { if (Array.isArray(list)) { globalScores = normalizeScoreList(list); refreshScoreListIfOpen(); } })
      .catch(() => null);
    return scoreWriteQueue;
  }
  function submitScore(rec) { // POST a run to the shared leaderboard; ignored gracefully if offline / no backend
    if (!rec) return;
    // A run played on tuned constants (` panel) isn't comparable to anyone else's,
    // so it stays in this browser's local list. Guarded here rather than at the call
    // sites so the later name-edit re-submit can't sneak it onto the shared board.
    if (rec.tuned) return;
    try { return queueScoreWrite(rec); } catch (e) {}
  }
  function scheduleNameUpdate(rec) {
    if (!rec || rec.tuned) return;
    pendingNameUpdate = { op: "name", id: rec.id, name: rec.name || "" };
    clearTimeout(nameUpdateTimer);
    nameUpdateTimer = setTimeout(flushNameUpdate, NAME_UPDATE_DELAY);
  }
  function flushNameUpdate() {
    clearTimeout(nameUpdateTimer); nameUpdateTimer = null;
    const update = pendingNameUpdate; pendingNameUpdate = null;
    if (update) try { return queueScoreWrite(update); } catch (e) {}
  }
  function fetchScores() { // GET the shared leaderboard; on success it replaces the local list in the UI
    if (typeof fetch !== "function") return;
    try {
      fetch(API_URL, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((list) => { if (Array.isArray(list)) { globalScores = normalizeScoreList(list); refreshScoreListIfOpen(); } })
        .catch(() => {});
    } catch (e) {}
  }
  function refreshScoreListIfOpen() { if (el.scores && !el.scores.classList.contains("hidden") && el.scoreDetail && el.scoreDetail.classList.contains("hidden")) renderScoreList(); }
  function renderScoreList() {
    if (!el.scoresList) return;
    let arr = (globalScores || loadScores()).slice(); // shared list when we have it, else this browser's local runs
    // TOUCH AND DESKTOP ARE DIFFERENT SPORTS — the phone runs at a different swim speed, zoom and
    // gold-phage capture radius — so they get separate boards rather than one hopeless mixed one.
    const counts = { desktop: 0, touch: 0 };
    for (const r of arr) counts[deviceOf(r)]++;
    arr = arr.filter((r) => deviceOf(r) === scoreDevice);
    renderDeviceTabs(counts);
    // paused mid-game: drop the live run into the list so you can see exactly where it ranks
    const liveLine = (state && state.running && !state.demo && state.device === scoreDevice) ? currentRunLine() : null; // the attract loop is not a run
    if (liveLine) arr.push(liveLine);
    if (!arr.length) {
      el.scoresList.innerHTML = `<p class="empty">No ${scoreDevice === "touch" ? "mobile" : "desktop"} runs yet. Play a game and your lineage's evolutionary history will appear here.</p>`;
      return;
    }
    // all-time leader per category → 🏆 badge on that run's value
    const leader = {};
    for (const k of ["score", "gen", "dur", "ad"]) { let best = -Infinity, id = null; for (const r of arr) { const v = SCORE_VAL[k](r); if (v > best) { best = v; id = recId(r); } } leader[k] = id; }
    // sort by the active column (numbers desc / names asc by default; tie-break on calories)
    const val = SCORE_VAL[scoreSort.key] || SCORE_VAL.score, dir = scoreSort.dir;
    arr.sort((a, b) => { const va = val(a), vb = val(b); if (va < vb) return -dir; if (va > vb) return dir; return SCORE_VAL.score(b) - SCORE_VAL.score(a); });
    const arrow = (c) => scoreSort.key === c ? (scoreSort.dir < 0 ? " ▾" : " ▴") : "";
    const badge = (c, r) => leader[c] === recId(r) ? ` <span class="lead" title="best ${c}">🏆</span>` : "";
    const COLS = [["name", "Name", "nm"], ["score", "Calories", "num"], ["gen", "Gen", "num"], ["dur", "Time", "num"], ["ad", "Adapt.", "num"], ["date", "Date", "num dt"]];
    let h = `<table id="scoresTable"><thead><tr><th class="rk">#</th>`;
    for (const [key, label, cls] of COLS) h += `<th data-k="${key}" class="sortable ${cls}">${label}${arrow(key)}</th>`;
    h += `<th class="run">Run</th></tr></thead><tbody>`;
    arr.forEach((r, i) => {
      const isLive = r === liveLine;
      h += `<tr class="srow${isLive || recId(r) === justFinishedTs ? " current" : ""}" data-id="${recId(r)}"><td class="rk">${i+1}</td>`;
      h += `<td class="nm">${isLive ? '<span class="livedot"></span>' : ''}${r.name ? escapeHtml(r.name) : `<span class="anon">${isLive ? "this run" : "anon"}</span>`}</td>`;
      h += `<td class="num">${SCORE_VAL.score(r).toLocaleString()}${badge("score", r)}</td>`;
      h += `<td class="num">${SCORE_VAL.gen(r)}${badge("gen", r)}</td>`;
      h += `<td class="num">${fmtDur(SCORE_VAL.dur(r))}${badge("dur", r)}</td>`;
      h += `<td class="num">${SCORE_VAL.ad(r)}${badge("ad", r)}</td>`;
      h += `<td class="num dt">${r.date && r.date > 0 ? fmtDate(r.date) : ""}</td>`;
      h += `<td class="chart"><canvas width="132" height="30" data-cid="${recId(r)}"></canvas></td></tr>`;
    });
    el.scoresList.innerHTML = h + `</tbody></table>`;
    el.scoresList.querySelectorAll("canvas[data-cid]").forEach((cv) => { // the run's simplified generational trajectory
      const rec = arr.find((r) => String(recId(r)) === cv.getAttribute("data-cid"));
      if (rec) renderEcoChart(cv.getContext("2d"), cv.width, cv.height, rec.hist || []);
    });
    el.scoresList.querySelectorAll("th.sortable").forEach((th) => th.addEventListener("click", () => {
      const kk = th.getAttribute("data-k");
      if (scoreSort.key === kk) scoreSort.dir = -scoreSort.dir; else scoreSort = { key: kk, dir: kk === "name" ? 1 : -1 };
      renderScoreList();
    }));
    el.scoresList.querySelectorAll("tr.srow").forEach((tr) => {
      const rec = arr.find((r) => String(recId(r)) === tr.getAttribute("data-id"));
      if (!rec) return;
      tr.addEventListener("click", () => openScoreDetail("#" + (arr.indexOf(rec) + 1), rec));
      // Hover → that run's genome, drawn as a circos ring. Touch has no hover, so a phone gets the
      // same plot by tapping the row (it's in the detail view too) — nothing is desktop-only.
      if (isTouch) return;
      tr.addEventListener("mouseenter", (e) => { showCircos(rec); positionCircos(e); });
      tr.addEventListener("mousemove", positionCircos);
      tr.addEventListener("mouseleave", hideCircos);
    });
  }
  // ------------------------------------------------------------------ circos
  // A run's genome as a ring: one sector per adaptation, clockwise from 12 o'clock IN THE ORDER IT
  // ARRIVED — state.upgrades is already an acquisition-ordered log, so it needs no extra bookkeeping.
  // A solid sector is a brand-new gene (`acquired`); a shorter, dimmer one is an expression bump of a
  // gene already held. Chords tie the sectors of one locus together, so Lipase 1 → 2 → 3 reads as a
  // single gene amplifying rather than three unrelated events — which is the whole point of drawing
  // it round rather than as another timeline.
  const locusOf = (u) => (String(u.abbr || "").match(/^[A-Za-z]+/) || [""])[0];  // "L2"→"L", "Ab1"→"Ab"
  // `mid` is what goes in the hole: {top, bot}. A whole run says "gen 7 / 14,820 cal"; a single
  // lineage says how many cells it had and how adapted it was.
  // Every cell starts with one carbohydrase — that IS its genome, not an absence of one. A lineage
  // that never adapted should show that single founding gene, not an empty ring reading "nothing".
  const FOUNDER_GENE = () => ({ t: 0, label: "Carbohydrase 1", abbr: "C1", color: RESOURCES[2].color, acquired: true, founder: true });
  function renderCircos(g, W, H, upgrades, mid) {
    g.clearRect(0, 0, W, H);
    // The founding carbohydrase leads EVERY ring: the circos is the lineage's whole genome, and that
    // gene is part of it — it just wasn't acquired, it was inherited from the first cell in the sea.
    const ups = [FOUNDER_GENE()].concat((upgrades || []).filter((u) => u && u.abbr));
    const cx = W/2, cy = H/2, R = Math.min(W, H)/2 - 22, rIn = R*0.72;
    g.strokeStyle = "rgba(255,255,255,.10)"; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
    g.beginPath(); g.arc(cx, cy, rIn, 0, TAU); g.stroke();
    g.textAlign = "center"; g.textBaseline = "middle";
    const n = ups.length, step = TAU/n, gap = Math.min(step*0.18, 0.06);
    const ang = (i) => -Math.PI/2 + i*step + step/2;              // a sector's midpoint
    // chords first, so the sectors overlap them rather than the other way round
    const byLocus = {};
    ups.forEach((u, i) => { const k = locusOf(u); (byLocus[k] = byLocus[k] || []).push(i); });
    for (const k in byLocus) {
      const idx = byLocus[k];
      if (idx.length < 2) continue;                                // a lone gene has nothing to link to
      g.strokeStyle = ups[idx[0]].color; g.globalAlpha = 0.3; g.lineWidth = 1.6;
      for (let j = 0; j < idx.length - 1; j++) {
        const a = ang(idx[j]), b = ang(idx[j+1]);
        g.beginPath();
        g.moveTo(cx + Math.cos(a)*rIn, cy + Math.sin(a)*rIn);
        g.quadraticCurveTo(cx, cy, cx + Math.cos(b)*rIn, cy + Math.sin(b)*rIn);  // bow through the middle
        g.stroke();
      }
      g.globalAlpha = 1;
    }
    ups.forEach((u, i) => {
      const a0 = -Math.PI/2 + i*step + gap/2, a1 = a0 + step - gap;
      const isNew = !!u.acquired;
      const r0 = isNew ? rIn : R*0.85;                             // a bump is a stub; a new gene spans the ring
      g.beginPath(); g.arc(cx, cy, R, a0, a1); g.arc(cx, cy, r0, a1, a0, true); g.closePath();
      g.fillStyle = u.color; g.globalAlpha = isNew ? 0.95 : 0.5; g.fill(); g.globalAlpha = 1;
      if (u.founder) {                                  // inherited, not acquired — mark it apart
        g.strokeStyle = "rgba(255,255,255,.85)"; g.lineWidth = 1.2; g.setLineDash([3, 2]); g.stroke(); g.setLineDash([]);
      } else if (isNew) { g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 1; g.stroke(); }
      const a = ang(i);
      g.fillStyle = u.color; g.globalAlpha = isNew ? 1 : 0.75;
      g.font = (isNew ? "bold " : "") + "9.5px 'Trebuchet MS', sans-serif";
      g.fillText(u.abbr, cx + Math.cos(a)*(R + 11), cy + Math.sin(a)*(R + 11));
      g.globalAlpha = 1;
    });
    g.fillStyle = "#eafff8"; g.font = "bold 15px 'Trebuchet MS', sans-serif";
    g.fillText((mid && mid.top) || "", cx, cy - 8);
    g.fillStyle = "rgba(215,245,238,.6)"; g.font = "10.5px 'Trebuchet MS', sans-serif";
    g.fillText((mid && mid.bot) || "", cx, cy + 9);
  }
  const runMid = (rec) => ({ top: "gen " + (rec && rec.gen != null ? rec.gen : "—"),
                             bot: Math.round((rec && rec.score) || 0).toLocaleString() + " cal" });
  // ---------------------------------------------------------------- cladogram
  // A run's phylogeny. Every lineage carries its adaptations in the order it got them, so two
  // lineages that share a prefix share an ancestor — the set of paths IS a tree, and building it is
  // just a trie over those logs. No extra bookkeeping, no guessing: the branch points are the moments
  // a lineage adapted away from its parent.
  // Caveat worth knowing: immigrant lineages drift in with a ready-made genome and no true history
  // (genomeUps synthesises a canonical order), so they hang off the root by what they CARRY rather
  // than by descent. In a game where genes also move sideways, that is arguably the honest picture.
  function buildClado(rec) {
    const lin = rec.lineages || {};
    const keys = Object.keys(lin);
    if (!keys.length) return null;
    const root = { abbr: null, color: null, depth: 0, children: [], leaves: [] };
    for (const k of keys) {
      let node = root;
      for (const u of (lin[k].ups || [])) {
        let ch = node.children.find((c) => c.abbr === u.abbr);
        if (!ch) { ch = { abbr: u.abbr, color: u.color, depth: node.depth + 1, children: [], leaves: [] }; node.children.push(ch); }
        node = ch;
      }
      node.leaves.push(+k);                       // this lineage ends here
    }
    return root;
  }
  // Size the canvas to the tree before drawing it: a run with 16 lineages needs 16 legible rows, and
  // a fixed height either squashes them into each other or wastes half the panel on a two-branch run.
  function drawClado(canvas, rec) {
    if (!canvas || !rec) return;
    const root = buildClado(rec);
    let leaves = 0;
    if (root) (function count(n) { leaves += n.leaves.length; n.children.forEach(count); })(root);
    canvas.height = clamp(leaves*22 + 34, 110, 520);
    renderClado(canvas.getContext("2d"), canvas.width, canvas.height, rec);
  }
  function renderClado(g, W, H, rec) {
    g.clearRect(0, 0, W, H);
    g.fillStyle = CHART.surface; g.fillRect(0, 0, W, H);
    const root = buildClado(rec);
    g.textBaseline = "middle";
    if (!root) {
      g.fillStyle = "rgba(215,245,238,.45)"; g.font = "italic 12px 'Trebuchet MS', sans-serif";
      g.textAlign = "center"; g.fillText("no lineages recorded for this run", W/2, H/2);
      return;
    }
    // peak population of each lineage, so a band that briefly existed doesn't look like a dynasty
    const peak = {};
    for (const s of (rec.hist || [])) { const b = sampleBuckets(s); for (const k in b) peak[k] = Math.max(peak[k] || 0, b[k]); }
    // rows: one per terminal lineage, in depth-first order so the tree doesn't cross itself
    const rows = [];
    let maxDepth = 0;
    (function walk(n) {
      maxDepth = Math.max(maxDepth, n.depth);
      for (const k of n.leaves) rows.push({ node: n, key: k });
      for (const c of n.children) walk(c);
    })(root);
    if (!rows.length) return;
    const padL = 16, padR = 128, padT = 14, padB = 12;
    const xAt = (d) => padL + (maxDepth ? d/maxDepth : 0)*(W - padL - padR);
    const rowH = Math.min(26, (H - padT - padB)/Math.max(1, rows.length));
    rows.forEach((r, i) => { r.y = padT + rowH*(i + 0.5); });   // every terminal lineage gets its own row
    const yOf = new Map();                                       // a node sits at the middle of its subtree
    (function place(n) {
      for (const c of n.children) place(c);
      const ys = rows.filter((r) => r.node === n).map((r) => r.y);
      for (const c of n.children) ys.push(yOf.get(c));
      yOf.set(n, ys.length ? (Math.min(...ys) + Math.max(...ys))/2 : padT);
    })(root);
    // COLOUR HAS TO TRACK THE CHART. The leaves already carry their lineage's colour (the same
    // levelColor the stacked bands use), but the BRANCHES were drawn in the colour of the GENE that
    // split them — a second, unrelated colour system — so nothing traced from a band on the chart
    // down into the tree. Now each branch is drawn in the colour of the lineage it leads to: pick a
    // subtree's representative as its biggest leaf, so a band's colour runs unbroken from the root
    // out to it. The gene keeps the LABEL (in the gene's own colour), which is what it's for.
    const repOf = new Map();
    (function rep(n) {
      let bestKey = null, bestPeak = -1;
      for (const k of n.leaves) if ((peak[k] || 0) > bestPeak) { bestPeak = peak[k] || 0; bestKey = k; }
      for (const c of n.children) {
        rep(c);
        const ck = repOf.get(c);
        if (ck != null && (peak[ck] || 0) > bestPeak) { bestPeak = peak[ck] || 0; bestKey = ck; }
      }
      repOf.set(n, bestKey);
    })(root);
    const lineColor = (n) => {
      const k = repOf.get(n);
      return k == null ? "rgba(255,255,255,.3)" : levelColor(k >> 6, k & 63);
    };
    // DIAGONAL branches: a straight line from parent to child, so the tree reads as descent with
    // divergence rather than as a plumbing diagram.
    g.lineWidth = 2; g.font = "9.5px 'Trebuchet MS', sans-serif"; g.textAlign = "center";
    (function draw(n) {
      const x0 = xAt(n.depth), y0 = yOf.get(n);
      for (const c of n.children) {
        const x1 = xAt(c.depth), y1 = yOf.get(c);
        g.strokeStyle = lineColor(c);                   // the LINEAGE's colour — same as its band
        g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.fillStyle = c.color || "#9fc3ba";             // the GENE's colour, for the label only
        g.save();                                       // label rides ON the branch, along its slope
        g.translate((x0 + x1)/2, (y0 + y1)/2);
        g.rotate(Math.atan2(y1 - y0, x1 - x0));
        g.fillText(c.abbr, 0, -5);                      // the adaptation that split this branch off
        g.restore();
        draw(c);
      }
    })(root);
    // the founder: the genome everything here descends from — one carbohydrase
    const ry = yOf.get(root);
    g.fillStyle = RESOURCES[2].color;
    g.beginPath(); g.arc(xAt(0), ry, 4, 0, TAU); g.fill();
    g.font = "bold 9.5px 'Trebuchet MS', sans-serif"; g.textAlign = "left"; g.fillText("C1", xAt(0) - 4, ry - 11);
    // leaves: the colored band from the chart above, so the two plots read as one thing
    g.textAlign = "left"; g.font = "10.5px 'Trebuchet MS', sans-serif";
    for (const r of rows) {
      const xn = xAt(r.node.depth), y = r.y;
      const mask = r.key >> 6, tier = r.key & 63, col = levelColor(mask, tier);
      if (Math.abs(y - yOf.get(r.node)) > 0.5) {          // stub across to its own row — in ITS colour
        g.strokeStyle = col; g.lineWidth = 1.5;
        g.beginPath(); g.moveTo(xn, yOf.get(r.node)); g.lineTo(xn, y); g.stroke();
      }
      g.fillStyle = col; g.fillRect(xn + 6, y - 5, 10, 10);   // the same color as its band on the chart above
      g.fillStyle = "rgba(215,245,238,.85)";
      // "peak 12" was ambiguous — peak WHAT? It's the most cells this lineage ever had at one moment.
      const n = peak[r.key] || 0;
      g.fillText(`${n} cell${n === 1 ? "" : "s"} at peak` + (r.node.depth ? "" : " · founder, never adapted"), xn + 21, y);
    }
  }
  function showCircos(rec) {
    if (!el.circosPop || !el.circosCanvas) return;
    renderCircos(el.circosCanvas.getContext("2d"), el.circosCanvas.width, el.circosCanvas.height, rec.upgrades, runMid(rec));
    const n = rec.upgrades ? rec.upgrades.length : 0;
    el.circosPop.style.borderColor = "";
    if (el.circosCap) el.circosCap.innerHTML = n
      ? `<em>C1</em> founding gene + ${n} adaptation${n === 1 ? "" : "s"}, clockwise as they arrived`
      : `<em>C1</em> founding gene only — this run never adapted`;
    el.circosPop.classList.remove("hidden");
  }
  // Hovering a COLORED BAND on a run chart: that band is one lineage (an ecotype at an adaptation
  // level), so show that lineage's own genome — which is the whole point of the colors.
  function showLineageCircos(rec, band) {
    if (!el.circosPop || !el.circosCanvas) return;
    const lin = (rec.lineages || {})[band.key] || (rec.lineages || {})[String(band.key)];
    const color = levelColor(band.mask, band.tier);
    // A run saved before per-lineage genomes existed has no `lineages` map. Falling back to the
    // run-level log drew the SAME ring for every band, which looked exactly like a broken plot —
    // so say plainly that this run predates the data instead of quietly drawing a lie.
    if (!lin) {
      renderCircos(el.circosCanvas.getContext("2d"), el.circosCanvas.width, el.circosCanvas.height, [],
                   { top: band.count + (band.count === 1 ? " cell" : " cells"), bot: "tier " + band.tier });
      el.circosPop.style.borderColor = color;
      if (el.circosCap) el.circosCap.innerHTML =
        `<b style="color:${color}">■</b> <em>this run predates per-lineage genomes — no genome recorded for this band</em>`;
      el.circosPop.classList.remove("hidden");
      return;
    }
    const ups = lin.ups || [];
    renderCircos(el.circosCanvas.getContext("2d"), el.circosCanvas.width, el.circosCanvas.height, ups,
                 { top: band.count + (band.count === 1 ? " cell" : " cells"), bot: "tier " + band.tier });
    el.circosPop.style.borderColor = color;
    if (el.circosCap) el.circosCap.innerHTML =
      `<b style="color:${color}">■</b> this lineage · <em>C1</em> founding gene` +
      (ups.length ? ` + ${ups.length} adaptation${ups.length === 1 ? "" : "s"}, as they arrived` : ` only — never adapted`);
    el.circosPop.classList.remove("hidden");
  }
  // Which stacked band is under the cursor? Re-derives exactly what renderEcoChart drew, so the
  // hit-test can't drift away from the picture.
  function ecoBandAt(hist, W, H, mx, my) {
    if (!hist || hist.length < 2) return null;
    const S = ecoScale(hist, H);                       // the SAME scale the renderer used
    const n = Math.max(hist.length, 2);
    const i = clamp(Math.round(mx/W*(n-1)), 0, hist.length - 1);
    let cum = 0;
    for (const key of S.keys) {
      const cnt = S.bks[i][key] || 0;
      const h = bandVal(cnt);
      if (cnt > 0 && my <= S.yAt(cum) && my >= S.yAt(cum + h))
        return { key, count: cnt, mask: key >> 6, tier: key & 63 };
      cum += h;
    }
    return null;
  }
  function bindLineageHover(canvas, getRec) {
    if (!canvas || isTouch) return;   // no hover on a phone; the cladogram below the chart covers it
    canvas.addEventListener("mousemove", (e) => {
      const rec = getRec();
      if (!rec) { hideCircos(); return; }
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const band = ecoBandAt(rec.hist || [], canvas.width, canvas.height,
                             (e.clientX - r.left)*(canvas.width/r.width),
                             (e.clientY - r.top)*(canvas.height/r.height));
      if (!band) { hideCircos(); return; }
      showLineageCircos(rec, band);
      positionCircos(e);
    });
    canvas.addEventListener("mouseleave", hideCircos);
  }
  function hideCircos() { if (el.circosPop) el.circosPop.classList.add("hidden"); }
  // Sit to the LEFT of the pointer: on the right it covered the very chart you were reading, so you
  // couldn't see the band you were pointing at. Falls back to the right only if there's no room left.
  function positionCircos(e) {
    if (!el.circosPop) return;
    const p = el.circosPop, w = p.offsetWidth || 246, h = p.offsetHeight || 268;
    const vw = window.innerWidth || 900, vh = window.innerHeight || 700;
    let x = e.clientX - w - 18;
    if (x < 6) x = Math.min(e.clientX + 18, vw - w - 6);   // no room on the left — go right instead
    p.style.left = clamp(x, 6, vw - w - 6) + "px";
    p.style.top  = clamp(e.clientY - h/2, 6, vh - h - 6) + "px";
  }
  function fmtDur(s) { const m = Math.floor(s/60); return m + ":" + String(s % 60).padStart(2, "0"); }
  function clockStr() { // in-game 24h clock — one full turn every day.lengthSec
    const h = dayHour(state.tod || 0), hh = Math.floor(h), mm = Math.floor((h - hh)*60);
    const day = (state.day || 1) > 1 ? `d${state.day} ` : "";   // only once a run has outlived its first day
    return day + ((state.light || 0) > 0.05 ? "☀ " : "☾ ") + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }
  // the sea's clock at an arbitrary elapsed time — "your kind went extinct at 09:40" reads far better
  // than "at 154 seconds", and the whole game is told on the day's clock anyway
  function clockAt(sec) {
    const h = dayHour(((sec || 0)/CFG.day.lengthSec) % 1), hh = Math.floor(h), mm = Math.floor((h - hh)*60);
    const dayN = Math.floor((sec || 0)/CFG.day.lengthSec) + 1;
    return (dayN > 1 ? `day ${dayN}, ` : "") + String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }
  function fmtDate(ms) { const d = new Date(ms);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }); }
  let scoreSort = { key: "score", dir: -1 }; // leaderboard sort — default calories, descending
  // Runs recorded before the split carry no device at all. They were desktop — the phone build was
  // barely playable — so that's how they're read, rather than being dropped or shown on both boards.
  const deviceOf = (r) => (r.device === "touch" ? "touch" : "desktop");
  let scoreDevice = "desktop";                     // set to the device you're actually on, at boot
  function renderDeviceTabs(counts) {
    if (!el.scoreTabs) return;
    const tab = (k, label) =>
      `<button class="devtab${scoreDevice === k ? " on" : ""}" data-dev="${k}">${label}` +
      `<em>${counts[k] || 0}</em></button>`;
    el.scoreTabs.innerHTML = tab("desktop", "🖥 Desktop") + tab("touch", "📱 Mobile");
    el.scoreTabs.querySelectorAll(".devtab").forEach((b) => b.addEventListener("click", () => {
      scoreDevice = b.getAttribute("data-dev");
      if (el.scoreDetail) el.scoreDetail.classList.add("hidden");   // the open run belongs to the other board
      renderScoreList();
    }));
  }
  const recId = (r) => (r.id != null ? r.id : r.date);
  const SCORE_VAL = { // per-column value accessors (also the sortable/badge categories)
    name:  (r) => (r.name || "").toLowerCase(),
    score: (r) => Math.round(r.score || 0),
    gen:   (r) => r.gen || 0,
    dur:   (r) => r.dur || 0,
    ad:    (r) => (r.upgrades ? r.upgrades.length : 0),
    date:  (r) => r.date || 0,
  };
  function currentRunLine() {
    return { id: -1, date: -1, name: playerName, score: Math.round(state.score), gen: state.gen, dur: Math.round(state.elapsed), hist: state.fullHist, upgrades: state.upgrades,
             device: state.device || "desktop", lineages: state.lineages, roleSwaps: state.roleSwaps };
  }
  let _detailRec = null, _detailRank = "";
  function openScoreDetail(rankHtml, rec) {
    if (!el.scoreDetail || !el.detailChart) return;
    hideCircos();                             // the hover popup would otherwise hang over the detail view
    _detailRec = rec; _detailRank = rankHtml; // remembered so the log/linear toggle can redraw it
    if (el.detailCircos) renderCircos(el.detailCircos.getContext("2d"), el.detailCircos.width, el.detailCircos.height, rec.upgrades, runMid(rec));
    annotateRun(el.detailChart.getContext("2d"), el.detailChart.width, el.detailChart.height, rec.hist || [], rec.upgrades, rec.dur, rec.roleSwaps);
    if (el.detailSubChart) annotateSub(el.detailSubChart.getContext("2d"), el.detailSubChart.width, el.detailSubChart.height, rec.hist || [], rec.upgrades, rec.dur, rec.roleSwaps);
    if (el.detailSubLabel) el.detailSubLabel.textContent = subLabelText();
    if (el.detailClado) drawClado(el.detailClado, rec);
    if (el.detailStats) el.detailStats.innerHTML = runStatsHtml(rec.hist || [], rec.upgrades);
    if (el.detailTitle) el.detailTitle.innerHTML =
      `${rankHtml}${rec.name ? " · " + escapeHtml(rec.name) : ""} · <b>${rec.score}</b> · generation ${rec.gen} · survived ${fmtDur(rec.dur)}`;
    [el.scoresList, el.scoresKey, el.currentRun].forEach((e) => e && e.classList.add("hidden"));
    // On the pause screen this button is the way INTO the leaderboard, not back out of it.
    if (el.detailBack) el.detailBack.textContent = (rec.id === -1) ? "High scores →" : "← Back to list";
    el.scoreDetail.classList.remove("hidden");
  }
  function closeScoreDetail() {
    if (el.scoreDetail) el.scoreDetail.classList.add("hidden");
    showScores(); // rebuilds & re-shows the list (and the current-run row if paused mid-game)
  }
  // `liveDetail` = the PAUSE screen. Pausing to be shown a table of other people's scores is the
  // wrong answer to "how am I doing?" — what you want mid-run is your OWN run: the ecotype chart,
  // the food/mortality panel, the phylogeny, the genome. That's the same page the leaderboard opens
  // for a saved run, so pause just opens it on the live one. "← Back to list" from there still takes
  // you to the board, so nothing is lost.
  function showScores(opts) {
    const active = !!(state && state.running && !state.demo); // paused mid-game — the attract loop isn't a game to end
    const live = !!(opts && opts.liveDetail) && active;
    if (el.scoresTitle) el.scoresTitle.textContent = paused ? "Paused" : "High Scores";
    if (el.scoresBack) el.scoresBack.textContent = paused ? "Resume" : "Back";
    if (el.endGameBtn) el.endGameBtn.classList.toggle("hidden", !active);
    if (el.currentRun) el.currentRun.classList.add("hidden"); // the live run now appears inline in the ranked list
    if (el.scoresKey) { // colors now encode GENERATION (ecotype + upgrade tier), so no fixed per-ecotype swatch
      el.scoresKey.innerHTML =
        `<span><i class="gen-swatch"></i>bacteria</span>` +
        `<span><i class="eco-line" style="border-color:${PROTIST_COLOR}"></i>protists</span>` +
        `<span><i class="eco-line" style="border-color:${VIRUS_COLOR}"></i>viruses</span>`;
    }
    if (live) {
      openScoreDetail(`<span class="livedot"></span>this run`, currentRunLine());
    } else {
      if (el.scoreDetail) el.scoreDetail.classList.add("hidden"); // open on the list, not a stale detail
      [el.scoresList, el.scoresKey].forEach((e) => e && e.classList.remove("hidden"));
      renderScoreList();     // draw from cache/local immediately…
    }
    fetchScores();           // …then refresh from the shared leaderboard when it responds
    el.scores.classList.remove("hidden");
  }
  function hideScores() { hideCircos(); el.scores.classList.add("hidden"); if (el.scoreDetail) el.scoreDetail.classList.add("hidden"); }
  // BETA FEEDBACK. It posts to our own feedback.php (one JSON entry per report) rather than handing
  // the tester off to GitHub — not everyone has an account, and "go make one to tell me the protists
  // are too fast" is how you get no feedback at all. It ships the boring half of a bug report with
  // it (build, device, what the run was doing), which is the half nobody can reconstruct afterwards.
  const FEEDBACK_URL = "feedback.php";
  function feedbackContext() {
    const L = [];
    L.push(`build: ${BUILD}`);
    L.push(`device: ${isTouch ? "touch" : "desktop"} · ${window.innerWidth}×${window.innerHeight}`);
    L.push(`browser: ${navigator.userAgent}`);
    if (state) {
      L.push(`run: ${state.role} · day ${state.day || 1} · ${clockStr()} · gen ${state.gen} · ` +
             `${Math.round(state.score)} cal · ${cells.length} bacteria · ${predators.length} protists`);
      L.push(`adaptations: ${(state.upgrades || []).map((u) => u.abbr).join(" ") || "none"}`);
      if (cfgTuned()) L.push(`NOTE: tuning panel was used — this run is not comparable to a default one`);
    }
    return L.join("\n");
  }
  function showFeedback() {
    if (!el.feedback) return;
    if (el.fbStatus) { el.fbStatus.textContent = ""; el.fbStatus.className = ""; }
    if (el.fbSend) el.fbSend.disabled = false;
    if (el.fbName && playerName) el.fbName.value = playerName;
    if (el.fbCtx) el.fbCtx.textContent = feedbackContext();   // show them exactly what gets sent
    el.feedback.classList.remove("hidden");
    if (el.fbText) el.fbText.focus();
  }
  function hideFeedback() { if (el.feedback) el.feedback.classList.add("hidden"); }
  function sendFeedback() {
    if (!el.fbText) return;
    const text = (el.fbText.value || "").trim();
    if (!text) { if (el.fbStatus) { el.fbStatus.textContent = "Say something first."; el.fbStatus.className = "warn"; } return; }
    const payload = { text, name: (el.fbName && el.fbName.value || "").slice(0, 40), context: feedbackContext() };
    if (el.fbSend) el.fbSend.disabled = true;
    if (el.fbStatus) { el.fbStatus.textContent = "Sending…"; el.fbStatus.className = ""; }
    fetch(FEEDBACK_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then(() => {
        if (el.fbStatus) { el.fbStatus.textContent = "Sent — thank you. 🦠"; el.fbStatus.className = "ok"; }
        if (el.fbText) el.fbText.value = "";
        setTimeout(hideFeedback, 1100);
      })
      .catch(() => {
        // Don't swallow it: tell them it failed and leave their words in the box so nothing is lost.
        if (el.fbSend) el.fbSend.disabled = false;
        if (el.fbStatus) { el.fbStatus.textContent = "Couldn't reach the server — your text is still here, try again in a moment."; el.fbStatus.className = "warn"; }
      });
  }
  let helpOpen = false, sciOpen = false;
  // The day's real-time length is a tunable knob, so the help screen must not hardcode it — it used
  // to promise "one hour per real minute", which stopped being true the moment day.lengthSec moved.
  function dayLenStr() {
    const s = Math.round(CFG.day.lengthSec);
    if (s < 90) return `${s} seconds`;
    const m = s/60;
    return `${Number.isInteger(m) ? m : m.toFixed(1)} minutes`;
  }
  function showHelp() {
    if (!el.help) return;
    if (el.dayLen) el.dayLen.textContent = dayLenStr();
    el.help.classList.remove("hidden"); helpOpen = true;
  }
  function hideHelp() { if (el.help) { el.help.classList.add("hidden"); helpOpen = false; } }
  function showScience() { if (el.science) { el.science.classList.remove("hidden"); sciOpen = true; if (el.sciBody) el.sciBody.scrollTop = 0; } }
  function hideScience() { if (el.science) { el.science.classList.add("hidden"); sciOpen = false; } }
  function toggleHelp() { helpOpen ? hideHelp() : showHelp(); }
  function pauseGame() { if (!state || !state.running || paused) return; paused = true; releaseStick(); showScores({ liveDetail: true }); }
  function resumeGame() { paused = false; hideScores(); }
  function endGame() { if (!state || !state.running || state.demo) return; paused = false; hideScores(); gameOver(); } // the demo has no score to end
  let _toastTimer = null;
  function positionToast() { // anchor the announcement just above the controlled cell (was fixed at the top, over the HUD)
    const pc = controlledCell(); if (!pc || !el.toast) return;
    const sc = el.game && el.game.clientWidth ? el.game.clientWidth / VIEW_W : 1; // canvas is CSS-scaled on small screens
    el.toast.style.left = Math.round(sx(pc.x) * sc) + "px";
    el.toast.style.top = Math.round(Math.max(6, sy(pc.y) * sc - 52)) + "px";
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
  // Paint one rolodex button: the face is what's loaded, prev/next peek out behind it so you
  // can see what a swipe would bring up. Nulls hide the neighbors (nothing else to cycle to).
  function paintRolo(btn, face, prev, next) {
    if (!btn) return;
    const f = btn.querySelector(".rface"), p = btn.querySelector(".rprev"),
          n = btn.querySelector(".rnext");
    if (f) { f.style.background = face; f.style.boxShadow = `0 2px 12px rgba(0,0,0,.5), 0 0 16px -4px ${face}`; }
    if (p) { p.style.background = prev || "transparent"; p.style.visibility = prev ? "visible" : "hidden"; }
    if (n) { n.style.background = next || "transparent"; n.style.visibility = next ? "visible" : "hidden"; }
  }
  // What you currently ARE, drawn in dark ink on the lineage button's face: a flagellated rod, or a
  // blobby grazer once a role-swap has flipped you. Only redrawn when the role changes — the face
  // color underneath carries the lineage, so the ink never has to change.
  function drawRoleSprite(cv, role) {
    if (!cv || cv.dataset.role === role) return;
    cv.dataset.role = role;
    const g = cv.getContext("2d"), w = cv.width, hgt = cv.height;
    g.clearRect(0, 0, w, hgt);
    g.save(); g.translate(w/2, hgt/2);
    g.fillStyle = "#06232a"; g.strokeStyle = "#06232a"; g.lineJoin = "round";
    if (role === "protist") {
      g.beginPath();                                  // an amoeboid blob, lobed like the real thing
      for (let i = 0; i <= 28; i++) {
        const a = i/28*TAU, r = w*0.38*(1 + 0.13*Math.sin(a*3 + 0.6));
        g[i ? "lineTo" : "moveTo"](Math.cos(a)*r, Math.sin(a)*r);
      }
      g.closePath(); g.fill();
      g.globalAlpha = 0.30; g.fillStyle = "#ffffff";  // food vacuole
      g.beginPath(); g.arc(w*0.09, -hgt*0.06, w*0.13, 0, TAU); g.fill();
    } else {
      g.lineWidth = Math.max(1.5, w*0.055);           // flagellum
      g.beginPath();
      for (let i = 0; i <= 14; i++) {
        const t = i/14, x = -w*0.22 - t*w*0.22, y = Math.sin(t*7)*w*0.06*t;
        g[i ? "lineTo" : "moveTo"](x, y);
      }
      g.stroke();
      const hl = w*0.24, r = w*0.145;                 // the rod
      g.beginPath();
      g.moveTo(-hl, -r); g.lineTo(hl, -r);
      g.arc(hl, 0, r, -Math.PI/2, Math.PI/2);
      g.lineTo(-hl, r);
      g.arc(-hl, 0, r, Math.PI/2, -Math.PI/2);
      g.closePath(); g.fill();
    }
    g.restore();
  }
  function syncRolodex(c) {
    if (!isTouch || !el.tEnz) return;        // the deck only exists on a phone
    const sprite = el.tLin && el.tLin.querySelector(".rsprite");
    if (state && state.role === "protist") { // a grazer has no enzymes — the button is a sprint
      paintRolo(el.tEnz, "#ffd24a", null, null);
      const pr = controlledProtist();
      if (el.tLin && pr) {
        paintRolo(el.tLin, "#ff9ec0", null, null);
        drawRoleSprite(sprite, "protist");
      }
      return;
    }
    const owned = c ? ownedDeployables(c) : [2];
    let i = owned.indexOf(state.activeEnzyme); if (i < 0) i = 0;
    const many = owned.length > 1;
    paintRolo(el.tEnz, deployColor(owned[i]),
      many ? deployColor(owned[(i - 1 + owned.length) % owned.length]) : null,
      many ? deployColor(owned[(i + 1) % owned.length]) : null);

    if (el.tLin && c) {
      const { ks } = lineageReps();
      let j = ks.indexOf(ecoMask(c)*64 + upgradeTier(c)); if (j < 0) j = 0;
      const multi = ks.length > 1;
      paintRolo(el.tLin, levelColor(ecoMask(c), upgradeTier(c)),
        multi ? lineageKeyColor(ks[(j - 1 + ks.length) % ks.length]) : null,
        multi ? lineageKeyColor(ks[(j + 1) % ks.length]) : null);
      drawRoleSprite(sprite, "bacterium");
    }
  }
  function syncHud() {
    if (!state) return;
    const protist = state.role === "protist";
    if (el.toast && el.toast.classList.contains("show")) positionToast(); // keep the announcement pinned above the cell
    const ent = controlledEntity(), e = ent ? ent.energy : 0;
    const full = protist ? CFG.predator.reproEnergy : CFG.cell.divideThreshold; // "full" = ready to divide
    el.energyFill.style.width = Math.min(100, e/full*100) + "%";
    el.energyTxt.textContent = Math.round(e);
    el.colony.textContent = cells.length; el.gen.textContent = state.gen; el.score.textContent = Math.round(state.score);
    if (el.time) el.time.textContent = clockStr(); // shows the in-game time of day, not raw elapsed
    if (el.colonyWord) el.colonyWord.textContent = cells.length === 1 ? "bacterium" : "bacteria";
    // as a protist there's no genome to show — hide the strand and flag the role instead
    if (el.genome) el.genome.style.display = protist ? "none" : "";
    if (el.roleTag) el.roleTag.classList.toggle("hidden", !protist);
    if (protist) return;
    const c = controlledCell();
    drawHelix(c); // DNA double-helix backbone under the genome, drawn in the current lineage's color
    syncRolodex(c);
    const pc = controlledCell();
    const amp = (n) => n >= 1 ? ` <span class="amp">×${n}</span>` : ""; // expression as gene amplification (×N); shown from ×1 so the chip width doesn't jump
    for (let i = 0; i < 3; i++) if (el.enz[i]) {
      const lvl = pc ? pc.enzLvl[i] : (i === 2 ? 1 : 0), owned = lvl > 0;
      el.enz[i].classList.toggle("owned", owned);
      el.enz[i].classList.toggle("active", owned && i === state.activeEnzyme);
      el.enz[i].innerHTML = RESOURCES[i].enzyme + (owned ? amp(lvl) : "");
    }
    if (el.enzTox) { const lvl = pc ? pc.antibiotic : 0, owned = lvl > 0;
      el.enzTox.classList.toggle("owned", owned);
      el.enzTox.classList.toggle("active", owned && state.activeEnzyme === 3);
      el.enzTox.innerHTML = "antibiotic" + (owned ? amp(lvl) : ""); }
    if (el.abilChemo) { const on = !!(pc && pc.chemotaxis); el.abilChemo.classList.toggle("owned", on); el.abilChemo.innerHTML = "chemotaxis" + (on ? amp(pc.chemoLevel) : ""); }
    if (el.abilCrispr) el.abilCrispr.classList.toggle("owned", !!(pc && pc.crispr));
  }

  // -------------------------------------------------------------------- loop
  // Match the canvas backing store to the stage's on-screen size so the world fills
  // the available space (and grows when the charts are folded away). Desktop stays
  // 800×680; on a phone the stage flexes and the canvas follows.
  function resizeCanvas() {
    if (!canvas || !el.stage || !el.stage.getBoundingClientRect) return;
    const r = el.stage.getBoundingClientRect();
    if (!r.width || !r.height) return; // not laid out yet (or headless)
    const w = Math.round(r.width), h = Math.round(r.height);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w; canvas.height = h; VIEW_W = w; VIEW_H = h; // dots are normalized — no rebuild
      // Re-derive the zoom from the canvas we actually got. Without this the touch zoom (tuned
      // when the canvas was a fixed 800px being CSS-scaled down) composites with the responsive
      // canvas and the world is magnified twice over.
      if (isTouch) ZOOM = touchZoom() * viewScale();
    }
  }
  let last = 0;
  function frame(now) {
    resizeCanvas();
    const dt = last ? Math.min((now-last)/1000, 0.05) : 0; last = now;
    if (!paused) update(dt);
    draw(); syncHud(); drawChart(); syncPageBackdrop();
    { // hide the HUD + live charts behind any menu (title/over/scores/help), show only during active play
      const menu = [el.title, el.over, el.scores, el.help, el.science].some((s) => s && !s.classList.contains("hidden"));
      // The demo has no player, so the HUD would report a cell that doesn't exist (0 energy, no genome).
      // Hide it — the tutorial should read as a film of the sea, not a game with nobody driving.
      const interactive = !!(demo && demo.interactive);
      const hide = menu || !(state && state.running) || (!!(state && state.demo) && !interactive);
      // charts stay away in the tutorial: it's busy enough, and they're not what's being taught yet
      if (el.chartwrap) el.chartwrap.classList.toggle("hidden", hide || interactive);
      if (el.hud) el.hud.classList.toggle("hidden", hide);
      if (el.touch) el.touch.classList.toggle("hidden", hide); // on-screen controls live only during active play
    }
    requestAnimationFrame(frame);
  }

  function start() { stopDemo(); Audio.init(); Music.start(Audio.ctx()); applyAudioMode(); justFinishedTs = null; el.title.classList.add("hidden"); el.over.classList.add("hidden"); newGame(); }
  el.startBtn.addEventListener("click", start);
  // Carry the SAME run into the next day: nothing is reset — the colony, the score, the genome and
  // the clock all continue. Only the day counter moves, which pushes the next end-of-day boundary a
  // day further out. The run's leaderboard row is already keyed on runId, so it just gets updated.
  function continueDay() {
    if (!state || state.running) return;
    state.day = (state.day || 1) + 1;
    state.running = true;
    paused = false;
    el.over.classList.add("hidden");
    if (el.continueBtn) el.continueBtn.classList.add("hidden");
    justFinishedTs = null;
    Audio.play("spawn", 0.55);
  }
  if (el.continueBtn) el.continueBtn.addEventListener("click", continueDay);
  el.restartBtn.addEventListener("click", start);
  if (el.scoresBtn) el.scoresBtn.addEventListener("click", showScores);
  if (el.scoresBtn2) el.scoresBtn2.addEventListener("click", showScores);
  if (el.scoresBack) el.scoresBack.addEventListener("click", () => { if (paused) resumeGame(); else hideScores(); });
  if (el.helpBtn) el.helpBtn.addEventListener("click", showHelp);
  [el.sciBtn, el.sciBtn2, el.sciBtn3].forEach((b) => b && b.addEventListener("click", showScience));
  if (el.sciBack) el.sciBack.addEventListener("click", hideScience);
  if (el.sciBody) el.sciBody.querySelectorAll("a").forEach((a) => { a.target = "_blank"; a.rel = "noopener"; }); // Wikipedia opens in a new tab
  if (el.helpBtn2) el.helpBtn2.addEventListener("click", showHelp);
  if (el.helpBtn3) el.helpBtn3.addEventListener("click", showHelp);
  if (el.helpBack) el.helpBack.addEventListener("click", hideHelp);
  if (el.endGameBtn) el.endGameBtn.addEventListener("click", endGame);
  if (el.detailBack) el.detailBack.addEventListener("click", closeScoreDetail);
  if (el.nameInput) {
    el.nameInput.addEventListener("input", (e) => setPlayerName(e.target.value));
    el.nameInput.addEventListener("change", flushNameUpdate);
  }

  // --------------------------------------------------------- admin / tuning panel
  // ` opens a live-tuning panel: one slider per numeric leaf of CFG. Sliders are
  // LOG-scaled — each spans a decade either side of the shipped default — because
  // the constants range over five orders of magnitude (cystMetab 0.035 … maxCells
  // 1e5), and a linear slider would make every small one untunable. The sim is NOT
  // paused, so edits are visible immediately; values that are only read when
  // something spawns (particle counts, grid.cs, protist lifespan) therefore apply
  // to newly spawned entities rather than retroactively to those already alive.
  const TUNE_DECADES = 1;      // slider spans default/10 … default*10
  const TUNE_STEPS = 1000;     // slider resolution
  let adminOpen = false, adminBuilt = false;
  const adminRows = [];        // { leaf, set, row, hay } per generated row
  const adminGroups = [];      // { head, rows } so a group's heading hides when the filter empties it

  // Hover text for every knob. Keyed by dotted path; a range like phage.burst is
  // documented once and both ends (.0/.1) inherit it. Anything missing here still
  // gets a row — it just falls back to showing only its default.
  const TUNE_DOCS = {
    "cell.radius": "Cell body radius (px) — also its collision size.",
    "cell.baseHalf": "Half-length of a freshly divided cell (px).",
    "cell.maxHalf": "Half-length at full elongation, just before it splits (px).",
    "cell.lenBaseEnergy": "Energy above which a cell starts elongating.",
    "cell.elongK": "Extra half-length gained per unit of energy above lenBaseEnergy.",
    "cell.thrust": "Swim thrust. At low Reynolds number speed is thrust/dragRate, NOT an acceleration — the cell reaches this speed at once and loses it at once. Raise thrust alone and the cell swims faster; raise it with dragRate and the speed is unchanged, only the glide.",
    "cell.driftOnUpgrade": "1 = every time YOU take a gold phage, one other random cell also changes — it gains a random gene or loses one. This is what keeps a SPREAD of genomes in the sea instead of a population that just tracks your genome (and it gives kill-the-winner something to bite on). 0 = off.",
    "cell.driftGainChance": "When drift fires, the chance the other cell GAINS a gene rather than losing one. 0.5 = a coin flip. Push it up and the whole sea escalates with you; push it down and genomes streamline around you.",
    "cell.dragRate": "How fast velocity relaxes onto what the thrust sustains (1/s). High = the cell stops dead when you let go, which is what a real bacterium does (viscosity beats inertia at this size). Low = it coasts like a submarine, which is wrong but forgiving. Also sets free-swim speed via thrust/dragRate.",
    "cell.cystDragRate": "Same, for a dormant cyst. Kept low so a cyst keeps drifting with the water instead of freezing in place.",
    "cell.maxSpeed": "Hard cap on swim speed (px/s), applied after thrust/dragRate.",
    "cell.uptake": "Nutrient absorbed per second while touching free motes.",
    "cell.startEnergy": "Energy a new cell begins life with.",
    "cell.maxEnergy": "Energy ceiling — a cell can't store more than this.",
    "cell.divideThreshold": "Energy at which a cell divides in two.",
    "cell.swimCost": "Energy per second burned while swimming.",
    "cell.enzymeCost": "Energy spent per enzyme release.",
    "cell.antibioticCost": "Energy spent per antibiotic release.",
    "cell.invulnTime": "Seconds of immunity to grazing/infection right after dividing.",
    "cell.runMin": "Shortest run an autonomous cell takes before tumbling (s).",
    "cell.runMax": "Longest run an autonomous cell takes before tumbling (s).",
    "cell.tumbleDur": "Seconds a cell spends tumbling (reorienting).",
    "cell.tumbleTurn": "How sharply an autonomous cell turns while tumbling (rad/s).",
    "cell.playerTumbleTurn": "How fast YOUR cell drifts off-heading when you let go of the controls. COSMETIC ONLY: you stop dead when you release (low Reynolds number), so this changes nothing about where you go — it's a reminder of the run-and-tumble your autonomous cells are actually doing. Don't document it as a movement mechanic; it isn't one.",
    "cell.enzymeCooldown": "Seconds between an autonomous cell's enzyme releases (picked at random in this range).",
    "cell.cystBelow": "Energy below which an autonomous cell gives up and encysts (goes dormant).",
    "cell.cystWake": "Energy a cyst must accumulate before it revives.",
    "cell.cystMetab": "Energy per second burned while dormant — near zero, which is why cysts outlast famine.",
    "cell.cystReviveEnergy": "Energy handed to a cyst when you take control of it.",
    "cell.crisprEnergy": "Energy gained when a CRISPR cell destroys a virus it's immune to.",
    "cell.cystDiffuse": "How fast cysts drift passively with the water (brownian).",
    "cell.exprBoost": "Enzyme-radius gain per expression level (the stacking gold-phage upgrade).",
    "cell.chemoRange0": "Chemotaxis sensing range at the first level (px).",
    "cell.chemoRangePer": "Extra sensing range gained per further chemotaxis level.",
    "cell.chemoBias": "How much heading up-gradient stretches a run, per chemotaxis level — the bias in the biased random walk.",
    "cell.genomeUpkeep": "Extra respiration per adaptation tier — what a bigger genome costs to carry (the pressure to streamline).",
    "cell.fedLinger": "Seconds a cell stays in its 'well fed' state (shorter runs) after eating.",
    "cell.startUpgrades": "TESTING AID: how many random adaptations the starting cell already has, drawn from the same pool a gold phage gives. 0 = the normal game. Raise it to drop straight into the late game instead of grinding there.",
    "cell.maxCells": "Hard cap on living cells — a performance backstop, not an ecological limit.",
    "cell.touchLatchSecs": "Phone thumbstick: how long you must hold it at FULL deflection before the run locks in and keeps going after you lift your thumb. Lower = quicker to commit but easier to trigger by accident.",
    "cell.touchRunSecs": "How long a locked-in run lasts before it winds down on its own (the knob eases back to center as it runs out). Stops the stick getting stuck on. Touching it again pauses the countdown; re-latching refills it.",
    "cycle.turboSecs": "Base length of a protist's turbo burst (Space, or the release button on a phone).",
    "cycle.turboMult": "How much faster a protist swims during a turbo burst.",
    "cycle.turboCost": "Energy a protist spends per turbo burst. It has no other use for energy but staying alive, so this is the real price of a sprint.",
    "cycle.turboGoldBonus": "Seconds added to your turbo burst for each gold phage you catch AS A PROTIST — the grazer's version of an adaptation. Stacks for the rest of the run.",
    "cycle.turboMaxSecs": "Ceiling on the turbo burst, however many gold phages you collect.",
    "day.latitude": "Latitude of this run, degrees (+N / -S). With day.dayOfYear it gives the real sun: sunrise, sunset, how high it climbs. Past ~66.5 you get midnight sun or polar night depending on the season.",
    "day.dayOfYear": "Day of the year, 1-365. 172 = June solstice, 355 = December solstice, 80/266 = the equinoxes. Sets the sun's declination, so it decides the season.",
    "diel.twilight": "How far the sun sinks below the horizon before the light is fully gone. 0.21 is roughly nautical dusk (12 deg). Higher = longer, softer twilight.",
    "diel.lightGamma": "Shapes the daylight curve across the 24h. 1 = a plain sinusoid; higher deepens the night and sharpens midday. The light drives food supply, grazing pressure and the color of the water.",
    "diel.waterNight": "The sea's color at midnight (r, g, b). The water itself carries the time of day.",
    "diel.waterDay": "The sea's color at noon (r, g, b). Push it up to make midday brighter.",
    "diel.goldTint": "Strength of the warm glow while the sun is low (dawn/dusk).",
    "diel.q10": "Q10: metabolic rate multiplies by this for every +10 degC. 2 = the textbook value (rate doubles). 1 = temperature has no effect. Applies to bacteria AND protists.",
    "diel.q10RefC": "Reference temperature for Q10 — metabolism runs at its base rate here.",
    "respirationBase": "Baseline energy per second every cell burns just staying alive. The single biggest lever on how punishing the game is.",
    "touchSpeedScale": "TOUCH ONLY: how fast swimming things move — your cells AND the protists together, so predator/prey stays in proportion. The phone magnifies the world onto a small screen, which makes the same world-speed read as much faster. 1 = desktop speed. NOTE: energy costs are per SECOND, so slower swimming means a trip to food costs more energy.",
    "grid.cs": "Voxel size of destructible particles (px) — smaller = finer digging but more work per frame. Only affects NEWLY spawned particles.",
    "substrate.count": "How many food particles are kept drifting in the water. Applies as particles respawn.",
    "substrate.bloomEvery": "Seconds per particle as the food field tracks the diel target — lower = the bloom rises and recedes faster. The target itself is substrate.count scaled by the light (see diel.foodFloor).",
    "substrate.moteEnergy": "Energy in each nutrient mote freed by dissolving a voxel.",
    "substrate.sizeMin": "Smallest particle radius (px).",
    "substrate.sizeMax": "Largest particle radius (px).",
    "substrate.sizeExp": "Power-law exponent of the size spectrum: higher = far more small particles than large ones.",
    "substrate.carveRate": "Density an enzyme removes per second, per voxel it covers — how fast you dig.",
    "substrate.lifeMin": "Shortest particle lifespan (s).",
    "substrate.lifeMax": "Longest particle lifespan (s).",
    "substrate.dissolveTime": "Seconds a dying particle takes to erode away voxel by voxel.",
    "substrate.driftMin": "Slowest particle drift (px/s).",
    "substrate.driftMax": "Fastest particle drift (px/s).",
    "substrate.minPerRes": "Minimum particles dominated by EACH resource, so every enzyme always has something to eat.",
    "substrate.grainStrength": "Depth shading: how strongly a voxel is lit by its distance to the particle's surface. Set to 0 for the old flat blocks (type 0 in the box — the slider is log-scaled and can't reach it).",
    "substrate.grainRim": "Brightness of surface voxels. Above 1 makes the particle's skin catch the light; freshly carved faces brighten as they become the new surface.",
    "substrate.grainFalloff": "How much brightness is lost per voxel step deeper into the mass. Higher = a harder, more dramatic gradient from skin to core.",
    "substrate.grainFloor": "Darkest the buried core is allowed to get, so a big particle's middle doesn't go to black.",
    "enzyme.life": "Seconds an enzyme cloud persists.",
    "enzyme.maxRadius": "Enzyme cloud radius at full growth (px) — your effective digging reach.",
    "enzyme.growTime": "Seconds the enzyme cloud takes to reach full size.",
    "predator.immigratePerPrey": "Protist immigration target per bacterium alive — grazers arrive as their prey booms.",
    "predator.immigrateCap": "Ceiling on the protist population that immigration will chase.",
    "predator.immigrateMax": "Most protists that can arrive in a single immigration step (how fast they catch a boom).",
    "predator.respawnFloor": "Shortest protist respawn interval (s) — it halves on each extinction, down to this.",
    "predator.virusEnergy": "Energy a protist gains from grazing a free virion — a small meal, and a brake on phage blooms.",
    "day.lengthSec": "Real seconds in one in-game day. The run ends when the day does.",
    "day.startHour": "Hour of the in-game day the run opens on (6 = dawn).",
    "diel.tempBase": "Mean water temperature across the day (°C).",
    "diel.tempAmp": "Half the day's temperature swing (°C) — how far it climbs above the mean.",
    "diel.tempLag": "How far the day's warmest moment trails the sun (fraction of a day).",
    "diel.foodFloor": "Night-time food production, as a fraction of the midday bloom.",
    "diel.grazeNight": "Extra grazing pressure at night, when the grazers rise to feed.",
    "cycle.reseedBacteria": "Bacteria seeded in one go when a role-swap happens — the prey that drifts in the moment you become a grazer (and the founders if you ever revert).",
    "cycle.reseedProtists": "Protists seeded when the grazers are wiped out.",
    "cycle.protistThrust": "Swim speed of the protist you steer after a role swap.",
    "cycle.protistEatScore": "Calories scored per bacterium eaten while you're the protist.",
    "toxin.life": "Seconds the antibiotic cloud lingers.",
    "toxin.maxRadius": "Antibiotic cloud radius at full growth (px).",
    "toxin.growTime": "Seconds the antibiotic cloud takes to reach full size.",
    "toxin.dose": "Instant damage dealt to a protist the moment the cloud touches it.",
    "toxin.potency": "Further damage per second to protists sitting inside the cloud.",
    "toxin.crossDist": "Cross-reactivity: bacteria at least this genetic distance from the releaser are harmed by its antibiotic too.",
    "toxin.crossFactor": "How hard that cross-reactive dose lands on those distant lineages (1 = the full dose).",
    "toxin.radiusPer": "Cloud radius gained per antibiotic level — leveling widens the cloud rather than strengthening it.",
    "nutrient.life": "Seconds a freed nutrient mote floats before decaying.",
    "nutrient.radius": "Pickup radius of a nutrient mote (px).",
    "nutrient.maxCount": "Cap on free-floating nutrient motes.",
    "predator.count": "Target number of protist grazers. Applies as protists spawn, not retroactively.",
    "predator.radius": "Protist size (px).",
    "predator.wanderSpeed": "Protist speed while searching for prey.",
    "predator.chaseSpeed": "Protist speed while actively chasing a cell.",
    "predator.senseRange": "How far a protist can detect your cells (px).",
    "predator.satiatedTime": "Seconds a protist rests, not hunting, after a meal.",
    "predator.startEnergy": "Energy a new protist starts with.",
    "predator.mealEnergy": "Energy a protist gains per bacterium eaten.",
    "predator.metabolism": "Energy per second a protist burns — raise it to starve the grazers out.",
    "predator.maturity": "Seconds before a protist is old enough to reproduce.",
    "predator.reproEnergy": "Energy a protist must reach to divide.",
    "predator.reproCooldown": "Minimum seconds between a protist's divisions.",
    "predator.safetyMax": "Hard cap on protists — a performance backstop, never ecologically binding.",
    "predator.minCount": "Population floor: below this, a new protist drifts in from offscreen.",
    "predator.immigrateEvery": "Seconds between immigration checks when the protist population has crashed.",
    "predator.cystMealFactor": "Fraction of a normal meal's energy a protist gets from eating a cyst.",
    "predator.cystEatChance": "Chance a bumped cyst is actually eaten rather than resisting.",
    "predator.killMotes": "Food motes released when an ANTIBIOTIC kills a protist (dying of old age releases nothing).",
    "phage.greenCount": "Free phages kept drifting in the water.",
    "phage.radius": "Phage size (px).",
    "phage.seedBatch": "Most virions added per top-up when a lineage's tier is under-seeded.",
    "phage.hostTolerance": "Kill-the-winner: a phage infects only cells within this many upgrade tiers of its host.",
    "phage.goldLife": "Seconds a gold phage lingers — far longer than green, so you can chase it down.",
    "phage.goldGrabTouch": "TOUCH ONLY: multiplies the gold phage's grab radius, since a fingertip is coarser than a cursor.",
    "phage.life": "Seconds a free-floating phage survives before decaying.",
    "phage.maxCount": "Cap on phages — a performance backstop, deliberately high so epidemics can get nasty.",
    "phage.diffuse": "How fast phages diffuse through the water.",
    "phage.infectHalo": "Extra reach beyond the cell body at which a phage can adsorb (px).",
    "phage.burst": "How many new phages burst out when an infected cell lyses.",
    "phage.latent": "Seconds from infection to lysis — the latent period.",
    "phage.greenSeed": "Seconds between reservoir top-ups, which keep phages tuned to a sampled lineage.",
    "phage.greenFloor": "Minimum phages kept matched to the sampled lineage's tier at each top-up.",
    "phage.hostTolerance": "Kill-the-winner window: how many adaptation tiers from its host a phage can still infect. Lower = upgrading shakes off your pursuers faster.",
    "phage.goldLife": "Seconds the rare GOLD phage (the HGT upgrade) lingers before vanishing.",
    "phage.goldGrabTouch": "TOUCH DEVICES ONLY: multiplies the gold phage's grab radius, because catching it with a thumb is much fiddlier than with a keyboard. 1 = same as desktop. Green phages are unaffected.",
    "phage.goldCount": "How many gold phages are kept on the board at once (desktop). Gold is the only thing that changes what you can do, so this is really 'how fast can you evolve'. 1 = scarce, a hunt.",
    "phage.goldCountTouch": "Same, on a phone. Higher than desktop on purpose: mobile runs are short, and at desktop scarcity most phone players never see a single adaptation.",
    "phage.goldMinDist": "How far from you a fresh gold phage is buried (px). Big = a real expedition.",
    "phage.goldMinDistTouch": "Same, on a phone — closer in, because the phone shows you far less sea and a distant gold is one you'll never know existed.",
    "touch.zoom": "TOUCH ONLY: world magnification on a phone. HIGH zoom = fewer world-pixels on screen, so the same swim speed reads as frantic and food appears out of nowhere. This was 1.69 and is most of why mobile felt worse than desktop. Lower = calmer, more sea visible, smaller cells.",
    "touch.autoEnzyme": "TOUCH ONLY: 1 = your cell dissolves any particle it can reach, by itself. The interesting decision on a phone is where to swim, not when to tap. 0 = fire everything by hand, as on desktop.",
    "touch.autoEnzymeEvery": "TOUCH ONLY: seconds between auto-fired enzymes. Lower = digs faster and burns more energy.",
  };
  // arrays are documented once at the parent path; ".0"/".1" fall back to it
  function tuneDoc(path) {
    const dotted = path.join(".");
    if (TUNE_DOCS[dotted]) return TUNE_DOCS[dotted];
    const parent = TUNE_DOCS[path.slice(0, -1).join(".")];
    if (!parent) return "";
    const end = path[path.length - 1] === "0" ? "Low end" : "High end";
    return `${parent}\n(${end} of the range.)`;
  }

  // every numeric leaf of CFG, including array entries (["phage","burst",0] etc.)
  function cfgLeaves(obj = CFG, path = []) {
    const out = [];
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "number") out.push({ path: [...path, k] });
      else if (v && typeof v === "object") out.push(...cfgLeaves(v, [...path, k]));
    }
    return out;
  }
  const cfgGet = (o, p) => p.reduce((x, k) => (x == null ? undefined : x[k]), o);
  function cfgSet(p, v) { let o = CFG; for (let i = 0; i < p.length - 1; i++) o = o[p[i]]; o[p[p.length - 1]] = v; }
  const cfgDefault = (p) => cfgGet(CFG_DEFAULTS, p);
  const cfgTuned = () => cfgLeaves().some((L) => cfgGet(CFG, L.path) !== cfgDefault(L.path));

  // log mapping: pos 0…TUNE_STEPS ↔ value in [def/10, def*10], with the default at
  // the midpoint. A default of 0 has no decade to span, so those fall back to linear.
  function tuneScale(def) {
    if (def > 0) {
      const lo = Math.log(def) - TUNE_DECADES * Math.LN10, hi = Math.log(def) + TUNE_DECADES * Math.LN10;
      return { val: (t) => Math.exp(lo + (hi - lo) * t / TUNE_STEPS),
               pos: (v) => (v > 0 ? clamp(Math.round((Math.log(v) - lo) / (hi - lo) * TUNE_STEPS), 0, TUNE_STEPS) : 0) };
    }
    const lo = 0, hi = def === 0 ? 10 : def + 1;   // a zero default has no decade to span (startUpgrades)
    return { val: (t) => lo + (hi - lo) * t / TUNE_STEPS,
             pos: (v) => clamp(Math.round((v - lo) / (hi - lo) * TUNE_STEPS), 0, TUNE_STEPS) };
  }
  function fmtTune(v) {
    const a = Math.abs(v);
    return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(4);
  }
  function adminStatus(msg, warn) {
    if (!el.adminStatus) return;
    el.adminStatus.textContent = msg;
    el.adminStatus.classList.toggle("warn", !!warn);
  }
  const DOC_IDLE = `<span class="idle">Hover a knob to see what it does.</span>`;
  function showDoc(dotted, doc, def) {
    if (!el.adminDoc) return;
    el.adminDoc.innerHTML = `<b>${escapeHtml(dotted)}</b> <span class="adef">· default ${fmtTune(def)}</span><br>${escapeHtml(doc).replace(/\n/g, "<br>")}`;
  }
  function clearDoc() { if (el.adminDoc) el.adminDoc.innerHTML = DOC_IDLE; }
  function tunedNotice() {
    if (cfgTuned()) adminStatus("modified — this run is a tuning experiment, so it won't be sent to the shared leaderboard", true);
    else adminStatus("all values at their defaults");
  }
  function buildAdmin() {
    if (adminBuilt || !el.adminBody) return;
    adminBuilt = true;
    const groups = new Map();
    for (const leaf of cfgLeaves()) {
      const g = leaf.path.length > 1 ? leaf.path[0] : "general"; // respirationBase is top-level
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(leaf);
    }
    for (const [g, leaves] of groups) {
      const head = document.createElement("div");
      head.className = "agroup"; head.textContent = g;
      el.adminBody.appendChild(head);
      const groupRows = [];
      adminGroups.push({ head, rows: groupRows });
      for (const leaf of leaves) {
        const def = cfgDefault(leaf.path), sc = tuneScale(def);
        const row = document.createElement("div"); row.className = "arow";
        const name = document.createElement("label"); name.className = "aname";
        name.textContent = leaf.path.slice(g === "general" ? 0 : 1).join(".");
        const doc = tuneDoc(leaf.path);
        // on the ROW, so hovering the slider or the number box explains it too
        row.title = (doc ? doc + "\n\n" : "") + `default ${fmtTune(def)} — double-click the name to reset`;
        row.addEventListener("mouseenter", () => showDoc(leaf.path.join("."), doc, def));
        const slider = document.createElement("input");
        slider.type = "range"; slider.min = 0; slider.max = TUNE_STEPS; slider.step = 1;
        const num = document.createElement("input");
        num.type = "number"; num.className = "anum"; num.step = "any";
        // `src` says which widget the value came from, so we don't fight the one being dragged
        const repaints = leaf.path[0] === "substrate" && leaf.path[1].startsWith("grain");
        const set = (v, src) => {
          if (!isFinite(v)) return;
          cfgSet(leaf.path, v);
          if (src !== "slider") slider.value = sc.pos(v);
          if (src !== "num") num.value = fmtTune(v);
          row.classList.toggle("changed", v !== def);
          // a particle only re-caches when something carves it, so a shading tweak would
          // otherwise not show until your next bite — force the repaint to see it live
          if (repaints) for (const p of substrates) p.dirty = true;
          tunedNotice();
        };
        slider.addEventListener("input", () => set(sc.val(+slider.value), "slider"));
        num.addEventListener("change", () => set(parseFloat(num.value), "num")); // typed value may exceed the slider's decade — that's fine, it just pins the slider
        name.addEventListener("dblclick", () => set(def));
        row.append(name, slider, num);
        el.adminBody.appendChild(row);
        // searched text = group + dotted path + label + description, so "protist" finds
        // the predator group AND toxin.dose, which only mentions protists in its prose
        const entry = { leaf, set, row, hay: `${g} ${leaf.path.join(".")} ${name.textContent} ${doc}`.toLowerCase() };
        adminRows.push(entry);
        groupRows.push(entry);
      }
    }
    el.adminEmpty = document.createElement("div");
    el.adminEmpty.className = "aempty hidden";
    el.adminEmpty.textContent = "no knobs match that filter";
    el.adminBody.appendChild(el.adminEmpty);
    el.adminBody.addEventListener("mouseleave", clearDoc);
    clearDoc();
    filterAdmin();
    tunedNotice();
  }
  // filter on every whitespace-separated token (all must match), so "phage life" narrows
  function filterAdmin() {
    const q = (el.adminSearch && el.adminSearch.value || "").toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const g of adminGroups) {
      let any = false;
      for (const r of g.rows) {
        const hit = tokens.every((t) => r.hay.includes(t));
        r.row.classList.toggle("hidden", !hit);
        if (hit) { any = true; shown++; }
      }
      g.head.classList.toggle("hidden", !any);
    }
    if (el.adminEmpty) el.adminEmpty.classList.toggle("hidden", shown > 0);
    if (el.adminCount) el.adminCount.textContent = tokens.length ? `${shown} of ${adminRows.length} knobs` : `${adminRows.length} knobs`;
  }
  function syncAdmin() { for (const r of adminRows) r.set(cfgGet(CFG, r.leaf.path)); }
  function toggleAdmin(show) {
    buildAdmin();
    adminOpen = show === undefined ? !adminOpen : !!show;
    if (el.admin) el.admin.classList.toggle("hidden", !adminOpen);
    if (adminOpen) syncAdmin();
  }
  function adminPreset() {
    const changed = {};
    for (const L of cfgLeaves()) {
      const v = cfgGet(CFG, L.path), d = cfgDefault(L.path);
      if (v !== d) changed[L.path.join(".")] = { default: d, value: v };
    }
    const raw = (el.adminName && el.adminName.value || "").trim();
    const name = (raw.replace(/[^\w .-]+/g, "-").replace(/\s+/g, "-").slice(0, 60)) || "preset";
    // `cfg` is the whole tree (paste it back / Load it); `changed` is the readable
    // summary of what this experiment actually altered.
    return { name, saved: new Date().toISOString(), changedCount: Object.keys(changed).length, changed, cfg: CFG };
  }
  function adminSave() {
    const data = adminPreset(), json = JSON.stringify(data, null, 2);
    console.log("[tuning] " + data.name, data); // also dumped to the console for a quick copy
    try {
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = data.name + ".json";
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      adminStatus(`saved ${data.name}.json — ${data.changedCount} value${data.changedCount === 1 ? "" : "s"} changed from default`);
    } catch (e) { adminStatus("could not save the file — the JSON is in the console", true); }
  }
  function adminApply(obj) {
    const src = obj && obj.cfg ? obj.cfg : obj; // accept a saved preset or a bare CFG tree
    if (!src || typeof src !== "object") { adminStatus("that file isn't a tuning preset", true); return; }
    let n = 0;
    for (const r of adminRows) {
      const v = cfgGet(src, r.leaf.path);
      if (typeof v === "number" && isFinite(v)) { r.set(v); n++; }
    }
    adminStatus(`loaded ${n} value${n === 1 ? "" : "s"}${obj && obj.name ? ` from "${obj.name}"` : ""}`);
    if (obj && obj.name && el.adminName) el.adminName.value = obj.name;
  }
  if (el.adminSearch) el.adminSearch.addEventListener("input", filterAdmin);
  // Focus is NOT stolen when the panel opens — the sim keeps running, so WASD must
  // keep steering. "/" jumps to the filter when you actually want it.
  if (el.admin) el.admin.addEventListener("keydown", (e) => {
    // the window handler ignores keys typed in inputs, so ` / Esc are handled here
    if (e.key === "`" || e.code === "Backquote") { e.preventDefault(); toggleAdmin(false); return; }
    if (e.key === "Escape") {
      e.preventDefault();
      if (el.adminSearch && e.target === el.adminSearch && el.adminSearch.value) { el.adminSearch.value = ""; filterAdmin(); }
      else { toggleAdmin(false); }
    }
  });
  if (el.adminSave) el.adminSave.addEventListener("click", adminSave);
  if (el.adminReset) el.adminReset.addEventListener("click", () => {
    for (const r of adminRows) r.set(cfgDefault(r.leaf.path));
    adminStatus("all values reset to defaults");
  });
  if (el.adminLoad && el.adminFile) {
    el.adminLoad.addEventListener("click", () => el.adminFile.click());
    el.adminFile.addEventListener("change", () => {
      const f = el.adminFile.files && el.adminFile.files[0];
      if (!f) return;
      f.text().then((txt) => adminApply(JSON.parse(txt)))
              .catch(() => adminStatus("could not read that file as JSON", true));
      el.adminFile.value = ""; // let the same file be re-loaded
    });
  }

  // --------------------------------------------------------- touch controls
  // The controls live in a deck BELOW the ocean (see #touch in index.html), so a thumb
  // never covers the thing you're looking at.
  //
  // Everything here is POINTER events, not touch+click. Two reasons, both bugs on a real
  // phone with the old code:
  //   - `click` needs a clean press-release with no other finger down, so you could not
  //     hold the stick and tap `release` at the same time. Pointer events carry a pointerId
  //     and each finger is tracked independently, so both work at once.
  //   - the stick only took its direction from MOVE events, so a quick flick that started
  //     at the center (thumb lands, flicks off) committed no direction at all and the cell
  //     just sat there. The release point is now sampled on pointerup as well.
  let _stickId = null;
  // Travel is derived from the base's ACTUAL size rather than hardcoded — the stick is clamp()-fluid,
  // so a fixed 52px radius would mean a different dead-zone and rim on every screen width.
  let stickMaxR = 52;                          // last measured knob travel, px (used by the decay too)
  const STICK_TRAVEL = 0.40;                   // knob travel as a fraction of the base's width
  const STICK_DEADF  = 0.13;                   // dead-zone, same units
  const STICK_RIMF   = 0.90;                   // "full deflection" — the latch dwell happens out here
  function parkKnob(x, y) {
    if (el.stickKnob) el.stickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
  }
  function setLatched(on) {
    touchLatched = on;
    if (on) {
      touchRunT = CFG.cell.touchRunSecs;         // (re-)latching refills the run
      touchLatchVec.x = touchVec.x; touchLatchVec.y = touchVec.y; // remember how hard it was pushed
    }
    if (el.stickBase) {
      el.stickBase.classList.toggle("latched", on); // so you can SEE the run is locked
      el.stickBase.style.setProperty("--lock", "1");
    }
  }
  function clearLatchTimer() { if (_latchTimer) { clearTimeout(_latchTimer); _latchTimer = null; } }
  function armLatch() { // thumb just reached the rim — latch if it's STILL there when this fires
    clearLatchTimer();
    _latchTimer = setTimeout(() => {
      _latchTimer = null;
      if (touchVec.active && touchAtMax) setLatched(true);
    }, Math.max(0, CFG.cell.touchLatchSecs) * 1000);
  }
  function releaseStick() { // full stop (used when pausing / opening a menu)
    _stickId = null; touchVec.active = false; touchVec.x = touchVec.y = 0;
    touchAtMax = false; touchRunT = 0; clearLatchTimer(); setLatched(false);
    if (el.stickBase) el.stickBase.classList.remove("on");
    parkKnob(0, 0);
  }
  function setupTouch() {
    const zone = el.stickZone, base = el.stickBase, knob = el.stickKnob;
    if (zone && base && knob) {
      const park = parkKnob;
      // aim from a pointer's position: past the dead-zone it steers; at the center it stops
      const aim = (e) => {
        const r = base.getBoundingClientRect(), cx = r.left + r.width/2, cy = r.top + r.height/2;
        const maxR = r.width * STICK_TRAVEL, dead = r.width * STICK_DEADF;
        stickMaxR = maxR;
        const dxp = e.clientX - cx, dyp = e.clientY - cy;
        const d = Math.hypot(dxp, dyp), cl = d > maxR ? maxR/d : 1;
        park(dxp*cl, dyp*cl);
        const atMax = d >= maxR * STICK_RIMF;
        if (atMax && !touchAtMax) armLatch();       // just arrived at the rim — start the clock
        else if (!atMax && touchAtMax) clearLatchTimer(); // eased off it — the dwell has to start over
        touchAtMax = atMax;
        if (d > dead) {
          // ANALOG: the vector carries how FAR you pushed, not just which way. Magnitude ramps
          // 0→1 from the dead-zone out to the rim, and the mover turns it into thrust — so a
          // gentle lean is a slow crawl and a full push is a sprint.
          const mag = clamp((d - dead) / Math.max(1, maxR - dead), 0, 1);
          touchVec.x = (dxp/d)*mag; touchVec.y = (dyp/d)*mag;
        } else {                                    // back to the center = stop, and drop the latch
          touchVec.x = touchVec.y = 0; clearLatchTimer(); setLatched(false);
        }
      };
      zone.addEventListener("pointerdown", (e) => {
        if (_stickId !== null) return;             // one finger owns the stick; others are free
        _stickId = e.pointerId;
        if (zone.setPointerCapture) zone.setPointerCapture(e.pointerId); // keep it ours if the thumb slides off
        touchVec.active = true; base.classList.add("on");
        aim(e); e.preventDefault();
      });
      zone.addEventListener("pointermove", (e) => {
        if (e.pointerId !== _stickId) return;
        aim(e); e.preventDefault();
      });
      const lift = (e) => {
        if (e.pointerId !== _stickId) return;
        aim(e);                                     // sample where the thumb actually left
        clearLatchTimer();                          // a dwell still in progress doesn't count
        _stickId = null; touchVec.active = false; touchAtMax = false;
        if (touchLatched && (touchVec.x || touchVec.y)) {
          touchLatchVec.x = touchVec.x; touchLatchVec.y = touchVec.y;
          park(touchVec.x*stickMaxR, touchVec.y*stickMaxR); // knob stays thrown: the run is still on
        } else {                                    // never dwelled at the rim → releasing just stops
          touchVec.x = touchVec.y = 0;
          setLatched(false);
          park(0, 0);
        }
        base.classList.remove("on");
      };
      zone.addEventListener("pointerup", lift);
      zone.addEventListener("pointercancel", lift);
    }
    const live = () => !(paused || helpOpen || sciOpen || !state || !state.running);
    // Buttons act on pointerDOWN: immediate, no synthetic-click delay, and — the point —
    // unaffected by another finger already holding the stick.
    const act = (elm, fn, gate) => elm && elm.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      if (gate && !live()) return;
      fn();
    });
    act(el.tPause, togglePause, false); // must also work while paused, to un-pause
    // tap a gene to load that enzyme/antibiotic (pointerdown covers mouse clicks too)
    el.enz.forEach((g, i) => act(g, () => selectEnzyme(i), false));
    act(el.enzTox, () => selectEnzyme(3), false);

    // Rolodex buttons: TAP does the thing, SWIPE up/down cycles what's loaded. Telling the two
    // apart means we can only commit on pointerUP — you can't know a press was a swipe until the
    // finger leaves. Still no click delay, and still multi-touch safe (each pointerId is its own).
    const SWIPE = 14; // px of vertical travel before a press counts as a swipe rather than a tap
    const swipeBtn = (btn, onTap, onSwipe) => {
      if (!btn) return;
      let pid = null, y0 = 0;
      btn.addEventListener("pointerdown", (e) => {
        if (pid !== null) return;
        pid = e.pointerId; y0 = e.clientY;
        if (btn.setPointerCapture) btn.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      btn.addEventListener("pointermove", (e) => { if (e.pointerId === pid) e.preventDefault(); });
      btn.addEventListener("pointerup", (e) => {
        if (e.pointerId !== pid) return;
        const dy = e.clientY - y0;
        pid = null; e.preventDefault();
        if (!live()) return;
        // the NEXT card peeks out below the face, so dragging UP pulls it into place
        if (Math.abs(dy) > SWIPE) onSwipe(dy < 0 ? 1 : -1);
        else onTap();
      });
      btn.addEventListener("pointercancel", (e) => { if (e.pointerId === pid) pid = null; });
    };
    swipeBtn(el.tEnz, playerEnzyme, (dir) => cycleEnzyme(dir));
    swipeBtn(el.tLin, () => switchControl(1), (dir) => switchControl(dir));
    setupChartToggle(); // tap OR vertical swipe folds the charts away
  }
  // tap OR swipe anywhere on the chart panel to fold it away / bring it back (mobile)
  function setupChartToggle() {
    const cw = el.chartwrap; if (!cw) return;
    let x0 = null, y0 = null;
    cw.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
    cw.addEventListener("touchend", (e) => {
      if (y0 == null) return;
      const t = e.changedTouches[0], moved = Math.hypot(t.clientX - x0, t.clientY - y0);
      if (moved < 12 || Math.abs(t.clientY - y0) > 24) cw.classList.toggle("collapsed"); // tap or vertical swipe
      x0 = y0 = null;
    }, { passive: true });
  }
  // click any generation-history chart to flip its y-axis between linear and log
  // (on touch the live chart's tap is used to fold it away, so skip the log flip there)
  if (el.chart) el.chart.addEventListener("click", () => { if (!document.body.classList.contains("touch")) chartLog = !chartLog; });
  if (el.analysisChart) el.analysisChart.addEventListener("click", () => { chartLog = !chartLog; drawAnalysis(); });
  if (el.detailChart) el.detailChart.addEventListener("click", () => { chartLog = !chartLog; if (_detailRec) openScoreDetail(_detailRank, _detailRec); });
  // click the lower chart to swap food-available ↔ cause-of-mortality (live chart is desktop-only: tap folds it on mobile)
  if (el_subchart) el_subchart.addEventListener("click", () => { if (!document.body.classList.contains("touch")) toggleSubMode(); });
  if (el.analysisSubChart) el.analysisSubChart.addEventListener("click", () => { toggleSubMode(); drawAnalysis(); });
  if (el.detailSubChart) el.detailSubChart.addEventListener("click", () => { toggleSubMode(); if (_detailRec) openScoreDetail(_detailRank, _detailRec); });
  updateSubLegend();
  // Hover a colored band on either run chart → that lineage's own genome, as a circos ring.
  bindLineageHover(el.analysisChart, analysisRec);
  bindLineageHover(el.detailChart, () => _detailRec);
  if (el.tutorialBtn) el.tutorialBtn.addEventListener("click", watchTutorial);
  if (el.feedbackBtn) el.feedbackBtn.addEventListener("click", showFeedback);
  if (el.feedbackBtn2) el.feedbackBtn2.addEventListener("click", showFeedback);
  if (el.fbSend) el.fbSend.addEventListener("click", sendFeedback);
  if (el.fbCancel) el.fbCancel.addEventListener("click", hideFeedback);
  if (el.menuBtn) el.menuBtn.addEventListener("click", toTitle);
  if (el.menuBtn2) el.menuBtn2.addEventListener("click", toTitle);
  if (el.demoPlay) el.demoPlay.addEventListener("click", start);
  if (el.demoBack) el.demoBack.addEventListener("click", endTutorial);
  if (el.tutPrev) el.tutPrev.addEventListener("click", tutPrev);
  if (el.tutNext) el.tutNext.addEventListener("click", tutNext);

  // Touch-event support is not an input mode: hybrid laptops expose ontouchstart while their
  // primary mouse/trackpad is still fine and hover-capable. Only a touch-first primary pointer
  // gets the phone deck and its gameplay tuning. Re-evaluate when the OS changes its primary
  // pointer (for example, a convertible entering or leaving tablet mode).
  const touchModeQuery = typeof matchMedia === "function"
    ? matchMedia("(pointer: coarse) and (hover: none)") : null;
  const genomeRow = document.querySelector("#hud .genome-row");
  const genomeHome = genomeRow ? document.createComment("genome-row home") : null;
  if (genomeRow && genomeHome && genomeRow.parentNode) genomeRow.parentNode.insertBefore(genomeHome, genomeRow);
  function applyTouchMode(on) {
    on = !!on;
    if (isTouch === on) return;
    isTouch = on;
    document.body.classList.toggle("touch", on);
    scoreDevice = on ? "touch" : "desktop";
    ZOOM = on ? touchZoom() * viewScale() : 1;

    // The genes are controls on a phone, so they live above the touch buttons. Put them back
    // beside the desktop HUD when a convertible returns to a fine primary pointer.
    const right = document.getElementById("deckRight");
    if (on && genomeRow && right) right.insertBefore(genomeRow, right.firstChild);
    else if (!on && genomeRow && genomeHome && genomeHome.parentNode)
      genomeHome.parentNode.insertBefore(genomeRow, genomeHome.nextSibling);

    if (!on) {
      releaseStick();
      if (el.chartwrap) el.chartwrap.classList.remove("collapsed");
    }
    if (el.scores && !el.scores.classList.contains("hidden")) renderScoreList();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(resizeCanvas);
  }
  applyTouchMode(touchModeQuery && touchModeQuery.matches);
  if (touchModeQuery) {
    const onTouchModeChange = (event) => applyTouchMode(event.matches);
    if (touchModeQuery.addEventListener) touchModeQuery.addEventListener("change", onTouchModeChange);
    else if (touchModeQuery.addListener) touchModeQuery.addListener(onTouchModeChange);
  }
  setupTouch();

  // ------------------------------------------------------ self-update (PWA)
  // Force the latest build: reload the page with a fresh query so the browser
  // re-fetches index.html (uncached), which points at game.js?v=<newBuild> — a
  // new URL that sidesteps any stale cached copy of the script.
  function forceUpdate() {
    try { location.replace(location.pathname + "?u=" + Date.now()); }
    catch (e) { location.reload(); }
  }
  // Ask the server (bypassing cache) what build is live; if it's newer than the
  // one running, reveal the "Update to latest version" button on the title screen.
  async function checkForUpdate() {
    if (typeof fetch !== "function") return;
    try {
      const res = await fetch(location.pathname + "?_=" + Date.now(), { cache: "no-store" });
      const html = await res.text();
      const m = html.match(/name="build"\s+content="([^"]*)"/);
      const live = m && m[1];
      if (live && live !== "__BUILD__" && live !== BUILD && el.updateBtn) el.updateBtn.classList.remove("hidden");
    } catch (e) {}
  }
  if (el.updateBtn) el.updateBtn.addEventListener("click", forceUpdate);
  if (typeof console !== "undefined") console.log("Bacteria! build " + BUILD);
  checkForUpdate();

  // temperature & salinity are held neutral for now (reserved for future levels:
  // estuary, sea ice, hydrothermal vent, ...)
  env.tempC = 20; env.salinity = 35; env.update();
  // The title screen used to be an empty ocean. Run the attract mode behind it: the sim teaches
  // itself, and the menu sits over a sea that's actually alive.
  startDemo();
  // Clicking the water (rather than a menu button) also means "let me play".
  if (el.title) el.title.addEventListener("click", (e) => { if (e.target === el.title && demo) start(); });
  requestAnimationFrame(frame);

})();
