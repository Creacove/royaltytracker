#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

const HEADERS = [
  "Report Item",
  "Report Date",
  "Sales Start",
  "Sales End",
  "Track Title",
  "Track Artist",
  "Artist Name",
  "Release Title",
  "Release UPC",
  "ISRC",
  "ISWC",
  "Label",
  "Publisher",
  "Channel",
  "Platform",
  "Country",
  "Territory",
  "Config Type",
  "Usage Type",
  "Quantity",
  "Unit",
  "Gross Revenue",
  "Commission",
  "Net Revenue",
  "Publisher Share",
  "Royalty Revenue",
  "Amount in Original Currency",
  "Original Currency",
  "Amount in Reporting Currency",
  "Reporting Currency",
  "Exchange Rate",
  "Rights Type",
  "Contract ID",
  "Deal ID",
  "License Type",
  "Distribution Cycle",
  "Society",
  "Claim Status",
];

const REQUIRED_COVERAGE_HEADERS = ["Track Title", "Platform", "Territory"];

const DEFAULTS = {
  rowsPerFile: 500,
  files: 3,
  artists: 10,
  from: "2019-01-01",
  to: new Date().toISOString().slice(0, 10),
  profile: "demo-realistic",
  seed: "20260312",
  out: "demo-data",
  anomalyRate: 0.05,
};

const FILE_PROFILES = [
  {
    key: "dsp_streaming",
    fileName: "demo-cmr-01_dsp_streaming.xlsx",
    channels: ["Streaming", "UGC Video", "Short-Video"],
    platformWeights: [
      ["Spotify", 0.34],
      ["Apple Music", 0.2],
      ["YouTube", 0.2],
      ["Amazon Music", 0.12],
      ["Deezer", 0.08],
      ["TikTok Music", 0.06],
    ],
    usageTypeWeights: [
      ["On Demand Audio", 0.55],
      ["Ad-Supported Stream", 0.2],
      ["UGC", 0.15],
      ["Subscription Stream", 0.1],
    ],
    rightsTypeWeights: [
      ["Performance", 0.45],
      ["Mechanical", 0.35],
      ["Neighboring", 0.2],
    ],
    commissionRange: [0.1, 0.22],
    quantityRange: [400, 80000],
    unitWeights: [["Streams", 0.75], ["Views", 0.2], ["Plays", 0.05]],
    periodDaysRange: [7, 45],
    reportingCurrencyWeights: [["USD", 0.7], ["EUR", 0.15], ["GBP", 0.15]],
    originalCurrencyWeights: [
      ["USD", 0.42],
      ["EUR", 0.18],
      ["GBP", 0.12],
      ["NGN", 0.1],
      ["ZAR", 0.1],
      ["JPY", 0.08],
    ],
  },
  {
    key: "public_performance",
    fileName: "demo-cmr-02_public_performance.xlsx",
    channels: ["Radio", "TV", "Public Performance"],
    platformWeights: [
      ["Broadcast Radio", 0.35],
      ["Television", 0.2],
      ["Public Venue", 0.2],
      ["Spotify", 0.1],
      ["YouTube", 0.1],
      ["Apple Music", 0.05],
    ],
    usageTypeWeights: [
      ["Broadcast", 0.5],
      ["Public Performance", 0.3],
      ["Linear TV", 0.2],
    ],
    rightsTypeWeights: [
      ["Performance", 0.6],
      ["Mechanical", 0.15],
      ["Synchronization", 0.25],
    ],
    commissionRange: [0.18, 0.35],
    quantityRange: [20, 12000],
    unitWeights: [["Performances", 0.5], ["Plays", 0.35], ["Views", 0.15]],
    periodDaysRange: [28, 92],
    reportingCurrencyWeights: [["USD", 0.6], ["EUR", 0.2], ["GBP", 0.2]],
    originalCurrencyWeights: [
      ["USD", 0.3],
      ["EUR", 0.22],
      ["GBP", 0.15],
      ["NGN", 0.1],
      ["ZAR", 0.1],
      ["JPY", 0.13],
    ],
  },
  {
    key: "mixed_rights_fx",
    fileName: "demo-cmr-03_mixed_rights_fx.xlsx",
    channels: ["Streaming", "Radio", "Social", "Public Performance"],
    platformWeights: [
      ["Spotify", 0.2],
      ["YouTube", 0.18],
      ["Apple Music", 0.12],
      ["Broadcast Radio", 0.15],
      ["Public Venue", 0.12],
      ["Amazon Music", 0.1],
      ["TikTok Music", 0.08],
      ["Deezer", 0.05],
    ],
    usageTypeWeights: [
      ["On Demand Audio", 0.35],
      ["Broadcast", 0.22],
      ["UGC", 0.15],
      ["Public Performance", 0.2],
      ["Synchronization", 0.08],
    ],
    rightsTypeWeights: [
      ["Performance", 0.42],
      ["Mechanical", 0.28],
      ["Synchronization", 0.2],
      ["Neighboring", 0.1],
    ],
    commissionRange: [0.12, 0.3],
    quantityRange: [30, 50000],
    unitWeights: [["Streams", 0.45], ["Performances", 0.3], ["Views", 0.15], ["Plays", 0.1]],
    periodDaysRange: [14, 92],
    reportingCurrencyWeights: [["USD", 0.45], ["EUR", 0.2], ["GBP", 0.2], ["JPY", 0.15]],
    originalCurrencyWeights: [
      ["USD", 0.18],
      ["EUR", 0.2],
      ["GBP", 0.16],
      ["NGN", 0.16],
      ["ZAR", 0.14],
      ["JPY", 0.16],
    ],
  },
];

