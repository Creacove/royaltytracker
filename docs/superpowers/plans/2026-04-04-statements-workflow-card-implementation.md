# Statements Workflow Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Statements page upload workflow as one light, product-native workflow card that cleanly transitions through upload, processing, track-match notification, finalizing, and reset.

**Architecture:** Keep the current report-processing and match-task data flow, but replace the current mixed-state UI with a single workflow card component and a matching modal component. Preserve the existing table and report-status behavior, while limiting the top card to the session-tracked active workflow only.

**Tech Stack:** React, TypeScript, TanStack Query, Supabase client, existing `Card`/`Dialog`/`Button` UI primitives, Vitest.

---

## File Structure

**Create:**
- `C:/Users/USER/royaltytracker/src/components/reports/StatementWorkflowCard.tsx`
  Owns the top-card presentation for `idle`, `file_selected`, `processing`, `match_action_needed`, and `finalizing`.
- `C:/Users/USER/royaltytracker/src/components/reports/StatementTrackMatchDialog.tsx`
  Owns the light-styled modal for flat track-match decisions.
- `C:/Users/USER/royaltytracker/src/test/report-workflow-card.test.tsx`
  Covers render-level workflow-card states and prevents another route-level render miss.

**Modify:**
- `C:/Users/USER/royaltytracker/src/pages/Reports.tsx`
  Keep data fetching, mutations, table rendering, and session-scoped active workflow tracking. Remove inlined workflow-card JSX and wire the new components in.
- `C:/Users/USER/royaltytracker/src/lib/report-workflow.ts`
  Extend helpers only if needed for clean state derivation, without changing backend semantics.
- `C:/Users/USER/royaltytracker/src/test/report-workflow.test.ts`
  Add or adjust pure helper tests if state-derivation helpers change.

**Keep unchanged unless a concrete blocker appears:**
- `C:/Users/USER/royaltytracker/src/pages/DataQualityQueue.tsx`
- `C:/Users/USER/royaltytracker/supabase/functions/reprocess-file/index.ts`
- `C:/Users/USER/royaltytracker/supabase/functions/prepare-track-matches/index.ts`
- `C:/Users/USER/royaltytracker/supabase/functions/submit-track-match-decisions/index.ts`

---

### Task 1: Extract the Workflow Card Boundary

**Files:**
- Create: `C:/Users/USER/royaltytracker/src/components/reports/StatementWorkflowCard.tsx`
- Modify: `C:/Users/USER/royaltytracker/src/pages/Reports.tsx`
- Test: `C:/Users/USER/royaltytracker/src/test/report-workflow-card.test.tsx`

- [ ] **Step 1: Write a failing render test for the idle workflow card**

Create `C:/Users/USER/royaltytracker/src/test/report-workflow-card.test.tsx` with a focused render test for the extracted card component, not the whole page:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StatementWorkflowCard } from "@/components/reports/StatementWorkflowCard";

