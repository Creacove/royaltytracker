export type ParserLane = "income" | "rights" | "mixed";
export type DocumentKind =
  | "income_statement"
  | "rights_catalog"
  | "split_sheet"
  | "contract_summary"
  | "mixed_statement";
export type BusinessSide = "publishing" | "recording" | "mixed" | "unknown";

type InputRow = Record<string, unknown>;

type ValidationError = {
  row_index: number;
  field: string;
  message: string;
};

function hasValue(value: unknown): boolean {
  return typeof value === "number"
    ? Number.isFinite(value)
    : typeof value === "string"
      ? value.trim().length > 0
      : value != null;
}

function rowHasAny(row: InputRow, fields: string[]): boolean {
  return fields.some((field) => hasValue(row[field]));
}

function rowHasSourceSplitShare(row: InputRow): boolean {
  return rowHasAny(row, [
    "de_share",
    "dr_share",
    "ph_share",
    "source_de_share",
    "source_dr_share",
    "source_ph_share",
    "source_rights_code",
    "source_rights_label",
  ]);
}

export function classifyDocumentFamily(rows: InputRow[]): {
  document_kind: DocumentKind;
  parser_lane: ParserLane;
  business_side: BusinessSide;
} {
  const incomeRows = rows.filter((row) =>
    rowHasAny(row, ["net_revenue", "gross_revenue", "amount_reporting", "amount_original"]) ||
    (rowHasAny(row, ["platform", "territory"]) && rowHasAny(row, ["track_title", "isrc", "quantity"])),
  );
  const rightsRows = rows.filter((row) =>
    rowHasAny(row, ["iswc", "share_pct", "rightsholder_name", "party_name", "work_title", "publisher_name", "ipi_number", "source_role"]) ||
    rowHasSourceSplitShare(row),
  );

  const parser_lane: ParserLane =
    incomeRows.length > 0 && rightsRows.length > 0
      ? "mixed"
      : incomeRows.length > 0
        ? "income"
        : "rights";

  const document_kind: DocumentKind =
    parser_lane === "mixed"
      ? "mixed_statement"
      : parser_lane === "income"
        ? "income_statement"
        : rowHasAny(rows[0] ?? {}, ["effective_start", "effective_end", "term_mode"])
          ? "contract_summary"
          : rowHasSourceSplitShare(rows[0] ?? {})
            ? "split_sheet"
            : rowHasAny(rows[0] ?? {}, ["share_pct", "split"])
            ? "rights_catalog"
            : "split_sheet";

  const publishing = rows.some((row) => rowHasAny(row, ["iswc", "writer_name", "publisher_name", "work_title", "ipi_number"]) || rowHasSourceSplitShare(row));
  const recording = rows.some((row) => rowHasAny(row, ["isrc", "track_title", "release_title", "upc"]));
  const business_side: BusinessSide = publishing && recording ? "mixed" : publishing ? "publishing" : recording ? "recording" : "unknown";

  return { document_kind, parser_lane, business_side };
}

export function validateRowsForLane(
  parserLane: ParserLane,
  rows: InputRow[],
): { errors: ValidationError[] } {
  if (parserLane !== "income" && parserLane !== "mixed") {
    return { errors: [] };
  }

  const errors: ValidationError[] = [];
  rows.forEach((row, index) => {
    for (const field of ["platform", "territory"]) {
      if (!hasValue(row[field])) {
        errors.push({
          row_index: index,
          field,
          message: `${field} is required for income rows`,
        });
      }
    }
  });

  return { errors };
}
