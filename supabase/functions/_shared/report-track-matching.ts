export type ReportTrackRow = {
  id: string;
  source_row_id?: string | null;
  track_title?: string | null;
  artist_name?: string | null;
  isrc?: string | null;
};

export type WorkspaceTrack = {
  track_key: string;
  track_title: string | null;
  artist_name: string | null;
  isrc?: string | null;
};

export type TrackMatchCandidate = {
  track_key: string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
};

export type TrackMatchTask = {
  group_key: string;
  track_title: string;
  artist_name: string;
  isrc: string | null;
  transaction_ids: string[];
  source_row_ids: string[];
  candidates: TrackMatchCandidate[];
};

const FEAT_PATTERN = /\b(featuring|feat\.?|ft\.?)\b/g;
const AMP_PATTERN = /\s*&\s*/g;
const PUNCTUATION_PATTERN = /[^\p{L}\p{N}\s]+/gu;
const MULTISPACE_PATTERN = /\s+/g;

export function normalizeIsrc(isrc: string | null | undefined): string | null {
  const normalized = String(isrc ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .trim();
  return normalized || null;
}

export function normalizeTrackText(value: string | null | undefined): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(AMP_PATTERN, " and ")
    .replace(FEAT_PATTERN, " feat ")
    .replace(PUNCTUATION_PATTERN, " ")
    .replace(MULTISPACE_PATTERN, " ")
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  const next = new Array<number>(b.length + 1);

  for (let i = 0; i < a.length; i += 1) {
    next[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      next[j + 1] = Math.min(
        next[j] + 1,
        prev[j + 1] + 1,
        prev[j] + cost,
      );
    }
    for (let j = 0; j < next.length; j += 1) {
      prev[j] = next[j];
    }
  }

  return prev[b.length];
}

export function similarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeTrackText(a);
  const right = normalizeTrackText(b);

  if (!left || !right) return 0;
  if (left === right) return 1;

  const distance = levenshteinDistance(left, right);
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

export function createTrackGroupKey(
  isrc: string | null | undefined,
  trackTitle: string | null | undefined,
  artistName: string | null | undefined,
): string {
  const normalizedIsrc = normalizeIsrc(isrc);
  if (normalizedIsrc) return `isrc:${normalizedIsrc}`;
  return `text:${normalizeTrackText(trackTitle)}|${normalizeTrackText(artistName)}`;
}

export function collectTrackMatchTasks(
  reportRows: ReportTrackRow[],
  workspaceTracks: WorkspaceTrack[],
  titleThreshold = 0.9,
  artistThreshold = 0.9,
): TrackMatchTask[] {
  const grouped = new Map<string, TrackMatchTask>();

  for (const row of reportRows) {
    const groupKey = createTrackGroupKey(row.isrc, row.track_title, row.artist_name);
    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        group_key: groupKey,
        track_title: row.track_title?.trim() || "Unknown Track",
        artist_name: row.artist_name?.trim() || "Unknown Artist",
        isrc: normalizeIsrc(row.isrc),
        transaction_ids: [],
        source_row_ids: [],
        candidates: [],
      });
    }

    const group = grouped.get(groupKey)!;
    group.transaction_ids.push(row.id);
    if (row.source_row_id) group.source_row_ids.push(row.source_row_id);
  }

  const tasks: TrackMatchTask[] = [];

  for (const group of grouped.values()) {
    const candidates: TrackMatchCandidate[] = [];

    for (const track of workspaceTracks) {
      const candidateKey = createTrackGroupKey(track.isrc, track.track_title, track.artist_name);
      if (candidateKey === group.group_key) continue;

      const titleScore = similarity(group.track_title, track.track_title);
      const artistScore = similarity(group.artist_name, track.artist_name);
      if (titleScore < titleThreshold || artistScore < artistThreshold) continue;

      candidates.push({
        track_key: track.track_key,
        track_title: track.track_title?.trim() || "Unknown Track",
        artist_name: track.artist_name?.trim() || "Unknown Artist",
        isrc: normalizeIsrc(track.isrc),
      });
    }

    if (candidates.length > 0) {
      const deduped = new Map<string, TrackMatchCandidate>();
      for (const candidate of candidates) {
        deduped.set(candidate.track_key, candidate);
      }
      tasks.push({
        ...group,
        source_row_ids: Array.from(new Set(group.source_row_ids)),
        candidates: Array.from(deduped.values()),
      });
    }
  }

  return tasks;
}
