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
  share_pct: number | null;
  territory_scope: string | null;
  valid_from: string | null;
  valid_to: string | null;
  confidence: number | null;
  review_status: "pending" | "approved" | "rejected";
  managed_party_match: boolean | null;
  raw_payload: SplitClaimInputRow;
};

export type SplitReviewClaimLike = {
  company_id?: string | null;
  work_id?: string | null;
  party_id?: string | null;
  work_title?: string | null;
  iswc?: string | null;
  source_work_code?: string | null;
  party_name?: string | null;
  ipi_number?: string | null;
  source_role?: string | null;
  canonical_rights_stream?: string | null;
  source_rights_code?: string | null;
  share_pct?: number | string | null;
  territory_scope?: string | null;
  valid_from?: string | null;
  valid_to?: string | null;
};

export type SplitClaimReviewMetadata = {
  split_group_key: string;
  split_fingerprint: string;
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

type PdfTextAtom = {
  page: number;
  x: number;
  y: number;
  text: string;
};

type PdfInflateFn = (bytes: Uint8Array) => Uint8Array;

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

function normalizeReviewToken(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeIdentifierToken(value: unknown): string | null {
  const text = asString(value);
  if (!text) return null;
  return text.trim().toLowerCase().replace(/\s+/g, "");
}

function formatFingerprintShare(value: unknown): string {
  const number = asNumber(value);
  if (number == null) return "null";
  return Number(number.toFixed(4)).toString();
}

export function buildWorkGroupKeyFromClaim(claim: SplitReviewClaimLike): string {
  const iswc = normalizeIdentifierToken(claim.iswc);
  if (iswc) return `iswc:${iswc}`;

  const sourceWorkCode = normalizeIdentifierToken(claim.source_work_code);
  if (sourceWorkCode) return `source_work_code:${sourceWorkCode}`;

  const title = normalizeReviewToken(claim.work_title);
  if (title) return `title:${title}`;

  const workId = normalizeReviewToken(claim.work_id);
  return workId ? `work_id:${workId}` : "work:unknown";
}

export function buildPartyKeyFromClaim(claim: SplitReviewClaimLike): string {
  const ipi = normalizeIdentifierToken(claim.ipi_number);
  if (ipi) return `ipi:${ipi}`;

  const partyId = normalizeIdentifierToken(claim.party_id);
  if (partyId) return `party_id:${partyId}`;

  const partyName = normalizeReviewToken(claim.party_name);
  const role = normalizeReviewToken(claim.source_role);
  if (partyName) return `name:${partyName}|role:${role ?? "unknown"}`;

  return "party:unknown";
}

export function buildSplitFingerprint(claims: SplitReviewClaimLike[]): string {
  if (claims.length === 0) return "split:empty";

  const workKey = buildWorkGroupKeyFromClaim(claims[0]);
  const territory = normalizeReviewToken(claims.find((claim) => claim.territory_scope)?.territory_scope) ?? "world";
  const validFrom = normalizeReviewToken(claims.find((claim) => claim.valid_from)?.valid_from) ?? "open";
  const validTo = normalizeReviewToken(claims.find((claim) => claim.valid_to)?.valid_to) ?? "open";
  const entries = claims
    .map((claim) => {
      const partyKey = buildPartyKeyFromClaim(claim);
      const stream =
        normalizeReviewToken(claim.canonical_rights_stream) ??
        normalizeReviewToken(claim.source_rights_code) ??
        "unknown";
      return `${partyKey}|${stream}|${formatFingerprintShare(claim.share_pct)}`;
    })
    .sort();

  return `split:${workKey}|territory:${territory}|from:${validFrom}|to:${validTo}|${entries.join(";")}`;
}

export function buildSplitClaimReviewMetadata<T extends SplitReviewClaimLike>(claims: T[]): Map<T, SplitClaimReviewMetadata> {
  const byWork = new Map<string, T[]>();
  for (const claim of claims) {
    const key = buildWorkGroupKeyFromClaim(claim);
    const bucket = byWork.get(key) ?? [];
    bucket.push(claim);
    byWork.set(key, bucket);
  }

  const metadata = new Map<T, SplitClaimReviewMetadata>();
  for (const [splitGroupKey, workClaims] of byWork.entries()) {
    const splitFingerprint = buildSplitFingerprint(workClaims);
    for (const claim of workClaims) {
      metadata.set(claim, {
        split_group_key: splitGroupKey,
        split_fingerprint: splitFingerprint,
      });
    }
  }

  return metadata;
}

function decodePdfLiteralString(value: string): string {
  return value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, escaped: string) => {
    if (/^[0-7]+$/.test(escaped)) return String.fromCharCode(parseInt(escaped, 8));
    switch (escaped) {
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "b":
        return "\b";
      case "f":
        return "\f";
      default:
        return escaped;
    }
  });
}

