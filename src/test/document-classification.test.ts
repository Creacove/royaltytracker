import { describe, expect, it } from "vitest";

import {
  classifyDocumentFamily,
  validateRowsForLane,
} from "../../supabase/functions/_shared/document-classification";

describe("document family classification", () => {
  it("classifies income reports when revenue and distribution fields are present", () => {
    const classification = classifyDocumentFamily([
      {
        track_title: "Skyline",
        platform: "Spotify",
        territory: "US",
        net_revenue: "125.33",
      },
    ]);

    expect(classification).toMatchObject({
      document_kind: "income_statement",
      parser_lane: "income",
      business_side: "recording",
    });
  });

  it("classifies rights catalogs when split metadata exists without revenue rows", () => {
    const classification = classifyDocumentFamily([
      {
        work_title: "Skyline",
        iswc: "T1234567890",
        rightsholder_name: "Nexus Music Publishing",
        share_pct: "25",
      },
    ]);

    expect(classification).toMatchObject({
      document_kind: "rights_catalog",
      parser_lane: "rights",
    });
  });

  it("keeps revenue statements in the income lane when publishing metadata is present", () => {
    const classification = classifyDocumentFamily([
      {
        track_title: "Shadow Anthem",
        artist_name: "Jude Adebayo",
        isrc: "ESVTC2426877",
        iswc: "T-273.380.303-0",
        publisher_name: "Northline Publishing",
        publisher_share: "2.07",
        platform: "Spotify",
        territory: "GB",
        gross_revenue: "6.05",
        commission: "0.75",
        net_revenue: "5.30",
      },
    ]);

    expect(classification).toMatchObject({
      document_kind: "income_statement",
      parser_lane: "income",
      business_side: "mixed",
    });
  });

  it("classifies publishing revenue without an ISRC as income, not split evidence", () => {
    const classification = classifyDocumentFamily([
      {
        work_title: "Skyline",
        iswc: "T-123.456.789-0",
        publisher_name: "Nexus Music Publishing",
        territory: "US",
        platform: "ASCAP",
        usage_count: "42",
        net_revenue: "19.25",
      },
    ]);

    expect(classification).toMatchObject({
      document_kind: "income_statement",
      parser_lane: "income",
      business_side: "publishing",
    });
  });

  it("classifies explicit split rows without revenue as split sheets", () => {
    const classification = classifyDocumentFamily([
      {
        work_title: "BAD INTENTIONS",
        iswc: "T-338.961.666.0",
        party_name: "NEXUS MUSIC PUBLISHING",
        ipi_number: "1252479349",
        source_role: "E",
        de_share: "50,0000",
        dr_share: "50,0000",
        ph_share: "50,0000",
      },
    ]);

    expect(classification).toMatchObject({
      document_kind: "split_sheet",
      parser_lane: "rights",
      business_side: "publishing",
    });
  });

  it("classifies separate revenue and split rows as mixed", () => {
    const classification = classifyDocumentFamily([
      {
        track_title: "Skyline",
        isrc: "US-AAA-25-00001",
        platform: "Spotify",
        territory: "US",
        net_revenue: "12.40",
      },
      {
        work_title: "Skyline",
        party_name: "Nexus Music Publishing",
        ipi_number: "1252479349",
        share_pct: "50",
      },
    ]);

    expect(classification).toMatchObject({
      document_kind: "mixed_statement",
      parser_lane: "mixed",
    });
  });
});

describe("lane-specific validation", () => {
  it("does not require platform or territory for rights documents", () => {
    const validation = validateRowsForLane("rights", [
      {
        work_title: "Skyline",
        iswc: "T1234567890",
        rightsholder_name: "Nexus Music Publishing",
      },
    ]);

    expect(validation.errors).toEqual([]);
  });

  it("still requires platform and territory for income rows", () => {
    const validation = validateRowsForLane("income", [
      {
        track_title: "Skyline",
        net_revenue: "12.50",
        platform: "",
        territory: "",
      },
    ]);

    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "platform" }),
        expect.objectContaining({ field: "territory" }),
      ]),
    );
  });
});
