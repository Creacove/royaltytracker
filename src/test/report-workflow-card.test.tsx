import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StatementWorkflowCard } from "@/components/reports/StatementWorkflowCard";
import { StatementTrackMatchDialog } from "@/components/reports/StatementTrackMatchDialog";

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

  it("renders flat track match choices and disables submit until every task is answered", () => {
    render(
      <StatementTrackMatchDialog
        open
        pending={false}
        unansweredCount={1}
        tasks={[
          {
            id: "task-1",
            trackTitle: "Blinding Lights",
            artistName: "The Weeknd",
            isrc: null,
            candidates: [
              {
                trackKey: "track-1",
                trackTitle: "Blinding Lights",
                artistName: "The Weeknd",
                isrc: "USUG11904278",
              },
            ],
          },
        ]}
        selections={{}}
        onOpenChange={vi.fn()}
        onSelect={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText("Match similar tracks")).toBeInTheDocument();
    expect(screen.getAllByText("Blinding Lights").length).toBeGreaterThan(0);
    expect(screen.getByText("No match")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue processing" })).toBeDisabled();
  });
});
