import fs from "node:fs";

function loadEnv(filePath) {
  const out = {};
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    out[key] = value;
  }
  return out;
}

const reportId = process.argv[2];
if (!reportId) {
  console.error("Usage: node scripts/invoke-process-report.mjs <report_id>");
  process.exit(1);
}

const ref = "vdzuypxdueelmkrwvyet";
const env = loadEnv("supabase/functions/.env");
const anonKey = env.SUPABASE_ANON_KEY;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY;
const authToken = process.env.SUPABASE_FUNCTION_AUTH_TOKEN || serviceKey || anonKey;

if (!authToken) {
  console.error(
    "Missing auth token. Set SUPABASE_FUNCTION_AUTH_TOKEN, or add SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY to supabase/functions/.env"
  );
  process.exit(1);
}

const url = `https://${ref}.functions.supabase.co/process-report`;
const resp = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    apikey: anonKey || authToken,
    Authorization: `Bearer ${authToken}`,
  },
  body: JSON.stringify({ report_id: reportId }),
});

const text = await resp.text();
console.log(resp.status);
console.log(text);
