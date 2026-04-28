export type SourceRightsVocabulary = {
  source_rights_code: string;
  source_rights_label: string;
  source_language: string;
  canonical_rights_stream: string;
};

export type SplitClaimInputRow = Record<string, unknown>;

export type TypedSplitClaim = {
  source_report_id: string | null;
  source_row_id: string | null;
  work_id: string | null;
  party_id: string | null;
  work_title: string | null;
  iswc: string | null;
  source_work_code: string | null;
  party_name: string | null;
  ipi_number: string | null;
  source_role: string | null;
  source_rights_code: string;
  source_rights_label: string;
  source_language: string;
  canonical_rights_stream: string;
  share_pct: number;
  territory_scope: string | null;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number | null;
  review_status: "pending" | "approved" | "rejected";
  managed_party_match: boolean | null;
  raw_payload: SplitClaimInputRow;
};

type BuildSplitClaimOptions = {
  source_report_id?: string | null;
  source_row_ids?: Array<string | null>;
  source_language?: string;
  default_review_status?: "pending" | "approved" | "rejected";
};

type SacemWorkContext = {
  work_title: string;
  iswc: string;
  source_work_code: string;
  work_genre: string | null;
  deposit_date: string | null;
};

const SOURCE_VOCABULARY: Record<string, SourceRightsVocabulary> = {
  "fr:de": {
    source_rights_code: "DE",
    source_rights_label: "Droits d'execution",
    source_language: "fr",
    canonical_rights_stream: "performance",
  },
  "fr:dr": {
    source_rights_code: "DR",
    source_rights_label: "Droits de reproduction",
    source_language: "fr",
    canonical_rights_stream: "mechanical",
  },
  "fr:ph": {
    source_rights_code: "PH",
    source_rights_label: "Phonographic rights",
    source_language: "fr",
    canonical_rights_stream: "phonographic",
  },
  "en:performance": {
    source_rights_code: "PERFORMANCE",
    source_rights_label: "Performance",
    source_language: "en",
    canonical_rights_stream: "performance",
  },
  "en:mechanical": {
    source_rights_code: "MECHANICAL",
    source_rights_label: "Mechanical",
    source_language: "en",
    canonical_rights_stream: "mechanical",
  },
};

function asString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s/g, "").replace(",", ".").trim();
  if (!normalized || normalized === "-") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function coalesceString(row: SplitClaimInputRow, keys: string[]): string | null {
  for (const key of keys) {
    const value = asString(row[key]);
    if (value) return value;
  }
  return null;
}