const TERRITORIES = [
  { code: "US", country: "United States", weight: 0.18 },
  { code: "GB", country: "United Kingdom", weight: 0.12 },
  { code: "DE", country: "Germany", weight: 0.09 },
  { code: "FR", country: "France", weight: 0.08 },
  { code: "NG", country: "Nigeria", weight: 0.07 },
  { code: "ZA", country: "South Africa", weight: 0.06 },
  { code: "CA", country: "Canada", weight: 0.06 },
  { code: "AU", country: "Australia", weight: 0.06 },
  { code: "BR", country: "Brazil", weight: 0.05 },
  { code: "JP", country: "Japan", weight: 0.05 },
  { code: "NL", country: "Netherlands", weight: 0.04 },
  { code: "SE", country: "Sweden", weight: 0.03 },
  { code: "ES", country: "Spain", weight: 0.03 },
  { code: "IT", country: "Italy", weight: 0.03 },
  { code: "MX", country: "Mexico", weight: 0.03 },
  { code: "KE", country: "Kenya", weight: 0.02 },
];

const FX_RATES_TO_USD = {
  USD: 1.0,
  EUR: 1.09,
  GBP: 1.27,
  NGN: 0.00067,
  ZAR: 0.053,
  JPY: 0.0067,
};

const SOCIETIES = ["PRS", "BMI", "ASCAP", "SACEM", "GEMA", "SAMRO", "SOCAN"];
const LICENSE_TYPES = ["Standard", "Premium", "Blanket", "Direct", "Co-pub"];
const DISTRIBUTION_CYCLES = ["Monthly", "Quarterly", "Semi-Annual"];
const CLAIM_STATUSES = ["Matched", "Pending", "Under Review", "Disputed", "Resolved"];
const PUBLISHERS = ["Northline Publishing", "Harborlight Rights", "Monarch Songs", "Bluebridge Publishing"];
const LABELS = ["Crescent House", "Signalline Records", "Atlas Tone", "Silverline Music", "Cinder Bloom"];

const FIRST_NAMES = [
  "Avery", "Jordan", "Maya", "Noah", "Zara", "Elijah", "Lena", "Kai", "Sofia", "Ethan",
  "Amara", "Leo", "Nia", "Micah", "Ivy", "Jude", "Raya", "Dylan", "Talia", "Miles",
];
const LAST_NAMES = [
  "Cole", "Bennett", "Reyes", "Foster", "Monroe", "Hart", "Okafor", "Santos", "Morgan", "King",
  "Hughes", "Nolan", "Adams", "Walsh", "Adebayo", "Fischer", "Meyer", "Grant", "Clarke", "Owens",
];
const TRACK_WORD_A = [
  "Midnight", "Neon", "Golden", "Paper", "Silent", "Rising", "Electric", "Crimson", "Velvet", "Broken",
  "Echo", "Shadow", "Marble", "Silver", "Fallen", "Summer", "Northern", "Parallel", "Lucky", "Wild",
];
const TRACK_WORD_B = [
  "Signal", "Skyline", "Pattern", "Empire", "Letters", "Current", "Machine", "Harbor", "Stories", "Gravity",
  "Compass", "District", "Garden", "Fever", "Road", "River", "Voltage", "Anthem", "Mirage", "Run",
];

