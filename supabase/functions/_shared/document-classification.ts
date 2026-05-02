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

export function rowHasRevenueSignal(row: InputRow): boolean {
  return rowHasAny(row, [
    "net_revenue",
    "gross_revenue",
    "amount_reporting",
    "amount_original",
    "commission",
    "publisher_share",
  ]) ||
    (rowHasAny(row, ["platform", "channel", "territory", "country"]) &&
      rowHasAny(row, ["track_title", "work_title", "isrc", "iswc", "quantity", "usage_count"])) ||
    (rowHasAny(row, ["sales_start", "sales_end", "report_date", "period_start", "period_end"]) &&
      rowHasAny(row, ["quantity", "usage_count", "net_revenue", "gross_revenue"]));
}

export function rowHasExplicitSplitSignal(row: InputRow): boolean {
  const hasSourceSplit = rowHasSourceSplitShare(row);
  const hasShare = rowHasAny(row, ["share_pct", "split", "ownership_share", "writer_share", "publisher_share_pct"]);
  const hasParty = rowHasAny(row, ["rightsholder_name", "party_name", "writer_name", "publisher_name", "ipi_number"]);
  const hasRole = rowHasAny(row, ["source_role", "role"]);

  return hasSourceSplit || (hasShare && (hasParty || hasRole));
}

export function rowHasContractSignal(row: InputRow): boolean {
  return rowHasAny(row, ["effective_start", "effective_end", "term_mode", "agreement_type", "contract_type"]);
}

export function classifyDocumentFamily(rows: InputRow[]): {
  document_kind: DocumentKind;
  parser_lane: ParserLane;
  business_side: BusinessSide;
} {
  const incomeRows = rows.filter(rowHasRevenueSignal);
  const explicitSplitRows = rows.filter(rowHasExplicitSplitSignal);
  const contractRows = rows.filter(rowHasContractSignal);
  const hasSourceSplitShares = rows.some(rowHasSourceSplitShare);

  const hasIncome = incomeRows.length > 0;
  const hasExplicitSplits = explicitSplitRows.length > 0;
  const hasContracts = contractRows.length > 0;
  const hasStandaloneSplitRows = explicitSplitRows.some((row) => !rowHasRevenueSignal(row));

  const parser_lane: ParserLane =
    hasIncome && hasStandaloneSplitRows
        ? "mixed"
        : hasIncome
        ? "income"
        : hasExplicitSplits || hasContracts
          ? "rights"
          : "rights";

  const document_kind: DocumentKind =
    parser_lane === "mixed"
      ? "mixed_statement"
      : parser_lane === "income"
        ? "income_statement"
        : hasContracts
          ? "contract_summary"
          : hasSourceSplitShares
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
