export const ANIMATION_FPS = 30;
export const ANIMATION_DURATION_IN_FRAMES = 1620;
export const ANIMATION_WIDTH = 1600;
export const ANIMATION_HEIGHT = 900;

export type AnimationBeat = {
  id: string;
  title: string;
  startFrame: number;
  endFrame: number;
  headline: string;
  detail: string;
};

export const animationBeats: AnimationBeat[] = [
  {
    id: "ingestion",
    title: "500 Pages",
    startFrame: 0,
    endFrame: 209,
    headline: "500 pages. One ledger.",
    detail: "Messy statements collapse into a normalized data layer.",
  },
  {
    id: "answer-one",
    title: "AI Answer",
    startFrame: 210,
    endFrame: 539,
    headline: "Ask your data anything.",
    detail: "Prompt, loading, answer, strategy, chart, table, and evidence all appear in one flow.",
  },
  {
    id: "answer-two",
    title: "Prioritization",
    startFrame: 540,
    endFrame: 779,
    headline: "See the next move.",
    detail: "Portfolio prioritization turns into a concrete artist decision.",
  },
  {
    id: "review",
    title: "Review Queue",
    startFrame: 780,
    endFrame: 959,
    headline: "Resolve the blockers.",
    detail: "Statement review and evidence prove the system is auditable.",
  },
  {
    id: "transactions",
    title: "Transactions",
    startFrame: 960,
    endFrame: 1139,
    headline: "Trace every line.",
    detail: "Open normalized transaction detail and source metadata.",
  },
  {
    id: "snapshot",
    title: "Snapshot",
    startFrame: 1140,
    endFrame: 1439,
    headline: "Open the snapshot.",
    detail: "The answer resolves into a premium track snapshot with export.",
  },
  {
    id: "end",
    title: "End Card",
    startFrame: 1440,
    endFrame: 1619,
    headline: "Instant decisions from royalty data.",
    detail: "Brand close.",
  },
];

