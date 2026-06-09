/**
 * Sensitivity classifier — flags content the user does NOT want in the shared
 * knowledge base: job search, compensation, and money/financial info.
 *
 * Used two ways:
 *  - at ingest time (from-mcp.ts / run-sync.ts) to SKIP sensitive pages, and
 *  - by scrub.ts to purge already-ingested sensitive pages.
 */

export type SensitiveCategory = "money" | "compensation" | "job-search";

const PATTERNS: Array<{ category: SensitiveCategory; re: RegExp }> = [
  // Money / financial / payments.
  {
    category: "money",
    re: /\b(receipt|amount paid|invoice|payment|payout|paid \$|refund|transaction|bank|upi|account number|card ending|balance)\b/i,
  },
  { category: "money", re: /(\$|₹|usd|inr|rs\.?)\s?\d|\b\d+(\.\d+)?\s?(lpa|lakhs?|crores?|k\/?mo)\b/i },
  // Compensation.
  {
    category: "compensation",
    re: /\b(ctc|lpa|salary|compensation|retention bonus|stipend|in-?hand|take-?home|payslip|appraisal|increment|hike|offer letter|notice period|expected ctc|current ctc)\b/i,
  },
  // Job search / hiring / interviews.
  {
    category: "job-search",
    re: /\b(interview|recruiter|hiring|job\s?(alert|mail|application|board)?|applied|application|vacancy|opening|shortlist|candidate|jobgether|greenhouse|ambitionbox|naukri|placement|interview prep|guesstimate|rca round|wants to connect|connection request|talent acquisition|\bHR\b)\b/i,
  },
];

export interface SensitivityResult {
  sensitive: boolean;
  categories: SensitiveCategory[];
}

/**
 * Newsletter detector. The knowledge base is restricted to NEWSLETTER emails
 * only — everything else (personal mail, transactional, job alerts, account
 * notices, docs) is excluded. Driven mainly by the sender; content cues back it up.
 */
const NEWSLETTER_SENDER =
  /@(.*\.)?substack\.com|@(mail\.)?mostlymetrics\.com|@timdenning\.com|@every\.to|@mail\.mozilla\.org|newsletters-noreply@linkedin\.com|editors-noreply@linkedin\.com|@mail\.beehiiv\.com|@.*\.beehiiv\.com|@news\.|@newsletter\.|@email\.|@mail\./i;

const NON_NEWSLETTER_SENDER =
  /jobalerts|jobmail|messages-noreply@linkedin|invitations@linkedin|notifications-noreply@linkedin|no-reply@greenhouse|@naukri|ambitionbox|indeed\.com|receipts?@|no-reply@mail\.ollama|hello@ollama|welcome@|notifications@openrouter|@razorpay|@gofynd|@successpact|@npci/i;

export function isNewsletter(sender: string, title: string, body: string): boolean {
  if (NON_NEWSLETTER_SENDER.test(sender)) return false;
  if (NEWSLETTER_SENDER.test(sender)) return true;
  // Content fallback: clear newsletter footer cues.
  return /\b(unsubscribe|view (this email )?in (your )?browser|you('|’)re receiving this|manage your subscription)\b/i.test(
    `${title}\n${body}`,
  );
}

/** Classify a page's title + body. Any matched category ⇒ sensitive. */
export function classifySensitivity(title: string, body: string): SensitivityResult {
  const text = `${title}\n${body}`;
  const hits = new Set<SensitiveCategory>();
  for (const { category, re } of PATTERNS) {
    if (re.test(text)) hits.add(category);
  }
  return { sensitive: hits.size > 0, categories: [...hits] };
}
