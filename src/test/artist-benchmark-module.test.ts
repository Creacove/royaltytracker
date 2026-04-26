import { expect, it } from "vitest";

it("imports artist benchmark helpers without requiring CLI argv", async () => {
  const originalArgv = process.argv.slice();

  try {
    process.argv[1] = undefined as unknown as string;
    const mod = await import("../../scripts/artist-benchmark.mjs");

    expect(typeof mod.scoreResult).toBe("function");
    expect(typeof mod.aggregateResults).toBe("function");
    expect(typeof mod.applyRepetitionPenalty).toBe("function");
  } finally {
    process.argv = originalArgv;
  }
});
