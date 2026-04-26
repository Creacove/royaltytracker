# Statements Workflow Card Design

Date: 2026-04-04
Status: Proposed
Owner: Codex

## Goal

Redesign the top upload area on the Statements page so the workflow feels like one intentional product surface from start to finish:

- idle upload
- file selected
- processing
- action needed for track matching
- finalizing
- return to idle

The design must stay inside the app's current light forensic and evidence visual language. The ChatGPT reference is only an interaction reference for simplicity and focus, not a visual style to copy.

## Problem Summary

The current redesign fails for two reasons:

1. It mixes two visual systems.
   The idle uploader tries to look like ChatGPT, while processing and matching revert to the existing app card language. The workflow changes identity between states.

2. The processing state is too dashboard-like.
   The three-box processing layout fragments attention and makes the upload workflow feel like a reporting panel instead of a single controlled task.

The fix is not more decoration. The fix is a clearer object model:

- one stable outer card
- one inner workflow region
- full-state replacement inside that region
- consistent light product styling throughout

## Chosen Direction

Use a `Single Morphing Workflow Card` in the current light product language.

This means:

- the outer card shell remains consistent
- the card title remains `Upload statement`
- the interior swaps cleanly between workflow states
- processing fully replaces the upload form
- match-required state is a notification state with a single `Continue` action
- matching happens in a modal, not inside the card body

## Design Principles

1. One object, many states
   The user should feel that one card is progressing, not that new components are appearing underneath the old one.

2. Product-native, not borrowed
   Keep the existing page's light, editorial, evidence-driven visual system. Do not introduce a dark conversational surface.

3. Reduce simultaneous decisions
   Each state should present one clear next step. Idle invites upload. File-selected requests metadata. Processing asks for nothing. Match-needed asks only for continuation.

4. Replace, do not stack
   When state changes, the previous UI leaves. The new state takes over the inner card area completely.

5. Calm before detail
   The top card should summarize the workflow. Detailed matching choices belong in the modal.

## Card Structure

The outer wrapper remains a single `Card surface="hero"` aligned with the rest of the page.

Stable outer structure:

- card title: `Upload statement`
- one body region beneath the title
- internal padding consistent with other major cards on the page
- no extra nested mini-dashboards inside the workflow area unless required by the state

The inner workflow region changes by state.

## State Design

### 1. Idle

Purpose:
Invite the user to begin uploading without exposing unnecessary fields too early.

Content:

- centered upload invitation
- one clear dropzone/button surface
- short helper line describing accepted files

Behavior:

- `statement name` and `period` are hidden in this state
- user can click or drag a file into the card

Layout:

- generous vertical breathing room
- centered content
- one primary upload target
- no extra controls competing for attention

Tone:

- confident
- quiet
- ready for action

Example copy:

- Heading: `Ready to upload a statement?`
- Supporting text: `Drop a file here or choose one to begin processing.`

### 2. File Selected

Purpose:
Confirm the chosen file and collect the remaining required metadata before upload begins.

Content:

- selected file summary
- `statement name` input
- `period` input
- primary upload button
- secondary remove file action

Behavior:

- the same card expands modestly to reveal the fields
- the upload action remains visually dominant
- the file remains visible so the user knows what they are submitting

Layout:

- top row: selected file token/summary
- lower row: `statement name`, `period`, `Upload`
- layout should be compact and aligned, not chat-bubble-inspired

Tone:

- transactional
- clear
- lightweight

### 3. Processing

Purpose:
Show that the statement is actively being worked on and that the table will update only when the workflow is done.

Critical rule:
This state fully replaces the upload form interior.

Content:

- one centered processing message
- one compact file summary
- one supporting line about what the system is doing
- subtle progress motion

Do not include:

- the previous upload inputs
- three separate status tiles
- multiple competing summaries
- table-like boxes inside the card

Layout:

- centered or slightly left-weighted hero message
- compact metadata line beneath it
- optional subtle activity indicator or animated progress rail

