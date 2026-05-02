import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { parse as parseCsv } from "https://deno.land/std@0.168.0/encoding/csv.ts";
import * as XLSX from "https://esm.sh/xlsx@0.18.5?target=deno";
import { classifyDocumentFamily, rowHasExplicitSplitSignal, rowHasRevenueSignal, type ParserLane } from "../_shared/document-classification.ts";
import {
  buildSplitClaimReviewMetadata,
  buildSplitClaimsFromRows,
  extractSacemCatalogueRowsFromPdfBytes,
  extractSacemCatalogueRowsFromText,
} from "../_shared/rights-splits.ts";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── Google Document AI ──────────────────────────────────────────────

function parseJwtClaims(token: string): { role?: string; sub?: string; user_id?: string } | null {
  // JWTs are typically verified by the Supabase gateway (unless deployed with --no-verify-jwt).
  // We only decode claims to identify the caller and enforce ownership checks.
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json = atob(b64 + pad);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

async function getAccessToken(serviceAccountJson: string): Promise<string> {
  // Secret is expected to be the full service account JSON.
  // Keep parsing resilient to common secret-manager quoting/escaping.
  let cleaned = serviceAccountJson.trim();

  // Remove wrapping quotes if the entire value is quoted.
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1);
  }

  let sa: any;
  try {
    sa = JSON.parse(cleaned);
    // Some secret managers store JSON as a JSON-encoded string: "\"{...}\""
    if (typeof sa === "string") sa = JSON.parse(sa);
  } catch (e) {
    console.error(
      "[process-report] Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY. First 100 chars:",
      cleaned.substring(0, 100)
    );
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON.");
  }

  if (!sa?.client_email || !sa?.private_key) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_KEY must include client_email and private_key.");
  }

  // Normalize private key newlines if they were double-escaped.
  sa.private_key = String(sa.private_key).replace(/\\n/g, "\n");

  const toBase64Url = (input: string | Uint8Array): string => {
    const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
    // Convert bytes -> binary string for btoa
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  };

  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );

  const unsignedToken = `${header}.${payload}`;

  // Import the private key
  const pemContent = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binaryDer = Uint8Array.from(atob(pemContent), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    "pkcs8",
    binaryDer.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsignedToken)
  );

  const sig = toBase64Url(new Uint8Array(signature));
  const jwt = `${unsignedToken}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    // Use URLSearchParams to ensure `assertion` is properly URL-encoded.
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }).toString(),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Failed to get access token: ${errText}`);
  }

  const data = await resp.json();
  return data.access_token;
}

interface BBox {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

interface ParsedTable {
  page_number: number;
  headers: { text: string; bbox: BBox }[];
  rows: Record<string, { value: string; bbox: BBox; confidence: number }>[];
}

function extractBBox(vertices: { x?: number; y?: number }[]): BBox {
  const xs = vertices.map((v) => v.x ?? 0);
  const ys = vertices.map((v) => v.y ?? 0);
  return {
    x_min: Math.min(...xs),
    y_min: Math.min(...ys),
    x_max: Math.max(...xs),
    y_max: Math.max(...ys),
  };
}

function getTextFromLayout(
  layout: any,
  fullText: string
): string {
  if (!layout?.textAnchor?.textSegments) return "";
  let text = "";
  for (const seg of layout.textAnchor.textSegments) {
    const start = parseInt(seg.startIndex ?? "0", 10);
    const end = parseInt(seg.endIndex ?? "0", 10);
    text += fullText.slice(start, end);
  }
  return text.trim();
}

function parseDocumentAIResponse(document: any): ParsedTable[] {
  const fullText: string = document.text || "";
  const tables: ParsedTable[] = [];
  const pages = Array.isArray(document?.pages) ? document.pages : [];

  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx];
    const pageNum = pageIdx + 1;

    for (const table of page.tables || []) {
      const headers: { text: string; bbox: BBox }[] = [];
      if (table.headerRows?.[0]) {
        for (const cell of table.headerRows[0].cells) {
          const text = getTextFromLayout(cell.layout, fullText);
          const bbox = extractBBox(
            cell.layout?.boundingPoly?.normalizedVertices || []
          );
          headers.push({ text, bbox });
        }
      }

      const rows: Record<
        string,
        { value: string; bbox: BBox; confidence: number }
      >[] = [];
      for (const bodyRow of table.bodyRows || []) {
        const rowData: Record<
          string,
          { value: string; bbox: BBox; confidence: number }
        > = {};
        for (let ci = 0; ci < (bodyRow.cells || []).length; ci++) {
          const cell = bodyRow.cells[ci];
          const colName =
            ci < headers.length ? headers[ci].text : `col_${ci}`;
          rowData[colName] = {
            value: getTextFromLayout(cell.layout, fullText),
            bbox: extractBBox(
              cell.layout?.boundingPoly?.normalizedVertices || []
            ),
            confidence: cell.layout?.confidence ?? 0,
          };
        }
        rows.push(rowData);
      }

      tables.push({ page_number: pageNum, headers, rows });
    }
  }

  return tables;
}

// ─── Table Reconstruction & Column Mapping ───────────────────────────

const COLUMN_MAPPINGS: Record<string, string> = {
  ISRC: "isrc",
  ISWC: "iswc",
  UPC: "upc",
  "TRACK TITLE": "track_title",
  TRACK: "track_title",
  SONG: "track_title",
  TITLE: "track_title",
  "TRACK ARTIST": "track_artist",
  ARTIST: "track_artist",
  ALBUM: "release_title",
  RELEASE: "release_title",
  TERRITORY: "territory",
  COUNTRY: "territory",
  PLATFORM: "platform",
  DSP: "platform",
  SERVICE: "platform",
  CHANNEL: "platform",
  UNITS: "usage_count",
  PLAYS: "usage_count",
  STREAMS: "usage_count",
  QUANTITY: "usage_count",
  "GROSS REVENUE": "gross_revenue",
  GROSS: "gross_revenue",
  "TOTAL REVENUE": "gross_revenue",
  "NET REVENUE": "net_revenue",
  NET: "net_revenue",
  COMMISSION: "commission",
  FEE: "commission",
  "YOUR SHARE": "publisher_share",
  "PUBLISHER SHARE": "publisher_share",
  SHARE: "publisher_share",
  "START DATE": "sales_start",
  "SALES START": "sales_start",
  "END DATE": "sales_end",
  "SALES END": "sales_end",
  "REPORT DATE": "report_date",
  "ORIGINAL CURRENCY": "currency_original",
  "REPORTING CURRENCY": "currency_reporting",
  "AMOUNT IN ORIGINAL CURRENCY": "amount_original",
  "AMOUNT IN REPORTING CURRENCY": "amount_reporting",
  "EXCHANGE RATE": "exchange_rate",
  "RIGHTS TYPE": "rights_type",
  "CONFIG TYPE": "usage_type",
  UNIT: "quantity_unit",
  "USAGE TYPE": "usage_type",
  LABEL: "label_name",
  PUBLISHER: "publisher_name",
  "WORK TITLE": "work_title",
  "TITRE DE L'OEUVRE": "work_title",
  "TITRE DE L OEUVRE": "work_title",
  "CODE OEUVRE": "source_work_code",
  "NOM DE L'AYANT-DROIT": "party_name",
  "NOM DE L AYANT DROIT": "party_name",
  "CODE IPI": "ipi_number",
  IPI: "ipi_number",
  ROLE: "source_role",
  "RÔLE": "source_role",
  "CLE DE": "de_share",
  "CLÉ DE": "de_share",
  "CLE DR": "dr_share",
  "CLÉ DR": "dr_share",
  "CLE PH": "ph_share",
  "CLÉ PH": "ph_share",
  DE: "de_share",
  DR: "dr_share",
  PH: "ph_share",
};

const TRANSACTION_SIGNAL_FIELDS = [
  "track_title",
  "track_artist",
  "artist_name",
  "isrc",
  "iswc",
  "platform",
  "territory",
  "usage_count",
  "gross_revenue",
  "net_revenue",
  "commission",
  "publisher_share",
  "release_title",
  "work_title",
  "party_name",
  "ipi_number",
  "source_role",
  "source_work_code",
  "de_share",
  "dr_share",
  "ph_share",
] as const;

const STANDARD_TRANSACTION_FIELDS = new Set<string>([
  "track_title",
  "track_artist",
  "artist_name",
  "release_title",
  "label_name",
  "publisher_name",
  "isrc",
  "iswc",
  "upc",
  "platform",
  "territory",
  "usage_count",
  "usage_type",
  "gross_revenue",
  "commission",
  "net_revenue",
  "publisher_share",
  "sales_start",
  "sales_end",
  "period_start",
  "period_end",
  "report_date",
  "currency",
  "currency_original",
  "currency_reporting",
  "exchange_rate",
  "amount_original",
  "amount_reporting",
  "quantity",
  "work_title",
  "party_name",
  "ipi_number",
  "source_role",
  "source_work_code",
  "de_share",
  "dr_share",
  "ph_share",
]);

const DOCUMENT_AI_ITEM_FIELDS = [
  "report_item",
  "amount_in_original_currency",
  "amount_in_reporting_currency",
  "channel",
  "config_type",
  "usage_type",
  "country",
  "exchange_rate",
  "isrc",
  "label",
  "master_commission",
  "original_currency",
  "quantity",
  "release_artist",
  "release_title",
  "release_upc",
  "report_date",
  "reporting_currency",
  "royalty_revenue",
  "sales_end",
  "sales_start",
  "track_artist",
  "track_title",
  "unit",
] as const;

type DocumentAiItemField = (typeof DOCUMENT_AI_ITEM_FIELDS)[number];

type DocumentAiReportItem = {
  [K in DocumentAiItemField]: string | null;
} & {
  source_page: number | null;
  item_index: number;
  ocr_confidence: number | null;
  raw_entity: Record<string, unknown> | null;
};

const DOCUMENT_AI_ITEM_FIELD_SET = new Set<string>(DOCUMENT_AI_ITEM_FIELDS);

type EntityPoint = {
  field: string;
  value: string;
  page: number | null;
  y: number;
  x: number;
  bbox?: BBox | null;
  conf: number;
  idx: number;
};

// Custom Extractor labels should map to document_ai_report_items fields directly.
// We keep this mapper separate from generic column mapping to avoid remapping
// labels like `country` -> `territory` and dropping them from extracted rows.
const DOCUMENT_AI_FIELD_ALIASES: Record<string, DocumentAiItemField> = {
  territory: "country",
  platform: "channel",
  usage_count: "quantity",
  commission: "master_commission",
  label_name: "label",
  upc: "release_upc",
  artist_name: "track_artist",
};

