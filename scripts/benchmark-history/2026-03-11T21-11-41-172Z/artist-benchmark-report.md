# Artist Benchmark Report

- Generated: 2026-03-11T21:11:41.168Z
- Total prompts: 5
- Gate pass: NO
- Critical failures: 2
- Median quality: 8.29 (required >= 8)
- Share >= 7.0: 80.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-002` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: Which tracks in this artist's catalog have high usage but low effective royalty rate by rights type this year, and what contract/data issue should we investigate first?
  - Excerpt: (empty)
- `artist-live-005` score=7.19 flags=[constrained_unexpected] target=planner
  - Q: Which platforms are driving revenue concentration risk, and what should we do next quarter?
  - Excerpt: I found artist data, but this result does not satisfy the requested question shape with high confidence.

## Failure Clusters

### By intent
- unknown: 1
- analysis: 1

### By safety flag
- runtime_error: 1
- constrained_unexpected: 1

## Patch Targets

- compiler, planner, composer: 1
- planner: 1
