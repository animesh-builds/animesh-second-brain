import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config, type Source } from "./config.js";
import { pageFilename, renderPage, sanitizeBody } from "./markdown.js";
import type { PageFrontMatter } from "./markdown.js";
import { isUnchanged, loadState, markSeen, saveState } from "./state.js";
import { syncBrain } from "./sync-brain.js";
import type { IngestItem } from "./gmail.js";

/**
 * MCP-connector ingestion path.
 *
 * Unlike run-sync.ts (which calls the Google APIs directly via a refresh
 * token), this path consumes data already fetched through MCP connectors —
 * the agent (Claude Code / OpenClaw) holds the Google auth, so there is NO
 * Google Cloud OAuth setup to do. The agent dumps connector responses into a
 * "bundle" JSON; this script renders them to the same cited markdown and runs
 * the same idempotency/state logic as the OAuth path.
 *
 *   tsx ingest/from-mcp.ts <bundle.json>
 *
 * Bundle shape (see ingest/mcp-bundle.schema.md):
 *   {
 *     "gmailThreads": [{ id, messages: [{ sender, toRecipients[], subject, date, body }] }],
 *     "driveFiles":   [{ id, title, mimeType, modifiedTime, viewUrl, content }]
 *   }
 */

interface BundleMessage {
  sender?: string;
  toRecipients?: string[];
  subject?: string;
  date?: string;
  body?: string;
  plaintextBody?: string;
  snippet?: string;
}
interface BundleThread {
  id: string;
  messages: BundleMessage[];
}
interface BundleDriveFile {
  id: string;
  title?: string;
  mimeType?: string;
  modifiedTime?: string;
  viewUrl?: string;
  content?: string;
}
interface Bundle {
  gmailThreads?: BundleThread[];
  driveFiles?: BundleDriveFile[];
}

const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function messageBody(m: BundleMessage): string {
  return m.body ?? m.plaintextBody ?? m.snippet ?? "";
}

function renderThread(t: BundleThread): string {
  return t.messages
    .map((m) => {
      const text = sanitizeBody(messageBody(m), config.maxBodyChars);
      return `## ${m.sender ?? "(unknown sender)"} — ${m.date ?? ""}\n\n${text}`;
    })
    .join("\n\n---\n\n");
}

function gmailItem(t: BundleThread): IngestItem | null {
  if (!t.id || t.messages.length === 0) return null;
  const first = t.messages[0]!;
  const latest = t.messages[t.messages.length - 1]!;
  const revision = String(
    latest.date ? Date.parse(latest.date) || latest.date : t.messages.length,
  );
  const participants = Array.from(
    new Set(t.messages.flatMap((m) => [m.sender ?? "", ...(m.toRecipients ?? [])])),
  ).filter(Boolean);
  const fm: PageFrontMatter = {
    source: "gmail",
    id: t.id,
    revision,
    date: latest.date ?? new Date().toISOString(),
    title: first.subject || "(no subject)",
    participants,
    url: `https://mail.google.com/mail/u/0/#all/${t.id}`,
  };
  return { fm, body: renderThread(t) };
}

function driveItem(f: BundleDriveFile): IngestItem | null {
  if (!f.id) return null;
  const source: Source = f.mimeType === SHEET_MIME ? "sheets" : "docs";
  const fm: PageFrontMatter = {
    source,
    id: f.id,
    revision: String(f.modifiedTime ?? "0"),
    date: f.modifiedTime ?? new Date().toISOString(),
    title: f.title ?? "(untitled)",
    url: f.viewUrl ?? `https://drive.google.com/open?id=${f.id}`,
  };
  return { fm, body: sanitizeBody(f.content ?? "", config.maxBodyChars) };
}

async function main(): Promise<void> {
  const bundlePath = process.argv[2];
  if (!bundlePath) {
    console.error("usage: tsx ingest/from-mcp.ts <bundle.json>");
    process.exit(1);
  }
  const bundle = JSON.parse(await readFile(bundlePath, "utf8")) as Bundle;
  const state = await loadState(config.sourceDir);
  await mkdir(config.sourceDir, { recursive: true });

  const candidates: IngestItem[] = [
    ...(bundle.gmailThreads ?? []).map(gmailItem),
    ...(bundle.driveFiles ?? []).map(driveItem),
  ].filter((x): x is IngestItem => x !== null);

  let written = 0;
  let skipped = 0;
  for (const item of candidates) {
    if (isUnchanged(state, item.fm.source, item.fm.id, item.fm.revision)) {
      skipped++;
      continue;
    }
    await writeFile(
      join(config.sourceDir, pageFilename(item.fm.source, item.fm.id)),
      renderPage(item.fm, item.body),
      "utf8",
    );
    markSeen(state, item.fm.source, item.fm.id, item.fm.revision);
    written++;
  }

  state.lastSyncAt = new Date().toISOString();
  await saveState(config.sourceDir, state);
  console.log(
    `[from-mcp] candidates=${candidates.length} written=${written} skipped=${skipped}`,
  );
  await syncBrain();
  console.log("[from-mcp] done.");
}

main().catch((e) => {
  console.error("[from-mcp] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
