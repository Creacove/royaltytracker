# Artist Benchmark Report

- Generated: 2026-03-11T20:54:15.252Z
- Total prompts: 20
- Gate pass: NO
- Critical failures: 20
- Median quality: 2.89 (required >= 8)
- Share >= 7.0: 0.0% (required >= 90.0%)

## Top Failing Prompts

- `artist-live-007` score=2.64 flags=[runtime_error, missing_external_citations] target=compiler, planner, composer, enrichment
  - Q: Where should this artiste tour and why?
  - Excerpt: (empty)
- `artist-live-008` score=2.64 flags=[runtime_error, missing_external_citations] target=compiler, planner, composer, enrichment
  - Q: Where should this artiste tour next quarter, and what should we validate before booking dates?
  - Excerpt: (empty)
- `artist-live-009` score=2.64 flags=[runtime_error, missing_external_citations] target=compiler, planner, composer, enrichment
  - Q: Which territories show strongest monetization momentum, and what city-level validation should we run before routing dates?
  - Excerpt: (empty)
- `artist-live-001` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: Where are the biggest attribution and mapping gaps likely distorting net revenue decisions, and what is the 30-day remediation order by expected financial impact?
  - Excerpt: (empty)
- `artist-live-002` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: Which tracks in this artist's catalog have high usage but low effective royalty rate by rights type this year, and what contract/data issue should we investigate first?
  - Excerpt: (empty)
- `artist-live-003` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: Compare last 6 months vs prior 6 months by platform and recommend 3 actions.
  - Excerpt: (empty)
- `artist-live-004` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: Show net revenue week by week for the last 16 weeks by platform, and identify where momentum broke.
  - Excerpt: (empty)
- `artist-live-005` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: Which platforms are driving revenue concentration risk, and what should we do next quarter?
  - Excerpt: (empty)
- `artist-live-006` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: Which territories are under-monetized relative to usage, and what should we do first?
  - Excerpt: (empty)
- `artist-live-010` score=2.89 flags=[runtime_error] target=compiler, planner, composer
  - Q: If budget is limited, what 2 no-regret moves should we make this quarter?
  - Excerpt: (empty)

## Failure Clusters

### By intent
- unknown: 20

### By safety flag
- runtime_error: 20
- missing_external_citations: 3

## Patch Targets

- compiler, planner, composer: 17
- compiler, planner, composer, enrichment: 3
