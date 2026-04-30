import type { DragEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FileText, Loader2, Upload, X } from "lucide-react";

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

type WorkflowStatePanelProps = {
  eyebrow: string;
  title: string;
  description: string;
  meta?: ReactNode;
  action?: ReactNode;
};

function WorkflowStatePanel({ eyebrow, title, description, meta, action }: WorkflowStatePanelProps) {
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

export function StatementWorkflowCard(props: StatementWorkflowCardProps) {
  const isIdle = props.mode === "idle";
  const isFileSelected = props.mode === "file_selected";
  const isProcessing = props.mode === "processing";
  const isMatchActionNeeded = props.mode === "match_action_needed";
  const isFinalizing = props.mode === "finalizing";

  return (
    <Card surface="hero">
      <CardContent className="space-y-4 p-4 md:p-5">
        <CardTitle className="text-[1.05rem]">Upload document</CardTitle>

        {isIdle ? (
          <div
            className="rounded-[calc(var(--radius)-2px)] border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-panel)/0.72)] px-6 py-12"
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            onDrop={props.onDrop}
          >
            <div className="mx-auto flex max-w-2xl flex-col items-center gap-4 text-center">
              <p className="type-display-section text-[1.6rem] text-foreground">
                Ready to upload a document?
              </p>
              <p className="max-w-xl text-sm leading-6 text-muted-foreground">
                Drop a revenue, split, rights, or contract file here to begin processing.
              </p>
              <Button type="button" variant="secondary" onClick={props.onFilePick}>
                <Upload className="mr-2 h-4 w-4" />
                Choose a file
              </Button>
            </div>
          </div>
        ) : null}

        {isFileSelected ? (
          <div
            className={`space-y-5 rounded-[calc(var(--radius)-2px)] border bg-[hsl(var(--surface-panel)/0.72)] px-5 py-5 transition-colors md:px-6 ${
              props.dragActive
                ? "border-[hsl(var(--brand-accent)/0.25)]"
                : "border-[hsl(var(--border)/0.08)]"
            }`}
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            onDrop={props.onDrop}
          >
            <div className="flex items-start justify-between gap-4 rounded-[calc(var(--radius)-6px)] border border-[hsl(var(--border)/0.08)] bg-[hsl(var(--surface-elevated)/0.72)] px-4 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[hsl(var(--border)/0.1)] bg-[hsl(var(--surface-panel)/0.82)] text-muted-foreground">
                  <FileText className="h-4.5 w-4.5" />
                </div>
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-base font-semibold text-foreground">{props.file?.name ?? "Selected file"}</p>
                  <p className="text-sm text-muted-foreground">Add the document details, then upload to begin processing.</p>
                </div>
              </div>

              <Button type="button" variant="ghost" size="icon" onClick={props.onClearFile} aria-label="Clear selected file">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
              <Input
                value={props.statementName}
                onChange={(event) => props.onStatementNameChange(event.target.value)}
                placeholder="Statement name"
              />
              <Input
                value={props.reportPeriod}
                onChange={(event) => props.onReportPeriodChange(event.target.value)}
                placeholder="Period"
              />
              <div className="flex gap-2 md:justify-end">
                <Button type="button" variant="quiet" onClick={props.onFilePick}>
                  Change file
                </Button>
                <Button
                  type="button"
                  onClick={props.onUpload}
                  disabled={!props.file || !props.statementName.trim() || props.uploadPending}
                >
                  {props.uploadPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        {isProcessing ? (
          <WorkflowStatePanel
            eyebrow="In progress"
            title="Processing your document"
            description="Extraction, classification, and the matching review path are running. The document will appear in the table when processing is complete."
            meta={
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{props.workflowFileName ?? "Statement file"}</p>
                {props.workflowStatementName || props.workflowPeriod ? (
                  <p className="text-sm text-muted-foreground">
                    {[props.workflowStatementName, props.workflowPeriod].filter(Boolean).join(" | ")}
                  </p>
                ) : null}
              </div>
            }
          />
        ) : null}

        {isMatchActionNeeded ? (
          <WorkflowStatePanel
            eyebrow="Action needed"
            title="We need a few track confirmations"
            description="We found tracks in this statement that may match records already in your workspace. Review them to continue processing."
            meta={
              <p className="text-sm text-muted-foreground">
                {props.unansweredTrackMatchCount} decision{props.unansweredTrackMatchCount === 1 ? "" : "s"} remaining
              </p>
            }
            action={
              <Button type="button" onClick={props.onContinueMatching}>
                Continue
              </Button>
            }
          />
        ) : null}

        {isFinalizing ? (
          <WorkflowStatePanel
            eyebrow="Finalizing"
            title="Applying your track decisions"
            description="We’re updating the statement and running the final validation pass."
            meta={
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">{props.workflowFileName ?? "Statement file"}</p>
                <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Finishing processing
                </p>
              </div>
            }
          />
        ) : null}
      </CardContent>
    </Card>
  );
}
