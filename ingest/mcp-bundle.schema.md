# MCP ingestion bundle

The **MCP path** (`ingest/from-mcp.ts`, run via `pnpm ingest:mcp <bundle.json>`)
is an alternative to the OAuth bridge (`run-sync.ts`). It exists because this
project is operated by an agent (Claude Code / OpenClaw) that already holds
authenticated **Google MCP connectors** — so there is **no Google Cloud OAuth
setup** to do for bootstrapping data.

## Who does what

1. **The agent fetches** Google data through MCP connectors:
   - Gmail: `search_threads` (Gmail query syntax) → `get_thread` (FULL_CONTENT
     for bodies).
   - Drive: `search_files` / `list_recent_files` → `read_file_content`
     (returns clean text/markdown for Docs & Sheets).
2. **The agent writes a bundle JSON** with the shape below.
3. **`from-mcp.ts` renders + redacts + dedupes** — same `renderPage()` /
   `sanitizeBody()` (PII redaction) / `state.ts` idempotency as the OAuth path —
   then triggers `gbrain` sync.

## Privacy

- Put the bundle under the gitignored `sources/` tree (e.g.
  `sources/google/.mcp-bundle.json`) — it holds **raw, pre-redaction** data.
- **Delete the bundle** after running; the rendered `.md` pages are the
  redacted artifact.
- Set `REDACT_NAMES` (comma-separated) to the person names present in the data
  so they are scrubbed to `[REDACTED-NAME]` (the regex layer handles emails,
  phones, secrets, and call links automatically).

## Bundle shape

```jsonc
{
  "gmailThreads": [
    {
      "id": "<threadId>",                       // idempotency key
      "messages": [
        {
          "sender": "from@example.com",
          "toRecipients": ["to@example.com"],
          "subject": "...",
          "date": "2026-06-09T10:43:59Z",       // ISO 8601; latest = revision
          "body": "plaintext body (or `plaintextBody` / `snippet`)"
        }
      ]
    }
  ],
  "driveFiles": [
    {
      "id": "<fileId>",                          // idempotency key
      "title": "...",
      "mimeType": "application/vnd.google-apps.document", // or ...spreadsheet
      "modifiedTime": "2026-06-09T12:32:43Z",    // used as revision
      "viewUrl": "https://docs.google.com/...",  // tracking params stripped on render
      "content": "text/markdown from read_file_content"
    }
  ]
}
```

## Automation note

MCP connectors live in the **agent session**, not in a plain cron. For an
unattended 15-min refresh, either use the OAuth bridge (`pnpm ingest`) or run
`pnpm ingest:mcp` from a scheduled headless agent that holds the connectors.