function normalizeFieldToken(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function mapDocumentAiField(raw: string): string {
  const normalized = normalizeFieldToken(raw);

  if (DOCUMENT_AI_ITEM_FIELD_SET.has(normalized)) return normalized;
  if (DOCUMENT_AI_FIELD_ALIASES[normalized]) return DOCUMENT_AI_FIELD_ALIASES[normalized];

  // Backward-compatibility: if older mapping logic yields a known alias.
  const legacyMapped = mapColumnName(raw);
  if (DOCUMENT_AI_ITEM_FIELD_SET.has(legacyMapped)) return legacyMapped;
  if (DOCUMENT_AI_FIELD_ALIASES[legacyMapped]) return DOCUMENT_AI_FIELD_ALIASES[legacyMapped];

  return normalized;
}

const HEADER_KEYWORDS = [
  "ISRC",
  "REVENUE",
  "TERRITORY",
  "PLATFORM",
  "TRACK",
  "ARTIST",
  "TITLE",
  "STREAM",
  "PLAY",
  "USAGE",
];

function mapColumnName(raw: string): string {
  const clean = raw.toUpperCase().trim();
  if (COLUMN_MAPPINGS[clean]) return COLUMN_MAPPINGS[clean];
  for (const [pattern, standard] of Object.entries(COLUMN_MAPPINGS)) {
    if (clean.includes(pattern)) return standard;
  }
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_");
}

function detectHeaders(headers: { text: string }[]): boolean {
  const headerText = headers.map((h) => h.text.toUpperCase()).join(" ");
  const matchCount = HEADER_KEYWORDS.filter((kw) =>
    headerText.includes(kw)
  ).length;
  return matchCount >= 3;
}

function isSummaryRow(row: Record<string, any>): boolean {
  // Safer summary check: only flag if the row *starts* with a summary keyword
  // or if the value is EXACTLY a summary keyword.
  // This prevents "Total Eclipse of the Heart" from being dropped.
  for (const v of Object.values(row)) {
    if (typeof v === "string") {
      const upper = v.toUpperCase().trim();
      const keywords = ["TOTAL", "SUBTOTAL", "SUM", "GRAND TOTAL"];
      // Strict check: cell IS the keyword, or starts with keyword + colon/space
      if (keywords.some(kw => upper === kw || upper.startsWith(kw + ":"))) {
        return true;
      }
    }
  }
  return false;
}

function isSummaryOrLikelyNonDataRow(row: Record<string, any>): boolean {
  // Use the same safer summary check
  if (isSummaryRow(row)) return true;

  // Removed the strict !row.isrc && !row.track_title check.
  // We now rely on hasTransactionSignal to keep everything with at least one value.
  return false;
}

function hasTransactionSignal(row: Record<string, any>): boolean {
  // Relaxed signal check: allow ANY non-empty string value to qualify a row as potential data.
  // We will filter out purely empty rows, but keep rows with even 1 weak signal.
  // The validation step will flag rows with missing critical fields.
  for (const key of Object.keys(row)) {
    if (key.startsWith("_") || key === "source_page" || key === "source_row" || key === "ocr_confidence") continue;
    const value = row[key];
    if (value != null && String(value).trim() !== "") return true;
  }
  return false;
}

interface TransactionRow {
  [key: string]: any;
}

function reconstructTables(tables: ParsedTable[]): TransactionRow[] {
  let headerMemory: string[] | null = null;
  const allRows: TransactionRow[] = [];

  for (const table of tables) {
    const hasHeaders = detectHeaders(table.headers);
    if (hasHeaders) {
      headerMemory = table.headers.map((h) => mapColumnName(h.text));
    } else if (!headerMemory) {
      continue;
    }

    for (let ri = 0; ri < table.rows.length; ri++) {
      const rowData = table.rows[ri];
      const record: TransactionRow = {
        source_page: table.page_number,
        source_row: ri,
      };

      const keys = Object.keys(rowData);
      const headers = headerMemory!;
      const bboxes: Record<string, BBox> = {};
      let confidenceSum = 0;
      let confidenceCount = 0;

      for (let ci = 0; ci < headers.length; ci++) {
        if (ci < keys.length) {
          const cell = rowData[keys[ci]];
          record[headers[ci]] = cell.value;
          bboxes[headers[ci]] = cell.bbox;
          if (cell.confidence > 0) {
            confidenceSum += cell.confidence;
            confidenceCount++;
          }
        }
      }

      record._bboxes = bboxes;
      record.ocr_confidence =
        confidenceCount > 0 ? confidenceSum / confidenceCount : 0;

      if (!isSummaryOrLikelyNonDataRow(record)) {
        allRows.push(record);
      }
    }
  }

  return allRows;
}

function getEntityText(entity: any): string {
  if (!entity) return "";
  if (typeof entity.mentionText === "string" && entity.mentionText.trim()) {
    return entity.mentionText.trim();
  }

  const nv = entity.normalizedValue;
  if (nv == null) return "";
  if (typeof nv.text === "string" && nv.text.trim()) return nv.text.trim();
  if (typeof nv.integerValue === "number" || typeof nv.integerValue === "string") {
    return String(nv.integerValue);
  }
  if (typeof nv.floatValue === "number" || typeof nv.floatValue === "string") {
    return String(nv.floatValue);
  }
  if (typeof nv.booleanValue === "boolean") return String(nv.booleanValue);
  if (typeof nv.dateValue === "object" && nv.dateValue) {
    const y = nv.dateValue.year ?? "";
    const m = String(nv.dateValue.month ?? "").padStart(2, "0");
    const d = String(nv.dateValue.day ?? "").padStart(2, "0");
    const asDate = `${y}-${m}-${d}`.replace(/^-|-$/g, "");
    if (asDate !== "--" && asDate !== "") return asDate;
  }
  if (typeof nv.moneyValue === "object" && nv.moneyValue) {
    const units = Number(nv.moneyValue.units ?? 0);
    const nanos = Number(nv.moneyValue.nanos ?? 0);
    return String(units + nanos / 1_000_000_000);
  }

  return "";
}

function getEntityPage(entity: any): number | null {
  const pageRef = entity?.pageAnchor?.pageRefs?.[0];
  if (!pageRef) return null;
  if (typeof pageRef.page === "number") return pageRef.page + 1;
  const p = parseInt(String(pageRef.page ?? ""), 10);
  return isNaN(p) ? null : p + 1;
}

function getEntityBBox(entity: any): BBox | null {
  const vertices = entity?.pageAnchor?.pageRefs?.[0]?.boundingPoly?.normalizedVertices;
  if (!Array.isArray(vertices) || vertices.length === 0) return null;
  return extractBBox(vertices);
}

function flattenEntityProperties(entity: any): any[] {
  const out: any[] = [];
  const stack = Array.isArray(entity?.properties) ? [...entity.properties] : [];
  while (stack.length > 0) {
    const next = stack.shift();
    if (!next) continue;
    out.push(next);
    if (Array.isArray(next.properties) && next.properties.length > 0) {
      stack.push(...next.properties);
    }
  }
  return out;
}

function createEmptyDocumentAiReportItem(index: number): DocumentAiReportItem {
  const row: Record<string, unknown> = {
    source_page: null,
    item_index: index,
    ocr_confidence: null,
    raw_entity: null,
  };
  for (const field of DOCUMENT_AI_ITEM_FIELDS) {
    row[field] = null;
  }
  return row as DocumentAiReportItem;
}

function hasAnyDocumentAiField(row: DocumentAiReportItem): boolean {
  for (const field of DOCUMENT_AI_ITEM_FIELDS) {
    const value = row[field];
    if (typeof value === "string" && value.trim() !== "") return true;
  }
  return false;
}

function extractDocumentAiReportItems(document: any): DocumentAiReportItem[] {
  const entities = Array.isArray(document?.entities) ? document.entities : [];
  if (entities.length === 0) return [];

  const reportItemEntities = entities.filter(
    (entity: any) => mapColumnName(String(entity?.type ?? "")) === "report_item"
  );

  // Preferred path for Custom Extractor: top-level report_item entities with nested properties.
  if (reportItemEntities.length > 0) {
    const rows: DocumentAiReportItem[] = [];
    for (const [index, entity] of reportItemEntities.entries()) {
      const row = createEmptyDocumentAiReportItem(index);
      row.source_page = getEntityPage(entity);
      row.ocr_confidence = Number(entity?.confidence ?? 0) || null;
      row.raw_entity = null;

      const reportItemText = getEntityText(entity);
      if (reportItemText) row.report_item = reportItemText;

      const props = flattenEntityProperties(entity);
      for (const prop of props) {
        const field = mapDocumentAiField(String(prop?.type ?? ""));
        if (!DOCUMENT_AI_ITEM_FIELD_SET.has(field)) continue;
        const value = getEntityText(prop);
        if (!value) continue;
        (row as any)[field] = value;
      }

      if (hasAnyDocumentAiField(row)) rows.push(row);
    }
    if (rows.length > 0) return rows;
  }

  // Fallback path: flat entity list grouped by page + row-like y position.
  const points = entities
    .map((entity: any, idx: number) => {
      const field = mapDocumentAiField(String(entity?.type ?? ""));
      if (!DOCUMENT_AI_ITEM_FIELD_SET.has(field)) return null;
      const value = getEntityText(entity);
      if (!value) return null;
      const bbox = getEntityBBox(entity);
      return {
        field,
        value,
        page: getEntityPage(entity),
        y: bbox?.y_min ?? Number.MAX_SAFE_INTEGER,
        x: bbox?.x_min ?? Number.MAX_SAFE_INTEGER,
        conf: Number(entity?.confidence ?? 0),
        idx,
      };
    })
    .filter((v: EntityPoint | null): v is EntityPoint => v !== null)
    .sort((a: EntityPoint, b: EntityPoint) => {
      if ((a.page ?? 0) !== (b.page ?? 0)) return (a.page ?? 0) - (b.page ?? 0);
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return a.idx - b.idx;
    });

  if (points.length === 0) return [];

  const grouped = new Map<string, DocumentAiReportItem>();
  for (const point of points) {
    const key = `${point.page ?? 0}:${Math.round(point.y * 100)}`;
    if (!grouped.has(key)) {
      const row = createEmptyDocumentAiReportItem(grouped.size);
      row.source_page = point.page;
      row.raw_entity = null;
      grouped.set(key, row);
    }
    const row = grouped.get(key)!;
    (row as any)[point.field] = point.value;
    row.ocr_confidence = (row.ocr_confidence ?? 0) + (point.conf > 0 ? point.conf : 0);
  }

  const rows = Array.from(grouped.values())
    .map((row) => {
      row.ocr_confidence = null;
      return row;
    })
    .filter(hasAnyDocumentAiField);

  return rows;
}

function reconstructEntities(document: any): TransactionRow[] {
  const entities = Array.isArray(document?.entities) ? document.entities : [];
  if (entities.length === 0) return [];

  const rows: TransactionRow[] = [];

  // Pattern A: row-like entities with nested properties.
  for (const [ri, entity] of entities.entries()) {
    const props = Array.isArray(entity?.properties) ? entity.properties : [];
    if (props.length === 0) continue;

    const record: TransactionRow = {
      source_page: getEntityPage(entity),
      source_row: ri,
    };
    const bboxes: Record<string, BBox> = {};
    let confidenceSum = 0;
    let confidenceCount = 0;

    for (const prop of props) {
      const mapped = mapColumnName(String(prop?.type ?? ""));
      const value = getEntityText(prop);
      if (!mapped || !value) continue;

      record[mapped] = value;
      const bbox = getEntityBBox(prop);
      if (bbox) bboxes[mapped] = bbox;

      const conf = Number(prop?.confidence ?? 0);
      if (conf > 0) {
        confidenceSum += conf;
        confidenceCount++;
      }
    }

    if (Object.keys(bboxes).length > 0) record._bboxes = bboxes;
    record.ocr_confidence = confidenceCount > 0 ? confidenceSum / confidenceCount : 0;

    if (Object.keys(record).length > 2 && !isSummaryRow(record) && hasTransactionSignal(record)) {
      rows.push(record);
    }
  }
  if (rows.length > 0) return rows;

  // Pattern B: flat entities (no nested properties). Group by page + y-position.
  const fieldPoints = entities
    .map((entity: any, idx: number) => {
      const field = mapColumnName(String(entity?.type ?? ""));
      const value = getEntityText(entity);
      const bbox = getEntityBBox(entity);
      if (!field || !value) return null;
      return {
        field,
        value,
        page: getEntityPage(entity),
        y: bbox?.y_min ?? Number.MAX_SAFE_INTEGER,
        x: bbox?.x_min ?? Number.MAX_SAFE_INTEGER,
        bbox,
        conf: Number(entity?.confidence ?? 0),
        idx,
      };
    })
    .filter((v: EntityPoint | null): v is EntityPoint => v !== null)
    .sort((a: EntityPoint, b: EntityPoint) => {
      if ((a.page ?? 0) !== (b.page ?? 0)) return (a.page ?? 0) - (b.page ?? 0);
      if (a.y !== b.y) return a.y - b.y;
      if (a.x !== b.x) return a.x - b.x;
      return a.idx - b.idx;
    });

  if (fieldPoints.length === 0) return [];

  const grouped = new Map<string, TransactionRow>();
  for (const point of fieldPoints) {
    const rowKey = `${point.page ?? 0}:${Math.round(point.y * 100)}`;
    if (!grouped.has(rowKey)) {
      grouped.set(rowKey, {
        source_page: point.page,
        source_row: grouped.size,
        _bboxes: {},
        ocr_confidence: 0,
        _conf_count: 0,
      } as TransactionRow);
    }
    const row = grouped.get(rowKey)!;
    row[point.field] = point.value;
    if (point.bbox) row._bboxes[point.field] = point.bbox;
    if (point.conf > 0) {
      row.ocr_confidence += point.conf;
      row._conf_count += 1;
    }
  }

  const flattened = Array.from(grouped.values())
    .map((r) => {
      const confCount = Number(r._conf_count ?? 0);
      if (confCount > 0) {
        r.ocr_confidence = Number(r.ocr_confidence ?? 0) / confCount;
      } else {
        r.ocr_confidence = 0;
      }
      delete r._conf_count;
      if (r._bboxes && Object.keys(r._bboxes).length === 0) delete r._bboxes;
      return r;
    })
    .filter((r) => !isSummaryRow(r) && hasTransactionSignal(r));

  return flattened;
}

// ─── Normalization ───────────────────────────────────────────────────

const TERRITORY_MAP: Record<string, string> = {
  UK: "GB",
  USA: "US",
  "UNITED STATES": "US",
  "UNITED KINGDOM": "GB",
  ENGLAND: "GB",
  SCOTLAND: "GB",
  WALES: "GB",
  "NORTHERN IRELAND": "GB",
  "SOUTH KOREA": "KR",
  KOREA: "KR",
  HOLLAND: "NL",
  NETHERLANDS: "NL",
};

function normalizeISRC(isrc: string | null | undefined): string | null {
  if (!isrc) return null;
  const clean = isrc.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (clean.length !== 12) return null;
  return `${clean.slice(0, 2)}-${clean.slice(2, 5)}-${clean.slice(5, 7)}-${clean.slice(7, 12)}`;
}

function normalizeTerritory(t: string | null | undefined): string | null {
  if (!t) return null;
  const clean = t.trim().toUpperCase();
  return TERRITORY_MAP[clean] || (clean.length === 2 ? clean : clean);
}

const PLATFORM_PATTERNS: [RegExp, string][] = [
  [/spotify/i, "Spotify"],
  [/apple.*music/i, "Apple Music"],
  [/youtube/i, "YouTube"],
  [/deezer/i, "Deezer"],
  [/tidal/i, "Tidal"],
  [/amazon.*music/i, "Amazon Music"],
  [/pandora/i, "Pandora"],
];

function normalizePlatform(p: string | null | undefined): string | null {
  if (!p) return null;
  for (const [re, name] of PLATFORM_PATTERNS) {
    if (re.test(p)) return name;
  }
  return p.trim();
}

function parseCurrency(value: any): number | null {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  const isNegative = str.includes("(") && str.includes(")");
  let clean = str.replace(/[^\d.,-]/g, "");
  if (!clean) return null;

  // Handle European vs US format
  if (clean.includes(",") && clean.includes(".")) {
    if (clean.lastIndexOf(",") > clean.lastIndexOf(".")) {
      clean = clean.replace(/\./g, "").replace(",", ".");
    } else {
      clean = clean.replace(/,/g, "");
    }
  } else if (clean.includes(",")) {
    const parts = clean.split(",");
    if (parts[parts.length - 1].length <= 3) {
      clean = clean.replace(/,/g, "");
    } else {
      clean = clean.replace(",", ".");
    }
  }

  const num = parseFloat(clean);
  if (isNaN(num)) return null;
  return isNegative ? -num : num;
}

function normalizeCurrencyCode(value: any): string | null {
  if (value == null || value === "") return null;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;

  const lettersOnly = raw.replace(/[^A-Z]/g, "");
  if (lettersOnly.length === 3) return lettersOnly;
  if (raw.length === 3 && /^[A-Z]{3}$/.test(raw)) return raw;
  return null;
}

function normalizeRightsStream(value: unknown): "performance" | "mechanical" | "sync" | "phonographic" | "other" | "unknown" {
  if (value == null || value === "") return "unknown";
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("mechanical") || normalized.includes("reproduction") || normalized === "dr") return "mechanical";
  if (normalized.includes("performance") || normalized.includes("execution") || normalized === "de") return "performance";
  if (normalized.includes("sync") || normalized.includes("synchronization")) return "sync";
  if (normalized.includes("phonographic") || normalized.includes("master") || normalized === "ph") return "phonographic";
  return "other";
}

