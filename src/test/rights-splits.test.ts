import { describe, expect, it } from "vitest";
import { deflateSync, inflateSync } from "node:zlib";

import {
  buildSplitClaimsFromRows,
  extractSacemCatalogueRowsFromPdfBytes,
  extractSacemCatalogueRowsFromText,
  mapSourceRightsVocabulary,
} from "../../supabase/functions/_shared/rights-splits";
import { classifyDocumentFamily } from "../../supabase/functions/_shared/document-classification";

describe("rights split source vocabulary", () => {
  it("maps French SACEM share labels while preserving source codes", () => {
    expect(mapSourceRightsVocabulary("DE", "fr")).toMatchObject({
      source_rights_code: "DE",
      source_rights_label: "Droits d'execution",
      canonical_rights_stream: "performance",
      source_language: "fr",
    });
    expect(mapSourceRightsVocabulary("DR", "fr")).toMatchObject({
      source_rights_code: "DR",
      canonical_rights_stream: "mechanical",
    });
    expect(mapSourceRightsVocabulary("PH", "fr")).toMatchObject({
      source_rights_code: "PH",
      canonical_rights_stream: "phonographic",
    });
  });

  it("builds one typed split claim per source share column", () => {
    const claims = buildSplitClaimsFromRows([
      {
        work_title: "BAD INTENTIONS",
        iswc: "T-338.961.895.1",
        source_work_code: "111770195467",
        party_name: "NEXUS MUSIC PUBLISHING",
        ipi_number: "1252479349",
        source_role: "E",
        de_share: "50,0000",
        dr_share: "50,0000",
        ph_share: "50,0000",
        source_page: 1,
        source_row: 7,
      },
    ], {
      source_report_id: "report_1",
      source_row_ids: ["row_1"],
      source_language: "fr",
    });

    expect(claims).toHaveLength(3);
    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_report_id: "report_1",
          source_row_id: "row_1",
          work_title: "BAD INTENTIONS",
          party_name: "NEXUS MUSIC PUBLISHING",
          ipi_number: "1252479349",
          source_role: "E",
          source_rights_code: "DE",
          canonical_rights_stream: "performance",
          share_pct: 50,
          review_status: "pending",
        }),
        expect.objectContaining({
          source_rights_code: "DR",
          canonical_rights_stream: "mechanical",
          share_pct: 50,
        }),
        expect.objectContaining({
          source_rights_code: "PH",
          canonical_rights_stream: "phonographic",
          share_pct: 50,
        }),
      ]),
    );
    expect(claims[0].raw_payload).toMatchObject({ source_page: 1, source_row: 7 });
  });

  it("keeps rights evidence reviewable even when the source has no explicit share percent", () => {
    const claims = buildSplitClaimsFromRows([
      {
        work_title: "BAD INTENTIONS",
        iswc: "T-338.961.666.0",
        source_work_code: "111770208367",
        party_name: "EKEKWE ALEXANDER",
        source_role: "Chant",
        rights_type: "Chant",
      },
    ], {
      source_report_id: "report_1",
      source_row_ids: ["row_1"],
      source_language: "fr",
    });

    expect(claims).toEqual([
      expect.objectContaining({
        source_report_id: "report_1",
        source_row_id: "row_1",
        work_title: "BAD INTENTIONS",
        party_name: "EKEKWE ALEXANDER",
        source_rights_code: "CHANT",
        share_pct: null,
        review_status: "pending",
      }),
    ]);
  });

  it("can require explicit share evidence for SACEM catalogue rows", () => {
    const claims = buildSplitClaimsFromRows([
      {
        work_title: "BELIEVE",
        iswc: "T-333.869.164.4",
        source_work_code: "111492018167",
        party_name: "EMEYOMA-ATIGBI",
        source_role: "Chant",
        rights_type: "Chant",
      },
    ], {
      source_report_id: "report_1",
      source_row_ids: ["row_1"],
      source_language: "fr",
      require_share_evidence: true,
    });

    expect(claims).toEqual([]);
  });
});

