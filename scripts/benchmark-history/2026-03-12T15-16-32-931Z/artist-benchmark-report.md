# Artist Benchmark Report

- Generated: 2026-03-12T15:16:32.928Z
- Total prompts: 20
- Gate pass: NO
- Critical failures: 1
- Median quality: 8.69 (required >= 8)
- Share >= 7.0: 95.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-009` score=9.14 flags=[intent_family_mismatch, missing_external_citations] target=enrichment
  - Q: Which territories show strongest monetization momentum, and what city-level validation should we run before routing dates?
  - Excerpt: Priority touring territories: GB, US, NL. GB leads the current monetization signal at 97.5% share of observed gross.
- `artist-live-019` score=6.82 flags=[none] target=planner
  - Q: If budget is cut by 40%, what 2 moves should we keep and what 1 move should we pause?
  - Excerpt: Maintain focus on 'Golden Current' by Zara Hughes, which generated $10,400,566.60 in gross revenue. Consider keeping 'Golden Fever' as a secondary option with $1,170,422.45 in gross revenue. Pause any initiatives that do not directly support these top revenue-generating tracks. Data-quality caveat: this result is di...

## Failure Clusters

### By intent
- quality_risk_impact: 1
- budget_analysis: 1

### By safety flag
- intent_family_mismatch: 1
- missing_external_citations: 1

## Patch Targets

- enrichment: 1
- planner: 1
