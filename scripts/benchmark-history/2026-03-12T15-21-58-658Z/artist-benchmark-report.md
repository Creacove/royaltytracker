# Artist Benchmark Report

- Generated: 2026-03-12T15:21:58.656Z
- Total prompts: 20
- Gate pass: YES
- Critical failures: 0
- Median quality: 8.69 (required >= 8)
- Share >= 7.0: 95.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-019` score=6.82 flags=[none] target=planner
  - Q: If budget is cut by 40%, what 2 moves should we keep and what 1 move should we pause?
  - Excerpt: To optimize after a 40% budget cut, keep investments in 'Golden Current' by Zara Hughes, which generated $10,400,566.60, and also maintain support for 'Golden Fever' with $1,170,422.45. Pause any initiatives related to lower-performing tracks or artists not listed. Data-quality caveat: this result is directionally u...

## Failure Clusters

### By intent
- budget_analysis: 1

### By safety flag
- none

## Patch Targets

- planner: 1
