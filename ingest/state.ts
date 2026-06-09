import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Source } from "./config.js";

/**
 * Idempotency + incremental-sync state. Stored as JSON inside the source dir
 * (gitignored). Keying on id+revision is what guarantees re-runs produce no
 * duplicates (architecture.md §Risks — non-idempotent ingestion).
 */
export interface IngestState {
  /** Last successful run, ISO 8601. Drives incremental `after:` queries. */
  lastSyncAt?: string;
  /** Per-source map of item id -> the revision we last wrote. */
  seen: Record<Source, Record<string, string>>;
}

const STATE_FILENAME = ".ingest-state.json";

function emptyState(): IngestState {
  return { seen: { gmail: {}, drive: {}, docs: {}, sheets: {} } };
}

export async function loadState(sourceDir: string): Promise<IngestState> {
  try {
    const raw = await readFile(join(sourceDir, STATE_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as Partial<IngestState>;
    const base = emptyState();
    return {
      lastSyncAt: parsed.lastSyncAt,
      seen: { ...base.seen, ...(parsed.seen ?? {}) },
    };
  } catch {
    return emptyState();
  }
}

export async function saveState(sourceDir: string, state: IngestState): Promise<void> {
  const path = join(sourceDir, STATE_FILENAME);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

/** True when this id+revision was already written — safe to skip. */
export function isUnchanged(
  state: IngestState,
  source: Source,
  id: string,
  revision: string,
): boolean {
  return state.seen[source][id] === revision;
}

export function markSeen(
  state: IngestState,
  source: Source,
  id: string,
  revision: string,
): void {
  state.seen[source][id] = revision;
}
