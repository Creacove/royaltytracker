#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const PASS_THRESHOLD = 0.95;

function generatePrompts() {
  const subjects = ["artist", "catalog", "top tracks", "songs", "back catalog"];
  const dimensions = ["platform", "territory", "usage_type", "track_title"];
  const metrics = ["net revenue", "gross revenue", "quantity", "streams"];
  const periods = ["this month", "last quarter", "last 12 months", "year to date", "last 90 days"];
  const verbs = ["rank", "compare", "break down", "show", "analyze"];
  const styles = [
    "publisher style",
    "exec summary style",
    "strict data answer",
    "short answer",
    "deep audit",
  ];

  const prompts = [];
  let id = 1;
  for (const subject of subjects) {
    for (const dimension of dimensions) {
      for (const metric of metrics) {
        for (const period of periods) {
          for (const verb of verbs) {
            for (const style of styles) {
              prompts.push({
                id: `artist-bm-${String(id).padStart(4, "0")}`,
                prompt: `${verb} ${subject} by ${dimension} using ${metric} for ${period} (${style})`,
                category: `${dimension}_${metric}`.replace(/\s+/g, "_"),
              });
              id += 1;
            }
          }
        }
      }
    }
  }
  return prompts;
}

function writePromptsFile(outputPath) {
  const prompts = generatePrompts();
  const trimmed = prompts.slice(0, 250);
  fs.writeFileSync(outputPath, JSON.stringify(trimmed, null, 2));
  console.log(`Generated ${trimmed.length} benchmark prompts at ${outputPath}`);
}

function scoreResults(resultsPath) {
  if (!fs.existsSync(resultsPath)) {
    console.error(`Results file not found: ${resultsPath}`);
    process.exit(2);
  }
  const payload = JSON.parse(fs.readFileSync(resultsPath, "utf8"));
  if (!Array.isArray(payload)) {
    console.error("Results file must be an array.");
    process.exit(2);
  }

  const total = payload.length;
  const passed = payload.filter((row) => row && row.pass === true).length;
  const rate = total === 0 ? 0 : passed / total;

  console.log(`Benchmark results: ${passed}/${total} passed (${(rate * 100).toFixed(2)}%)`);
  if (rate < PASS_THRESHOLD) {
    console.error(`Gate failed: pass rate below ${(PASS_THRESHOLD * 100).toFixed(0)}%`);
    process.exit(1);
  }
  console.log("Gate passed.");
}

const arg = process.argv[2] ?? "generate";
if (arg === "generate") {
  writePromptsFile(path.resolve("scripts", "artist-benchmark-prompts.json"));
  process.exit(0);
}
if (arg === "score") {
  const file = process.argv[3] ?? path.resolve("scripts", "artist-benchmark-results.json");
  scoreResults(file);
  process.exit(0);
}

console.error("Usage: node scripts/artist-benchmark.mjs [generate|score <results-file>]");
process.exit(2);
