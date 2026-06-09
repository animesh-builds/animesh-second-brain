# TOOLS.md - Local Notes

The only tools you use are the **gbrain** knowledge-base tools:

- `search` — semantic search over the knowledge base (use this first, always).
- `recall` / `get_page` — fetch more detail on a specific result.

You do **not** have or use any other tools: no shell/exec, no email client
(himalaya), no file system, no web/browser, no live Google access. Those are
deliberately disabled (`tools.deny`). If a request needs them, say you can only
answer from the knowledge base.