describe("rights split document classification", () => {
  it("classifies source-specific split columns as rights documents", () => {
    const classification = classifyDocumentFamily([
      {
        work_title: "BAD INTENTIONS",
        party_name: "NEXUS MUSIC PUBLISHING",
        source_role: "E",
        de_share: "50,0000",
        dr_share: "50,0000",
        ph_share: "50,0000",
        ipi_number: "1252479349",
      },
    ]);

    expect(classification).toMatchObject({
      document_kind: "split_sheet",
      parser_lane: "rights",
      business_side: "publishing",
    });
  });
});

describe("SACEM catalogue OCR parsing", () => {
  it("extracts work, party, IPI, role, and DE/DR/PH shares from catalogue text", () => {
    const rows = extractSacemCatalogueRowsFromText(`
CATALOGUE DES OEUVRES D'UN AYANT DROIT
Clé DE Clé DR Clé PH
Code oeuvre
Nom de l'ayant-droit Code IPIRôle Société en DECOAD Société en DRNom au fichier IPI
Chant T-338.961.666.0111770208367 02/03/2026BAD INTENTIONS
C 2162992 50,00000,0000 50,0000EKEKWE Alexander Pas de societe381800272EKEKWE ALEXANDER
E 1926670 50,000050,0000 50,0000SACEMNEXUS MUSIC PUBLISHING SACEM1252479349NEXUS MUSIC PUBLISHING
Total 100,000 100,000 100,000
`);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      work_title: "BAD INTENTIONS",
      iswc: "T-338.961.666.0",
      source_work_code: "111770208367",
      party_name: "EKEKWE ALEXANDER",
      ipi_number: "381800272",
      source_role: "C",
      de_share: "50,0000",
      dr_share: "0,0000",
      ph_share: "50,0000",
      source_page: 1,
    });

    const claims = buildSplitClaimsFromRows(rows, { source_language: "fr" });
    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          work_title: "BAD INTENTIONS",
          party_name: "NEXUS MUSIC PUBLISHING",
          ipi_number: "1252479349",
          source_role: "E",
          source_rights_code: "DR",
          share_pct: 50,
        }),
      ]),
    );
  });

  it("extracts real rows from the provided SACEM PDF text sample", () => {
    const rows = extractSacemCatalogueRowsFromText(`
Chant T-338.961.666.0111770208367 02/03/2026BAD INTENTIONS
C 2162992 50,00000,0000 50,0000EKEKWE Alexander Pas de societe381800272EKEKWE ALEXANDER
C 2162993 0,000050,0000 0,0000BMIEKEKWE Alexander 381800272EKEKWE ALEXANDER
E 1926670 50,000050,0000 50,0000SACEMNEXUS MUSIC PUBLISHING SACEM1252479349NEXUS MUSIC PUBLISHING
Total 100,000 100,000 100,000
Chant T-339.110.723.2111774203267 02/03/2026BAMIJO
C 2165480 50,00000,0000 50,0000SANUSI Babajide Pas de societe1331281489SANUSI BABAJIDE EMMANUEL
C 2165481 0,000050,0000 0,0000BMISANUSI Babajide 1331281489SANUSI BABAJIDE EMMANUEL
A 2165483 25,00000,0000 25,0000ADELUSI Segun Pas de societe1315535962ADELUSI SEGUN VICTOR (Pas de
A 2165484 0,000025,0000 0,0000BMIADELUSI Segun 1315535962ADELUSI SEGUN VICTOR (BMI)
E 1926670 25,000025,0000 25,0000SACEMNEXUS MUSIC PUBLISHING SACEM1252479349NEXUS MUSIC PUBLISHING
Total 100,000 100,000 100,000
Chant T-333.869.164.4111492018167 21/07/2025BELIEVE
CA 2023581 50,000066,6700 50,0000ASCAPEMEYOMA-ATIGBI Pas de societe1252825361EMEYOMA-ATIGBI
E 1926670 50,000033,3300 50,0000SACEMNEXUS MUSIC PUBLISHING SACEM1252479349NEXUS MUSIC PUBLISHING
Total 100,000 100,000 100,000
Chant T-333.336.342.7111474864967 23/06/2025BIG BIG THINGS
C 2011196 25,000033,3330 25,0000BMIDRIZZDPRODUCER Pas de societe1179495896OLALEYE ISRAEL TOLUWANI
A 2035207 25,000033,3330 50,0000PRSVIXXBUG Pas de societe1288967868TINUBU VICTOR AYOMIDE
E 1926670 50,000033,3340 25,0000SACEMNEXUS MUSIC PUBLISHING SACEM1252479349NEXUS MUSIC PUBLISHING
Total 100,000 100,000 100,000
`);

    expect(rows).toHaveLength(13);
    expect(new Set(rows.map((row) => row.work_title))).toEqual(new Set([
      "BAD INTENTIONS",
      "BAMIJO",
      "BELIEVE",
      "BIG BIG THINGS",
    ]));
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          work_title: "BELIEVE",
          iswc: "T-333.869.164.4",
          source_work_code: "111492018167",
          source_role: "CA",
          party_name: "EMEYOMA-ATIGBI",
          de_share: "50,0000",
          dr_share: "66,6700",
          ph_share: "50,0000",
        }),
        expect.objectContaining({
          work_title: "BELIEVE",
          party_name: "NEXUS MUSIC PUBLISHING",
          de_share: "50,0000",
          dr_share: "33,3300",
          ph_share: "50,0000",
        }),
      ]),
    );
  });

  it("parses SACEM rightsholder shares when all three share columns are spaced", () => {
    const rows = extractSacemCatalogueRowsFromText(`
Chant T-333.869.164.4111492018167 21/07/2025BELIEVE
CA 2023581 50,0000 66,6700 50,0000 ASCAPEMEYOMA-ATIGBI Pas de societe1252825361EMEYOMA-ATIGBI
`);

    expect(rows).toEqual([
      expect.objectContaining({
        source_role: "CA",
        de_share: "50,0000",
        dr_share: "66,6700",
        ph_share: "50,0000",
        party_name: "EMEYOMA-ATIGBI",
      }),
    ]);
  });

  it("parses SACEM catalogue rows from the PDF text layer even when the header is missing", () => {
    const rows = extractSacemCatalogueRowsFromText(`
Chant T-338.961.666.0111770208367 02/03/2026BAD INTENTIONS
C 2162992 50,00000,0000 50,0000EKEKWE Alexander Pas de societe381800272EKEKWE ALEXANDER
C 2162993 0,000050,0000 0,0000BMIEKEKWE Alexander 381800272EKEKWE ALEXANDER
E 1926670 50,000050,0000 50,0000SACEMNEXUS MUSIC PUBLISHING SACEM1252479349NEXUS MUSIC PUBLISHING
Total 100,000 100,000 100,000
Chant T-339.110.683.1111774159367 02/03/2026ATTRACTIVE
ACOUSTIC
C 2165481 0,000050,0000 0,0000BMISANUSI Babajide 1331281489SANUSI BABAJIDE EMMANUEL
E 1926670 25,000025,0000 25,0000SACEMNEXUS MUSIC PUBLISHING SACEM1252479349NEXUS MUSIC PUBLISHING
Total 100,000 100,000 100,000
`);

    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({
      work_title: "BAD INTENTIONS",
      iswc: "T-338.961.666.0",
      source_work_code: "111770208367",
      source_role: "C",
      de_share: "50,0000",
      dr_share: "0,0000",
      ph_share: "50,0000",
      party_name: "EKEKWE ALEXANDER",
    });
    expect(rows[3]).toMatchObject({
      work_title: "ATTRACTIVE ACOUSTIC",
      source_role: "C",
      dr_share: "50,0000",
    });

    const claims = buildSplitClaimsFromRows(rows, { source_language: "fr" });
    expect(claims).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          work_title: "BAD INTENTIONS",
          party_name: "EKEKWE ALEXANDER",
          source_rights_code: "DE",
          share_pct: 50,
        }),
        expect.objectContaining({
          work_title: "BAD INTENTIONS",
          party_name: "EKEKWE ALEXANDER",
          source_rights_code: "DR",
          share_pct: 0,
        }),
        expect.objectContaining({
          work_title: "ATTRACTIVE ACOUSTIC",
          party_name: "NEXUS MUSIC PUBLISHING",
          source_rights_code: "PH",
          share_pct: 25,
        }),
      ]),
    );
  });

  it("uses PDF text coordinates to assign SACEM DE, DR, and PH shares", async () => {
    const pdfContent = `%PDF-1.4
1 0 obj
<< /Length 900 >>
stream
BT 1 0 0 1 432.99 580.38 Tm (Chant)Tj ET
BT 1 0 0 1 522.48 580.38 Tm (T-338.961.666.0)Tj ET
BT 1 0 0 1 270 580.38 Tm (111770208367)Tj ET
BT 1 0 0 1 672.48 580.38 Tm (02/03/2026)Tj ET
BT 1 0 0 1 25 580.38 Tm (BAD INTENTIONS)Tj ET
BT 1 0 0 1 37.11 525.23 Tm (C)Tj ET
BT 1 0 0 1 219.43 525.23 Tm (2162992)Tj ET
BT 1 0 0 1 663.04 525.23 Tm (50,0000)Tj ET
BT 1 0 0 1 602.27 525.23 Tm (0,0000)Tj ET
BT 1 0 0 1 725.54 525.23 Tm (25,0000)Tj ET
BT 1 0 0 1 264 525.23 Tm (EKEKWE Alexander)Tj ET
BT 1 0 0 1 399.98 525.23 Tm (381800272)Tj ET
BT 1 0 0 1 74 525.23 Tm (EKEKWE ALEXANDER)Tj ET
endstream
endobj`;
    const rows = await extractSacemCatalogueRowsFromPdfBytes(new TextEncoder().encode(pdfContent));

    expect(rows).toEqual([
      expect.objectContaining({
        work_title: "BAD INTENTIONS",
        source_role: "C",
        party_name: "EKEKWE ALEXANDER",
        de_share: "50,0000",
        dr_share: "0,0000",
        ph_share: "25,0000",
      }),
    ]);
  });

  it("inflates FlateDecode PDF streams before parsing SACEM coordinates", async () => {
    const content = `BT 1 0 0 1 432.99 580.38 Tm (Chant)Tj ET
BT 1 0 0 1 522.48 580.38 Tm (T-333.869.164.4)Tj ET
BT 1 0 0 1 270 580.38 Tm (111492018167)Tj ET
BT 1 0 0 1 672.48 580.38 Tm (21/07/2025)Tj ET
BT 1 0 0 1 25 580.38 Tm (BELIEVE)Tj ET
BT 1 0 0 1 34.44 525.23 Tm (CA)Tj ET
BT 1 0 0 1 219.43 525.23 Tm (2023581)Tj ET
BT 1 0 0 1 663.04 525.23 Tm (50,0000)Tj ET
BT 1 0 0 1 600.04 525.23 Tm (66,6700)Tj ET
BT 1 0 0 1 725.54 525.23 Tm (50,0000)Tj ET
BT 1 0 0 1 264 525.23 Tm (EMEYOMA-ATIGBI)Tj ET
BT 1 0 0 1 397.76 525.23 Tm (1252825361)Tj ET
BT 1 0 0 1 74 525.23 Tm (EMEYOMA-ATIGBI)Tj ET`;
    const compressed = deflateSync(Buffer.from(content, "binary"));
    const pdfBytes = Buffer.concat([
      Buffer.from(`%PDF-1.4
1 0 obj
<< /Length ${compressed.length} /Filter /FlateDecode >>
stream
`, "binary"),
      compressed,
      Buffer.from(`
endstream
endobj`, "binary"),
    ]);

    const rows = await extractSacemCatalogueRowsFromPdfBytes(pdfBytes, (bytes) => inflateSync(Buffer.from(bytes)));

    expect(rows).toEqual([
      expect.objectContaining({
        work_title: "BELIEVE",
        source_role: "CA",
        party_name: "EMEYOMA-ATIGBI",
        de_share: "50,0000",
        dr_share: "66,6700",
        ph_share: "50,0000",
      }),
    ]);
  });
});
