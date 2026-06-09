import type { Source } from "./config.js";

/** Front-matter for one ingested page. Mirrors architecture.md data model. */
export interface PageFrontMatter {
  source: Source;
  /** gmail thread id | drive file id — the idempotency key. */
  id: string;
  /** drive version | gmail latest internalDate — changes => re-render. */
  revision: string;
  /** ISO 8601. */
  date: string;
  title: string;
  /** gmail only: [from, ...to]. */
  participants?: string[];
  /** Deep link, used for citations. */
  url: string;
}

/** YAML-escape a scalar string (quote + escape only when needed). */
function yamlScalar(value: string): string {
  const v = value.replace(/\r?\n/g, " ").trim();
  if (v === "") return '""';
  // Quote if it contains YAML-significant characters or could be misparsed.
  if (/[:#\-?\[\]{}&*!|>'"%@`,]/.test(v) || /^\s|\s$/.test(v) || /^\d/.test(v)) {
    return `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return v;
}

function yamlList(values: string[]): string {
  if (values.length === 0) return "[]";
  return `[${values.map(yamlScalar).join(", ")}]`;
}

/**
 * Strip control characters and cap length. Ingested content is untrusted —
 * sanitize before writing markdown (architecture.md security section).
 */
export function sanitizeBody(raw: string, maxChars: number): string {
  // Remove C0 control chars (0x00-0x1F) and DEL (0x7F), but keep
  // tab (0x09) and newline (0x0A).
  const CONTROL = new RegExp("[\u0000-\u0008\u000B-\u001F\u007F]", "g");
  let body = raw.replace(CONTROL, "");
  // Collapse runs of >2 blank lines.
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  if (body.length > maxChars) {
    body = body.slice(0, maxChars) + "\n\n_[truncated]_";
  }
  return body;
}

/** Render a full markdown page (front-matter + body). */
export function renderPage(fm: PageFrontMatter, body: string): string {
  const lines = ["---", `source: ${fm.source}`, `id: ${yamlScalar(fm.id)}`];
  lines.push(`revision: ${yamlScalar(fm.revision)}`);
  lines.push(`date: ${yamlScalar(fm.date)}`);
  lines.push(`title: ${yamlScalar(fm.title)}`);
  if (fm.participants && fm.participants.length > 0) {
    lines.push(`participants: ${yamlList(fm.participants)}`);
  }
  lines.push(`url: ${yamlScalar(fm.url)}`);
  lines.push("---", "", `# ${fm.title}`, "", body, "");
  return lines.join("\n");
}

/** Deterministic, filesystem-safe filename from source + id. Stable across runs. */
export function pageFilename(source: Source, id: string): string {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `${source}-${safeId}.md`;
}
