#!/usr/bin/env node
/**
 * Local sanity-check for the Pre Token Generation Lambda. Invokes the
 * handler against a mock Cognito event so you can verify your
 * SUPERBLOCKS_EMBED_TOKEN, region, and the resulting claims before deploying.
 *
 * Setup:
 *   cp cognito/lambda/env.example .env.lambda     # gitignored at repo root
 *   # edit .env.lambda — fill in real values
 *   set -a && source .env.lambda && set +a
 *
 * Usage:
 *   node cognito/lambda/test-local.js                              # uses sample inputs
 *   node cognito/lambda/test-local.js you@mycompany.com
 *   node cognito/lambda/test-local.js you@mycompany.com "Test User"
 *   node cognito/lambda/test-local.js list                         # SCIM: list groups
 *   node cognito/lambda/test-local.js list mycompany.com           # SCIM: filter by name
 */
const lambda = require("./superblocks-pre-token");

function assertEnv(required) {
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `Missing env vars: ${missing.join(", ")}\n` +
        `See cognito/lambda/env.example. Source a local env file first:\n` +
        `  set -a && source .env.lambda && set +a`,
    );
    process.exit(1);
  }
}

/** Render a token like `eyJhb…sQX9k (len=842)` for safe logging. */
function previewToken(t) {
  if (!t) return "(unset)";
  const head = t.slice(0, 6);
  const tail = t.length > 16 ? t.slice(-6) : "";
  return `${head}…${tail} (len=${t.length})`;
}

function decodeJwt(jwt) {
  try {
    const [, payload] = jwt.split(".");
    return JSON.parse(
      Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8",
      ),
    );
  } catch {
    return undefined;
  }
}

async function runHandler(email, name) {
  assertEnv(["SUPERBLOCKS_EMBED_TOKEN"]);

  console.log("Env summary:");
  console.log(`  SUPERBLOCKS_EMBED_TOKEN     = ${previewToken(process.env.SUPERBLOCKS_EMBED_TOKEN)}`);
  console.log(`  SUPERBLOCKS_ORG_ADMIN_TOKEN = ${previewToken(process.env.SUPERBLOCKS_ORG_ADMIN_TOKEN)}`);
  console.log(
    `  SUPERBLOCKS_REGION          = ${process.env.SUPERBLOCKS_REGION || "(default: app)"}`,
  );
  console.log();

  console.log(`Invoking handler with mock Cognito event for "${email}"…`);
  const event = {
    request: {
      userAttributes: {
        email,
        name,
        sub: "local-test-cognito-sub-0001",
      },
    },
  };
  const result = await lambda.handler(event);
  const claims =
    result.response &&
    result.response.claimsAndScopeOverrideDetails &&
    result.response.claimsAndScopeOverrideDetails.idTokenGeneration &&
    result.response.claimsAndScopeOverrideDetails.idTokenGeneration
      .claimsToAddOrOverride;
  const claim = claims && claims.superblocks_token;

  if (!claim) {
    console.error("  superblocks_token claim missing — see logs above.");
    process.exit(2);
  }
  console.log(`  superblocks_token = ${claim.slice(0, 32)}…`);
  const payload = decodeJwt(claim);
  if (payload) {
    console.log("  decoded payload:");
    console.log(
      JSON.stringify(payload, null, 2)
        .split("\n")
        .map((l) => `    ${l}`)
        .join("\n"),
    );
  }
}

async function runListGroups(filterName) {
  assertEnv(["SUPERBLOCKS_ORG_ADMIN_TOKEN"]);
  const { findGroupByName } = lambda._internals;
  if (filterName) {
    console.log(`Looking up SCIM group with displayName="${filterName}"…`);
    const group = await findGroupByName(filterName);
    if (!group) {
      console.log("  (no match)");
      return;
    }
    console.log(`  ${group.id}\t${group.displayName}`);
    return;
  }
  // No filter: hit SCIM /Groups directly and print all results.
  const https = require("https");
  const region = process.env.SUPERBLOCKS_REGION || "app";
  await new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: `${region}.superblocks.com`,
        path: "/scim/v2/Groups",
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${process.env.SUPERBLOCKS_ORG_ADMIN_TOKEN}`,
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            console.error(`  ${res.statusCode}: ${chunks}`);
            return reject(new Error(`SCIM list failed (${res.statusCode})`));
          }
          const body = JSON.parse(chunks);
          const groups = body.Resources || [];
          console.log(`Found ${groups.length} group(s):`);
          for (const g of groups) console.log(`  ${g.id}\t${g.displayName}`);
          resolve();
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

(async () => {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "list") {
    await runListGroups(rest[0]);
    return;
  }
  const email = cmd || "test.user@mycompany.com";
  const name = rest[0] || email;
  await runHandler(email, name);
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  if (err.body) console.error("  body:", JSON.stringify(err.body));
  process.exit(2);
});
