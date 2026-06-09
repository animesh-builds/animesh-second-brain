import { readdir, readFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { config } from "./config.js";
import { classifySensitivity } from "./sensitivity.js";

/**
 * Purge sensitive pages (job-search / compensation / money) from the knowledge
 * base. Moves flagged .md files into sources/google/.quarantine/ (not deleted —
 * reversible) so the brain source dir holds only non-sensitive content. After
 * running, rebuild the index: `gbrain init --force ...` then import + embed.
 *
 *   pnpm scrub          # report + quarantine
 *   pnpm scrub --dry    # report only, move nothing
 */
async function main(): Promise<void> {
  const dry = process.argv.includes("--dry");
  const dir = config.sourceDir;
  const quarantine = join(dir, ".quarantine");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));

  let kept = 0;
  let purged = 0;
  const byCat: Record<string, number> = {};

  for (const f of files) {
    const raw = await readFile(join(dir, f), "utf8");
    // title from front-matter, body = everything after the second '---'
    const title = (raw.match(/^title:\s*(.+)$/m)?.[1] ?? "").replace(/^["']|["']$/g, "");
    const body = raw.split(/^---\s*$/m).slice(2).join("\n");
    const { sensitive, categories } = classifySensitivity(title, body);
    if (sensitive) {
      purged++;
      for (const c of categories) byCat[c] = (byCat[c] ?? 0) + 1;
      console.log(`  PURGE [${categories.join(",")}]  ${f}`);
      if (!dry) {
        await mkdir(quarantine, { recursive: true });
        await rename(join(dir, f), join(quarantine, f));
      }
    } else {
      kept++;
      console.log(`  keep              ${f}`);
    }
  }

  console.log(
    `\n[scrub]${dry ? " (dry-run)" : ""} files=${files.length} purged=${purged} kept=${kept} ` +
      `by-category=${JSON.stringify(byCat)}`,
  );
  if (!dry && purged > 0) {
    console.log(
      "[scrub] Quarantined to sources/google/.quarantine/. Now rebuild the index:\n" +
        "  gbrain init --force --pglite --embedding-model ollama:nomic-embed-text\n" +
        "  gbrain import sources/google/ --no-embed && gbrain embed --stale",
    );
  }
}

main().catch((e) => {
  console.error("[scrub] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
