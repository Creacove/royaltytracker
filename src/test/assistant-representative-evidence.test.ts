import { describe, expect, it } from "vitest";

import {
  selectRepresentativeSqlJob,
} from "../../supabase/functions/_shared/assistant-representative-evidence";
import { buildDecisionGradeAnswer } from "../../supabase/functions/_shared/assistant-answer-policy";

describe("assistant representative evidence selection", () => {
  it("uses territory evidence for touring even when legacy-primary returns a total revenue row first", () => {
    const representative = selectRepresentativeSqlJob({
      question: "where should this artiste tour",
      successfulSqlJobs: [
        {
          job_id: "legacy-primary",
          columns: ["net_revenue"],
          row_count: 1,
          rows: [{ net_revenue: 3208911.71 }],
        },
        {
          job_id: "territory-context",
          columns: ["territory", "net_revenue"],
          row_count: 3,
          rows: [
            { territory: "US", net_revenue: 125000 },
            { territory: "GB", net_revenue: 90000 },
            { territory: "NG", net_revenue: 70000 },
          ],
        },
      ],
      allSqlJobs: [],
    });

    expect(representative?.job_id).toBe("territory-context");

    const answer = buildDecisionGradeAnswer({
      question: "where should this artiste tour",
      mode: "artist",
      resolvedEntities: { artist_name: "Selected Artist" },
      visual: {
        type: "table",
        columns: representative?.columns ?? [],
        rows: representative?.rows ?? [],
      },
      evidence: {
        row_count: representative?.row_count ?? 0,
        from_date: "2025-01-01",
        to_date: "2026-04-30",
        provenance: ["test"],
      },
    });

    expect(answer.objective).toBe("touring");
    expect(answer.quality_outcome).toBe("pass");
    expect(answer.executive_answer).not.toMatch(/can't shortlist|no territory-level/i);
    expect(answer.executive_answer).toMatch(/United States|US|United Kingdom|GB|Nigeria|NG/);
  });
});