function bytesToBinaryString(bytes: Uint8Array): string {
  let output = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    output += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return output;
}

function binaryStringToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    bytes[i] = value.charCodeAt(i) & 0xff;
  }
  return bytes;
}

function inflatePdfStreamBytes(bytes: Uint8Array, inflate?: PdfInflateFn): Uint8Array | null {
  if (!inflate) return null;
  try {
    return inflate(bytes);
  } catch (_error) {
    return null;
  }
}

function extractPdfTextAtomsFromContent(content: string, page: number): PdfTextAtom[] {
  const atoms: PdfTextAtom[] = [];
  const blockPattern = /BT([\s\S]*?)ET/g;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(content))) {
    const block = blockMatch[1];
    const matrix = block.match(/1\s+0\s+0\s+1\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm/);
    if (!matrix) continue;

    const textParts = Array.from(block.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g))
      .map((match) => decodePdfLiteralString(match[1]))
      .join("");
    const text = textParts.replace(/\s+/g, " ").trim();
    if (!text) continue;

    atoms.push({
      page,
      x: Number(matrix[1]),
      y: Number(matrix[2]),
      text,
    });
  }

  return atoms;
}

function groupPdfRows(atoms: PdfTextAtom[]): PdfTextAtom[][] {
  const rows: PdfTextAtom[][] = [];
  for (const atom of atoms) {
    let row = rows.find((candidate) =>
      candidate[0] && candidate[0].page === atom.page && Math.abs(candidate[0].y - atom.y) <= 1.5
    );
    if (!row) {
      row = [];
      rows.push(row);
    }
    row.push(atom);
  }

  return rows
    .map((row) => row.sort((a, b) => a.x - b.x))
    .sort((a, b) => {
      const pageDelta = (a[0]?.page ?? 0) - (b[0]?.page ?? 0);
      if (pageDelta !== 0) return pageDelta;
      return (b[0]?.y ?? 0) - (a[0]?.y ?? 0);
    });
}

