# Capture Runbook

## Recording Setup

- Browser viewport: `1728x972`
- App capture resolution: `4K` if possible, otherwise `2560x1440`
- Browser zoom: `100%`
- OS scaling: fixed before all captures
- Cursor: enabled, medium size, no click rings
- Theme: use the existing app theme without ad hoc overrides

## Pre-Capture Cleanup

- Close unused tabs
- Hide bookmarks bar
- Turn off desktop notifications
- Use one browser profile with no extensions visible
- Clear irrelevant history/autocomplete suggestions
- Prepare the exact routes in separate tabs before recording
- Use these app routes:
  - `/reports`
  - `/`
  - `/ai-insights`
  - `/ai-insights/snapshots/artist/:artistKey`
  - `/ai-insights/snapshots/track/:trackKey`
  - `/review-queue`
  - `/transactions`

## Required Capture Passes

For each hero screen, record:

- `pass A`: full interaction at normal speed
- `pass B`: slower, precise cursor motion for speed ramps
- `pass C`: static hold with no cursor for macro crops

## Screen Notes

### Reports & Statements

- Use one staged file name: `SAMRO_Q4_2025_statement.pdf`
- Visible CMO: `SAMRO`
- Visible period: `Q4 2025`
- Visible status progression: `processing` -> `completed_with_warnings`

### Dashboard

- Net revenue should read as the main commercial proof point
- Revenue trend must end on an upswing
- Top platform mix should look intentional, not perfectly balanced
- CMO scorecard should show `3-5` believable organizations

### AI Insights

- Start from empty state once
- Then record answers already loaded where possible
- Keep prompts exact:
  - `Where is revenue leaking the most?`
  - `Which artists should we prioritize this quarter?`
  - `Show tracks with highest opportunity.`

### Artist Snapshot

- Pick one artist with:
  - clear revenue leader status
  - visible top tracks
  - strong chart shape
  - at least one signal card that reads in under two seconds

### Track Snapshot

- This is the hero surface
- Export button must be visible in at least one pass
- Territory and platform mix must both look strong enough for close-up crops

### Data Quality Queue

- Use one open task with a clean issue title
- Keep the source evidence grid readable and non-sensitive
- Avoid crowded payloads or overly technical JSON on the main visible beat

### Transactions

- Use one row with complete metadata
- Open the detail drawer and hold on:
  - ISRC
  - Territory
  - Platform
  - Net revenue
  - Source page

## Edit Assist Notes

- Record typing separately if live typing feels uneven
- Record hover states separately for export, snapshot, and drawer actions
- Prefer short, confident cursor paths
- Do not scroll long tables during hero shots unless the motion is used as a transition

## Quality Bar

Reject any capture if:

- text is too small for a mobile crop
- the cursor hesitates or reverses direction
- the data looks fake in a bad way
- the frame includes browser clutter or OS distractions
- a chart shape is visually flat or confusing
