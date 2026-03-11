# Artist Benchmark Report

- Generated: 2026-03-11T21:19:42.014Z
- Total prompts: 20
- Gate pass: NO
- Critical failures: 1
- Median quality: 8.69 (required >= 8)
- Share >= 7.0: 100.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-009` score=8.16 flags=[cross_intent_recommendation_drift, missing_external_citations] target=recommender, enrichment
  - Q: Which territories show strongest monetization momentum, and what city-level validation should we run before routing dates?
  - Excerpt: Priority touring territories: SE, AN, MY. SE leads the current monetization signal at 86.8% share of observed gross.

## Failure Clusters

### By intent
- quality_risk_impact: 1

### By safety flag
- cross_intent_recommendation_drift: 1
- missing_external_citations: 1

## Patch Targets

- recommender, enrichment: 1
