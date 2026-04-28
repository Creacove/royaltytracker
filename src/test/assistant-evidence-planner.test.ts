import { describe, expect, it } from "vitest";

import {
  buildEvidencePack,
  planEvidence,
} from "../../supabase/functions/_shared/assistant-evidence";

describe("assistant evidence planner", () => {
  it("plans entitlement questions as multi-node evidence jobs", () => {
    const plan = planEvidence({
      question: "How much should Nexus Music Publishing get for BAD INTENTIONS from Q1 revenue?",
      from_date: "2026-01-01",
      to_date: "2026-03-31",
      scope_mode: "workspace",
    });

    expect(plan.family).toBe("entitlement_allocation");
    expect(plan.required_evidence).toEqual(
      expect.arrayContaining(["resolved_entities", "revenue_evidence", "split_evidence", "computed_allocations"]),
    );
    expect(plan.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining([
        "resolve_entity",
        "fetch_revenue_evidence",
        "fetch_split_evidence",
        "fetch_rights_positions",
        "compute_allocation",
        "check_evidence_quality",
      ]),
    );
    expect(plan.nodes.length).toBeGreaterThan(4);
  });

  it("plans revenue comparisons as evidence work instead of a single generic lookup", () => {
    const plan = planEvidence({
      question: "Compare Spotify revenue in Lagos and Accra this quarter",
      from_date: "2026-01-01",
      to_date: "2026-03-31",
      scope_mode: "workspace",
    });

    expect(plan.family).toBe("revenue_comparison");
    expect(plan.nodes.map((node) => node.kind)).toEqual(
      expect.arrayContaining(["resolve_entity", "fetch_revenue_evidence", "check_evidence_quality"]),
    );
    expect(plan.required_evidence).toContain("revenue_evidence");
  });
});

describe("assistant evidence pack allocation behavior", () => {
  const allocationPlan = planEvidence({
    question: "How much should Nexus get for BAD INTENTIONS?",
    from_date: "2026-01-01",
    to_date: "2026-03-31",
    scope_mode: "workspace",
  });

  it("computes estimated allocations when revenue and split evidence both exist", () => {
    const pack = buildEvidencePack(allocationPlan, {
      resolved_entities: [
        { kind: "work", label: "BAD INTENTIONS", identifiers: { work_title: "BAD INTENTIONS" } },
        { kind: "party", label: "NEXUS MUSIC PUBLISHING", identifiers: { party_name: "NEXUS MUSIC PUBLISHING" } },
      ],
      revenue_evidence: [
        {
          id: "rev_1",
          work_title: "BAD INTENTIONS",
          net_revenue: 1000,
          currency: "USD",
          rights_stream: null,
          source_ref: "royalty_transactions",
        },
      ],
      split_evidence: [
        {
          id: "split_1",
          work_title: "BAD INTENTIONS",
          party_name: "NEXUS MUSIC PUBLISHING",
          share_pct: 50,
          canonical_rights_stream: "public_performance",
          review_status: "pending",
          source_ref: "catalog_split_claims",
        },
      ],
    });

    expect(pack.computed_allocations).toEqual([
      expect.objectContaining({
        party_name: "NEXUS MUSIC PUBLISHING",
        work_title: "BAD INTENTIONS",
        allocation_amount: 500,
        allocation_label: "estimated_allocation",
        currency: "USD",
      }),
    ]);
    expect(pack.quality_flags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "pending_split_claim" }),
        expect.objectContaining({ code: "revenue_stream_missing" }),
      ]),
    );
  });

  it("reports split evidence without pretending allocation exists when revenue is missing", () => {
    const pack = buildEvidencePack(allocationPlan, {
      split_evidence: [
        {
          id: "split_1",
          work_title: "BAD INTENTIONS",
          party_name: "NEXUS MUSIC PUBLISHING",
          share_pct: 50,
          canonical_rights_stream: "public_performance",
          review_status: "approved",
          source_ref: "catalog_split_claims",
        },
      ],
    });

    expect(pack.computed_allocations).toHaveLength(0);
    expect(pack.missing_evidence).toContainEqual(expect.objectContaining({ evidence_class: "revenue_evidence" }));
  });

  it("reports revenue evidence without pretending allocation exists when split evidence is missing", () => {
    const pack = buildEvidencePack(allocationPlan, {
      revenue_evidence: [
        {
          id: "rev_1",
          work_title: "BAD INTENTIONS",
          net_revenue: 1000,
          currency: "USD",
          rights_stream: "public_performance",
          source_ref: "royalty_transactions",
        },
      ],
    });

    expect(pack.computed_allocations).toHaveLength(0);
    expect(pack.missing_evidence).toContainEqual(expect.objectContaining({ evidence_class: "split_evidence" }));
  });
});
