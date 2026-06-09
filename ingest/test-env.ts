// Test-only side-effect module. MUST be imported BEFORE ./config.js (i.e. the
// first import in any test that exercises redaction) so these values are in
// process.env when config.ts evaluates them at module load.
process.env.REDACT_PII = "true";
if (!process.env.REDACT_NAMES) {
  // Fictional names only — never commit real people's names to a public repo.
  process.env.REDACT_NAMES = "Ada Lovelace,Grace Hopper";
}
