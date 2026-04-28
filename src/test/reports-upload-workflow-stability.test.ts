import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pruneTrackMatchSelections } from "@/lib/report-workflow";

const read = (relativePath: string) => readFileSync(path.resolve(process.cwd(), relativePath), "utf8");

describe("reports upload workflow stability", () => {
  it("does not allocate a new selection object when track-match tasks are unchanged", () => {
    const current = { "task-1": "track-1" };

    const next = pruneTrackMatchSelections(current, ["task-1"]);

    expect(next).toBe(current);
  });

  it("uses stable empty query defaults on the Reports page", () => {
    const reportsPage = read("src/pages/Reports.tsx");

    expect(reportsPage).not.toContain("data: activeTrackMatchReviewTasks = []");
    expect(reportsPage).toContain("data: activeTrackMatchReviewTasks = EMPTY_REVIEW_TASKS");
  });
});
