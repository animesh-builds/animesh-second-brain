import { config, type Source } from "./config.js";

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

/** Shown at the top of every rendered page when redaction is on. */
export const PII_NOTICE =
  "> _PII redacted per privacy policy — review before external sharing._";

/**
 * PII redactor. The ingested corpus is shared externally for demos, so scrub
 * personal data before it reaches disk / the index / the LLM prompt (D007).
 * Two layers: deterministic category regexes (always on) + a name/term
 * blocklist supplied via REDACT_NAMES (the agent populates it from the people
 * actually present in the data — a regex can't tell a name from a company).
 */
const CATEGORY_PATTERNS: Array<[RegExp, string]> = [
  // Secrets / API keys first (some contain no @ and are highest risk).
  [/sk-(?:or-v1-|ant-|proj-)?[A-Za-z0-9_-]{16,}/g, "[REDACTED-SECRET]"],
  [/AIza[0-9A-Za-z_-]{30,}/g, "[REDACTED-SECRET]"],
  [/GOCSPX-[0-9A-Za-z_-]{20,}/g, "[REDACTED-SECRET]"],
  [/1\/\/[0-9A-Za-z_-]{30,}/g, "[REDACTED-SECRET]"],
  [/AKIA[0-9A-Z]{16}/g, "[REDACTED-SECRET]"],
  [/ghp_[A-Za-z0-9]{30,}/g, "[REDACTED-SECRET]"],
  // Video-call links.
  [/https?:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/gi, "[REDACTED-LINK]"],
  [/https?:\/\/[\w.-]*zoom\.us\/[^\s)>\]]+/gi, "[REDACTED-LINK]"],
  [/https?:\/\/teams\.microsoft\.com\/[^\s)>\]]+/gi, "[REDACTED-LINK]"],
  // Email addresses.
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[REDACTED-EMAIL]"],
  // IPv4.
  [/(?<!\d)\d{1,3}(?:\.\d{1,3}){3}(?!\d)/g, "[REDACTED-IP]"],
  // Phone numbers: plain 10–13 digit runs (optionally +cc) and separated forms.
  [/(?<![\d.])\+?\d{10,13}(?!\d)/g, "[REDACTED-PHONE]"],
  [/(?<!\d)\d{3,5}[\s.-]\d{5,7}(?!\d)/g, "[REDACTED-PHONE]"],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function redactPII(text: string): string {
  if (!config.redactPii) return text;
  let out = text;
  for (const [re, tag] of CATEGORY_PATTERNS) out = out.replace(re, tag);
  // Longest names first so "Carol Lucas" is redacted before "Carol".
  const names = [...config.redactNames].sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (!name) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi"), "[REDACTED-NAME]");
  }
  return out;
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

/** Drop tracking query params (ouid, usp, …) from a citation URL. */
function stripCitationUrl(url: string): string {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}

/**
 * Strip control characters, redact PII, and cap length. Ingested content is
 * untrusted — sanitize before writing markdown (architecture.md security).
 */
export function sanitizeBody(raw: string, maxChars: number): string {
  // Remove C0 control chars (0x00-0x1F) and DEL (0x7F), keeping tab and
  // newline. ASCII-only pattern to avoid literal control bytes in source.
  const CONTROL = new RegExp("[\u0000-\u0008\u000B-\u001F\u007F]", "g");
  let body = redactPII(raw.replace(CONTROL, ""));
  // Collapse runs of >2 blank lines.
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  if (body.length > maxChars) {
    body = body.slice(0, maxChars) + "\n\n_[truncated]_";
  }
  return body;
}

/** Render a full markdown page (front-matter + body). */
export function renderPage(fm: PageFrontMatter, body: string): string {
  const title = redactPII(fm.title);
  const participants = fm.participants?.map(redactPII);
  const lines = ["---", `source: ${fm.source}`, `id: ${yamlScalar(fm.id)}`];
  lines.push(`revision: ${yamlScalar(fm.revision)}`);
  lines.push(`date: ${yamlScalar(fm.date)}`);
  lines.push(`title: ${yamlScalar(title)}`);
  if (participants && participants.length > 0) {
    lines.push(`participants: ${yamlList(participants)}`);
  }
  lines.push(`url: ${yamlScalar(stripCitationUrl(fm.url))}`);
  lines.push("---", "", `# ${title}`, "");
  if (config.redactPii) lines.push(PII_NOTICE, "");
  // Redact the whole body here too (defense-in-depth): callers may assemble
  // headers/structure around already-sanitized text (e.g. gmail "## sender").
  lines.push(redactPII(body), "");
  return lines.join("\n");
}

/** Deterministic, filesystem-safe filename from source + id. Stable across runs. */
export function pageFilename(source: Source, id: string): string {
  const safeId = id.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `${source}-${safeId}.md`;
}
