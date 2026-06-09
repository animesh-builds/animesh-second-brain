import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const exec = promisify(execFile);

/**
 * Retrieval + citation eval (ai-spec.md §Evals). Runs each gold question
 * through gbrain and checks: (1) in-corpus questions retrieve the expected
 * source, (2) out-of-corpus questions retrieve nothing (no fabrication).
 *
 * This exercises the brain's retrieval/citation core directly via the gbrain
 * CLI — it does not require the WhatsApp/OpenClaw stack to be running.
 */
interface GoldCase {
  question: string;
  expectSourceId: string;
  expectAnswer: string;
  outOfCorpus: boolean;
}

const PASS_BAR = 0.9;

async function gbrainSearch(question: string): Promise<string> {
  // Prefer JSON; fall back to plain text if the flag/version differs.
  try {
    const { stdout } = await exec("gbrain", ["search", question, "--json"], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } catch {
    const { stdout } = await exec("gbrain", ["search", question], {
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }
}

/** Heuristic: does the gbrain output reference this source id, and is it non-empty? */
function evaluate(output: string, c: GoldCase): boolean {
  const trimmed = output.trim();
  const hasResults = trimmed.length > 0 && !/no results|nothing found/i.test(trimmed);

  if (c.outOfCorpus) {
    // Pass only if the brain surfaced nothing relevant (anti-hallucination).
    return !hasResults;
  }
  const citationOk = c.expectSourceId === "" || output.includes(c.expectSourceId);
  const answerOk = c.expectAnswer === "" || output.toLowerCase().includes(c.expectAnswer.toLowerCase());
  return hasResults && citationOk && answerOk;
}

async function main(): Promise<void> {
  const dir = new URL(".", import.meta.url).pathname;
  const goldPath = existsSync(join(dir, "gold.jsonl"))
    ? join(dir, "gold.jsonl")
    : join(dir, "gold.example.jsonl");
  console.log(`[eval] using ${goldPath}`);

  const lines = (await readFile(goldPath, "utf8"))
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const cases = lines.map((l) => JSON.parse(l) as GoldCase);

  let pass = 0;
  let fabrications = 0;
  for (const c of cases) {
    let ok = false;
    try {
      const out = await gbrainSearch(c.question);
      ok = evaluate(out, c);
    } catch (e) {
      console.error(`[eval] gbrain failed for "${c.question}":`, e instanceof Error ? e.message : e);
    }
    if (ok) pass++;
    else if (c.outOfCorpus) fabrications++;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.outOfCorpus ? "[out-of-corpus] " : ""}${c.question}`);
  }

  const rate = cases.length ? pass / cases.length : 0;
  console.log(`\n[eval] ${pass}/${cases.length} passed (${(rate * 100).toFixed(0)}%). ` +
    `fabrications=${fabrications}`);
  console.log(`[eval] pass bar: >=${PASS_BAR * 100}% AND zero fabrications.`);

  if (rate < PASS_BAR || fabrications > 0) {
    console.error("[eval] BELOW PASS BAR.");
    process.exit(1);
  }
  console.log("[eval] PASS.");
}

main().catch((e) => {
  console.error("[eval] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
