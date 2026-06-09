import "./test-env.js"; // MUST be first — sets REDACT_* before config.ts loads.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderPage, sanitizeBody, pageFilename, redactPII } from "./markdown.js";
import { isUnchanged, markSeen } from "./state.js";
import type { IngestState } from "./state.js";
import { classifySensitivity } from "./sensitivity.js";

test("sanitizeBody strips control chars, keeps tab/newline, truncates", () => {
  const NUL = String.fromCharCode(0);
  const BEL = String.fromCharCode(7);
  const clean = sanitizeBody(`hello${NUL}${BEL}world\ttab\nline`, 1000);
  assert.equal(clean, "helloworld\ttab\nline");

  const long = sanitizeBody("x".repeat(50), 10);
  assert.ok(long.startsWith("xxxxxxxxxx"));
  assert.ok(long.includes("_[truncated]_"));
});

test("redactPII scrubs emails, phones, secrets, call links, and known names", () => {
  assert.match(redactPII("ping me at sam@acme.io"), /\[REDACTED-EMAIL\]/);
  assert.match(redactPII("call +919876543210 now"), /\[REDACTED-PHONE\]/);
  assert.match(redactPII("key sk-or-v1-abcdef0123456789abcd"), /\[REDACTED-SECRET\]/);
  assert.match(
    redactPII("join https://meet.google.com/abc-defg-hij"),
    /\[REDACTED-LINK\]/,
  );
  // Name from REDACT_NAMES (test-env), case-insensitive.
  assert.match(redactPII("interviewer was ada lovelace"), /\[REDACTED-NAME\]/);
  // Ordinary words untouched.
  assert.equal(redactPII("the quarterly roadmap"), "the quarterly roadmap");
});

test("renderPage redacts PII, adds the notice, strips url tracking params", () => {
  const md = renderPage(
    {
      source: "docs",
      id: "file-123",
      revision: "1700000000000",
      date: "2026-01-01T00:00:00.000Z",
      title: "Q1 plan",
      participants: ["a@x.com", "b@y.com"],
      url: "https://docs.google.com/document/d/file-123/edit?usp=drivesdk&ouid=999",
    },
    sanitizeBody("contact a@x.com", 1000),
  );
  assert.ok(md.startsWith("---\n"));
  assert.match(md, /\nsource: docs\n/);
  // Emails in participants AND body are redacted.
  assert.match(md, /\nparticipants: \["\[REDACTED-EMAIL\]", "\[REDACTED-EMAIL\]"\]\n/);
  assert.match(md, /contact \[REDACTED-EMAIL\]/);
  assert.doesNotMatch(md, /a@x\.com/);
  // Citation url keeps the path but drops ?usp/ouid tracking params.
  assert.match(md, /url:.*docs\.google\.com\/document\/d\/file-123\/edit/);
  assert.doesNotMatch(md, /ouid|usp=/);
  // Privacy notice present.
  assert.ok(md.includes("PII redacted per privacy policy"));
});

test("classifySensitivity flags job-search / compensation / money", () => {
  assert.equal(classifySensitivity("Razorpay Interview Confirmation", "design round").sensitive, true);
  assert.equal(classifySensitivity("Re: offer", "Expected CTC: 45 LPA").sensitive, true);
  assert.equal(classifySensitivity("OpenRouter receipt", "Amount paid $10.80").sensitive, true);
  assert.deepEqual(
    classifySensitivity("Job alert", "Product Manager applied").categories.includes("job-search"),
    true,
  );
  // Non-sensitive content passes through.
  assert.equal(classifySensitivity("Meeting notes", "Discussed the roadmap and Q3 themes.").sensitive, false);
});

test("pageFilename is deterministic and filesystem-safe", () => {
  assert.equal(pageFilename("gmail", "abc/def:ghi"), "gmail-abc_def_ghi.md");
  assert.equal(
    pageFilename("docs", "1aB-_cD"),
    pageFilename("docs", "1aB-_cD"),
    "same input -> same filename (idempotent path)",
  );
});

test("idempotency: same id+revision is unchanged after first write", () => {
  const state: IngestState = {
    seen: { gmail: {}, drive: {}, docs: {}, sheets: {}, notion: {} },
  };
  assert.equal(isUnchanged(state, "gmail", "t1", "rev1"), false);
  markSeen(state, "gmail", "t1", "rev1");
  assert.equal(isUnchanged(state, "gmail", "t1", "rev1"), true, "re-run skips");
  // A new revision (new reply in the thread) must NOT be skipped.
  assert.equal(isUnchanged(state, "gmail", "t1", "rev2"), false);
});
