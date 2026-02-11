import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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

  for (let pageIdx = 0; pageIdx < (document.pages || []).length; pageIdx++) {
    const page = document.pages[pageIdx];
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
  LABEL: "label_name",
  PUBLISHER: "publisher_name",
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
] as const;

const DOCUMENT_AI_ITEM_FIELDS = [
  "report_item",
  "amount_in_original_currency",
  "amount_in_reporting_currency",
  "channel",
  "config_type",
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
  for (const v of Object.values(row)) {
    if (typeof v === "string") {
      const upper = v.toUpperCase();
      if (["TOTAL", "SUBTOTAL", "SUM", "GRAND"].some((kw) => upper.includes(kw)))
        return true;
    }
  }
  return false;
}

function isSummaryOrLikelyNonDataRow(row: Record<string, any>): boolean {
  for (const v of Object.values(row)) {
    if (typeof v === "string") {
      const upper = v.toUpperCase();
      if (["TOTAL", "SUBTOTAL", "SUM", "GRAND"].some((kw) => upper.includes(kw)))
        return true;
    }
  }
  if (!row.isrc && !row.track_title) return true;
  return false;
}

function hasTransactionSignal(row: Record<string, any>): boolean {
  for (const key of TRANSACTION_SIGNAL_FIELDS) {
    const value = row[key];
    if (value == null) continue;
    if (typeof value === "string" && value.trim() === "") continue;
    return true;
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
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => {
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
    .map((entity, idx) => {
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
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => {
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

function normalizeRow(row: TransactionRow): TransactionRow {
  const r = { ...row };
  r.isrc = normalizeISRC(r.isrc);
  r.territory = normalizeTerritory(r.territory);
  r.platform = normalizePlatform(r.platform);
  for (const col of [
    "gross_revenue",
    "commission",
    "net_revenue",
    "publisher_share",
  ]) {
    if (r[col] != null) r[col] = parseCurrency(r[col]);
  }
  if (r.usage_count != null) {
    const n = parseInt(String(r.usage_count).replace(/[^0-9]/g, ""), 10);
    r.usage_count = isNaN(n) ? null : n;
  }
  // Clean strings
  for (const col of ["track_title", "artist_name", "track_artist", "release_title", "label_name", "publisher_name"]) {
    if (typeof r[col] === "string") {
      r[col] = r[col].replace(/\s+/g, " ").trim() || null;
    }
  }
  return r;
}

// ─── Validation ──────────────────────────────────────────────────────

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
  tolerance = 0.01
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

    // Required fields
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

  const criticalRows = new Set(
    errors.filter((e) => e.severity === "critical").map((e) => e.row_index)
  );
  const validRows = rows.length - criticalRows.size;
  const accuracy = rows.length > 0 ? (validRows / rows.length) * 100 : 0;

  return { errors, accuracy };
}

// ─── Main Handler ────────────────────────────────────────────────────

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

    // 1. Fetch report metadata
    const { data: report, error: fetchErr } = await supabase
      .from("cmo_reports")
      .select("*")
      .eq("id", report_id)
      .single();

    if (fetchErr || !report) {
      throw new Error(`Report not found: ${fetchErr?.message}`);
    }

    if (!isServiceRoleCaller && report.user_id !== authedUserId) {
      return new Response(
        JSON.stringify({ error: "Forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Update status to processing
    await supabase
      .from("cmo_reports")
      .update({ status: "processing" })
      .eq("id", report_id);

    // Reprocessing safety: clear prior outputs for this report to avoid duplicates.
    await supabase.from("validation_errors").delete().eq("report_id", report_id);
    await supabase.from("royalty_transactions").delete().eq("report_id", report_id);
    await supabase.from("document_ai_report_items").delete().eq("report_id", report_id);

    // 3. Download PDF from storage
    const { data: pdfData, error: dlErr } = await supabase.storage
      .from("cmo-reports")
      .download(report.file_path);

    if (dlErr || !pdfData) {
      throw new Error(`Failed to download PDF: ${dlErr?.message}`);
    }

    const pdfBytes = new Uint8Array(await pdfData.arrayBuffer());
    // Chunk the conversion to avoid call stack overflow on large files
    let binary = "";
    const CHUNK = 8192;
    for (let i = 0; i < pdfBytes.length; i += CHUNK) {
      binary += String.fromCharCode(...pdfBytes.subarray(i, i + CHUNK));
    }
    const pdfBase64 = btoa(binary);

    console.log(`[process-report] PDF downloaded (${pdfBytes.byteLength} bytes)`);

    // 4. Call Google Document AI
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

    console.log(`[process-report] Calling Document AI...`);

    const aiResp = await fetch(docAIUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        rawDocument: {
          content: pdfBase64,
          mimeType: "application/pdf",
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
    const document = aiResult.document;

    console.log(`[process-report] Document AI returned ${document.pages?.length ?? 0} pages`);

    // 5. Persist all Custom Extractor report-item fields for full-fidelity access.
    const extractedItems = extractDocumentAiReportItems(document);
    if (extractedItems.length > 0) {
      const extractedRows = extractedItems.map((item) => ({
        report_id,
        user_id: report.user_id,
        source_page: item.source_page,
        item_index: item.item_index,
        report_item: item.report_item,
        amount_in_original_currency: item.amount_in_original_currency,
        amount_in_reporting_currency: item.amount_in_reporting_currency,
        channel: item.channel,
        config_type: item.config_type,
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
          throw new Error(`Failed to insert Document AI extracted items: ${docAiInsertErr.message}`);
        }
      }

      console.log(`[process-report] Saved ${extractedRows.length} document_ai_report_items rows`);
    } else {
      console.log("[process-report] No document_ai_report_items extracted from entities");
    }

    let rawRows: TransactionRow[] = [];
    const usingCustomItems = extractedItems.length > 0;

    // Prefer directly mapping Custom Extractor `report_item` rows when available.
    if (extractedItems.length > 0) {
      rawRows = extractedItems
        .map((item) => ({
          source_page: item.source_page,
          source_row: item.item_index,
          ocr_confidence: item.ocr_confidence ?? 0,
          track_title: item.track_title,
          track_artist: item.track_artist ?? item.release_artist,
          release_title: item.release_title,
          isrc: item.isrc,
          upc: item.release_upc,
          platform: item.channel,
          territory: item.country,
          usage_count: item.quantity,
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
      const tables = parseDocumentAIResponse(document);
      rawRows = reconstructTables(tables);
      if (rawRows.length === 0) {
        rawRows = reconstructEntities(document);
      }
      console.log(`[process-report] Built ${rawRows.length} transaction candidates from fallback parsers`);
    }

    if (rawRows.length === 0) {
      // No data extracted
      await supabase
        .from("cmo_reports")
        .update({
          status: "completed",
          processed_at: new Date().toISOString(),
          transaction_count: 0,
          accuracy_score: 0,
          error_count: 0,
          total_revenue: 0,
        })
        .eq("id", report_id);

      return new Response(
        JSON.stringify({
          status: "completed",
          message:
            "No structured transaction rows found in document. If using Custom Extractor, add labels for transaction fields (track title/ISRC/platform/territory/revenue).",
          transactions: 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 7. Normalize
    const normalizedRows = rawRows.map(normalizeRow);

    // 8. Validate
    // For custom extractor mode, we skip strict validation/error expansion to keep
    // processing within edge runtime limits and avoid low-value warning floods.
    let validationErrors: ValidationError[] = [];
    let accuracy = 100;
    let criticalRowIndices = new Set<number>();
    if (!usingCustomItems) {
      const validation = validateRows(normalizedRows);
      validationErrors = validation.errors;
      accuracy = validation.accuracy;
      const criticalErrors = validationErrors.filter(
        (e) => e.severity === "critical"
      );
      criticalRowIndices = new Set(criticalErrors.map((e) => e.row_index));
    }

    // 9. Insert transactions into royalty_transactions
    const transactions = normalizedRows.map((r, i) => ({
      report_id,
      user_id: report.user_id,
      track_title: r.track_title || r.artist_name || null,
      artist_name: r.track_artist || r.artist_name || null,
      isrc: r.isrc || null,
      iswc: r.iswc || null,
      platform: r.platform || null,
      territory: r.territory || null,
      quantity: r.usage_count || null,
      gross_revenue: r.gross_revenue ?? null,
      commission: r.commission ?? null,
      net_revenue: r.net_revenue ?? null,
      currency: "USD",
      source_page: r.source_page ?? null,
      source_row: r.source_row ?? null,
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
    }));

    // Insert in batches of 500
    const BATCH_SIZE = 500;
    for (let start = 0; start < transactions.length; start += BATCH_SIZE) {
      const batch = transactions.slice(start, start + BATCH_SIZE);
      const { error: insErr } = await supabase
        .from("royalty_transactions")
        .insert(batch);
      if (insErr) {
        console.error(`[process-report] Insert error at batch ${start}:`, insErr.message);
        throw new Error(`Failed to insert transactions: ${insErr.message}`);
      }
    }

    console.log(`[process-report] Inserted ${transactions.length} transactions`);

    // 10. Insert validation errors
    if (!usingCustomItems && validationErrors.length > 0) {
      const errorRecords = validationErrors.map((e) => ({
        report_id,
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
        if (errInsErr) {
          console.error(`[process-report] Validation error insert failed:`, errInsErr.message);
        }
      }

      console.log(`[process-report] Inserted ${errorRecords.length} validation errors`);
    }

    // 11. Update report with results
    const totalRevenue = normalizedRows.reduce(
      (sum, r) => sum + (r.gross_revenue ?? 0),
      0
    );

    await supabase
      .from("cmo_reports")
      .update({
        status: "completed",
        processed_at: new Date().toISOString(),
        transaction_count: transactions.length,
        accuracy_score: Math.round(accuracy * 100) / 100,
        error_count: validationErrors.length,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        page_count: document.pages?.length ?? 0,
      })
      .eq("id", report_id);

    console.log(`[process-report] Done. ${transactions.length} transactions, ${accuracy.toFixed(1)}% accuracy`);

    return new Response(
      JSON.stringify({
        status: "completed",
        transactions: transactions.length,
        errors: validationErrors.length,
        accuracy: Math.round(accuracy * 100) / 100,
        pages: document.pages?.length ?? 0,
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
