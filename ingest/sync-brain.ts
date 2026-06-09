import { spawn } from "node:child_process";
import { config } from "./config.js";

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${cmd} ${args.join(" ")} exited ${code}`)),
    );
  });
}

/**
 * Import the freshly-written markdown into gbrain and embed the stale chunks.
 * Mirrors the gbrain live-sync recipe:
 *   gbrain import <dir> --no-embed && gbrain embed --stale
 * No-ops (with a warning) if gbrain isn't on PATH so ingestion still succeeds.
 */
export async function syncBrain(): Promise<void> {
  if (!config.runGbrainSync) {
    console.log("[brain] RUN_GBRAIN_SYNC=false — skipping gbrain sync.");
    return;
  }
  try {
    await run("gbrain", ["import", config.sourceDir, "--no-embed"]);
    await run("gbrain", ["embed", "--stale"]);
    console.log("[brain] gbrain import + embed complete.");
  } catch (e) {
    console.warn(
      `[brain] gbrain sync skipped/failed: ${
        e instanceof Error ? e.message : e
      }\n` +
        "        Install gbrain (see brain/setup.sh) or set RUN_GBRAIN_SYNC=false.",
    );
  }
}
