import { google, type Auth } from "googleapis";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { config, GOOGLE_SCOPES } from "./config.js";

const LOOPBACK_PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${LOOPBACK_PORT}/oauth2callback`;

/** Build an OAuth2 client. Optionally seed it with the stored refresh token. */
function makeClient(withRefreshToken: boolean): Auth.OAuth2Client {
  const client = new google.auth.OAuth2(
    config.google.clientId(),
    config.google.clientSecret(),
    REDIRECT_URI,
  );
  if (withRefreshToken) {
    client.setCredentials({ refresh_token: config.google.refreshToken() });
  }
  return client;
}

/** Authenticated client for ingestion. Refreshes access tokens automatically. */
export function getAuthClient(): Auth.OAuth2Client {
  return makeClient(true);
}

/**
 * One-time interactive flow: prints a consent URL, captures the code on a
 * loopback server, exchanges it, and prints the refresh token to paste into
 * .env. Run via `pnpm auth`.
 */
async function runLoginFlow(): Promise<void> {
  const client = makeClient(false);
  const state = randomBytes(16).toString("hex");
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-auth
    scope: [...GOOGLE_SCOPES],
    state,
  });

  const code = await new Promise<string>((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "", REDIRECT_URI);
        if (url.pathname !== "/oauth2callback") {
          res.writeHead(404).end();
          return;
        }
        if (url.searchParams.get("state") !== state) {
          res.writeHead(400).end("State mismatch — aborting.");
          reject(new Error("OAuth state mismatch"));
          return;
        }
        const err = url.searchParams.get("error");
        if (err) {
          res.writeHead(400).end(`OAuth error: ${err}`);
          reject(new Error(`OAuth error: ${err}`));
          return;
        }
        const got = url.searchParams.get("code");
        if (!got) {
          res.writeHead(400).end("No code.");
          reject(new Error("No authorization code returned"));
          return;
        }
        res.writeHead(200, { "Content-Type": "text/html" }).end(
          "<h2>Authorized.</h2><p>You can close this tab and return to the terminal.</p>",
        );
        server.close();
        resolvePromise(got);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
    server.listen(LOOPBACK_PORT, () => {
      console.log("\nOpen this URL in your browser to authorize (read-only):\n");
      console.log(authUrl + "\n");
      console.log(`Waiting for the redirect on ${REDIRECT_URI} ...`);
    });
  });

  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "No refresh_token returned. Revoke prior access at " +
        "https://myaccount.google.com/permissions and retry (we force prompt=consent).",
    );
  }
  console.log("\n=== Success ===");
  console.log("Add this line to your .env (keep it secret):\n");
  console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

if (process.argv.includes("--login")) {
  runLoginFlow().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
