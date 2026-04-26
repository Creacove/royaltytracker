import { describe, expect, it, vi } from "vitest";

import {
  getWorkflowMode,
  isActiveWorkflowStatus,
  isTrackMatchTaskPayload,
  reopenFilePicker,
} from "@/lib/report-workflow";

describe("report workflow helpers", () => {
  it("treats pending and processing reports as active workflow items", () => {
    expect(isActiveWorkflowStatus("pending")).toBe(true);
    expect(isActiveWorkflowStatus("processing")).toBe(true);
    expect(isActiveWorkflowStatus("needs_review")).toBe(false);
    expect(isActiveWorkflowStatus("completed_with_warnings")).toBe(false);
  });

  it("detects track match review payloads", () => {
    expect(isTrackMatchTaskPayload({ kind: "track_match" })).toBe(true);
    expect(isTrackMatchTaskPayload({ kind: "other" })).toBe(false);
    expect(isTrackMatchTaskPayload(null)).toBe(false);
    expect(isTrackMatchTaskPayload("track_match")).toBe(false);
  });

  it("derives the workflow mode from tracked state and local upload state", () => {
    expect(
      getWorkflowMode({
        hasTrackedWorkflow: false,
        hasSelectedFile: true,
        isUploading: false,
        hasTrackMatchTasks: false,
        isSubmittingMatches: false,
      }),
    ).toBe("file_selected");

    expect(
      getWorkflowMode({
        hasTrackedWorkflow: true,
        hasSelectedFile: false,
        isUploading: false,
        hasTrackMatchTasks: true,
        isSubmittingMatches: false,
      }),
    ).toBe("match_action_needed");
  });

  it("clears the previous file selection before reopening the picker", () => {
    const click = vi.fn();
    const input = {
      value: "C:\\fakepath\\statement.csv",
      click,
    } as unknown as HTMLInputElement;

    reopenFilePicker(input);

    expect(input.value).toBe("");
    expect(click).toHaveBeenCalledOnce();
  });
});
