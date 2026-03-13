# Artist Benchmark Report

- Generated: 2026-03-12T15:07:27.783Z
- Total prompts: 20
- Gate pass: NO
- Critical failures: 3
- Median quality: 8.69 (required >= 8)
- Share >= 7.0: 95.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-003` score=8.69 flags=[intent_family_mismatch] target=composer
  - Q: Compare last 6 months vs prior 6 months by platform and recommend 3 actions.
  - Excerpt: In the last 6 months, Public Performance generated a net revenue of $22,550.52 with a quantity of 58,843, while in the prior 6 months, it was only $682.38 from 3,007. Radio saw an increase from $310.97 to $2,638.35, and Short-Video rose from $65.85 to $6,322.05. Notably, Social and Streaming platforms reported no re...
- `artist-live-009` score=9.14 flags=[intent_family_mismatch, missing_external_citations] target=enrichment
  - Q: Which territories show strongest monetization momentum, and what city-level validation should we run before routing dates?
  - Excerpt: Priority touring territories: GB, US, NL. GB leads the current monetization signal at 97.5% share of observed gross.
- `artist-live-013` score=9.39 flags=[intent_family_mismatch] target=composer
  - Q: If we had to choose between doubling down on top performers vs building the mid-tier catalog, which strategy has better 2-quarter upside-adjusted risk?
  - Excerpt: Building the mid-tier catalog shows better potential with significant revenue increases. For example, 'Midnight Empire' generated $22,913.86 in net revenue over the last two quarters, while 'Electric Machine' only brought in $2,919.27.
- `artist-live-019` score=6.82 flags=[none] target=planner
  - Q: If budget is cut by 40%, what 2 moves should we keep and what 1 move should we pause?
  - Excerpt: To optimize a 40% budget cut, keep investments in 'Golden Current' by Zara Hughes, which generated $10,400,566.60, and 'Golden Fever', which brought in $1,170,422.45. Pause any initiatives not directly tied to these top revenue-generating tracks. Data-quality caveat: this result is directionally useful, but signal r...

## Failure Clusters

### By intent
- period_comparison: 2
- quality_risk_impact: 1
- budget_analysis: 1

### By safety flag
- intent_family_mismatch: 3
- missing_external_citations: 1

## Patch Targets

- composer: 2
- enrichment: 1
- planner: 1