Example copy:

- Eyebrow: `In progress`
- Title: `Processing your statement`
- Supporting text: `Extraction, normalization, and validation are running. This statement will appear in the table when processing is complete.`

Visual direction:

- use the app's current light surfaces
- introduce motion through restrained shimmer, pulse, or progress activity
- avoid spinner-only communication as the primary visual anchor

### 4. Match Required

Purpose:
Pause the workflow and tell the user that processing cannot finish until they confirm some possible track matches.

Critical rule:
This is still the same card. It is not a modal preview and not a mini-review tool.

Content:

- notification-style state
- one short explanation
- one primary `Continue` button
- optional count of pending track questions

Behavior:

- the card stops feeling like "processing"
- it feels like a clear handoff moment
- clicking `Continue` opens the matching modal

Layout:

- same basic structure as the processing state
- stronger emphasis on action
- one clear button aligned with the notification message

Example copy:

- Eyebrow: `Action needed`
- Title: `We need a few track confirmations`
- Supporting text: `We found tracks in this statement that may match records already in your workspace. Review them to continue processing.`
- Button: `Continue`

### 5. Finalizing

Purpose:
Show that the user has completed match decisions and the system is now applying them and finishing the workflow.

Content:

- same structural pattern as processing
- updated copy indicating post-match work

Example copy:

- Eyebrow: `Finalizing`
- Title: `Applying your track decisions`
- Supporting text: `We’re updating the statement and running the final validation pass.`

Visual direction:

- visually close to processing
- slightly more resolved and conclusive in tone

### 6. Done

Purpose:
Return the card to its idle state once the workflow is complete and the report enters the table.

Behavior:

- the card resets to the idle uploader
- the completed report appears in the Statements table regardless of final terminal status

## Match Modal Design

The modal should remain inside the same light product language.

Modal behavior:

- opens only after the user clicks `Continue`
- shows one uploaded track per section
- each section lists possible matches as flat choices
- includes `No match`
- user must decide each item before continuing

Modal layout:

- calm header with one clear explanation
- stacked sections for track questions
- each candidate rendered as a selectable row
- footer with decision count and primary submit action

Do not add:

- ranking labels
- confidence ladders
- complex scoring language
- side-by-side forensic comparison grids unless later required

## Motion and Transition Rules

Use restrained state transitions so the card feels continuous:

- fade plus slight vertical motion between states
- progress shimmer or subtle pulse in processing states
- no dramatic layout jumps
- no hard visual style swap between idle and processing

The animation should communicate continuity, not novelty.

## Copy Rules

The copy should be:

- short
- operational
- calm
- product-native

Avoid:

- chat language
- overly friendly assistant phrasing
- vague status messages like `Working...`

Prefer:

- `Processing your statement`
- `We need a few track confirmations`
- `Applying your track decisions`

## Behavioral Rules

1. Only the active workflow for the current session owns the top card.
2. Historical unfinished reports must not permanently occupy the upload surface.
3. The Statements table hides only unfinished workflow items.
4. Once processing is complete, the report appears in the table regardless of whether the final status is `needs_review`, `completed_with_warnings`, `completed_passed`, or another terminal status.
5. The modal is the only place where matching decisions are made.

## Acceptance Criteria

The redesign is successful when all of the following are true:

- the top card feels visually consistent with the rest of the Statements page
- the idle state does not look like an imported chat component
- processing fully replaces the upload form interior
- the match-required state is a simple notification plus button
- the modal handles all track decisions
- the card resets cleanly after completion
- the workflow reads as one designed system instead of several unrelated components

## Out of Scope

- redesigning the Statements table
- redesigning the full Data Quality Queue
- introducing scored match explanations
- adding new persistent match-learning UI for future uploads

## Self-Review

Checked for:

- consistency between workflow states
- alignment with the current product visual language
- explicit handling of the modal boundary
- explicit rule that processing replaces the upload form
- explicit rule that `statement name` and `period` appear only after file selection
