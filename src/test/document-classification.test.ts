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