function hasSplitShareEvidence(row: TransactionRow): boolean {
  const shareValues = [
    row.de_share,
    row.dr_share,
    row.ph_share,
    row.share_pct,
    row.split,
    row.share,
  ];
  return shareValues.some((value) => {
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value !== "string") return false;
    const normalized = value.replace(/\s/g, "").replace(",", ".").trim();
    return /^-?\d+(?:\.\d+)?$/.test(normalized);
  });
}

function inferRightsFamily(row: TransactionRow): "publishing" | "recording" | "neighboring" | "mixed" | "unknown" {
  if (row.isrc) return "recording";
  if (row.iswc && (row.track_title || row.release_title || row.upc)) return "mixed";
  if (row.iswc || row.work_title || row.party_name || row.publisher_name || row.source_work_code) return "publishing";
  if (row.track_title || row.release_title || row.upc) return "recording";
  return "unknown";
}

function inferAssetClass(row: TransactionRow): "recording" | "work" | "unknown" {
  if (row.isrc) return "recording";
  if (row.iswc || row.work_title || row.source_work_code) return "work";
  return "unknown";
}

function parseDate(value: any): string | null {
  if (value == null || value === "") return null;
  const str = String(value).trim();
  if (!str) return null;

  // Try to parse various date formats
  // Expected formats: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, MM-DD-YYYY

  // First try ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Try MM/DD/YYYY or MM-DD-YYYY
  const usMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (usMatch) {
    const [, month, day, year] = usMatch;
    const parsed = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split("T")[0];
    }
  }

  // Try DD/MM/YYYY (European) - assume if first number > 12
  const euMatch = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (euMatch) {
    const [, day, month, year] = euMatch;
    const dayNum = parseInt(day);
    const monthNum = parseInt(month);
    // If first number > 12, it's likely day
    if (dayNum > 12) {
      const parsed = new Date(parseInt(year), monthNum - 1, dayNum);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split("T")[0];
      }
    }
  }

  // Try generic JavaScript Date parsing
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split("T")[0];
  }

  return null;
}

function normalizeRow(row: TransactionRow): TransactionRow {
  const r = { ...row };
  r.territory_raw =
    typeof r.territory === "string" && r.territory.trim() !== ""
      ? r.territory.trim()
      : r.territory_raw ?? null;
  r.isrc = normalizeISRC(r.isrc);
  r.territory = normalizeTerritory(r.territory);
  r.platform = normalizePlatform(r.platform);

  // Preserve dual-currency financials from extractor/structured rows.
  const amountOriginalRaw = r.amount_original ?? r.amount_in_original_currency;
  const amountReportingRaw =
    r.amount_reporting ?? r.amount_in_reporting_currency ?? r.royalty_revenue;
  r.amount_original = parseCurrency(amountOriginalRaw);
  r.amount_reporting = parseCurrency(amountReportingRaw);
  r.exchange_rate = parseCurrency(r.exchange_rate);

  r.currency_original = normalizeCurrencyCode(
    r.currency_original ?? r.original_currency ?? r.currency
  );
  r.currency_reporting = normalizeCurrencyCode(
    r.currency_reporting ?? r.reporting_currency ?? r.currency
  );
  r.currency =
    normalizeCurrencyCode(r.currency_reporting) ??
    normalizeCurrencyCode(r.currency_original) ??
    normalizeCurrencyCode(r.currency);

  if (!r.usage_type && typeof r.config_type === "string") {
    r.usage_type = r.config_type.trim() || null;
  }
  if (!r.quantity_unit && typeof r.unit === "string") {
    r.quantity_unit = r.unit.trim() || null;
  }

  for (const col of [
    "gross_revenue",
    "commission",
    "net_revenue",
    "publisher_share",
  ]) {
    if (r[col] != null) r[col] = parseCurrency(r[col]);
  }
  if (r.gross_revenue == null && r.amount_original != null) {
    r.gross_revenue = r.amount_original;
  }
  if (r.net_revenue == null && r.amount_reporting != null) {
    r.net_revenue = r.amount_reporting;
  }
  if (r.usage_count != null) {
    const n = parseInt(String(r.usage_count).replace(/[^0-9]/g, ""), 10);
    r.usage_count = isNaN(n) ? null : n;
  }
  // Parse dates - sales_start/sales_end become period_start/period_end
  r.period_start = parseDate(r.sales_start);
  r.period_end = parseDate(r.sales_end);
  // Clean strings
  for (const col of ["track_title", "artist_name", "track_artist", "release_title", "label_name", "publisher_name", "work_title", "party_name", "ipi_number", "source_role", "source_work_code", "de_share", "dr_share", "ph_share"]) {
    if (typeof r[col] === "string") {
      r[col] = r[col].replace(/\s+/g, " ").trim() || null;
    }
  }
  return r;
}

