import { describe, expect, it } from "vitest";

import {
  buildPartyKeyFromClaim,
  buildSplitFingerprint,
  buildWorkGroupKeyFromClaim,
} from "../../supabase/functions/_shared/rights-splits";
import { buildSplitCases } from "@/lib/split-cases";

const baseClaim = {
  id: "claim_1",
  source_report_id: "report_1",
  source_row_id: "row_1",
  work_id: null,
  party_id: null,
  work_title: "Bad Intentions",
  iswc: "T-338.961.666.0",
  source_work_code: "111770208367",
  party_name: "Nexus Music Publishing",
  ipi_number: "1252479349",
  source_role: "E",
  source_rights_code: "DE",
  source_rights_label: "Droits d'execution",
  source_language: "fr",
  canonical_rights_stream: "performance",
  share_pct: 50,
  territory_scope: null,
  valid_from: null,
  valid_to: null,
  confidence: 0.96,
  review_status: "pending",
  managed_party_match: null,
  raw_payload: {},
  created_at: "2026-05-02T08:00:00.000Z",
};

describe("split review fingerprints", () => {
  it("uses strong identifiers for work and party keys", () => {
    expect(buildWorkGroupKeyFromClaim(baseClaim)).toBe("iswc:t-338.961.666.0");
    expect(buildPartyKeyFromClaim(baseClaim)).toBe("ipi:1252479349");
  });

  it("creates the same split fingerprint when row order changes", () => {
    const writer = {
      ...baseClaim,
      id: "claim_2",
      party_name: "Ekekwe Alexander",
      ipi_number: "381800272",
      source_role: "C",
      share_pct: 50,
    };

    expect(buildSplitFingerprint([baseClaim, writer])).toBe(buildSplitFingerprint([writer, baseClaim]));
  });

  it("changes fingerprint when a party share changes", () => {
    const changedShare = { ...baseClaim, id: "claim_3", share_pct: 45 };

    expect(buildSplitFingerprint([baseClaim])).not.toBe(buildSplitFingerprint([changedShare]));
  });
});

describe("split cases", () => {
  it("groups flat split claims into document cases, works, parties, and stream shares", () => {
    const cases = buildSplitCases(
      [
        baseClaim,
        { ...baseClaim, id: "claim_2", source_rights_code: "DR", canonical_rights_stream: "mechanical" },
        {
          ...baseClaim,
          id: "claim_3",
          party_name: "Ekekwe Alexander",
          ipi_number: "381800272",
          source_role: "C",
          source_rights_code: "PH",
          canonical_rights_stream: "phonographic",
        },
        {
          ...baseClaim,
          id: "claim_4",
          party_name: "Ekekwe Alexander",
          ipi_number: "381800272",
          source_role: "C",
          source_rights_code: "DE",
          canonical_rights_stream: "performance",
        },
        {
          ...baseClaim,
          id: "claim_5",
          party_name: "Ekekwe Alexander",
          ipi_number: "381800272",
          source_role: "C",
          source_rights_code: "DR",
          canonical_rights_stream: "mechanical",
        },
        {
          ...baseClaim,
          id: "claim_6",
          source_rights_code: "PH",
          canonical_rights_stream: "phonographic",
        },
      ],
      [
        {
          id: "report_1",
          cmo_name: "SACEM",
          file_name: "split-sheet.pdf",
          status: "needs_review",
          report_period: null,
          created_at: "2026-05-02T08:00:00.000Z",
          document_kind: "split_sheet",
          business_side: "publishing",
          parser_lane: "rights",
        },
      ],
    );

    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({
      id: "report_1",
      fileName: "split-sheet.pdf",
      status: "ready_to_approve",
      workCount: 1,
      partyCount: 2,
    });
    expect(cases[0].works[0].parties[0].shares).toMatchObject({
      performance: 50,
      mechanical: 50,
    });
    expect(cases[0].works[0].parties[1].shares).toMatchObject({
      phonographic: 50,
    });
  });
});
