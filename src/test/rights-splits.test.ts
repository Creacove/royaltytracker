import { describe, expect, it } from "vitest";

import {
  buildSplitClaimsFromRows,
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
});