function normalizeForSacemDetection(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

export function isSacemCatalogueText(text: string): boolean {
  const normalized = normalizeForSacemDetection(text);
  return (
    normalized.includes("CATALOGUE DES OEUVRES") &&
    normalized.includes("CLE DE") &&
    normalized.includes("CLE DR") &&
    normalized.includes("CLE PH") &&
    normalized.includes("CODE IPI")
  );
}

function normalizeSacemDate(value: string | null): string | null {
  if (!value) return null;
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function parseSacemWorkHeader(line: string): SacemWorkContext | null {
  const match = line.match(
    /^([A-Za-z][A-Za-z\s'/-]*?)\s+(T-\d{3}\.\d{3}\.\d{3}\.\d)(\d+)\s+(\d{2}\/\d{2}\/\d{4})(.+)$/,
  );
  if (!match) return null;

  return {
    work_genre: match[1].trim() || null,
    iswc: match[2].trim(),
    source_work_code: match[3].trim(),
    deposit_date: normalizeSacemDate(match[4].trim()),
    work_title: match[5].trim(),
  };
}

function parseSacemRightsholderLine(line: string): {
  source_role: string;
  source_rightsholder_code: string;
  de_share: string;
  dr_share: string;
  ph_share: string;
  ipi_number: string | null;
  party_name: string | null;
  source_party_text: string | null;
} | null {
  const match = line.match(
    /^([A-Z]{1,3})\s+(\d+)\s+(\d{1,3},\d{4})(\d{1,3},\d{4})\s+(\d{1,3},\d{4})(.+)$/,
  );
  if (!match) return null;

  const tail = match[6].trim();
  const ipiMatches = Array.from(tail.matchAll(/\d{8,12}/g));
  const ipiMatch = ipiMatches[ipiMatches.length - 1] ?? null;
  const ipiNumber = ipiMatch?.[0] ?? null;
  const sourcePartyText = ipiMatch?.index != null ? tail.slice(0, ipiMatch.index).trim() : tail;
  const partyName = ipiMatch?.index != null
    ? tail.slice(ipiMatch.index + ipiMatch[0].length).trim()
    : null;

  return {
    source_role: match[1].trim(),
    source_rightsholder_code: match[2].trim(),
    de_share: match[3].trim(),
    dr_share: match[4].trim(),
    ph_share: match[5].trim(),
    ipi_number: ipiNumber,
    party_name: partyName || sourcePartyText || null,
    source_party_text: sourcePartyText || null,
  };
}

export function extractSacemCatalogueRowsFromText(text: string): SplitClaimInputRow[] {
  if (!isSacemCatalogueText(text)) return [];

  const rows: SplitClaimInputRow[] = [];
  let currentWork: SacemWorkContext | null = null;
  let currentPage = 1;
  let sourceRow = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line) continue;

    const pageFooter = line.match(/^(\d+)\s*Page\s*:/i);
    if (pageFooter) {
      currentPage = Number(pageFooter[1]) + 1;
      continue;
    }

    const workHeader = parseSacemWorkHeader(line);
    if (workHeader) {
      currentWork = workHeader;
      continue;
    }

    if (!currentWork || line.startsWith("Total ")) continue;

    const rightsholder = parseSacemRightsholderLine(line);
    if (!rightsholder) continue;

    rows.push({
      work_title: currentWork.work_title,
      iswc: currentWork.iswc,
      source_work_code: currentWork.source_work_code,
      work_genre: currentWork.work_genre,
      deposit_date: currentWork.deposit_date,
      party_name: rightsholder.party_name,
      ipi_number: rightsholder.ipi_number,
      source_role: rightsholder.source_role,
      source_rightsholder_code: rightsholder.source_rightsholder_code,
      source_party_text: rightsholder.source_party_text,
      de_share: rightsholder.de_share,
      dr_share: rightsholder.dr_share,
      ph_share: rightsholder.ph_share,
      source_language: "fr",
      source_page: currentPage,
      source_row: sourceRow,
      raw_text_line: line,
    });
    sourceRow += 1;
  }

  return rows;
}

export function mapSourceRightsVocabulary(rawCode: string, sourceLanguage = "en"): SourceRightsVocabulary {
  const normalizedCode = rawCode.trim();
  const key = `${sourceLanguage.toLowerCase()}:${normalizedCode.toLowerCase()}`;
  const mapped = SOURCE_VOCABULARY[key] ?? SOURCE_VOCABULARY[`en:${normalizedCode.toLowerCase()}`];
  if (mapped) return mapped;
  return {
    source_rights_code: normalizedCode.toUpperCase(),
    source_rights_label: normalizedCode,
    source_language: sourceLanguage,
    canonical_rights_stream: normalizedCode.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "source_defined",
  };
}

function shareEntries(row: SplitClaimInputRow): Array<{ code: string; value: unknown }> {
  const entries = [
    { code: "DE", value: row.de_share ?? row.source_de_share ?? row["cle_de"] ?? row["clé_de"] },
    { code: "DR", value: row.dr_share ?? row.source_dr_share ?? row["cle_dr"] ?? row["clé_dr"] },
    { code: "PH", value: row.ph_share ?? row.source_ph_share ?? row["cle_ph"] ?? row["clé_ph"] },
  ].filter((entry) => asNumber(entry.value) != null);

  const genericShare = asNumber(row.share_pct ?? row.split ?? row.share);
  const genericCode = asString(row.source_rights_code ?? row.rights_stream ?? row.rights_type);
  if (genericShare != null && genericCode) {
    entries.push({ code: genericCode, value: genericShare });
  }

  return entries;
}

export function buildSplitClaimsFromRows(rows: SplitClaimInputRow[], options: BuildSplitClaimOptions = {}): TypedSplitClaim[] {
  const sourceLanguage = options.source_language ?? "en";
  const reviewStatus = options.default_review_status ?? "pending";
  const claims: TypedSplitClaim[] = [];

  rows.forEach((row, index) => {
    for (const entry of shareEntries(row)) {
      const sharePct = asNumber(entry.value);
      if (sharePct == null) continue;
      const vocabulary = mapSourceRightsVocabulary(entry.code, sourceLanguage);
      claims.push({
        source_report_id: options.source_report_id ?? asString(row.source_report_id),
        source_row_id: options.source_row_ids?.[index] ?? asString(row.source_row_id),
        work_id: asString(row.work_id),
        party_id: asString(row.party_id),
        work_title: coalesceString(row, ["work_title", "track_title", "title", "titre_oeuvre"]),
        iswc: asString(row.iswc),
        source_work_code: coalesceString(row, ["source_work_code", "work_code", "code_oeuvre"]),
        party_name: coalesceString(row, ["party_name", "rightsholder_name", "publisher_name", "writer_name", "nom_ayant_droit"]),
        ipi_number: coalesceString(row, ["ipi_number", "ipi", "code_ipi"]),
        source_role: coalesceString(row, ["source_role", "role"]),
        source_rights_code: vocabulary.source_rights_code,
        source_rights_label: vocabulary.source_rights_label,
        source_language: vocabulary.source_language,
        canonical_rights_stream: vocabulary.canonical_rights_stream,
        share_pct: sharePct,
        territory_scope: coalesceString(row, ["territory_scope", "territory"]),
        valid_from: coalesceString(row, ["valid_from", "effective_start", "period_start"]),
        valid_to: coalesceString(row, ["valid_to", "effective_end", "period_end"]),
        confidence: asNumber(row.confidence ?? row.mapping_confidence ?? row.ocr_confidence),
        review_status: reviewStatus,
        managed_party_match: typeof row.managed_party_match === "boolean" ? row.managed_party_match : null,
        raw_payload: row,
      });
    }
  });

  return claims;
}
