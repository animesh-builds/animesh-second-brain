import { google, type gmail_v1, type Auth } from "googleapis";
import { config } from "./config.js";
import { sanitizeBody, type PageFrontMatter } from "./markdown.js";
import { isUnchanged, type IngestState } from "./state.js";

export interface IngestItem {
  fm: PageFrontMatter;
  body: string;
}

function header(msg: gmail_v1.Schema$Message, name: string): string {
  const h = msg.payload?.headers?.find(
    (x) => x.name?.toLowerCase() === name.toLowerCase(),
  );
  return h?.value ?? "";
}

/** Recursively find the best textual body part (prefer text/plain). */
function extractBody(payload: gmail_v1.Schema$MessagePart | undefined): string {
  if (!payload) return "";
  const decode = (data?: string | null): string =>
    data ? Buffer.from(data, "base64url").toString("utf8") : "";

  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decode(payload.body.data);
  }
  if (payload.parts?.length) {
    // Prefer a text/plain part anywhere in the tree.
    for (const p of payload.parts) {
      const found = extractBody(p);
      if (found.trim()) return found;
    }
  }
  // Fallback: strip tags from an HTML body.
  if (payload.mimeType === "text/html" && payload.body?.data) {
    return decode(payload.body.data).replace(/<[^>]+>/g, " ");
  }
  return "";
}

function renderThreadBody(messages: gmail_v1.Schema$Message[]): string {
  const blocks = messages.map((m) => {
    const from = header(m, "From");
    const date = header(m, "Date");
    const text = sanitizeBody(extractBody(m.payload), config.maxBodyChars);
    return `## ${from || "(unknown sender)"} — ${date}\n\n${text}`;
  });
  return blocks.join("\n\n---\n\n");
}

/**
 * Pull recent Gmail threads as one markdown page per thread.
 * Idempotency key: thread id + latest message internalDate.
 */
export async function ingestGmail(
  auth: Auth.OAuth2Client,
  state: IngestState,
  opts: { sinceQuery: string },
): Promise<{ items: IngestItem[]; listed: number; skipped: number }> {
  const gmail = google.gmail({ version: "v1", auth });
  const items: IngestItem[] = [];
  let listed = 0;
  let skipped = 0;
  let pageToken: string | undefined;
  const cap = config.maxItemsPerSource;

  do {
    const res = await gmail.users.threads.list({
      userId: "me",
      q: opts.sinceQuery,
      maxResults: 100,
      pageToken,
    });
    const threads = res.data.threads ?? [];
    for (const t of threads) {
      if (!t.id) continue;
      listed++;
      const full = await gmail.users.threads.get({
        userId: "me",
        id: t.id,
        format: "full",
      });
      const messages = full.data.messages ?? [];
      if (messages.length === 0) continue;

      const latest = messages[messages.length - 1]!;
      const revision = latest.internalDate ?? full.data.historyId ?? "0";
      if (isUnchanged(state, "gmail", t.id, String(revision))) {
        skipped++;
        continue;
      }

      const first = messages[0]!;
      const subject = header(first, "Subject") || "(no subject)";
      const dateMs = Number(latest.internalDate ?? Date.now());
      const participants = Array.from(
        new Set(
          messages.flatMap((m) => [header(m, "From"), header(m, "To")]),
        ),
      ).filter(Boolean);

      items.push({
        fm: {
          source: "gmail",
          id: t.id,
          revision: String(revision),
          date: new Date(dateMs).toISOString(),
          title: subject,
          participants,
          url: `https://mail.google.com/mail/u/0/#all/${t.id}`,
        },
        body: renderThreadBody(messages),
      });
      if (cap > 0 && items.length >= cap) return { items, listed, skipped };
    }
    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return { items, listed, skipped };
}
