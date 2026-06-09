import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { getAuthClient } from "./google-auth.js";
import { ingestGmail, type IngestItem } from "./gmail.js";
import { ingestDrive } from "./drive.js";
import { pageFilename, renderPage } from "./markdown.js";
import { loadState, markSeen, saveState } from "./state.js";
import { syncBrain } from "./sync-brain.js";
import { classifySensitivity } from "./sensitivity.js";

/**
 * Cron entry: pull recent Google data -> write idempotent markdown into the
 * gbrain source dir -> trigger gbrain sync. Logs counts only, never content
 * (architecture.md §Observability — redact PII from logs).
 */
async function main(): Promise<void> {
  const backfill = process.argv.includes("--backfill");
  const state = await loadState(config.sourceDir);
  await mkdir(config.sourceDir, { recursive: true });

  // Window: full backfill on --backfill or first run; otherwise incremental
  // since the last successful sync.
  const windowStart = new Date(
    Date.now() - config.windowDays * 24 * 60 * 60 * 1000,
  );
  const sinceDate =
    backfill || !state.lastSyncAt ? windowStart : new Date(state.lastSyncAt);
  const sinceIso = sinceDate.toISOString();
  // Gmail query uses date (UTC, day granularity) — slightly wider is fine.
  const sinceQuery = `after:${Math.floor(sinceDate.getTime() / 1000)}`;
  const mode = backfill || !state.lastSyncAt ? "backfill" : "incremental";
  console.log(`[ingest] mode=${mode} since=${sinceIso} dir=${config.sourceDir}`);

  const auth = getAuthClient();

  const [gmailRes, driveRes] = await Promise.all([
    ingestGmail(auth, state, { sinceQuery }),
    ingestDrive(auth, state, { sinceIso }),
  ]);

  const allItems: IngestItem[] = [...gmailRes.items, ...driveRes.items];
  let written = 0;
  let sensitiveSkipped = 0;
  for (const item of allItems) {
    if (config.skipSensitive && classifySensitivity(item.fm.title, item.body).sensitive) {
      sensitiveSkipped++;
      continue;
    }
    const filename = pageFilename(item.fm.source, item.fm.id);
    await writeFile(
      join(config.sourceDir, filename),
      renderPage(item.fm, item.body),
      "utf8",
    );
    markSeen(state, item.fm.source, item.fm.id, item.fm.revision);
    written++;
  }

  state.lastSyncAt = new Date().toISOString();
  await saveState(config.sourceDir, state);

  console.log(
    `[ingest] gmail: listed=${gmailRes.listed} skipped=${gmailRes.skipped} | ` +
      `drive: listed=${driveRes.listed} skipped=${driveRes.skipped} | ` +
      `written=${written} sensitive-skipped=${sensitiveSkipped}`,
  );

  await syncBrain();
  console.log("[ingest] done.");
}

main().catch((e) => {
  console.error("[ingest] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