function textInBand(row: PdfTextAtom[], minX: number, maxX: number): string | null {
  const text = row
    .filter((atom) => atom.x >= minX && atom.x < maxX)
    .map((atom) => atom.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function parseSacemPdfRowsFromAtoms(atoms: PdfTextAtom[]): SplitClaimInputRow[] {
  const rows: SplitClaimInputRow[] = [];
  let currentWork: SacemWorkContext | null = null;
  let currentWorkHasRightsholder = false;

  for (const row of groupPdfRows(atoms)) {
    const rowText = row.map((atom) => atom.text).join(" ");
    if (/^Total\b/i.test(rowText)) continue;

    const iswc = row.find((atom) => /^T-\d{3}\.\d{3}\.\d{3}\.\d$/.test(atom.text))?.text ?? null;
    if (iswc) {
      currentWork = {
        work_title: textInBand(row, 20, 260) ?? "",
        source_work_code: textInBand(row, 260, 365) ?? "",
        work_genre: textInBand(row, 365, 510),
        iswc,
        deposit_date: normalizeSacemDate(textInBand(row, 620, 770)),
      };
      currentWorkHasRightsholder = false;
      continue;
    }

    if (!currentWork) continue;

    const role = row.find((atom) => atom.x >= 25 && atom.x < 60 && /^[A-Z]{1,3}$/.test(atom.text))?.text ?? null;
    const sourceRightsholderCode = row.find((atom) => atom.x >= 190 && atom.x < 250 && /^\d+$/.test(atom.text))?.text ?? null;
    const deShare = textInBand(row, 590, 645);
    const drShare = textInBand(row, 645, 710);
    const phShare = textInBand(row, 710, 770);

    if (!role || !sourceRightsholderCode || !deShare || !drShare || !phShare) {
      if (!currentWorkHasRightsholder && row.length === 1 && row[0].x >= 20 && row[0].x < 260) {
        currentWork.work_title = `${currentWork.work_title} ${row[0].text}`.replace(/\s+/g, " ").trim();
      }
      continue;
    }

    currentWorkHasRightsholder = true;
    rows.push({
      work_title: currentWork.work_title,
      iswc: currentWork.iswc,
      source_work_code: currentWork.source_work_code,
      work_genre: currentWork.work_genre,
      deposit_date: currentWork.deposit_date,
      party_name: textInBand(row, 65, 190) ?? textInBand(row, 250, 390),
      ipi_number: textInBand(row, 390, 465),
      source_role: role,
      source_rightsholder_code: sourceRightsholderCode,
      source_party_text: textInBand(row, 250, 390),
      society_de: textInBand(row, 465, 525),
      society_dr: textInBand(row, 525, 590),
      de_share: deShare,
      dr_share: drShare,
      ph_share: phShare,
      source_language: "fr",
      source_page: row[0]?.page ?? null,
      source_row: rows.length,
      raw_text_line: rowText,
    });
  }

  return rows;
}

export async function extractSacemCatalogueRowsFromPdfBytes(
  fileBytes: Uint8Array,
  inflate?: PdfInflateFn,
): Promise<SplitClaimInputRow[]> {
  const binary = bytesToBinaryString(fileBytes);
  const streams = Array.from(binary.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g));
  const atoms: PdfTextAtom[] = [];
  let page = 1;

  for (const match of streams) {
    const streamBytes = binaryStringToBytes(match[1]);
    const streamIndex = match.index ?? 0;
    const objectIndex = binary.lastIndexOf(" obj", streamIndex);
    const dictionaryPrefix = binary.slice(objectIndex > 0 ? objectIndex : Math.max(0, streamIndex - 5000), streamIndex);
    if (/\/Subtype\s*\/Image/.test(dictionaryPrefix)) continue;
    const inflated = dictionaryPrefix.includes("FlateDecode")
      ? inflatePdfStreamBytes(streamBytes, inflate)
      : null;
    if (dictionaryPrefix.includes("FlateDecode") && !inflated) continue;
    const decodedBytes = inflated ?? streamBytes;
    const content = bytesToBinaryString(decodedBytes);
    if (!content.includes("BT")) continue;
    const contentAtoms = extractPdfTextAtomsFromContent(content, page);
    if (contentAtoms.length > 0) {
      page += 1;
      atoms.push(...contentAtoms);
    }
  }

  return parseSacemPdfRowsFromAtoms(atoms);
}

export function extractSacemCatalogueRowsFromText(text: string): SplitClaimInputRow[] {
  const rows: SplitClaimInputRow[] = [];
  let currentWork: SacemWorkContext | null = null;
  let currentWorkHasRightsholder = false;
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
      currentWorkHasRightsholder = false;
      continue;
    }

    if (!currentWork || line.startsWith("Total ")) continue;

    const rightsholder = parseSacemRightsholderLine(line);
    if (!rightsholder) {
      if (!currentWorkHasRightsholder) {
        currentWork.work_title = `${currentWork.work_title} ${line}`.replace(/\s+/g, " ").trim();
      }
      continue;
    }
    currentWorkHasRightsholder = true;

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

function hasReviewableRightsEvidence(row: SplitClaimInputRow): boolean {
  const workTitle = coalesceString(row, ["work_title", "track_title", "title", "titre_oeuvre"]);
  const partyName = coalesceString(row, [
    "party_name",
    "rightsholder_name",
    "publisher_name",
    "writer_name",
    "track_artist",
    "release_artist",
    "nom_ayant_droit",
  ]);
  return Boolean(workTitle && partyName);
}

function fallbackRightsCode(row: SplitClaimInputRow): string {
  return coalesceString(row, [
    "source_rights_code",
    "rights_stream",
    "rights_type",
    "usage_type",
    "source_role",
    "config_type",
  ]) ?? "unknown";
}

export function buildSplitClaimsFromRows(rows: SplitClaimInputRow[], options: BuildSplitClaimOptions = {}): TypedSplitClaim[] {
  const sourceLanguage = options.source_language ?? "en";
  const reviewStatus = options.default_review_status ?? "pending";
  const claims: TypedSplitClaim[] = [];

  rows.forEach((row, index) => {
    const entries = shareEntries(row);
    if (entries.length === 0 && hasReviewableRightsEvidence(row)) {
      entries.push({ code: fallbackRightsCode(row), value: null });
    }

    for (const entry of entries) {
      const sharePct = asNumber(entry.value);
      const vocabulary = mapSourceRightsVocabulary(entry.code, sourceLanguage);
      claims.push({
        source_report_id: options.source_report_id ?? asString(row.source_report_id),
        source_row_id: options.source_row_ids?.[index] ?? asString(row.source_row_id),
        work_id: asString(row.work_id),
        party_id: asString(row.party_id),
        work_title: coalesceString(row, ["work_title", "track_title", "title", "titre_oeuvre"]),
        iswc: asString(row.iswc),
        source_work_code: coalesceString(row, ["source_work_code", "work_code", "code_oeuvre"]),
        party_name: coalesceString(row, [
          "party_name",
          "rightsholder_name",
          "publisher_name",
          "writer_name",
          "track_artist",
          "release_artist",
          "nom_ayant_droit",
        ]),
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
