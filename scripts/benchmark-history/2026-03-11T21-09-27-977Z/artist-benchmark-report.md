# Artist Benchmark Report

- Generated: 2026-03-11T21:09:27.975Z
- Total prompts: 20
- Gate pass: NO
- Critical failures: 4
- Median quality: 8.69 (required >= 8)
- Share >= 7.0: 95.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-009` score=7.71 flags=[constrained_unexpected, cross_intent_recommendation_drift, missing_external_citations] target=planner, recommender, enrichment
  - Q: Which territories show strongest monetization momentum, and what city-level validation should we run before routing dates?
  - Excerpt: Priority touring territories: SE, AN, MY. SE leads the current monetization signal at 86.8% share of observed gross.
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
- quality_risk_impact: 1

### By safety flag
- constrained_unexpected: 2
- runtime_error: 1
- cross_intent_recommendation_drift: 1
- missing_external_citations: 1

## Patch Targets

- compiler, planner, composer: 1
- planner: 1
- planner, recommender, enrichment: 1
