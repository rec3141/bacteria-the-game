# Performance backstops

The simulation uses a torus-aware 64-pixel uniform grid for local cell, protist, phage, toxin,
nutrient, and viewport queries. Exact wrapped-distance and rod-distance checks still decide every
interaction; the grid only removes entities that cannot possibly be close enough.

The configured safety ceilings are deliberately above normal ecological populations but low enough
to remain useful backstops:

- 10,000 bacteria
- 300 protists
- 2,500 phages
- 600 nutrient motes

Run the deterministic cap-scale benchmark with:

```sh
node benchmarks/spatial-index.mjs
```

It rebuilds the production grid and runs predator targeting, phage adsorption, viral grazing, and a
representative viewport query for 25 measured iterations. It must keep candidate checks below 3% of
the old full cross-products and median broad-phase time below 30 ms. The timing budget can be raised
explicitly for unusually slow CI hosts with `SPATIAL_BENCH_BUDGET_MS`; the candidate-ratio assertion
is hardware-independent.

Reference run in the development container on 2026-07-14: 1.98–2.03 ms median and 197,685 candidate
checks versus 28,750,000 full-scan pairs (0.69%). This measures the indexed interaction broad phase,
not browser canvas paint time.
