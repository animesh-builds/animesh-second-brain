import { google, type Auth } from "googleapis";
import { config, type Source } from "./config.js";
import { sanitizeBody, type PageFrontMatter } from "./markdown.js";
import { isUnchanged, type IngestState } from "./state.js";
import type { IngestItem } from "./gmail.js";

const DOC_MIME = "application/vnd.google-apps.document";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";

function escapeCell(v: unknown): string {
  return String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/** Render a spreadsheet's sheets as markdown tables. */
function renderSheet(
  title: string,
  data: Array<{ name: string; rows: unknown[][] }>,
): string {
  const out: string[] = [];
  for (const sheet of data) {
    out.push(`## ${sheet.name}`);
    if (sheet.rows.length === 0) {
      out.push("_(empty)_");
      continue;
    }
    const header = sheet.rows[0]!.map(escapeCell);
    out.push(`| ${header.join(" | ")} |`);
    out.push(`| ${header.map(() => "---").join(" | ")} |`);
    for (const row of sheet.rows.slice(1)) {
      const cells = header.map((_, i) => escapeCell(row[i]));
      out.push(`| ${cells.join(" | ")} |`);
    }
    out.push("");
  }
  return out.join("\n");
}

/**
 * Pull recent Google Docs + Sheets as markdown. Idempotency key: file id +
 * Drive `version` (checked before any export, so unchanged files cost nothing).
 */
export async function ingestDrive(
  auth: Auth.OAuth2Client,
  state: IngestState,
  opts: { sinceIso: string },
): Promise<{ items: IngestItem[]; listed: number; skipped: number }> {
  const drive = google.drive({ version: "v3", auth });
  const sheetsApi = google.sheets({ version: "v4", auth });
  const docsApi = google.docs({ version: "v1", auth });

  const items: IngestItem[] = [];
  let listed = 0;
  let skipped = 0;
  let pageToken: string | undefined;
  const cap = config.maxItemsPerSource;

  const q =
    `(mimeType='${DOC_MIME}' or mimeType='${SHEET_MIME}') and ` +
    `modifiedTime > '${opts.sinceIso}' and trashed = false`;

  do {
    const res = await drive.files.list({
      q,
      pageSize: 100,
      fields: "nextPageToken, files(id,name,mimeType,modifiedTime,version,webViewLink)",
      pageToken,
      orderBy: "modifiedTime desc",
    });
    const files = res.data.files ?? [];
    for (const f of files) {
      if (!f.id || !f.mimeType) continue;
      listed++;
      const source: Source = f.mimeType === SHEET_MIME ? "sheets" : "docs";
      const revision = String(f.version ?? f.modifiedTime ?? "0");
      if (isUnchanged(state, source, f.id, revision)) {
        skipped++;
        continue;
      }

      const title = f.name ?? "(untitled)";
      let body: string;

      if (source === "docs") {
        // Plain-text export is the simplest faithful rendering of a Doc.
        const exported = await drive.files.export(
          { fileId: f.id, mimeType: "text/plain" },
          { responseType: "text" },
        );
        body = sanitizeBody(String(exported.data ?? ""), config.maxBodyChars);
        // docsApi is available for richer structure later; text export is enough for v1.
        void docsApi;
      } else {
        const meta = await sheetsApi.spreadsheets.get({
          spreadsheetId: f.id,
          fields: "sheets.properties.title",
        });
        const names = (meta.data.sheets ?? [])
          .map((s) => s.properties?.title)
          .filter((n): n is string => Boolean(n));
        const sheetData: Array<{ name: string; rows: unknown[][] }> = [];
        for (const name of names) {
          const values = await sheetsApi.spreadsheets.values.get({
            spreadsheetId: f.id,
            range: name,
          });
          sheetData.push({ name, rows: (values.data.values ?? []) as unknown[][] });
        }
        body = sanitizeBody(renderSheet(title, sheetData), config.maxBodyChars);
      }

      const fm: PageFrontMatter = {
        source,
        id: f.id,
        revision,
        date: f.modifiedTime ?? new Date().toISOString(),
        title,
        url: f.webViewLink ?? `https://drive.google.com/open?id=${f.id}`,
      };
      items.push({ fm, body });
      if (cap > 0 && items.length >= cap) return { items, listed, skipped };
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { items, listed, skipped };
}
