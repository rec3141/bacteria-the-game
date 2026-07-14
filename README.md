# Bacteria! — the game

A browser remake of a 2014 Flash game, rebuilt as a single-file HTML5 Canvas game in
vanilla JavaScript (no build step, no dependencies). You play a single marine bacterium:
forage particulate organic matter with your enzymes, evolve via horizontal gene transfer
from viruses, divide, and outlast protist grazers and phage epidemics in an emergent
microbial-ecology simulation.

Play it at **https://bacteria.cryomics.org**

## Controls

- **W A S D / arrows** — swim (release and you stop dead — see The Science)
- **Space** — fire the loaded gene: an enzyme dissolves the particle ahead, the antibiotic poisons nearby protists. As a protist, Space is a sprint.
- **Tab** — load a different gene · **Shift** — take control of another lineage
- **M** — cycle sound (music / effects / off) · **Esc** — pause, run stats & high scores
- **`** — live tuning panel (every constant in the sim)

## Mechanics (in brief)

- **Foraging** — big destructible marine particles (marine snow, fecal pellets, diatoms,
  chitin) are patchy mixes of lipid / protein / carbohydrate; each needs its own enzyme.
  Dig in, absorb the freed nutrients, shelter from predators.
- **Evolution / HGT** — chase the rare gold phage for a random heritable upgrade: new
  enzymes, higher expression, chemotaxis, CRISPR, or an anti-protist antibiotic. Upgrades
  only count once you **divide** and pass them on.
- **Viruses (kill-the-winner)** — green phages infect only cells near their host's
  *adaptation tier*, so every upgrade shifts your danger window — you can outrun a red
  swarm by upgrading. CRISPR turns immune viruses into food.
- **Charts** — the colony's generations stack as flat colored bands over time; protists
  and viruses (own axis) overlay as lines.

## Files

| File | What it is |
|---|---|
| `index.html` | page shell, HUD, screens, CSS |
| `game.js` | the entire engine (one IIFE) |
| `assets/sounds/` | sound effects (extracted from the original SWF) |
| `scores.php` | shared-leaderboard backend (GET top runs / POST a run; file-backed JSON) |
| `score_schema.php` | strict nested leaderboard normalization and byte-budget helpers |
| `Bacteria.swf` | the original 2014 Flash game, kept for posterity |

## Running locally

Serve over HTTP (audio loads via `fetch`, which won't run from `file://`):

```bash
python3 -m http.server
# then open http://localhost:8000/
```

The shared leaderboard needs PHP; without it, high scores fall back to this browser's
`localStorage`, so the game is fully playable locally with no backend.

## Deploying (DreamHost)

Static files + `scores.php` go in the `bacteria.cryomics.org` docroot. See `deploy.sh`.
`scores.json` is created on first submission and must be writable by the web server.