// ─── Validation ──────────────────────────────────────────────────────

const CURRENT_YEAR = new Date().getFullYear();

interface ValidationError {
  row_index: number;
  error_type: string;
  expected: number | null;
  actual: number | null;
  deviation: number | null;
  severity: string;
  field: string;
  message: string;
}

function validateRows(
  rows: TransactionRow[],
  tolerance = 0.01,
  parserLane: ParserLane = "income",
): { errors: ValidationError[]; accuracy: number } {
  const errors: ValidationError[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    // Revenue math: gross - commission = net
    if (r.gross_revenue != null && r.commission != null && r.net_revenue != null) {
      const expected = r.gross_revenue - r.commission;
      const deviation = Math.abs(expected - r.net_revenue);
      if (deviation > tolerance) {
        errors.push({
          row_index: i,
          error_type: "revenue_math_mismatch",
          expected,
          actual: r.net_revenue,
          deviation,
          severity: deviation > 1.0 ? "critical" : "warning",
          field: "net_revenue",
          message: `Expected net ${expected.toFixed(4)} but got ${r.net_revenue.toFixed(4)} (Δ${deviation.toFixed(4)})`,
        });
      }
    }

    // Non-negative checks
    for (const col of ["gross_revenue", "net_revenue", "commission", "publisher_share"]) {
      if (r[col] != null && r[col] < 0) {
        errors.push({
          row_index: i,
          error_type: "negative_value",
          expected: 0,
          actual: r[col],
          deviation: Math.abs(r[col]),
          severity: "warning",
          field: col,
          message: `${col} is negative: ${r[col]}`,
        });
      }
    }

    if (parserLane === "income" || parserLane === "mixed") {
      for (const col of ["track_title", "platform", "territory"]) {
        if (!r[col]) {
          errors.push({
            row_index: i,
            error_type: "missing_required_field",
            expected: null,
            actual: null,
            deviation: null,
            severity: "warning",
            field: col,
            message: `Missing required field: ${col}`,
          });
        }
      }
    }

    // Currency missing: revenue data exists but no currency code
    const hasRevenue =
      r.gross_revenue != null || r.net_revenue != null ||
      r.amount_original != null || r.amount_reporting != null;
    const hasCurrency =
      (r.currency_original && r.currency_original.length > 0) ||
      (r.currency_reporting && r.currency_reporting.length > 0) ||
      (r.currency && r.currency.length > 0);
    if (hasRevenue && !hasCurrency) {
      errors.push({
        row_index: i,
        error_type: "currency_missing",
        expected: null,
        actual: null,
        deviation: null,
        severity: "warning",
        field: "currency",
        message: "Revenue data present but no currency code found.",
      });
    }

    // Period validation
    if (r.period_start && r.period_end) {
      const start = new Date(r.period_start).getTime();
      const end = new Date(r.period_end).getTime();
      if (!isNaN(start) && !isNaN(end) && start > end) {
        errors.push({
          row_index: i,
          error_type: "period_inversion",
          expected: null,
          actual: null,
          deviation: null,
          severity: "warning",
          field: "period_start",
          message: `Period start (${r.period_start}) is after period end (${r.period_end}).`,
        });
      }
    }

    // Period year out-of-range
    for (const [field, dateStr] of [["period_start", r.period_start], ["period_end", r.period_end]]) {
      if (!dateStr) continue;
      const year = new Date(dateStr as string).getFullYear();
      if (!isNaN(year) && (year < 2000 || year > CURRENT_YEAR + 1)) {
        errors.push({
          row_index: i,
          error_type: "period_year_out_of_range",
          expected: null,
          actual: year,
          deviation: null,
          severity: "warning",
          field: field as string,
          message: `${field} year ${year} is outside the expected range (2000–${CURRENT_YEAR + 1}).`,
        });
      }
    }
  }

  const criticalRows = new Set(
    errors.filter((e) => e.severity === "critical").map((e) => e.row_index)
  );
  const validRows = rows.length - criticalRows.size;
  const accuracy = rows.length > 0 ? (validRows / rows.length) * 100 : 0;

  return { errors, accuracy };
}

function mapValidationErrorToTaskType(errorType: string): string {
  switch (errorType) {
    case "missing_required_field":
      return "missing_required_field";
    case "revenue_math_mismatch":
      return "revenue_math_mismatch";
    case "negative_value":
      return "numeric_outlier";
    case "currency_missing":
      return "currency_missing";
    case "period_inversion":
      return "period_mismatch";
    case "period_year_out_of_range":
      return "period_year_out_of_range";
    default:
      return "other";
  }
}

// ─── Main Handler ────────────────────────────────────────────────────

// ─── Structured File Parsing (Bypass Document AI) ────────────────────

// Structured File Parsing (Bypass Document AI)

type ProcessingLane = "structured" | "document_ai";

type CanonicalFieldResolution = {
  canonicalField: string;
  isMapped: boolean;
};

type CanonicalFieldResolver = (rawHeader: string) => CanonicalFieldResolution;

type StructuredSourceField = {
  raw_header: string;
  canonical_field: string;
  is_mapped: boolean;
  raw_value: string;
};

function isStructuredMimeType(mimeType: string): boolean {
  return (
    mimeType.includes("csv") ||
    mimeType.includes("spreadsheet") ||
    mimeType.includes("excel") ||
    mimeType.includes("text/plain")
  );
}

function detectProcessingLane(mimeType: string): ProcessingLane {
  return isStructuredMimeType(mimeType) ? "structured" : "document_ai";
}

function rowHasValues(row: Record<string, string>): boolean {
  return Object.values(row).some((value) => value.trim() !== "");
}

function cleanHeader(value: unknown, index: number): string {
  const text = String(value ?? "").replace(/^\uFEFF/, "").trim();
  return text || `column_${index + 1}`;
}

function dedupeHeaders(rawHeaders: unknown[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((value, index) => {
    const base = cleanHeader(value, index);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function detectCsvDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 5).join("\n");
  const candidates = [",", ";", "\t", "|"];
  let winner = ",";
  let bestScore = -1;

  for (const delimiter of candidates) {
    const score = sample.split(delimiter).length;
    if (score > bestScore) {
      bestScore = score;
      winner = delimiter;
    }
  }

  return winner;
}

async function parseCsvRows(bytes: Uint8Array): Promise<Record<string, string>[]> {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const delimiter = detectCsvDelimiter(text);
  const rows = await parseCsv(text, { skipFirstRow: false, separator: delimiter });
  if (rows.length === 0) return [];

  const headers = dedupeHeaders((rows[0] as unknown[]) ?? []);
  const dataRows = rows.slice(1) as unknown[][];
  const parsedRows: Record<string, string>[] = [];

  for (const row of dataRows) {
    const rowObj: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowObj[header] = String(row?.[index] ?? "").trim();
    });
    if (rowHasValues(rowObj)) parsedRows.push(rowObj);
  }

  return parsedRows;
}

function parseSpreadsheetRows(bytes: Uint8Array): Record<string, string>[] {
  const workbook = XLSX.read(bytes, { type: "array", raw: false, dense: false });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return [];

  const worksheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });
  if (matrix.length === 0) return [];

  const headerIndex = matrix.findIndex((row) =>
    Array.isArray(row) && row.some((cell) => String(cell ?? "").trim() !== "")
  );
  if (headerIndex < 0) return [];

  const headers = dedupeHeaders((matrix[headerIndex] as unknown[]) ?? []);
  const parsedRows: Record<string, string>[] = [];

  for (const row of matrix.slice(headerIndex + 1)) {
    if (!Array.isArray(row)) continue;
    const rowObj: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowObj[header] = String(row?.[index] ?? "").trim();
    });
    if (rowHasValues(rowObj)) parsedRows.push(rowObj);
  }

  return parsedRows;
}