describe("StatementWorkflowCard", () => {
  it("renders the idle upload invitation without metadata fields", () => {
    render(
      <StatementWorkflowCard
        mode="idle"
        dragActive={false}
        file={null}
        statementName=""
        reportPeriod=""
        uploadPending={false}
        trackMatchCount={0}
        unansweredTrackMatchCount={0}
        workflowFileName={null}
        workflowStatementName={null}
        workflowPeriod={null}
        workflowCreatedAt={null}
        onFilePick={vi.fn()}
        onClearFile={vi.fn()}
        onStatementNameChange={vi.fn()}
        onReportPeriodChange={vi.fn()}
        onUpload={vi.fn()}
        onDragOver={vi.fn()}
        onDragLeave={vi.fn()}
        onDrop={vi.fn()}
        onContinueMatching={vi.fn()}
      />,
    );

    expect(screen.getByText("Ready to upload a statement?")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Statement name")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Period")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test and verify it fails because the component does not exist yet**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- FAIL with module resolution error for `@/components/reports/StatementWorkflowCard`

- [ ] **Step 3: Create the workflow card component with a minimal prop interface**

Create `C:/Users/USER/royaltytracker/src/components/reports/StatementWorkflowCard.tsx`:

```tsx
import type { DragEvent, ReactNode } from "react";

export type StatementWorkflowMode =
  | "idle"
  | "file_selected"
  | "processing"
  | "match_action_needed"
  | "finalizing";

export type StatementWorkflowCardProps = {
  mode: StatementWorkflowMode;
  dragActive: boolean;
  file: File | null;
  statementName: string;
  reportPeriod: string;
  uploadPending: boolean;
  trackMatchCount: number;
  unansweredTrackMatchCount: number;
  workflowFileName: string | null;
  workflowStatementName: string | null;
  workflowPeriod: string | null;
  workflowCreatedAt: string | null;
  onFilePick: () => void;
  onClearFile: () => void;
  onStatementNameChange: (value: string) => void;
  onReportPeriodChange: (value: string) => void;
  onUpload: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onContinueMatching: () => void;
};

export function StatementWorkflowCard(props: StatementWorkflowCardProps) {
  return <div>placeholder</div>;
}
```

- [ ] **Step 4: Replace the placeholder with the stable outer card shell and idle state**

Inside `StatementWorkflowCard.tsx`, implement the stable wrapper first:

```tsx
import { Card, CardContent, CardTitle } from "@/components/ui/card";

export function StatementWorkflowCard(props: StatementWorkflowCardProps) {
  return (
    <Card surface="hero">
      <CardContent className="space-y-4 p-4 md:p-5">
        <CardTitle className="text-[1.05rem]">Upload statement</CardTitle>
        <div className="rounded-[calc(var(--radius)-2px)] border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.72)] px-6 py-12">
          <div className="mx-auto flex max-w-2xl flex-col items-center gap-3 text-center">
            <p className="type-display-section text-[1.6rem] text-foreground">
              Ready to upload a statement?
            </p>
            <p className="max-w-xl text-sm leading-6 text-muted-foreground">
              Drop a file here or choose one to begin processing.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit the extraction checkpoint**

```bash
git add src/components/reports/StatementWorkflowCard.tsx src/test/report-workflow-card.test.tsx
git commit -m "refactor: extract statements workflow card shell"
```

---

### Task 2: Rebuild Idle and File-Selected States in the Light Product Language

**Files:**
- Modify: `C:/Users/USER/royaltytracker/src/components/reports/StatementWorkflowCard.tsx`
- Modify: `C:/Users/USER/royaltytracker/src/pages/Reports.tsx`
- Test: `C:/Users/USER/royaltytracker/src/test/report-workflow-card.test.tsx`

- [ ] **Step 1: Add a failing test for the file-selected state**

Append to `report-workflow-card.test.tsx`:

```tsx
it("reveals statement metadata inputs after a file is selected", () => {
  const file = new File(["demo"], "statement.csv", { type: "text/csv" });

  render(
    <StatementWorkflowCard
      mode="file_selected"
      dragActive={false}
      file={file}
      statementName="BMI Q1 2026"
      reportPeriod="Q1 2026"
      uploadPending={false}
      trackMatchCount={0}
      unansweredTrackMatchCount={0}
      workflowFileName={null}
      workflowStatementName={null}
      workflowPeriod={null}
      workflowCreatedAt={null}
      onFilePick={vi.fn()}
      onClearFile={vi.fn()}
      onStatementNameChange={vi.fn()}
      onReportPeriodChange={vi.fn()}
      onUpload={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDrop={vi.fn()}
      onContinueMatching={vi.fn()}
    />,
  );

  expect(screen.getByText("statement.csv")).toBeInTheDocument();
  expect(screen.getByDisplayValue("BMI Q1 2026")).toBeInTheDocument();
  expect(screen.getByDisplayValue("Q1 2026")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- FAIL because the file-selected state has not been implemented

- [ ] **Step 3: Implement the idle and file-selected layouts in the extracted card**

In `StatementWorkflowCard.tsx`, add two render branches:

```tsx
const isIdle = props.mode === "idle";
const isFileSelected = props.mode === "file_selected";
```

Implement the file-selected branch with:

- selected file summary row
- `Input` for `statement name`
- `Input` for `period`
- primary upload button
- clear-file button

Use the existing UI primitives only:

```tsx
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FileText, Loader2, Upload, X } from "lucide-react";
```

Layout rule:
- same outer card shell
- no dark composer surface
- no full-width chat bubble
- one aligned, light product-native content block

- [ ] **Step 4: Update `Reports.tsx` to derive `file_selected` instead of folding it into idle**

Replace the current mode calculation in `Reports.tsx` with:

```tsx
const activeWorkflowMode = useMemo<StatementWorkflowMode>(() => {
  if (submitTrackMatchesMutation.isPending) return "finalizing";
  if (activeWorkflowReport && trackMatchTasks.length > 0) return "match_action_needed";
  if (uploadMutation.isPending || activeWorkflowReport) return "processing";
  if (file) return "file_selected";
  return "idle";
}, [activeWorkflowReport, file, submitTrackMatchesMutation.isPending, trackMatchTasks.length, uploadMutation.isPending]);
```

- [ ] **Step 5: Run the focused workflow-card test again**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit the idle and file-selected rebuild**

```bash
git add src/components/reports/StatementWorkflowCard.tsx src/pages/Reports.tsx src/test/report-workflow-card.test.tsx
git commit -m "feat: rebuild statements upload card idle states"
```

---

### Task 3: Replace the Processing and Action-Needed UI with One Centered Workflow Surface

**Files:**
- Modify: `C:/Users/USER/royaltytracker/src/components/reports/StatementWorkflowCard.tsx`
- Modify: `C:/Users/USER/royaltytracker/src/pages/Reports.tsx`
- Test: `C:/Users/USER/royaltytracker/src/test/report-workflow-card.test.tsx`

- [ ] **Step 1: Add a failing test for the action-needed state**

Append to `report-workflow-card.test.tsx`:

```tsx
it("renders a simple action-needed notification with a continue button", () => {
  render(
    <StatementWorkflowCard
      mode="match_action_needed"
      dragActive={false}
      file={null}
      statementName=""
      reportPeriod=""
      uploadPending={false}
      trackMatchCount={3}
      unansweredTrackMatchCount={3}
      workflowFileName="statement.xlsx"
      workflowStatementName="SoundExchange Q4 2024"
      workflowPeriod="Q4 2024"
      workflowCreatedAt="2026-04-04T08:00:00.000Z"
      onFilePick={vi.fn()}
      onClearFile={vi.fn()}
      onStatementNameChange={vi.fn()}
      onReportPeriodChange={vi.fn()}
      onUpload={vi.fn()}
      onDragOver={vi.fn()}
      onDragLeave={vi.fn()}
      onDrop={vi.fn()}
      onContinueMatching={vi.fn()}
    />,
  );

  expect(screen.getByText("We need a few track confirmations")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- FAIL because the card still renders the dashboard-like processing structure

- [ ] **Step 3: Replace the current processing grid with a single centered state view**

In `StatementWorkflowCard.tsx`, remove the three-column processing block and replace it with one shared workflow-state renderer:

```tsx
function WorkflowStatePanel({
  eyebrow,
  title,
  description,
  meta,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  meta?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-[calc(var(--radius)-2px)] border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.72)] px-6 py-10 md:px-8 md:py-12">
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-4 text-center">
        <span className="editorial-kicker">{eyebrow}</span>
        <div className="space-y-3">
          <h2 className="type-display-section text-[1.65rem] text-foreground">{title}</h2>
          <p className="text-sm leading-7 text-muted-foreground">{description}</p>
        </div>
        {meta}
        {action}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Render `processing`, `match_action_needed`, and `finalizing` through the shared panel**

Use copy from the approved design:

```tsx
if (props.mode === "processing") {
  return (
    <WorkflowStatePanel
      eyebrow="In progress"
      title="Processing your statement"
      description="Extraction, normalization, and validation are running. This statement will appear in the table when processing is complete."
      meta={<p className="text-sm text-muted-foreground">{props.workflowFileName}</p>}
    />
  );
}

if (props.mode === "match_action_needed") {
  return (
    <WorkflowStatePanel
      eyebrow="Action needed"
      title="We need a few track confirmations"
      description="We found tracks in this statement that may match records already in your workspace. Review them to continue processing."
      meta={<p className="text-sm text-muted-foreground">{props.unansweredTrackMatchCount} decisions remaining</p>}
      action={<Button onClick={props.onContinueMatching}>Continue</Button>}
    />
  );
}

if (props.mode === "finalizing") {
  return (
    <WorkflowStatePanel
      eyebrow="Finalizing"
      title="Applying your track decisions"
      description="We’re updating the statement and running the final validation pass."
      meta={<p className="text-sm text-muted-foreground">{props.workflowFileName}</p>}
    />
  );
}
```

- [ ] **Step 5: Re-run the workflow-card test file**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit the workflow-state rebuild**

```bash
git add src/components/reports/StatementWorkflowCard.tsx src/test/report-workflow-card.test.tsx
git commit -m "feat: redesign statements workflow states"
```

---

### Task 4: Extract and Restyle the Track Match Modal

**Files:**
- Create: `C:/Users/USER/royaltytracker/src/components/reports/StatementTrackMatchDialog.tsx`
- Modify: `C:/Users/USER/royaltytracker/src/pages/Reports.tsx`
- Test: `C:/Users/USER/royaltytracker/src/test/report-workflow-card.test.tsx`

- [ ] **Step 1: Write a failing modal test for the simplified action layout**

Add a test that renders the new dialog component with one task and verifies:

- the header text is present
- candidate rows render
- `No match` renders
- the submit button is disabled until every task has a choice

Use this shape:

```tsx
type MatchTaskView = {
  id: string;
  trackTitle: string;
  artistName: string;
  isrc: string | null;
  candidates: Array<{
    trackKey: string;
    trackTitle: string;
    artistName: string;
    isrc: string | null;
  }>;
};
```

- [ ] **Step 2: Run the test and confirm it fails**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- FAIL because `StatementTrackMatchDialog` does not exist yet

- [ ] **Step 3: Create the extracted modal component**

Create `C:/Users/USER/royaltytracker/src/components/reports/StatementTrackMatchDialog.tsx` with:

- `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`
- one stacked section per uploaded track
- flat radio rows for candidates
- `No match`
- one footer button for `Continue processing`

Keep the light product language:

- elevated light surfaces
- no dark shell
- no confidence/ranking labels
- no comparison grid

- [ ] **Step 4: Replace the inlined dialog in `Reports.tsx` with the extracted component**

In `Reports.tsx`:

- remove the large `Dialog` JSX block
- map the current `trackMatchTasks` into a view model
- pass `open`, `onOpenChange`, `tasks`, `selections`, `setSelection`, `pending`, `unansweredCount`, and `onSubmit`

- [ ] **Step 5: Run the focused test file and verify it passes**

Run:

```bash
npx vitest run src/test/report-workflow-card.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit the dialog extraction**

```bash
git add src/components/reports/StatementTrackMatchDialog.tsx src/pages/Reports.tsx src/test/report-workflow-card.test.tsx
git commit -m "refactor: extract statements track match dialog"
```

---

### Task 5: Rewire the Reports Page Around the New Components

**Files:**
- Modify: `C:/Users/USER/royaltytracker/src/pages/Reports.tsx`
- Modify: `C:/Users/USER/royaltytracker/src/lib/report-workflow.ts`
- Test: `C:/Users/USER/royaltytracker/src/test/report-workflow.test.ts`

- [ ] **Step 1: Add a failing pure-helper test if state derivation is split out**

If you add a helper for view-mode derivation, add a test like:

```ts
expect(getWorkflowMode({
  hasTrackedWorkflow: false,
  hasSelectedFile: true,
  isUploading: false,
  hasTrackMatchTasks: false,
  isSubmittingMatches: false,
})).toBe("file_selected");
```

- [ ] **Step 2: Move state-derivation logic out of the render body if it improves clarity**

If extracted, add to `src/lib/report-workflow.ts`:

```ts
export type WorkflowMode =
  | "idle"
  | "file_selected"
  | "processing"
  | "match_action_needed"
  | "finalizing";

export function getWorkflowMode(input: {
  hasTrackedWorkflow: boolean;
  hasSelectedFile: boolean;
  isUploading: boolean;
  hasTrackMatchTasks: boolean;
  isSubmittingMatches: boolean;
}): WorkflowMode {
  if (input.isSubmittingMatches) return "finalizing";
  if (input.hasTrackedWorkflow && input.hasTrackMatchTasks) return "match_action_needed";
  if (input.isUploading || input.hasTrackedWorkflow) return "processing";
  if (input.hasSelectedFile) return "file_selected";
  return "idle";
}
```

- [ ] **Step 3: Replace the current inlined workflow-card JSX with the extracted components**

In `Reports.tsx`, the render block should shrink to:

```tsx
<StatementWorkflowCard
  mode={activeWorkflowMode}
  dragActive={dragActive}
  file={file}
  statementName={statementName}
  reportPeriod={reportPeriod}
  uploadPending={uploadMutation.isPending}
  trackMatchCount={trackMatchTasks.length}
  unansweredTrackMatchCount={unansweredTrackMatchCount}
  workflowFileName={activeWorkflowFileName}
  workflowStatementName={activeWorkflowStatementName}
  workflowPeriod={activeWorkflowPeriod}
  workflowCreatedAt={activeWorkflowReport?.created_at ?? null}
  onFilePick={() => document.getElementById("statement-upload")?.click()}
  onClearFile={() => setFile(null)}
  onStatementNameChange={setStatementName}
  onReportPeriodChange={setReportPeriod}
  onUpload={() => uploadMutation.mutate()}
  onDragOver={(event) => {
    event.preventDefault();
    setDragActive(true);
  }}
  onDragLeave={() => setDragActive(false)}
  onDrop={handleDrop}
  onContinueMatching={() => setIsTrackMatchDialogOpen(true)}
/>
```

- [ ] **Step 4: Verify the table logic remains untouched except for active-workflow exclusion**

Re-check these invariants in `Reports.tsx`:

- `tableReports` excludes only `pending` and `processing`
- the top card follows `trackedWorkflowReportId`
- old processing rows do not occupy the card
- completed reports still enter the table regardless of terminal status

- [ ] **Step 5: Run the pure-helper tests and page-adjacent tests**

Run:

```bash
npx vitest run src/test/report-workflow.test.ts src/test/report-track-matching.test.ts
```

Expected:
- PASS

- [ ] **Step 6: Commit the page integration**

```bash
git add src/pages/Reports.tsx src/lib/report-workflow.ts src/test/report-workflow.test.ts
git commit -m "feat: wire statements workflow card into reports page"
```

---

### Task 6: Verify the Rebuild End to End

**Files:**
- Modify: `C:/Users/USER/royaltytracker/src/test/report-workflow-card.test.tsx`
- Verify: `C:/Users/USER/royaltytracker/src/pages/Reports.tsx`

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected:
- PASS

- [ ] **Step 2: Run a production build**

Run:

```bash
npm run build
```

Expected:
- PASS

- [ ] **Step 3: Run the dev server and manually verify the visual states**

Run:

```bash
npm run dev
```

Manually verify on `http://localhost:8080/reports`:

- idle state shows only the upload invitation
- selecting a file reveals `statement name`, `period`, and upload action
- uploading replaces the form with the processing state
- track-match detection shows only a notification and `Continue`
- modal opens with flat candidate choices and `No match`
- finalizing returns to a processing-like completion state
- completion resets the card to idle and inserts the finished report into the table

- [ ] **Step 4: Capture regressions before merging**

Check specifically for:

- any runtime icon/import errors like `ArrowUp is not defined`
- any old processing rows occupying the card on fresh page load
- any dark or chat-like visual leftovers in the light page
- any reappearance of the three-box processing dashboard

- [ ] **Step 5: Commit the final verification checkpoint**

```bash
git add src/components/reports/StatementWorkflowCard.tsx src/components/reports/StatementTrackMatchDialog.tsx src/pages/Reports.tsx src/lib/report-workflow.ts src/test/report-workflow-card.test.tsx src/test/report-workflow.test.ts
git commit -m "feat: finish statements workflow card redesign"
```

---

## Self-Review

### Spec Coverage

- Idle upload state: covered in Task 2
- File-selected state with metadata after file selection: covered in Task 2
- Processing fully replaces upload UI: covered in Task 3
- Match-needed notification plus button: covered in Task 3
- Match choices live only in modal: covered in Task 4
- Session-scoped active workflow behavior: covered in Task 5
- Final reset to idle and table handoff: covered in Task 6 manual verification

### Placeholder Scan

- No `TODO`, `TBD`, or “handle appropriately” placeholders remain
- Commands are concrete
- File paths are concrete
- Test targets are concrete

### Type Consistency

- Workflow mode names are consistent across tasks:
  - `idle`
  - `file_selected`
  - `processing`
  - `match_action_needed`
  - `finalizing`

---

## Execution Handoff

Recommended next step: implement this plan in order, starting with the component extraction so the workflow UI can be redesigned without continuing to expand `Reports.tsx`.