export const launchFilmData = {
  brand: {
    name: "Other Sounds",
    tagline: "Instant decisions from royalty data.",
    logoSrc: "/ordersounds-logo.png",
  },
  ingestion: {
    pages: 500,
    cmoReports: 7,
    rows: 5000,
    headline: "500 pages, 7 CMO statements, 5,000 rows of royalty data.",
    subheadline: "All normalized into one ledger.",
    cmos: ["SAMRO", "PRS", "BMI", "GEMA", "SACEM", "ASCAP", "CAPASSO"],
    ledgerColumns: ["Track", "Artist", "Territory", "Platform", "Usage", "Gross", "Net"],
    ledgerRows: [
      ["Midnight Receiver", "Avery Lane", "Germany", "YouTube", "Stream", "$1,124.80", "$896.20"],
      ["Velvet Run", "Avery Lane", "United States", "Spotify", "Stream", "$2,408.11", "$1,978.40"],
      ["Glass District", "Juno Vale", "United Kingdom", "YouTube", "Video", "$1,806.94", "$1,401.32"],
      ["North Exit", "Avery Lane", "France", "TikTok", "UGC", "$694.90", "$551.34"],
    ],
  },
  ai: {
    questionOne: {
      prompt: "Where is revenue leaking the most?",
      loadingLabel: "AI IS REVIEWING YOUR DATA",
      answerTitle: "Revenue leakage is concentrated in Germany.",
      answer:
        "Germany is generating strong usage but under-indexing on payout quality. Commission drag is highest there, which makes it the fastest market to recover net revenue.",
      whyThisMatters:
        "Fix Germany payout quality first. That is the cleanest path to better net revenue without needing more volume.",
      kpis: [
        { label: "Revenue at risk", value: "$42.8K" },
        { label: "Leakage gap", value: "18.4%" },
        { label: "Rows scanned", value: "148,220" },
        { label: "Confidence", value: "High" },
      ],
      chartBars: [
        { label: "Germany", usage: 94, payout: 61 },
        { label: "United Kingdom", usage: 72, payout: 65 },
        { label: "United States", usage: 88, payout: 83 },
        { label: "South Africa", usage: 54, payout: 49 },
      ],
      tableColumns: ["territory", "usage_share", "payout_share", "yield_gap"],
      tableRows: [
        ["Germany", "24.1%", "15.2%", "-8.9%"],
        ["United Kingdom", "18.8%", "17.0%", "-1.8%"],
        ["United States", "31.0%", "29.4%", "-1.6%"],
        ["South Africa", "9.6%", "7.9%", "-1.7%"],
      ],
      evidence: [
        "148,220 reviewed rows",
        "track_quality_v1",
        "royalty_transactions",
        "extractor coverage",
        "1.8s query time",
      ],
    },
    questionQuick: {
      prompt: "Show the top territories by net revenue.",
      answerTitle: "The U.S. is leading, but Germany is under-monetized.",
      answer:
        "The United States is the largest revenue driver. Germany is the more important decision signal because usage is strong but payout quality is weaker.",
      whyThisMatters:
        "This is where the app becomes operational. You are not reading reports anymore. You are making the next market decision.",
      kpis: [
        { label: "Top territory", value: "United States" },
        { label: "2nd territory", value: "Germany" },
        { label: "Rows used", value: "148,220" },
        { label: "Chart type", value: "Bar" },
      ],
      chartBars: [
        { label: "United States", value: 100 },
        { label: "Germany", value: 64 },
        { label: "United Kingdom", value: 48 },
        { label: "South Africa", value: 29 },
      ],
      tableColumns: ["territory", "net_revenue", "units", "net_per_unit"],
      tableRows: [
        ["United States", "$124.4K", "188K", "$0.66"],
        ["Germany", "$74.2K", "161K", "$0.46"],
        ["United Kingdom", "$58.9K", "103K", "$0.57"],
      ],
    },
    questionTwo: {
      prompt: "Which artists should we prioritize this quarter?",
      answerTitle: "Prioritize Avery Lane first.",
      answer:
        "Avery Lane is leading net revenue and has the strongest Spotify momentum. Juno Vale is the secondary push if video-led growth is the priority.",
      whyThisMatters:
        "One artist is already converting. The second has upside. That makes the campaign decision obvious.",
      kpis: [
        { label: "Lead artist", value: "Avery Lane" },
        { label: "Net revenue", value: "$118.4K" },
        { label: "90-day trend", value: "+24.8%" },
        { label: "Top channel", value: "Spotify" },
      ],
      artistBars: [
        { label: "Avery Lane", value: 100 },
        { label: "Juno Vale", value: 73 },
        { label: "Noah Grey", value: 45 },
        { label: "Luna Harbor", value: 31 },
      ],
      evidence: [
        "catalog-wide scope",
        "artist snapshot",
        "workspace AI",
        "reviewed track performance",
      ],
    },
  },
  snapshot: {
    track: "Midnight Receiver",
    artist: "Avery Lane",
    opportunityScore: "91.4",
    summary:
      "High-volume track with clear room to improve net return. Usage is broad, but monetization quality is uneven across Germany and YouTube-heavy activity.",
    kpis: [
      { label: "Net revenue", value: "$42.6K" },
      { label: "Units", value: "182K" },
      { label: "Top territory", value: "United States" },
      { label: "Top platform", value: "Spotify" },
    ],
    signals: [
      {
        title: "High usage, light payout",
        body: "Germany is carrying strong activity but weaker payout share. It is the first place to inspect monetization leakage.",
        tone: "warning",
      },
      {
        title: "Momentum is building",
        body: "The track is accelerating over the last 90 days. It is a strong candidate for renewed playlist and marketing support.",
        tone: "opportunity",
      },
      {
        title: "Revenue is concentrated",
        body: "Spotify and the U.S. are doing most of the work. Useful for focus, but risky if either softens.",
        tone: "default",
      },
    ],
    territories: [
      { name: "United States", value: 42 },
      { name: "Germany", value: 24 },
      { name: "United Kingdom", value: 18 },
      { name: "South Africa", value: 10 },
    ],
    platforms: [
      { name: "Spotify", value: 49 },
      { name: "YouTube", value: 31 },
      { name: "TikTok", value: 12 },
      { name: "Apple Music", value: 8 },
    ],
    exportLabel: "Download publisher snapshot",
  },
  review: {
    title: "Revenue mismatch",
    body: "Net revenue does not match gross minus commission. Expected 421.80, got 396.20.",
    evidence: ["source page 4", "Germany", "YouTube", "Midnight Receiver"],
  },
  transactions: {
    rows: [
      ["Midnight Receiver", "Germany", "YouTube", "$896.20", "Passed"],
      ["Velvet Run", "United States", "Spotify", "$1,978.40", "Passed"],
      ["Glass District", "United Kingdom", "YouTube", "$1,401.32", "Review"],
    ],
    detail: {
      isrc: "GBAHS250001",
      territory: "Germany",
      platform: "YouTube",
      net: "$896.20",
      source: "Page 4 / Row 118",
    },
  },
};