function parseArgs(argv) {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value == null || value.startsWith("--")) continue;
    i += 1;
    if (["rows-per-file", "files", "artists", "seed"].includes(key)) {
      const mapKey = key === "rows-per-file" ? "rowsPerFile" : key;
      if (key === "seed") args.seed = String(value);
      else args[mapKey] = Number(value);
      continue;
    }
    if (key === "from") args.from = String(value);
    if (key === "to") args.to = String(value);
    if (key === "profile") args.profile = String(value);
    if (key === "out") args.out = String(value);
    if (key === "anomaly-rate") args.anomalyRate = Number(value);
  }
  return args;
}

function xmur3(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return function() {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
}

function mulberry32(a) {
  return function() {
    let t = a += 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const seedFn = xmur3(seed);
  return mulberry32(seedFn());
}

function randomInt(rng, min, max) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pickWeighted(rng, weightedPairs) {
  const total = weightedPairs.reduce((sum, [, w]) => sum + w, 0);
  let threshold = rng() * total;
  for (const [value, weight] of weightedPairs) {
    threshold -= weight;
    if (threshold <= 0) return value;
  }
  return weightedPairs[weightedPairs.length - 1][0];
}

function pick(rng, arr) {
  return arr[randomInt(rng, 0, arr.length - 1)];
}

function shuffleInPlace(rng, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function toIsoDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampDate(date, min, max) {
  if (date < min) return new Date(min);
  if (date > max) return new Date(max);
  return date;
}

function money(v) {
  return Number(v.toFixed(2));
}

function makeUpc(rng) {
  let s = "";
  for (let i = 0; i < 12; i++) s += String(randomInt(rng, 0, 9));
  return s;
}

function makeIsrc(rng, country) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const owner = `${pick(rng, letters)}${pick(rng, letters)}${pick(rng, letters)}`;
  const year = String(randomInt(rng, 19, 26)).padStart(2, "0");
  const des = String(randomInt(rng, 1, 99999)).padStart(5, "0");
  return `${country}${owner}${year}${des}`;
}

function makeIswc(rng) {
  const n1 = String(randomInt(rng, 100, 999));
  const n2 = String(randomInt(rng, 100, 999));
  const n3 = String(randomInt(rng, 100, 999));
  const chk = String(randomInt(rng, 0, 9));
  return `T-${n1}.${n2}.${n3}-${chk}`;
}

function buildRoster(rng, artistCount) {
  const names = [];
  const used = new Set();
  while (names.length < artistCount) {
    const full = `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_NAMES)}`;
    if (used.has(full)) continue;
    used.add(full);
    names.push(full);
  }

  return names.map((artistName, idx) => {
    const releaseCount = randomInt(rng, 2, 5);
    const releases = Array.from({ length: releaseCount }).map((_, rIdx) => ({
      releaseTitle: `${artistName.split(" ")[0]} ${pick(rng, TRACK_WORD_B)} Vol.${rIdx + 1}`,
      upc: makeUpc(rng),
      label: pick(rng, LABELS),
    }));
    const trackCount = randomInt(rng, 6, 14);
    const countryPool = ["US", "GB", "DE", "FR", "NG", "ZA", "CA", "AU", "BR", "JP", "SE", "ES"];
    const artistCountry = pick(rng, countryPool);
    const tracks = Array.from({ length: trackCount }).map((_, tIdx) => {
      const release = releases[tIdx % releases.length];
      return {
        trackTitle: `${pick(rng, TRACK_WORD_A)} ${pick(rng, TRACK_WORD_B)}`,
        isrc: makeIsrc(rng, artistCountry),
        iswc: rng() < 0.92 ? makeIswc(rng) : "",
        releaseTitle: release.releaseTitle,
        releaseUpc: release.upc,
        label: release.label,
      };
    });
    return {
      artistName,
      artistKey: `artist_${idx + 1}`,
      publisher: pick(rng, PUBLISHERS),
      tracks,
    };
  });
}

function selectSalesWindow(rng, fromDate, toDate, periodDaysRange) {
  const from = new Date(`${fromDate}T00:00:00.000Z`);
  const to = new Date(`${toDate}T00:00:00.000Z`);
  const maxStart = addDays(to, -Math.max(14, periodDaysRange[0]));
  const spanDays = Math.max(1, Math.floor((maxStart.getTime() - from.getTime()) / 86400000));
  const offsetDays = randomInt(rng, 0, spanDays);
  let start = addDays(from, offsetDays);
  if (rng() < 0.65) {
    start = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  }
  const periodDays = randomInt(rng, periodDaysRange[0], periodDaysRange[1]);
  let end = addDays(start, periodDays);
  end = clampDate(end, from, to);
  if (end < start) end = new Date(start);
  let reportDate = addDays(end, randomInt(rng, 10, 120));
  reportDate = clampDate(reportDate, end, addDays(to, 200));
  return { start, end, reportDate };
}

function buildBaseRow({
  rng,
  profile,
  roster,
  rowIndex,
  fromDate,
  toDate,
}) {
  const artist = pick(rng, roster);
  const track = pick(rng, artist.tracks);
  const territoryObj = pickWeighted(rng, TERRITORIES.map((t) => [t, t.weight]));
  const channel = pick(rng, profile.channels);
  const platform = pickWeighted(rng, profile.platformWeights);
  const usageType = pickWeighted(rng, profile.usageTypeWeights);
  const rightsType = pickWeighted(rng, profile.rightsTypeWeights);
  const unit = pickWeighted(rng, profile.unitWeights);
  const reportingCurrency = pickWeighted(rng, profile.reportingCurrencyWeights);
  const originalCurrency = pickWeighted(rng, profile.originalCurrencyWeights);
  const { start, end, reportDate } = selectSalesWindow(rng, fromDate, toDate, profile.periodDaysRange);

  const quantity = randomInt(rng, profile.quantityRange[0], profile.quantityRange[1]);
  const basePerUnit =
    unit === "Streams" ? rng() * 0.004 + 0.0007 :
    unit === "Views" ? rng() * 0.008 + 0.0012 :
    unit === "Performances" ? rng() * 1.8 + 0.25 :
    rng() * 0.4 + 0.04;
  const territoryMultiplier = 0.75 + rng() * 0.5;
  const rightsMultiplier =
    rightsType === "Synchronization" ? 1.5 :
    rightsType === "Performance" ? 1.15 :
    rightsType === "Neighboring" ? 1.05 : 1;
  const grossOriginal = money(quantity * basePerUnit * territoryMultiplier * rightsMultiplier);
  const commissionRate = profile.commissionRange[0] + rng() * (profile.commissionRange[1] - profile.commissionRange[0]);
  const commission = money(grossOriginal * commissionRate);
  const netOriginal = money(Math.max(0, grossOriginal - commission));

  const exRateToUsdOrig = FX_RATES_TO_USD[originalCurrency];
  const exRateToUsdRep = FX_RATES_TO_USD[reportingCurrency];
  const fx = money(exRateToUsdOrig / exRateToUsdRep);
  const amountReporting = money(grossOriginal * fx);
  const commissionReporting = money(commission * fx);
  const netReporting = money(Math.max(0, amountReporting - commissionReporting));
  const publisherShareRate = 0.35 + rng() * 0.3;
  const publisherShare = money(netReporting * publisherShareRate);

  return {
    "Report Item": `RI-${reportDate.getUTCFullYear()}-${String(rowIndex + 1).padStart(6, "0")}`,
    "Report Date": toIsoDate(reportDate),
    "Sales Start": toIsoDate(start),
    "Sales End": toIsoDate(end),
    "Track Title": track.trackTitle,
    "Track Artist": artist.artistName,
    "Artist Name": artist.artistName,
    "Release Title": track.releaseTitle,
    "Release UPC": track.releaseUpc,
    ISRC: track.isrc,
    ISWC: track.iswc,
    Label: track.label,
    Publisher: artist.publisher,
    Channel: channel,
    Platform: platform,
    Country: territoryObj.country,
    Territory: territoryObj.code,
    "Config Type": usageType,
    "Usage Type": usageType,
    Quantity: quantity,
    Unit: unit,
    "Gross Revenue": amountReporting,
    Commission: commissionReporting,
    "Net Revenue": netReporting,
    "Publisher Share": publisherShare,
    "Royalty Revenue": netReporting,
    "Amount in Original Currency": grossOriginal,
    "Original Currency": originalCurrency,
    "Amount in Reporting Currency": amountReporting,
    "Reporting Currency": reportingCurrency,
    "Exchange Rate": fx,
    "Rights Type": rightsType,
    "Contract ID": `CTR-${randomInt(rng, 1000, 9999)}-${randomInt(rng, 10, 99)}`,
    "Deal ID": `DL-${randomInt(rng, 100000, 999999)}`,
    "License Type": pick(rng, LICENSE_TYPES),
    "Distribution Cycle": pick(rng, DISTRIBUTION_CYCLES),
    Society: pick(rng, SOCIETIES),
    "Claim Status": pick(rng, CLAIM_STATUSES),
  };
}

function applyAnomalies(rng, rows, anomalyCount) {
  const anomalyStats = {
    gross_net_mismatch: 0,
    missing_non_critical: 0,
    mapping_friction_alias: 0,
    unknown_classification: 0,
  };
  if (anomalyCount <= 0) return anomalyStats;

  const targetIndices = shuffleInPlace(rng, Array.from({ length: rows.length }, (_, i) => i)).slice(0, anomalyCount);
  for (let i = 0; i < targetIndices.length; i++) {
    const idx = targetIndices[i];
    const row = rows[idx];
    const anomalyType = i % 4;
    if (anomalyType === 0) {
      const delta = money((rng() < 0.5 ? -1 : 1) * (rng() * 40 + 0.5));
      row["Net Revenue"] = money(Number(row["Net Revenue"]) + delta);
      row["Royalty Revenue"] = row["Net Revenue"];
      anomalyStats.gross_net_mismatch += 1;
    } else if (anomalyType === 1) {
      const candidates = ["ISWC", "Deal ID", "License Type", "Society", "Claim Status", "Release UPC"];
      row[pick(rng, candidates)] = "";
      anomalyStats.missing_non_critical += 1;
    } else if (anomalyType === 2) {
      const aliasPairs = [
        ["Platform", "Spotify Premium"],
        ["Platform", "AppleMusic"],
        ["Platform", "YT Music"],
        ["Platform", "Amazon Unlimited"],
        ["Channel", "Social Video UGC"],
      ];
      const [key, value] = pick(rng, aliasPairs);
      row[key] = value;
      anomalyStats.mapping_friction_alias += 1;
    } else {
      const unknownField = pick(rng, ["Claim Status", "Rights Type", "Config Type"]);
      row[unknownField] = pick(rng, ["Unknown", "TBD", "Unclassified"]);
      anomalyStats.unknown_classification += 1;
    }
  }

  return anomalyStats;
}

function computeCoverage(rows, header) {
  const nonEmpty = rows.filter((row) => String(row[header] ?? "").trim().length > 0).length;
  return rows.length === 0 ? 0 : nonEmpty / rows.length;
}

function computeFinancialPassRate(rows) {
  let pass = 0;
  for (const row of rows) {
    const gross = Number(row["Gross Revenue"]);
    const comm = Number(row["Commission"]);
    const net = Number(row["Net Revenue"]);
    if (Number.isFinite(gross) && Number.isFinite(comm) && Number.isFinite(net)) {
      const expected = money(gross - comm);
      if (Math.abs(expected - net) <= 0.01) pass += 1;
    }
  }
  return rows.length === 0 ? 0 : pass / rows.length;
}

function computeDatePassRate(rows) {
  let pass = 0;
  for (const row of rows) {
    const salesStart = new Date(`${row["Sales Start"]}T00:00:00.000Z`);
    const salesEnd = new Date(`${row["Sales End"]}T00:00:00.000Z`);
    const reportDate = new Date(`${row["Report Date"]}T00:00:00.000Z`);
    if (!Number.isNaN(salesStart.getTime()) && !Number.isNaN(salesEnd.getTime()) && !Number.isNaN(reportDate.getTime())) {
      if (salesStart <= salesEnd && reportDate >= salesEnd) pass += 1;
    }
  }
  return rows.length === 0 ? 0 : pass / rows.length;
}

function topMix(rows, key, limit = 8) {
  const map = new Map();
  for (const row of rows) {
    const v = String(row[key] ?? "").trim() || "Unknown";
    map.set(v, (map.get(v) ?? 0) + 1);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function ensureDir(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
}

function buildWorkbook(rows) {
  const orderedRows = rows.map((row) => {
    const out = {};
    for (const header of HEADERS) out[header] = row[header] ?? "";
    return out;
  });
  const ws = XLSX.utils.json_to_sheet(orderedRows, { header: HEADERS });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Statement");
  return wb;
}

function validateGlobalQuality(manifest) {
  const errors = [];
  for (const file of manifest.files) {
    if (file.rows !== manifest.config.rowsPerFile) {
      errors.push(`${file.file_name}: expected ${manifest.config.rowsPerFile} rows, got ${file.rows}`);
    }
    if (file.invalid_financial_row_rate > 0.08) {
      errors.push(`${file.file_name}: invalid financial row rate ${file.invalid_financial_row_rate} exceeds 0.08`);
    }
    for (const key of REQUIRED_COVERAGE_HEADERS) {
      if ((file.required_coverage[key] ?? 0) < 0.97) {
        errors.push(`${file.file_name}: required coverage ${key} below 0.97`);
      }
    }
  }
  return errors;
}

function run() {
  const args = parseArgs(process.argv);
  const rng = makeRng(String(args.seed));
  const outDir = path.resolve(args.out);
  ensureDir(outDir);

  const roster = buildRoster(rng, args.artists);
  const filesToGenerate = FILE_PROFILES.slice(0, args.files);
  const manifest = {
    generated_at: new Date().toISOString(),
    config: {
      rowsPerFile: args.rowsPerFile,
      files: filesToGenerate.length,
      artists: args.artists,
      from: args.from,
      to: args.to,
      profile: args.profile,
      seed: String(args.seed),
      anomaly_rate: args.anomalyRate,
      headers: HEADERS,
    },
    roster: {
      artists: roster.map((a) => ({
        artist_name: a.artistName,
        track_count: a.tracks.length,
        release_count: new Set(a.tracks.map((t) => t.releaseTitle)).size,
      })),
      total_tracks: roster.reduce((sum, a) => sum + a.tracks.length, 0),
    },
    files: [],
    quality_gate: {
      pass: true,
      errors: [],
    },
  };

  for (const profile of filesToGenerate) {
    const rows = [];
    for (let i = 0; i < args.rowsPerFile; i++) {
      rows.push(buildBaseRow({
        rng,
        profile,
        roster,
        rowIndex: i,
        fromDate: args.from,
        toDate: args.to,
      }));
    }

    const anomalyCount = Math.round(args.rowsPerFile * args.anomalyRate);
    const anomalyStats = applyAnomalies(rng, rows, anomalyCount);

    const wb = buildWorkbook(rows);
    const outFile = path.join(outDir, profile.fileName);
    XLSX.writeFile(wb, outFile);

    const requiredCoverage = Object.fromEntries(
      REQUIRED_COVERAGE_HEADERS.map((header) => [header, Number(computeCoverage(rows, header).toFixed(4))]),
    );
    const financialPassRate = computeFinancialPassRate(rows);
    const datePassRate = computeDatePassRate(rows);
    const invalidFinancialRowRate = Number((1 - financialPassRate).toFixed(4));
    const artistsCount = new Set(rows.map((r) => r["Artist Name"])).size;
    const tracksCount = new Set(rows.map((r) => `${r["Artist Name"]}::${r["Track Title"]}`)).size;
    manifest.files.push({
      file_name: profile.fileName,
      profile: profile.key,
      rows: rows.length,
      artists_count: artistsCount,
      tracks_count: tracksCount,
      date_min: rows.map((r) => r["Sales Start"]).sort()[0],
      date_max: rows.map((r) => r["Report Date"]).sort().slice(-1)[0],
      platform_mix: topMix(rows, "Platform"),
      territory_mix: topMix(rows, "Territory"),
      currency_mix: topMix(rows, "Original Currency"),
      anomalies: anomalyStats,
      anomaly_rows: anomalyCount,
      financial_pass_rate: Number(financialPassRate.toFixed(4)),
      date_validity_pass_rate: Number(datePassRate.toFixed(4)),
      invalid_financial_row_rate: invalidFinancialRowRate,
      required_coverage: requiredCoverage,
    });
  }

  manifest.quality_gate.errors = validateGlobalQuality(manifest);
  manifest.quality_gate.pass = manifest.quality_gate.errors.length === 0;

  const manifestPath = path.join(outDir, "demo-cmr-manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (!manifest.quality_gate.pass) {
    console.error("Quality gate failed:");
    for (const err of manifest.quality_gate.errors) console.error(`- ${err}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Generated ${filesToGenerate.length} files in ${outDir}`);
  for (const file of manifest.files) {
    console.log(`- ${file.file_name}: ${file.rows} rows, financial_pass_rate=${file.financial_pass_rate}`);
  }
  console.log(`Manifest: ${manifestPath}`);
}

run();
