import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "artifacts");
const OUT_FILE = path.join(OUT_DIR, "ordersounds-5-year-financial-projections.xlsx");

const years = [2026, 2027, 2028, 2029, 2030];

const assumptions = {
  currency: "USD",
  avgPayingWorkspaces: [8, 28, 80, 170, 320],
  blendedArpaMonthly: [350, 450, 575, 725, 850],
  aiUpliftPct: [0.05, 0.08, 0.12, 0.16, 0.18],
  cogsPct: [0.18, 0.19, 0.2, 0.21, 0.21],
  productAndEngineering: [170000, 260000, 420000, 630000, 840000],
  salesAndMarketing: [30000, 70000, 180000, 360000, 650000],
  generalAndAdmin: [50000, 80000, 120000, 180000, 260000],
  notes: [
    "Illustrative internal planning model based on current B2B beta stage and design-partner traction.",
    "Revenue model assumes B2B SaaS subscriptions plus AI/usage expansion revenue over time.",
    "Figures are editable and intended as a fundraising/accelerator planning draft, not audited guidance.",
  ],
};

const projectionRows = [];

for (let i = 0; i < years.length; i += 1) {
  const subscriptionRevenue =
    assumptions.avgPayingWorkspaces[i] * assumptions.blendedArpaMonthly[i] * 12;
  const aiRevenue = subscriptionRevenue * assumptions.aiUpliftPct[i];
  const totalRevenue = subscriptionRevenue + aiRevenue;
  const cogs = totalRevenue * assumptions.cogsPct[i];
  const grossProfit = totalRevenue - cogs;
  const totalOperatingExpenses =
    assumptions.productAndEngineering[i] +
    assumptions.salesAndMarketing[i] +
    assumptions.generalAndAdmin[i];
  const ebitda = grossProfit - totalOperatingExpenses;
  const netProfitLoss = ebitda;

  projectionRows.push({
    year: years[i],
    subscriptionRevenue,
    aiRevenue,
    totalRevenue,
    cogs,
    grossProfit,
    productAndEngineering: assumptions.productAndEngineering[i],
    salesAndMarketing: assumptions.salesAndMarketing[i],
    generalAndAdmin: assumptions.generalAndAdmin[i],
    totalOperatingExpenses,
    ebitda,
    netProfitLoss,
  });
}

const wb = XLSX.utils.book_new();

const summaryData = [
  ["OrderSounds", "5-Year Financial Projections"],
  ["Currency", assumptions.currency],
  ["Model period", `${years[0]}-${years[years.length - 1]}`],
  [],
  ["Key output", years[0], years[1], years[2], years[3], years[4]],
  ["Revenue", ...projectionRows.map((row) => row.totalRevenue)],
  ["Gross Profit", ...projectionRows.map((row) => row.grossProfit)],
  ["EBITDA", ...projectionRows.map((row) => row.ebitda)],
  ["Net Profit / Loss", ...projectionRows.map((row) => row.netProfitLoss)],
  [],
  ["Notes"],
  ...assumptions.notes.map((note) => [note]),
];

const assumptionsData = [
  ["OrderSounds", "Financial Model Assumptions"],
  ["Currency", assumptions.currency],
  [],
  ["Driver", ...years],
  ["Average Paying Workspaces", ...assumptions.avgPayingWorkspaces],
  ["Blended ARPA / Month", ...assumptions.blendedArpaMonthly],
  ["AI / Usage Revenue Uplift %", ...assumptions.aiUpliftPct],
  ["COGS % of Revenue", ...assumptions.cogsPct],
  ["Product & Engineering", ...assumptions.productAndEngineering],
  ["Sales & Marketing", ...assumptions.salesAndMarketing],
  ["General & Admin", ...assumptions.generalAndAdmin],
];

const projectionData = [
  ["Metric", ...years],
  ["Subscription Revenue", ...projectionRows.map((row) => row.subscriptionRevenue)],
  ["AI / Usage Revenue", ...projectionRows.map((row) => row.aiRevenue)],
  ["Total Revenue", ...projectionRows.map((row) => row.totalRevenue)],
  ["COGS", ...projectionRows.map((row) => row.cogs)],
  ["Gross Profit", ...projectionRows.map((row) => row.grossProfit)],
  ["Product & Engineering", ...projectionRows.map((row) => row.productAndEngineering)],
  ["Sales & Marketing", ...projectionRows.map((row) => row.salesAndMarketing)],
  ["General & Admin", ...projectionRows.map((row) => row.generalAndAdmin)],
  ["Total Operating Expenses", ...projectionRows.map((row) => row.totalOperatingExpenses)],
  ["EBITDA", ...projectionRows.map((row) => row.ebitda)],
  ["Net Profit / Loss", ...projectionRows.map((row) => row.netProfitLoss)],
];

function makeSheet(data, widths) {
  const sheet = XLSX.utils.aoa_to_sheet(data);
  sheet["!cols"] = widths.map((wch) => ({ wch }));
  return sheet;
}

const summarySheet = makeSheet(summaryData, [28, 16, 16, 16, 16, 16]);
const assumptionsSheet = makeSheet(assumptionsData, [28, 14, 14, 14, 14, 14]);
const projectionSheet = makeSheet(projectionData, [28, 16, 16, 16, 16, 16]);

const currencyRows = new Set([
  6, 7, 8,  // summary 1-indexed excel rows
  8, 9, 10, // assumptions expenses overlap but harmless
]);

function applyFormats(sheet, sheetName) {
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[ref];
      if (!cell || typeof cell.v !== "number") continue;

      if (sheetName === "Assumptions" && (r === 6 || r === 7)) {
        cell.z = "0.0%";
      } else if (sheetName === "Assumptions" && r >= 4) {
        cell.z = "$#,##0";
      } else if (sheetName === "Summary" && r >= 5 && c >= 1) {
        cell.z = "$#,##0";
      } else if (sheetName === "Projection" && r >= 1 && c >= 1) {
        cell.z = "$#,##0";
      }
    }
  }
}

applyFormats(summarySheet, "Summary");
applyFormats(assumptionsSheet, "Assumptions");
applyFormats(projectionSheet, "Projection");

XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
XLSX.utils.book_append_sheet(wb, assumptionsSheet, "Assumptions");
XLSX.utils.book_append_sheet(wb, projectionSheet, "Projection");

await fs.mkdir(OUT_DIR, { recursive: true });
XLSX.writeFile(wb, OUT_FILE);
console.log(`Wrote ${OUT_FILE}`);
