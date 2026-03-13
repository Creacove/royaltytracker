# Artist Benchmark Report

- Generated: 2026-03-12T15:11:40.387Z
- Total prompts: 20
- Gate pass: NO
- Critical failures: 3
- Median quality: 8.69 (required >= 8)
- Share >= 7.0: 95.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-003` score=8.69 flags=[intent_family_mismatch] target=composer
  - Q: Compare last 6 months vs prior 6 months by platform and recommend 3 actions.
  - Excerpt: In the last 6 months, Public Performance generated a net revenue of $22,550.52 from 58,843 performances, while in the prior 6 months, it only generated $682.38 from 3,007 performances. Radio also saw an increase, with net revenue rising to $2,638.35 from 29,230 performances compared to $310.97 from 20,738 performanc...
- `artist-live-009` score=9.14 flags=[intent_family_mismatch, missing_external_citations] target=enrichment
  - Q: Which territories show strongest monetization momentum, and what city-level validation should we run before routing dates?
  - Excerpt: Priority touring territories: GB, US, NL. GB leads the current monetization signal at 97.5% share of observed gross.
- `artist-live-013` score=9.39 flags=[intent_family_mismatch] target=composer
  - Q: If we had to choose between doubling down on top performers vs building the mid-tier catalog, which strategy has better 2-quarter upside-adjusted risk?
  - Excerpt: Building the mid-tier catalog shows better potential with a net revenue of $22,913.86 from 'Midnight Empire' in the prior 2 quarters. In contrast, top performers like 'Golden Fever' generated $2,611.61 in the last 2 quarters. The total net revenue for the last 2 quarters from mid-tier tracks is significantly higher ...
- `artist-live-019` score=6.82 flags=[none] target=planner
  - Q: If budget is cut by 40%, what 2 moves should we keep and what 1 move should we pause?
  - Excerpt: To manage a 40% budget cut, prioritize keeping investments in 'Golden Current' by Zara Hughes, which generated $10,400,566.60, and 'Golden Fever', which brought in $1,170,422.45. Consider pausing any initiatives that do not directly support these top revenue-generating tracks. Data-quality caveat: this result is dir...

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
