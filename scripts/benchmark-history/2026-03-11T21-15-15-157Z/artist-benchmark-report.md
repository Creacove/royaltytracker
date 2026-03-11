# Artist Benchmark Report

- Generated: 2026-03-11T21:15:15.153Z
- Total prompts: 5
- Gate pass: NO
- Critical failures: 1
- Median quality: 8.34 (required >= 8)
- Share >= 7.0: 100.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-002` score=8.12 flags=[constrained_unexpected] target=planner
  - Q: Which tracks in this artist's catalog have high usage but low effective royalty rate by rights type this year, and what contract/data issue should we investigate first?
  - Excerpt: I found relevant artist data, but evidence fit to this question is partial. Use these recommendations as provisional until missing evidence is added.

## Failure Clusters

### By intent
- quality_risk_impact: 1

### By safety flag
- constrained_unexpected: 1

## Patch Targets

- planner: 1
