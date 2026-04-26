import { describe, expect, it } from "vitest";

import {
  collectTrackMatchTasks,
  createTrackGroupKey,
  normalizeTrackText,
} from "../../supabase/functions/_shared/report-track-matching";

describe("report track matching", () => {
  it("normalizes punctuation, ampersands, and featuring variations", () => {
    expect(normalizeTrackText(" Burna Boy &  Seyi  ")).toBe("burna boy and seyi");
    expect(normalizeTrackText("Track Title feat. Guest")).toBe("track title feat guest");
    expect(normalizeTrackText("Track Title (ft Guest)")).toBe("track title feat guest");
  });

  it("groups report rows by identifier first, then by normalized title and artist", () => {
    const keyed = createTrackGroupKey("US-ABC-24-00001", "Ignored", "Ignored");
    const fallback = createTrackGroupKey(null, "Beautiful Day", "Arianna Grande");

    expect(keyed).toBe("isrc:USABC2400001");
    expect(fallback).toBe("text:beautiful day|arianna grande");
  });

  it("creates a match task when title and artist are both at least 90 percent similar", () => {
    const tasks = collectTrackMatchTasks(
      [
        {
          id: "tx-1",
          source_row_id: "sr-1",
          track_title: "Beautifull Day",
          artist_name: "Arianna Grande",
          isrc: null,
        },
      ],
      [
        {
          track_key: "isrc:USABC2400001",
          track_title: "Beautiful Day",
          artist_name: "Ariana Grande",
          isrc: "US-ABC-24-00001",
        },
      ],
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].candidates).toHaveLength(1);
    expect(tasks[0].candidates[0]).toMatchObject({
      track_key: "isrc:USABC2400001",
      track_title: "Beautiful Day",
      artist_name: "Ariana Grande",
      isrc: "USABC2400001",
    });
    expect(tasks[0].transaction_ids).toEqual(["tx-1"]);
  });

  it("skips catalog items that already share the same identifier", () => {
    const tasks = collectTrackMatchTasks(
      [
        {
          id: "tx-1",
          source_row_id: "sr-1",
          track_title: "Beautiful Day",
          artist_name: "Ariana Grande",
          isrc: "US-ABC-24-00001",
        },
      ],
      [
        {
          track_key: "isrc:USABC2400001",
          track_title: "Beautiful Day",
          artist_name: "Ariana Grande",
          isrc: "USABC2400001",
        },
      ],
    );

    expect(tasks).toHaveLength(0);
  });

  it("does not create a task when version text changes the title too much", () => {
    const tasks = collectTrackMatchTasks(
      [
        {
          id: "tx-1",
          source_row_id: "sr-1",
          track_title: "Beautiful Day Live",
          artist_name: "Ariana Grande",
          isrc: null,
        },
      ],
      [
        {
          track_key: "text:beautiful day|ariana grande",
          track_title: "Beautiful Day",
          artist_name: "Ariana Grande",
          isrc: null,
        },
      ],
    );

    expect(tasks).toHaveLength(0);
  });
});
