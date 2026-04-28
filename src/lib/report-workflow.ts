export type WorkflowMode =
  | "idle"
  | "file_selected"
  | "processing"
  | "match_action_needed"
  | "finalizing";

export function isActiveWorkflowStatus(status: string | null | undefined): boolean {
  return status === "pending" || status === "processing";
}

export function isTrackMatchTaskPayload(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as Record<string, unknown>).kind === "track_match"
    : false;
}

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

export function reopenFilePicker(
  input: Pick<HTMLInputElement, "value" | "click"> | null | undefined,
): void {
  if (!input) return;
  input.value = "";
  input.click();
}

export function pruneTrackMatchSelections(
  current: Record<string, string>,
  activeTaskIds: readonly string[],
): Record<string, string> {
  const activeTaskIdSet = new Set(activeTaskIds);
  const nextSelections: Record<string, string> = {};

  for (const [taskId, selectedTrackKey] of Object.entries(current)) {
    if (activeTaskIdSet.has(taskId)) {
      nextSelections[taskId] = selectedTrackKey;
    }
  }

  const currentKeys = Object.keys(current);
  const nextKeys = Object.keys(nextSelections);
  if (
    currentKeys.length === nextKeys.length &&
    nextKeys.every((key) => current[key] === nextSelections[key])
  ) {
    return current;
  }

  return nextSelections;
}