async function parseStructuredFile(
  fileBytes: Uint8Array,
  mimeType: string,
  resolveCanonicalField: CanonicalFieldResolver
): Promise<{ extractedItems: DocumentAiReportItem[]; rawRows: TransactionRow[] }> {
  let parsedRows: Record<string, string>[] = [];

  if (mimeType.includes("csv") || mimeType.includes("text/plain")) {
    parsedRows = await parseCsvRows(fileBytes);
  } else if (mimeType.includes("spreadsheet") || mimeType.includes("excel") || mimeType.includes("ms-excel")) {
    parsedRows = parseSpreadsheetRows(fileBytes);
  } else {
    throw new Error(`Unsupported structured file type: ${mimeType}`);
  }

  const extractedItems: DocumentAiReportItem[] = [];
  const rawRows: TransactionRow[] = [];

  parsedRows.forEach((rowObj, idx) => {
    const item = createEmptyDocumentAiReportItem(idx);
    item.source_page = 1;
    item.ocr_confidence = 1.0;
    item.raw_entity = rowObj;

    Object.entries(rowObj).forEach(([key, val]) => {
      const strVal = String(val).trim();
      if (!strVal) return;
      const mapped = mapDocumentAiField(key);
      if (DOCUMENT_AI_ITEM_FIELD_SET.has(mapped)) {
        (item as any)[mapped] = strVal;
      }
    });
    if (hasAnyDocumentAiField(item)) extractedItems.push(item);

    const txRow: TransactionRow = {
      source_page: 1,
      source_row: idx,
      ocr_confidence: 1.0,
      _bboxes: {},
      _source_fields: [] as StructuredSourceField[],
    };

    Object.entries(rowObj).forEach(([key, val]) => {
      const rawHeader = String(key).trim();
      const strVal = String(val).trim();
      if (!rawHeader || strVal === "") return;

      const resolution = resolveCanonicalField(rawHeader);
      const canonicalField = resolution.canonicalField;

      (txRow._source_fields as StructuredSourceField[]).push({
        raw_header: rawHeader,
        canonical_field: canonicalField,
        is_mapped: resolution.isMapped,
        raw_value: strVal,
      });

      if (!(canonicalField in txRow) || String(txRow[canonicalField] ?? "").trim() === "") {
        txRow[canonicalField] = strVal;
      }
    });

    if (hasTransactionSignal(txRow)) {
      rawRows.push(txRow);
    }
  });

  return { extractedItems, rawRows };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  // Supabase injects SUPABASE_* env vars automatically in Edge Functions.
  // If legacy keys are disabled, fall back to a custom secret name.
  const supabaseServiceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY");

  if (!supabaseUrl) {
    throw new Error("Missing SUPABASE_URL (in Supabase Edge Functions this should be provided automatically).");
  }
  if (!supabaseServiceKey) {
    throw new Error(
      "Missing service role key. Expected SUPABASE_SERVICE_ROLE_KEY (auto-provided) or SERVICE_ROLE_KEY (custom secret)."
    );
  }
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let reportId: string | null = null;

  try {
    const body = await req.json().catch(() => ({}));
    const report_id = (body as { report_id?: string }).report_id;
    reportId = report_id ?? null;
    if (!report_id) {
      return new Response(
        JSON.stringify({ error: "report_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization");
    const jwt = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!jwt) {
      return new Response(
        JSON.stringify({ error: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const claims = parseJwtClaims(jwt);
    const role = claims?.role ?? null;
    const isServiceRoleCaller = role === "service_role";
    const authedUserId = claims?.sub ?? claims?.user_id ?? null;

    // Normal path: require a user JWT. (The publishable/anon key is public, so it's not enough.)
    // Admin path: allow service_role callers (useful for manual reprocessing scripts).
    if (!isServiceRoleCaller && (!authedUserId || role === "anon")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[process-report] Starting for report ${report_id}`);

    // 0. Load column mappings from DB (system defaults + user overrides).
    let mappingQuery = supabase
      .from("column_mappings")
      .select("raw_header, canonical_field, scope")
      .eq("is_active", true);

    if (authedUserId) {
      mappingQuery = mappingQuery.or(`scope.eq.system,and(scope.eq.user,user_id.eq.${authedUserId})`);
    } else {
      mappingQuery = mappingQuery.eq("scope", "system");
    }

    const { data: activeMappings, error: mappingErr } = await mappingQuery;

    if (mappingErr) {
      console.warn("[process-report] Failed to load DB mappings, falling back to hardcoded defaults:", mappingErr.message);
    }

    const toLookupToken = (raw: string): string =>
      raw
        .toUpperCase()
        .trim()
        .replace(/[^A-Z0-9]+/g, " ")
        .replace(/\s+/g, " ");

    const toFallbackField = (raw: string): string =>
      raw
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_");

    const effectiveMappings: Record<string, string> = {};
    Object.entries(COLUMN_MAPPINGS).forEach(([pattern, canonical]) => {
      effectiveMappings[toLookupToken(pattern)] = canonical;
    });

    if (activeMappings) {
      activeMappings.sort((a, b) => (a.scope === "user" ? 1 : -1));
      for (const m of activeMappings) {
        effectiveMappings[toLookupToken(m.raw_header)] = m.canonical_field;
      }
    }

    const knownCanonicalFields = new Set<string>([
      ...Object.values(effectiveMappings),
      ...Array.from(STANDARD_TRANSACTION_FIELDS),
      "release_artist",
      "original_currency",
      "reporting_currency",
      "channel",
      "country",
      "config_type",
      "quantity",
    ]);

    const resolveCanonicalField = (raw: string): CanonicalFieldResolution => {
      if (raw.startsWith("custom:")) {
        return { canonicalField: raw, isMapped: true };
      }

      const lookupToken = toLookupToken(raw);
      const exact = effectiveMappings[lookupToken];
      if (exact) return { canonicalField: exact, isMapped: true };

      for (const [pattern, canonical] of Object.entries(effectiveMappings)) {
        if (lookupToken.includes(pattern)) {
          return { canonicalField: canonical, isMapped: true };
        }
      }

      const fallback = toFallbackField(raw);
      if (knownCanonicalFields.has(fallback)) {
        return { canonicalField: fallback, isMapped: true };
      }

      return { canonicalField: fallback, isMapped: false };
    };

    const getCanonicalField = (raw: string): string => resolveCanonicalField(raw).canonicalField;

    // 1. Fetch report metadata
    const { data: report, error: fetchErr } = await supabase
      .from("cmo_reports")
      .select("*")
      .eq("id", report_id)
      .single();

    if (fetchErr || !report) {
      throw new Error(`Report not found: ${fetchErr?.message}`);
    }
    const workspaceCompanyId =
      typeof (report as Record<string, unknown>).company_id === "string"
        ? ((report as Record<string, unknown>).company_id as string)
        : null;

    if (!isServiceRoleCaller && report.user_id !== authedUserId) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Update status to processing
    {
      const { error: statusErr } = await supabase
        .from("cmo_reports")
        .update({ status: "processing" })
        .eq("id", report_id);
      if (statusErr) throw new Error(`Failed to set report status to processing: ${statusErr.message}`);
    }

    // Reprocessing safety: clear ALL prior outputs for this report to avoid duplicates.
    // Order matters: source_fields FK depends on source_rows, transactions depend on source_rows.
    {
      const { error } = await supabase.from("validation_errors").delete().eq("report_id", report_id);
      if (error) throw new Error(`Failed to clear validation_errors: ${error.message}`);
    }
    {
      const { error } = await supabase.from("review_tasks").delete().eq("report_id", report_id);
      if (error) throw new Error(`Failed to clear review_tasks: ${error.message}`);
    }
    {
      const { error } = await supabase.from("source_fields").delete().eq("report_id", report_id);
      if (error) throw new Error(`Failed to clear source_fields: ${error.message}`);
    }
    {
      const { error } = await supabase.from("royalty_transactions").delete().eq("report_id", report_id);
      if (error) throw new Error(`Failed to clear royalty_transactions: ${error.message}`);
    }
    {
      const { error } = await supabase.from("catalog_split_claims").delete().eq("source_report_id", report_id);
      if (error) throw new Error(`Failed to clear catalog_split_claims: ${error.message}`);
    }
    {
      const { error } = await supabase.from("catalog_claims").delete().eq("source_report_id", report_id);
      if (error) throw new Error(`Failed to clear catalog_claims: ${error.message}`);
    }
    {
      const { error } = await supabase.from("source_rows").delete().eq("report_id", report_id);
      if (error) throw new Error(`Failed to clear source_rows: ${error.message}`);
    }
    {
      const { error } = await supabase.from("document_ai_report_items").delete().eq("report_id", report_id);
      if (error) throw new Error(`Failed to clear document_ai_report_items: ${error.message}`);
    }

    // 3. Download report file from storage
    const { data: reportFileData, error: dlErr } = await supabase.storage
      .from("cmo-reports")
      .download(report.file_path);

    if (dlErr || !reportFileData) {
      throw new Error(`Failed to download report file: ${dlErr?.message}`);
    }

    const fileBytes = new Uint8Array(await reportFileData.arrayBuffer());

    console.log(`[process-report] File downloaded (${fileBytes.byteLength} bytes)`);

    // Detect MIME type from file extension
    const fileName = report.file_name || "";
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const mimeTypes: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      csv: "text/csv",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      txt: "text/plain",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
    };
    const mimeType = mimeTypes[ext] || "application/pdf";
    const lane = detectProcessingLane(mimeType);
    console.log(`[process-report] Detected MIME type: ${mimeType} (from .${ext}). lane=${lane}`);

    let document: any = null;
    let extractedItems: DocumentAiReportItem[] = [];
    let rawRows: TransactionRow[] = [];

    if (mimeType === "application/pdf") {
      const sacemPdfRows = await extractSacemCatalogueRowsFromPdfBytes(fileBytes);
      const sacemPdfRowsWithShares = sacemPdfRows.filter(hasSplitShareEvidence).length;
      if (sacemPdfRowsWithShares > 0) {
        rawRows = sacemPdfRows;
        console.log(`[process-report] Parsed ${rawRows.length} SACEM rights catalogue rows from native PDF text coordinates (${sacemPdfRowsWithShares} rows with share evidence)`);
      } else if (sacemPdfRows.length > 0) {
        console.log(`[process-report] Ignoring ${sacemPdfRows.length} incomplete native SACEM rows with no share evidence; falling back to Document AI`);
      }
    }

    if (rawRows.length > 0) {
      console.log(`[process-report] Using native rights parser output; skipping generic Document AI extraction`);
    } else if (lane === "structured") {
      console.log(`[process-report] Processing structured file natively (bypass Document AI)`);
      const result = await parseStructuredFile(fileBytes, mimeType, resolveCanonicalField);
      extractedItems = result.extractedItems;
      rawRows = result.rawRows;
      console.log(`[process-report] Parsed ${extractedItems.length} items and ${rawRows.length} rows locally`);
    } else {
      // 4. Call Google Document AI for OCR-oriented formats.
      const gcpProject = Deno.env.get("GOOGLE_CLOUD_PROJECT");
      const processorId = Deno.env.get("DOCUMENTAI_PROCESSOR_ID");
      const docAiLocation = Deno.env.get("DOCUMENTAI_LOCATION") ?? "us";
      const saKey = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_KEY");

      if (!gcpProject || !processorId || !saKey) {
        throw new Error(
          "Missing Google Document AI secrets. Required: GOOGLE_CLOUD_PROJECT, DOCUMENTAI_PROCESSOR_ID, GOOGLE_SERVICE_ACCOUNT_KEY."
        );
      }

      const accessToken = await getAccessToken(saKey);
      const docAIUrl = `https://${docAiLocation}-documentai.googleapis.com/v1/projects/${gcpProject}/locations/${docAiLocation}/processors/${processorId}:process`;
      let binary = "";
      const CHUNK = 8192;
      for (let i = 0; i < fileBytes.length; i += CHUNK) {
        binary += String.fromCharCode(...fileBytes.subarray(i, i + CHUNK));
      }
      const fileBase64 = btoa(binary);

      console.log(`[process-report] Calling Document AI...`);
      // ... existing DocAI logic ...


      const aiResp = await fetch(docAIUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rawDocument: {
            content: fileBase64,
            mimeType: mimeType,
          },
        }),
      });

      if (!aiResp.ok) {
        const errText = await aiResp.text();

        // Try to turn the very verbose Google error into something actionable.
        try {
          const parsed = JSON.parse(errText);
          const message: string | undefined = parsed?.error?.message;
          const fieldViolations: Array<{ field?: string; description?: string }> =
            parsed?.error?.details?.find((d: any) => d?.fieldViolations)?.fieldViolations ?? [];

          const hasEntityTypesViolation = fieldViolations.some(
            (v) => (v?.field ?? "").toLowerCase().includes("entity_types")
          );

          if (hasEntityTypesViolation) {
            throw new Error(
              "Document AI processor is misconfigured (missing entity types). " +
              "If you're using a Custom Extractor, define at least one entity type in the processor schema. " +
              "For this app (table extraction), use a Form Parser or Layout Parser processor and update DOCUMENTAI_PROCESSOR_ID."
            );
          }

          if (message && typeof message === "string" && message.trim()) {
            throw new Error(`Document AI error (${aiResp.status}): ${message}`);
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("Document AI")) {
            throw e;
          }
          // ignore JSON parse errors and fall back to raw text
        }

        throw new Error(`Document AI error (${aiResp.status}): ${errText}`);
      }

      const aiResult = await aiResp.json();
      document = aiResult.document;

      console.log(`[process-report] Document AI returned ${document?.pages?.length ?? 0} pages`);

      // 5. Persist all Custom Extractor report-item fields for full-fidelity access.
      extractedItems = document ? extractDocumentAiReportItems(document) : [];
      // Logic for rawRows construction from DocAI
      // Prefer deterministic rights catalogue parsing when OCR text identifies
      // a SACEM works catalogue; generic report_item extractors flatten this
      // layout into track/artist fields and lose DE/DR/PH split semantics.
      const sacemCatalogueRows = typeof document?.text === "string"
        ? extractSacemCatalogueRowsFromText(document.text)
        : [];
      const sacemCatalogueRowsWithShares = sacemCatalogueRows.filter(hasSplitShareEvidence).length;
      if (sacemCatalogueRowsWithShares > 0) {
        rawRows = sacemCatalogueRows;
        console.log(`[process-report] Built ${rawRows.length} SACEM rights catalogue rows from OCR text (${sacemCatalogueRowsWithShares} rows with share evidence)`);
      } else if (sacemCatalogueRows.length > 0) {
        console.log(`[process-report] Ignoring ${sacemCatalogueRows.length} incomplete OCR SACEM rows with no share evidence; falling back to generic Document AI rows`);
      } else if (extractedItems.length > 0) {
        rawRows = extractedItems
          .map((item) => ({
            source_page: item.source_page,
            item_index: item.item_index,
            ocr_confidence: item.ocr_confidence ?? 0,
            track_title: item.track_title,
            track_artist: item.track_artist ?? item.release_artist,
            release_title: item.release_title,
            isrc: item.isrc,
            iswc: typeof item.isrc === "string" && item.isrc.trim().startsWith("T-") ? item.isrc.trim() : null,
            upc: item.release_upc,
            work_title: item.track_title,
            source_work_code: item.release_upc,
            party_name: item.track_artist ?? item.release_artist,
            platform: item.channel,
            territory: item.country,
            usage_count: item.quantity,
            usage_type: item.usage_type ?? item.config_type,
            quantity_unit: item.unit,
            rights_type: item.config_type,
            territory_raw: item.country,
            currency_original: item.original_currency,
            currency_reporting: item.reporting_currency,
            amount_original: item.amount_in_original_currency,
            amount_reporting:
              item.amount_in_reporting_currency ?? item.royalty_revenue,
            exchange_rate: item.exchange_rate,
            gross_revenue:
              item.amount_in_original_currency ??
              item.amount_in_reporting_currency ??
              item.royalty_revenue,
            net_revenue: item.royalty_revenue ?? item.amount_in_reporting_currency,
            commission: item.master_commission,
            sales_start: item.sales_start,
            sales_end: item.sales_end,
            report_date: item.report_date,
            label_name: item.label,
            publisher_share: null,
          }))
          .filter((row) => hasTransactionSignal(row));
        console.log(`[process-report] Built ${rawRows.length} transaction candidates from document_ai_report_items`);
      } else {
        // Fallback path for Form/Layout parsers or non-standard entity structures.
        const tables = document ? parseDocumentAIResponse(document) : [];
        rawRows = reconstructTables(tables);
        if (rawRows.length === 0) {
          rawRows = document ? reconstructEntities(document) : [];
        }
        console.log(`[process-report] Built ${rawRows.length} transaction candidates from fallback parsers`);
      }
    }   // End of else block for DocAI

    // ─── Persistence ─────────────────────────────────────────────────────
    // Persist extracted items (from either DocAI or Native Parse) for audit/debugging.
    if (extractedItems.length > 0) {
      const extractedRows = extractedItems.map((item) => ({
        report_id,
        user_id: report.user_id,
        source_page: item.source_page ?? 1,
        item_index: item.item_index ?? 0,
        report_item: item.report_item,
        amount_in_original_currency: item.amount_in_original_currency,
        amount_in_reporting_currency: item.amount_in_reporting_currency,
        channel: item.channel,
        config_type: item.config_type ?? item.usage_type,
        usage_type: item.usage_type ?? item.config_type,
        country: item.country,
        exchange_rate: item.exchange_rate,
        isrc: item.isrc,
        label: item.label,
        master_commission: item.master_commission,
        original_currency: item.original_currency,
        quantity: item.quantity,
        release_artist: item.release_artist,
        release_title: item.release_title,
        release_upc: item.release_upc,
        report_date: item.report_date,
        reporting_currency: item.reporting_currency,
        royalty_revenue: item.royalty_revenue,
        sales_end: item.sales_end,
        sales_start: item.sales_start,
        track_artist: item.track_artist,
        track_title: item.track_title,
        unit: item.unit,
        ocr_confidence: item.ocr_confidence,
        raw_entity: item.raw_entity,
      }));

      const BATCH_SIZE = 500;
      for (let start = 0; start < extractedRows.length; start += BATCH_SIZE) {
        const batch = extractedRows.slice(start, start + BATCH_SIZE);
        const { error: docAiInsertErr } = await supabase
          .from("document_ai_report_items")
          .insert(batch);
        if (docAiInsertErr) {
          // Log but don't fail the whole process if audit logging fails
          console.error(`[process-report] Failed to insert Document AI extracted items: ${docAiInsertErr.message}`);
        }
      }
      console.log(`[process-report] Saved ${extractedRows.length} document_ai_report_items rows`);
    }


    if (rawRows.length === 0) {
      const noDataMessage =
        lane === "structured"
          ? "No tabular rows were found in this structured file. Ensure it has a header row followed by data rows."
          : "No structured transaction rows found in document. If using Custom Extractor, add labels for transaction fields (track title/ISRC/platform/territory/revenue).";

      // No data extracted
      const { error: emptyUpdateErr } = await supabase
        .from("cmo_reports")
        .update({
          status: "completed_passed", // Changed from "processing" to "completed_passed"
          quality_gate_status: "needs_review",
          processed_at: new Date().toISOString(),
          transaction_count: 0,
          accuracy_score: 0,
          error_count: 0,
          total_revenue: 0,
        })
        .eq("id", report_id);
      if (emptyUpdateErr) {
        throw new Error(`Failed to update empty extraction report state: ${emptyUpdateErr.message}`);
      }

      return new Response(
        JSON.stringify({
          status: "completed_passed", // Changed from "processing" to "completed_passed"
          message: noDataMessage,
          transactions: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Normalize
    const normalizedRows = rawRows.map(normalizeRow);
    const documentFamily = classifyDocumentFamily(normalizedRows as unknown as Record<string, unknown>[]);

    {
      const { error: metadataErr } = await supabase
        .from("cmo_reports")
        .update({
          document_kind: documentFamily.document_kind,
          business_side: documentFamily.business_side,
          parser_lane: documentFamily.parser_lane,
          source_system: report.cmo_name ?? "workspace_upload",
          source_reference: (report as Record<string, unknown>).statement_reference ?? report.file_name ?? null,
        })
        .eq("id", report_id);
      if (metadataErr) throw new Error(`Failed to update report document metadata: ${metadataErr.message}`);
    }

    if (report.ingestion_file_id) {
      const { error: ingestionMetadataErr } = await supabase
        .from("ingestion_files")
        .update({
          company_id: workspaceCompanyId,
          document_kind: documentFamily.document_kind,
          business_side: documentFamily.business_side,
          parser_lane: documentFamily.parser_lane,
          source_system: report.cmo_name ?? "workspace_upload",
          source_reference: (report as Record<string, unknown>).statement_reference ?? report.file_name ?? null,
        })
        .eq("id", report.ingestion_file_id);
      if (ingestionMetadataErr) {
        throw new Error(`Failed to update ingestion file document metadata: ${ingestionMetadataErr.message}`);
      }
    }

    // 8. Validate
    // Always validate so review queue behavior is consistent across parser modes.
    let validationErrors: ValidationError[] = [];
    let accuracy = 100;
    let criticalRowIndices = new Set<number>();
    const validationBlockersByRow = new Map<number, ValidationError[]>();
    const validation = validateRows(normalizedRows, 0.01, documentFamily.parser_lane);
    validationErrors = validation.errors;
    accuracy = validation.accuracy;
    validationErrors.forEach((e) => {
      const current = validationBlockersByRow.get(e.row_index) ?? [];
      current.push(e);
      validationBlockersByRow.set(e.row_index, current);
    });
    const criticalErrors = validationErrors.filter(
      (e) => e.severity === "critical"
    );
    criticalRowIndices = new Set(criticalErrors.map((e) => e.row_index));

    // 9. Insert source_rows FIRST (before transactions) to establish provenance links
    // This enables Audit Reference (Page X, Row Y) and Source Evidence in the review queue UI.
    const sourceRowsToInsert = rawRows.map((r, i) => {
      const rawPayload = { ...r };
      delete (rawPayload as Record<string, unknown>)._source_fields;
      return {
        report_id,
        company_id: workspaceCompanyId,
        user_id: report.user_id,
        ingestion_file_id: report.ingestion_file_id ?? null,
        source_page: r.source_page ?? null,
        source_row_index: r.source_row ?? i,
        raw_payload: rawPayload, // Store extracted row data for evidence display.
      };
    });

    const insertedSourceRowIds: Array<string | null> = new Array(sourceRowsToInsert.length).fill(null);

    // Insert source_rows in batches and capture the IDs
    const SOURCE_BATCH_SIZE = 500;
    for (let start = 0; start < sourceRowsToInsert.length; start += SOURCE_BATCH_SIZE) {
      const batch = sourceRowsToInsert.slice(start, start + SOURCE_BATCH_SIZE);
      const { data: insertedSourceRows, error: srcErr } = await supabase
        .from("source_rows")
        .insert(batch)
        .select("id");
      if (srcErr) {
        console.error(`[process-report] Source rows insert error at batch ${start}:`, srcErr.message);
        throw new Error(`Failed to insert source rows: ${srcErr.message}`);
      }
      if (!insertedSourceRows || insertedSourceRows.length !== batch.length) {
        throw new Error("Failed to confirm inserted source rows for linkage.");
      }
      for (let i = 0; i < insertedSourceRows.length; i++) {
        insertedSourceRowIds[start + i] = insertedSourceRows[i].id ?? null;
      }
    }

    console.log(`[process-report] Inserted ${sourceRowsToInsert.length} source_rows for provenance tracking`);

    // 9.5 Populate source_fields for every extracted field
    const sourceFieldsToInsert: any[] = [];
    const unmappedHeaders = new Set<string>();
    const toMappingConfidence = (value: unknown): number | null => {
      const n = Number(value);
      if (!Number.isFinite(n)) return null;
      if (n <= 1) return Math.round(n * 10000) / 100;
      return Math.round(n * 100) / 100;
    };

    rawRows.forEach((r, i) => {
      const sourceRowId = insertedSourceRowIds[i];
      if (!sourceRowId) return;

      const rowConfidence = toMappingConfidence(r.ocr_confidence);
      const structuredSourceFields = Array.isArray((r as any)._source_fields)
        ? ((r as any)._source_fields as StructuredSourceField[])
        : null;

      if (structuredSourceFields && structuredSourceFields.length > 0) {
        structuredSourceFields.forEach((sourceField) => {
          const rawHeader = String(sourceField.raw_header ?? "").trim();
          const rawValue = String(sourceField.raw_value ?? "");
          const resolution = resolveCanonicalField(rawHeader);
          const canonical = sourceField.canonical_field || resolution.canonicalField;
          const isMapped = sourceField.is_mapped || resolution.isMapped;

          sourceFieldsToInsert.push({
            report_id,
            company_id: workspaceCompanyId,
            user_id: report.user_id,
            source_row_id: sourceRowId,
            field_name: rawHeader,
            raw_value: rawValue,
            normalized_value: rawValue,
            is_mapped: isMapped,
            mapping_rule: isMapped ? canonical : null,
            mapping_confidence: rowConfidence,
          });

          if (!isMapped && rawHeader) {
            unmappedHeaders.add(rawHeader);
          }
        });
        return;
      }

      Object.entries(r).forEach(([rawKey, value]) => {
        if (rawKey.startsWith("_") || rawKey === "source_page" || rawKey === "source_row" || rawKey === "ocr_confidence") return;

        const resolution = resolveCanonicalField(rawKey);
        const rawValue = value != null ? String(value) : null;

        sourceFieldsToInsert.push({
          report_id,
          company_id: workspaceCompanyId,
          user_id: report.user_id,
          source_row_id: sourceRowId,
          field_name: rawKey,
          raw_value: rawValue,
          normalized_value: rawValue,
          is_mapped: resolution.isMapped,
          mapping_rule: resolution.isMapped ? resolution.canonicalField : null,
          mapping_confidence: rowConfidence,
        });

        if (!resolution.isMapped) {
          unmappedHeaders.add(rawKey.trim());
        }
      });
    });

    if (sourceFieldsToInsert.length > 0) {
      for (let start = 0; start < sourceFieldsToInsert.length; start += SOURCE_BATCH_SIZE) {
        const batch = sourceFieldsToInsert.slice(start, start + SOURCE_BATCH_SIZE);
        const { error: sfErr } = await supabase.from("source_fields").insert(batch);
        if (sfErr) throw new Error(`Failed to insert source_fields: ${sfErr.message}`);
      }
    }

    // 10. Insert transactions into royalty_transactions (now with source_row_id links)
    const shouldInsertTransactions = documentFamily.parser_lane === "income" || documentFamily.parser_lane === "mixed";
    const transactionEntries = shouldInsertTransactions
      ? normalizedRows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) => documentFamily.parser_lane !== "mixed" || rowHasRevenueSignal(r as unknown as Record<string, unknown>))
      : [];
    const transactions = transactionEntries.map(({ r, i }) => ({
      report_id,
      company_id: workspaceCompanyId,
      user_id: report.user_id,
      track_title: r.track_title || r.artist_name || null,
      artist_name: r.track_artist || r.artist_name || null,
      isrc: r.isrc || null,
      iswc: r.iswc || null,
      platform: r.platform || null,
      territory: r.territory || null,
      usage_type: r.usage_type || null,
      quantity: r.usage_count || null,
      gross_revenue: r.gross_revenue ?? null,
      commission: r.commission ?? null,
      net_revenue: r.net_revenue ?? null,
      amount_original: r.amount_original ?? null,
      amount_reporting: r.amount_reporting ?? null,
      currency_original: r.currency_original ?? null,
      currency_reporting: r.currency_reporting ?? null,
      exchange_rate: r.exchange_rate ?? null,
      quantity_unit: r.quantity_unit ?? null,
      rights_type: r.rights_type ?? null,
      territory_raw: r.territory_raw ?? null,
      mapping_confidence:
        typeof r.mapping_confidence === "number"
          ? r.mapping_confidence
          : typeof r.ocr_confidence === "number"
            ? (r.ocr_confidence <= 1 ? r.ocr_confidence * 100 : r.ocr_confidence)
            : null,
      validation_blockers: (validationBlockersByRow.get(i) ?? []).map((e) => ({
        type: e.error_type,
        field: e.field,
        severity: e.severity,
        message: e.message,
      })),
      currency:
        normalizeCurrencyCode(r.currency_reporting) ??
        normalizeCurrencyCode(r.currency_original) ??
        normalizeCurrencyCode(r.currency) ??
        null,
      period_start: r.period_start || null,
      period_end: r.period_end || null,
      source_page: r.source_page ?? null,
      source_row: r.source_row ?? null,
      source_row_id: insertedSourceRowIds[i] ?? null, // Link to source_row for provenance
      ocr_confidence: r.ocr_confidence ?? null,
      bbox_x: r._bboxes
        ? Object.values(r._bboxes as Record<string, BBox>)[0]?.x_min ?? null
        : null,
      bbox_y: r._bboxes
        ? Object.values(r._bboxes as Record<string, BBox>)[0]?.y_min ?? null
        : null,
      bbox_width: r._bboxes
        ? (() => {
          const first = Object.values(r._bboxes as Record<string, BBox>)[0];
          return first ? first.x_max - first.x_min : null;
        })()
        : null,
      bbox_height: r._bboxes
        ? (() => {
          const first = Object.values(r._bboxes as Record<string, BBox>)[0];
          return first ? first.y_max - first.y_min : null;
        })()
        : null,
      validation_status: criticalRowIndices.has(i) ? "failed" : "passed",
      raw_data: r._bboxes ? { bounding_boxes: r._bboxes } : null,
      custom_properties: (() => {
        const extra: Record<string, any> = {};
        Object.entries(r).forEach(([key, val]) => {
          if (key.startsWith("_") || key === "source_page" || key === "source_row" || key === "ocr_confidence") return;
          const canonical = getCanonicalField(key);
          // If it maps to a "custom:" prefix or doesn't map to a standard column
          if (canonical.startsWith("custom:") || !STANDARD_TRANSACTION_FIELDS.has(canonical)) {
            const keyName = canonical.startsWith("custom:") ? canonical.split(":")[1] : canonical;
            extra[keyName] = val;
          }
        });
        return extra;
      })(),
      basis_type: "observed",
      asset_class: inferAssetClass(r),
      rights_family: inferRightsFamily(r),
      rights_stream: normalizeRightsStream(r.usage_type ?? r.rights_type),
    }));

    // Insert in batches of 500 and keep inserted ids for task linkage.
    const BATCH_SIZE = 500;
    const insertedTransactionIds: Array<string | null> = new Array(normalizedRows.length).fill(null);
    for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
      const batch = transactions.slice(start, start + BATCH_SIZE);
      const { data: insertedBatch, error: insErr } = await supabase
        .from("royalty_transactions")
        .insert(batch)
        .select("id");
      if (insErr) {
        console.error(`[process-report] Insert error at batch ${start}:`, insErr.message);
        throw new Error(`Failed to insert transactions: ${insErr.message}`);
      }
      if (!insertedBatch || insertedBatch.length !== batch.length) {
        throw new Error("Failed to confirm inserted transactions for task linkage.");
      }
      for (let i = 0; i < insertedBatch.length; i++) {
        insertedTransactionIds[transactionEntries[start + i]?.i ?? start + i] = insertedBatch[i].id ?? null;
      }
    }

    console.log(`[process-report] Inserted ${transactions.length} transactions`);

    let typedSplitClaimCount = 0;

    if (documentFamily.parser_lane === "rights" || documentFamily.parser_lane === "mixed") {
      const splitEntries = normalizedRows
        .map((r, i) => ({ r, i }))
        .filter(({ r }) =>
          documentFamily.parser_lane !== "mixed" ||
          (rowHasExplicitSplitSignal(r as unknown as Record<string, unknown>) && !rowHasRevenueSignal(r as unknown as Record<string, unknown>))
        );
      const catalogClaims = splitEntries.map(({ r, i }) => ({
        company_id: workspaceCompanyId,
        claim_type: documentFamily.document_kind,
        basis_type: "registered",
        source_report_id: report_id,
        source_row_id: insertedSourceRowIds[i] ?? null,
        subject_entity_type: r.iswc ? "work" : "recording",
        subject_entity_id: null,
        related_entity_type: r.publisher_name ? "party" : null,
        related_entity_id: null,
        payload: r,
        confidence:
          typeof r.mapping_confidence === "number"
            ? r.mapping_confidence
            : typeof r.ocr_confidence === "number"
              ? (r.ocr_confidence <= 1 ? r.ocr_confidence * 100 : r.ocr_confidence)
              : null,
        resolution_status: "pending",
      }));

      for (let start = 0; start < catalogClaims.length; start += BATCH_SIZE) {
        const batch = catalogClaims.slice(start, start + BATCH_SIZE);
        const { error: claimErr } = await supabase.from("catalog_claims").insert(batch);
        if (claimErr) throw new Error(`Failed to insert catalog claims: ${claimErr.message}`);
      }

      const builtSplitClaims = buildSplitClaimsFromRows(splitEntries.map(({ r }) => r), {
        source_report_id: report_id,
        source_row_ids: splitEntries.map(({ i }) => insertedSourceRowIds[i] ?? null),
        source_language: "fr",
        default_review_status: "pending",
      });
      const reviewMetadata = buildSplitClaimReviewMetadata(builtSplitClaims);
      const splitFingerprints = Array.from(
        new Set(
          Array.from(reviewMetadata.values())
            .map((metadata) => metadata.split_fingerprint)
            .filter(Boolean),
        ),
      );
      const approvedFingerprints = new Set<string>();
      if (splitFingerprints.length > 0) {
        const { data: existingApproved, error: existingApprovedErr } = await supabase
          .from("catalog_split_claims")
          .select("split_fingerprint")
          .eq("company_id", workspaceCompanyId)
          .eq("review_status", "approved")
          .in("split_fingerprint", splitFingerprints);
        if (existingApprovedErr) {
          const missingFingerprintColumn = existingApprovedErr.message.includes("split_fingerprint");
          if (!missingFingerprintColumn) {
            throw new Error(`Failed to compare existing split fingerprints: ${existingApprovedErr.message}`);
          }
        }
        (existingApproved ?? []).forEach((row: { split_fingerprint?: string | null }) => {
          if (row.split_fingerprint) approvedFingerprints.add(row.split_fingerprint);
        });
      }
      const autoAppliedAt = new Date().toISOString();
      const typedSplitClaims = builtSplitClaims.map((claim) => {
        const metadata = reviewMetadata.get(claim);
        const isDuplicate = metadata?.split_fingerprint ? approvedFingerprints.has(metadata.split_fingerprint) : false;
        return ({
        company_id: workspaceCompanyId,
        source_report_id: claim.source_report_id,
        source_row_id: claim.source_row_id,
        work_id: claim.work_id,
        party_id: claim.party_id,
        work_title: claim.work_title,
        iswc: claim.iswc,
        source_work_code: claim.source_work_code,
        party_name: claim.party_name,
        ipi_number: claim.ipi_number,
        source_role: claim.source_role,
        source_rights_code: claim.source_rights_code,
        source_rights_label: claim.source_rights_label,
        source_language: claim.source_language,
        canonical_rights_stream: claim.canonical_rights_stream,
        share_pct: claim.share_pct,
        territory_scope: claim.territory_scope,
        valid_from: claim.valid_from,
        valid_to: claim.valid_to,
        confidence: claim.confidence,
        review_status: isDuplicate ? "approved" : claim.review_status,
        managed_party_match: claim.managed_party_match,
        raw_payload: claim.raw_payload,
        split_group_key: metadata?.split_group_key ?? null,
        split_fingerprint: metadata?.split_fingerprint ?? null,
        dedupe_status: isDuplicate ? "auto_applied" : "new_needs_review",
        review_case_status: isDuplicate ? "already_known" : "ready_to_approve",
        auto_applied_at: isDuplicate ? autoAppliedAt : null,
      });
      });
      typedSplitClaimCount = typedSplitClaims.length;

      for (let start = 0; start < typedSplitClaims.length; start += BATCH_SIZE) {
        const batch = typedSplitClaims.slice(start, start + BATCH_SIZE);
        const { error: splitClaimErr } = await supabase.from("catalog_split_claims").insert(batch);
        if (splitClaimErr) {
          const missingCaseColumns =
            splitClaimErr.message.includes("split_group_key") ||
            splitClaimErr.message.includes("split_fingerprint") ||
            splitClaimErr.message.includes("dedupe_status") ||
            splitClaimErr.message.includes("review_case_status") ||
            splitClaimErr.message.includes("auto_applied_at") ||
            splitClaimErr.message.includes("matched_existing_rights_position_id");
          if (!missingCaseColumns) throw new Error(`Failed to insert catalog split claims: ${splitClaimErr.message}`);

          const legacyBatch = batch.map((claim) => {
            const {
              split_group_key: _splitGroupKey,
              split_fingerprint: _splitFingerprint,
              dedupe_status: _dedupeStatus,
              review_case_status: _reviewCaseStatus,
              auto_applied_at: _autoAppliedAt,
              matched_existing_rights_position_id: _matchedExistingRightsPositionId,
              ...legacyClaim
            } = claim;
            return legacyClaim;
          });
          const { error: legacySplitClaimErr } = await supabase.from("catalog_split_claims").insert(legacyBatch);
          if (legacySplitClaimErr) throw new Error(`Failed to insert catalog split claims: ${legacySplitClaimErr.message}`);
        }
      }

      const autoAppliedClaims = typedSplitClaims.filter((claim) => claim.dedupe_status === "auto_applied");
      if (autoAppliedClaims.length > 0) {
        const events = autoAppliedClaims.map((claim) => ({
          company_id: workspaceCompanyId,
          entity_type: "catalog_split_claim",
          entity_id: null,
          event_type: "split_claim_auto_applied_duplicate",
          previous_state: {},
          new_state: {
            source_report_id: report_id,
            split_group_key: claim.split_group_key,
            split_fingerprint: claim.split_fingerprint,
            review_status: "approved",
          },
          decided_by: report.user_id,
        }));
        const { error: autoEventErr } = await supabase.from("catalog_resolution_events").insert(events);
        if (autoEventErr) throw new Error(`Failed to record auto-applied duplicate events: ${autoEventErr.message}`);
      }
    }

    // 10. Insert validation errors
    if (validationErrors.length > 0) {
      const errorRecords = validationErrors.map((e) => ({
        report_id,
        transaction_id: insertedTransactionIds[e.row_index] ?? null,
        user_id: report.user_id,
        error_type: e.error_type,
        severity: e.severity,
        message: e.message,
        field_name: e.field,
        expected_value: e.expected != null ? String(e.expected) : null,
        actual_value: e.actual != null ? String(e.actual) : null,
        source_page: normalizedRows[e.row_index]?.source_page ?? null,
      }));

      for (let start = 0; start < errorRecords.length; start += BATCH_SIZE) {
        const batch = errorRecords.slice(start, start + BATCH_SIZE);
        const { error: errInsErr } = await supabase
          .from("validation_errors")
          .insert(batch);
        if (errInsErr) throw new Error(`Validation error insert failed: ${errInsErr.message}`);
      }

      console.log(`[process-report] Inserted ${errorRecords.length} validation errors`);

      // Group errors by row_index so one multi-error row gets ONE task with a full errors[] array.
      const errorsByRow = new Map<number, ValidationError[]>();
      for (const e of validationErrors) {
        const bucket = errorsByRow.get(e.row_index) ?? [];
        bucket.push(e);
        errorsByRow.set(e.row_index, bucket);
      }

      const reviewTasks = Array.from(errorsByRow.entries()).map(([rowIdx, rowErrors]) => {
        const primary = rowErrors[0];
        const worstSeverity = rowErrors.some((e) => e.severity === "critical") ? "critical" : "warning";
        const mappedTaskType = mapValidationErrorToTaskType(primary.error_type);
        const serializedErrors = rowErrors.map((e) => ({
          type: e.error_type,
          field: e.field,
          actual: e.actual,
          expected: e.expected,
          severity: e.severity,
          message: e.message,
        }));
        const payload = {
          error_type: primary.error_type,
          field: primary.field,
          actual: primary.actual,
          expected: primary.expected,
          row_index: rowIdx,
          source_page: normalizedRows[rowIdx]?.source_page ?? null,
          transaction_id: insertedTransactionIds[rowIdx] ?? null,
          errors: serializedErrors,
        };
        return {
          report_id,
          company_id: workspaceCompanyId,
          user_id: report.user_id,
          source_row_id: insertedSourceRowIds[rowIdx] ?? null,
          source_field_id: null,
          task_type: mappedTaskType,
          severity: worstSeverity,
          status: "open",
          reason: rowErrors.length > 1
            ? `${rowErrors.length} issues on this row (${rowErrors.map((e) => e.error_type).join(", ")})`
            : primary.message,
          payload,
        };
      });

      for (let start = 0; start < reviewTasks.length; start += BATCH_SIZE) {
        const batch = reviewTasks.slice(start, start + BATCH_SIZE);
        const { error: taskErr } = await supabase.from("review_tasks").insert(batch);
        if (taskErr) throw new Error(`Review task insert failed: ${taskErr.message}`);
      }

      console.log(`[process-report] Inserted ${reviewTasks.length} row-grouped review tasks (from ${validationErrors.length} errors`);
    }

    // 10.5 Insert mapping unresolved tasks for each unique unmapped header
    if (unmappedHeaders.size > 0) {
      const mappingTasks = Array.from(unmappedHeaders).map(header => {
        // Find a sample source_row for this header
        const sampleRowIndex = rawRows.findIndex((r) => {
          const structuredSourceFields = Array.isArray((r as any)._source_fields)
            ? ((r as any)._source_fields as StructuredSourceField[])
            : null;
          if (structuredSourceFields && structuredSourceFields.length > 0) {
            return structuredSourceFields.some((field) => field.raw_header === header);
          }
          return r[header] !== undefined;
        });
        return {
          report_id,
          company_id: workspaceCompanyId,
          user_id: report.user_id,
          source_row_id: sampleRowIndex !== -1 ? insertedSourceRowIds[sampleRowIndex] : null,
          task_type: "mapping_unresolved",
          severity: "warning",
          status: "open",
          reason: `Unknown column header: "${header}"`,
          payload: {
            unmapped_header: header,
            actual: header,
            error_type: "mapping_unmapped_header",
          }
        };
      });

      const { error: mTaskErr } = await supabase.from("review_tasks").insert(mappingTasks);
      if (mTaskErr) console.error("[process-report] Failed to insert mapping tasks:", mTaskErr.message);
      else console.log(`[process-report] Created ${mappingTasks.length} mapping review tasks`);
    }


    // 11. Compute final quality gate and update report with results
    const totalRevenue = normalizedRows.reduce(
      (sum, r) => sum + (r.gross_revenue ?? 0),
      0
    );
    const statementCurrency = (() => {
      const counts = new Map<string, number>();
      for (const tx of transactions) {
        const raw =
          tx.currency_reporting ??
          tx.currency_original ??
          tx.currency ??
          null;
        const code = normalizeCurrencyCode(raw);
        if (!code) continue;
        counts.set(code, (counts.get(code) ?? 0) + 1);
      }
      let winner: string | null = null;
      let max = -1;
      for (const [code, count] of counts.entries()) {
        if (count > max) { max = count; winner = code; }
      }
      return winner;
    })();
    const pageCount = lane === "structured" ? 1 : document?.pages?.length ?? 0;

    // Determine final status from actual error counts (not a hardcoded default)
    const openTaskCount = validationErrors.length;  // every validation error produces a task
    const hasCritical = validationErrors.some((e) => e.severity === "critical");
    const qualityGateStatus: "passed" | "needs_review" | "failed" =
      hasCritical ? "failed" : openTaskCount > 0 ? "needs_review" : "passed";
    const reportFinalStatus: "completed_passed" | "completed_with_warnings" | "needs_review" =
      hasCritical
        ? "needs_review"
        : openTaskCount > 0
          ? "completed_with_warnings"
          : "completed_passed";

    {
      const { error: reportUpdateErr } = await supabase
        .from("cmo_reports")
        .update({
          status: reportFinalStatus,
          quality_gate_status: qualityGateStatus,
          processed_at: new Date().toISOString(),
          transaction_count: transactions.length,
          accuracy_score: Math.round(accuracy * 100) / 100,
          error_count: validationErrors.length,
          total_revenue: Math.round(totalRevenue * 100) / 100,
          statement_currency: statementCurrency,
          page_count: pageCount,
        })
        .eq("id", report_id);
      if (reportUpdateErr) throw new Error(`Failed to update report summary: ${reportUpdateErr.message}`);
    }

    console.log(`[process-report] Done. ${transactions.length} transactions, ${accuracy.toFixed(1)}% accuracy`);

    return new Response(
      JSON.stringify({
        status: reportFinalStatus,
        quality_gate: qualityGateStatus,
        document_kind: documentFamily.document_kind,
        business_side: documentFamily.business_side,
        parser_lane: documentFamily.parser_lane,
        transactions: transactions.length,
        split_claims: typedSplitClaimCount,
        errors: validationErrors.length,
        accuracy: Math.round(accuracy * 100) / 100,
        pages: pageCount,
        revenue: Math.round(totalRevenue * 100) / 100,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("[process-report] FAILED:", error);

    // Try to mark report as failed
    try {
      if (reportId) {
        const sb = createClient(supabaseUrl, supabaseServiceKey);
        await sb.from("cmo_reports").update({ status: "failed" }).eq("id", reportId);
      }
    } catch (_) {
      // best effort
    }

    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
