import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv();

/** Read-only Google scopes — least privilege (D004). Never add write scopes. */
export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/documents.readonly",
] as const;

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.startsWith("YOUR_")) {
    throw new Error(
      `Missing required env var ${name}. Copy .env.example to .env and fill it in.`,
    );
  }
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  google: {
    clientId: () => required("GOOGLE_CLIENT_ID"),
    clientSecret: () => required("GOOGLE_CLIENT_SECRET"),
    refreshToken: () => required("GOOGLE_REFRESH_TOKEN"),
  },
  /** Absolute path to the gbrain source directory we write markdown into. */
  sourceDir: resolve(process.env.BRAIN_SOURCE_DIR ?? "./sources/google"),
  windowDays: num("INGEST_WINDOW_DAYS", 90),
  maxBodyChars: num("MAX_BODY_CHARS", 40_000),
  maxItemsPerSource: num("MAX_ITEMS_PER_SOURCE", 0),
  runGbrainSync: (process.env.RUN_GBRAIN_SYNC ?? "true") !== "false",
  /** PII redaction on by default; the corpus may be shared externally. */
  redactPii: (process.env.REDACT_PII ?? "true") !== "false",
  /** Skip job-search / compensation / money pages on ingest (safety default). */
  skipSensitive: (process.env.SKIP_SENSITIVE ?? "true") !== "false",
  /** Person names/terms to scrub (the regex layer can't infer these). */
  redactNames: (process.env.REDACT_NAMES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const;

export type Source = "gmail" | "drive" | "docs" | "sheets" | "notion";
