/**
 * Cognito Pre Token Generation Lambda trigger (v2): fetch a Superblocks
 * session and add it to the ID token as the `superblocks_token` claim.
 *
 * Also resolves each signed-in user's email domain to a Superblocks group
 * (creating the group on first sight) via the SCIM 2.0 API, so a user
 * signing in as `name@walmart.com` is placed in the Superblocks group
 * named `walmart.com`.
 *
 * Console: Cognito → User Pools → <your pool> → Extensions →
 *   Pre token generation → Lambda trigger event version: "Basic features +
 *   access token customization" (V2_0 / V3_0 both work).
 *
 * Runtime: Node.js 20.x (or newer). No external dependencies — uses Node's
 * built-in `https` so you can paste this straight into the Lambda inline
 * editor.
 *
 * Environment variables (Lambda → Configuration → Environment variables):
 *   SUPERBLOCKS_EMBED_TOKEN     — Embed access token from Superblocks Admin
 *                                 (recommended: source from AWS Secrets Manager)
 *   SUPERBLOCKS_ORG_ADMIN_TOKEN — Org Admin access token used to call SCIM.
 *                                 If unset, group resolution is skipped and
 *                                 users inherit whatever the org's "All
 *                                 Users" defaults grant.
 *   SUPERBLOCKS_REGION          — "app" (default) or "eu"
 *
 * @see https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso
 * @see https://docs.superblocks.com/admin/org-administration/auth/access-tokens
 * @see https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
 */
const https = require("https");

const SUPERBLOCKS_REGION = process.env.SUPERBLOCKS_REGION || "app";
const SUPERBLOCKS_HOST = `${SUPERBLOCKS_REGION}.superblocks.com`;
const SUPERBLOCKS_TOKEN_PATH = "/api/v1/public/token";
const SUPERBLOCKS_SCIM_GROUPS_PATH = "/scim/v2/Groups";
const SCIM_GROUP_SCHEMA = "urn:ietf:params:scim:schemas:core:2.0:Group";

// Cache resolved `domain → groupId` for the warm-container lifetime so we
// only hit SCIM on cold start. Entries are evicted if `/public/token`
// later tells us the cached ID is no longer valid (group deleted).
const domainGroupIdCache = new Map();

/** Issue an HTTPS request and parse JSON; reject on non-2xx responses. */
const httpsJson = (method, host, path, headers, body) =>
  new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const reqHeaders = { accept: "application/json", ...headers };
    if (payload !== undefined) {
      reqHeaders["content-type"] = "application/json";
      reqHeaders["content-length"] = Buffer.byteLength(payload);
    }
    const req = https.request(
      { host, path, method, headers: reqHeaders },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          const ok =
            res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
          let parsed;
          try {
            parsed = chunks ? JSON.parse(chunks) : undefined;
          } catch (_) {
            parsed = chunks;
          }
          if (ok) return resolve(parsed);
          const err = new Error(
            `Superblocks ${res.statusCode} on ${method} ${host}${path}: ${chunks}`,
          );
          err.statusCode = res.statusCode;
          err.body = parsed;
          reject(err);
        });
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });

const getJson = (host, path, headers) => httpsJson("GET", host, path, headers);
const postJson = (host, path, headers, body) =>
  httpsJson("POST", host, path, headers, body);

const scimAuthHeaders = () => ({
  authorization: `Bearer ${process.env.SUPERBLOCKS_ORG_ADMIN_TOKEN}`,
});

/** Find a Superblocks group by exact displayName via SCIM; null if none. */
async function findGroupByName(displayName) {
  const filter = encodeURIComponent(`displayName eq "${displayName}"`);
  const res = await getJson(
    SUPERBLOCKS_HOST,
    `${SUPERBLOCKS_SCIM_GROUPS_PATH}?filter=${filter}`,
    scimAuthHeaders(),
  );
  const resources = (res && res.Resources) || [];
  // SCIM filters are case-insensitive by spec; be strict on exact-match.
  return resources.find((g) => g && g.displayName === displayName) || null;
}

/** Create a new Superblocks group via SCIM; returns the created resource. */
function createGroup(displayName) {
  return postJson(
    SUPERBLOCKS_HOST,
    SUPERBLOCKS_SCIM_GROUPS_PATH,
    scimAuthHeaders(),
    { schemas: [SCIM_GROUP_SCHEMA], displayName },
  );
}

/**
 * Resolve email → Superblocks group ID. Looks up an existing group named
 * after the email domain and creates one on first sight. Returns null
 * when `SUPERBLOCKS_ORG_ADMIN_TOKEN` is unset, the email has no domain, or any
 * SCIM call fails (logged, non-fatal — we still mint a session token).
 */
async function resolveDomainGroupId(email) {
  if (!email || !process.env.SUPERBLOCKS_ORG_ADMIN_TOKEN) return null;
  const at = email.indexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;

  if (domainGroupIdCache.has(domain)) return domainGroupIdCache.get(domain);

  try {
    const existing = await findGroupByName(domain);
    const group = existing || (await createGroup(domain));
    if (group && group.id) {
      domainGroupIdCache.set(domain, group.id);
      return group.id;
    }
  } catch (err) {
    console.error(
      `[pre-token] SCIM group resolution failed for domain="${domain}": ${err.message}`,
    );
  }
  return null;
}

/** Pull invalid group IDs out of a /public/token 4xx error body, if any. */
function parseInvalidGroupIds(err) {
  const body = err && err.body;
  const message =
    (body && body.responseMeta && body.responseMeta.message) ||
    (body && body.error && body.error.message) ||
    (body && body.message) ||
    (err && err.message) ||
    "";
  // Server returns e.g. "The following requested group IDs are invalid: <uuid>, <uuid>"
  const match = /invalid group ids?:?\s*([0-9a-fA-F-,\s]+)/i.exec(message);
  if (!match) return [];
  return match[1]
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

exports.handler = async (event) => {
  if (!process.env.SUPERBLOCKS_EMBED_TOKEN) {
    throw new Error("SUPERBLOCKS_EMBED_TOKEN env var is not set on this Lambda");
  }

  const userAttrs = (event && event.request && event.request.userAttributes) || {};

  const user = {
    email: userAttrs.email,
    name: userAttrs.name || userAttrs.email,
    metadata: {
      cognitoUserId: userAttrs.sub,
    },
  };

  const groupId = await resolveDomainGroupId(userAttrs.email);
  if (groupId) user.groupIds = [groupId];

  const fetchToken = () =>
    postJson(
      SUPERBLOCKS_HOST,
      SUPERBLOCKS_TOKEN_PATH,
      { authorization: `Bearer ${process.env.SUPERBLOCKS_EMBED_TOKEN}` },
      user,
    );

  let token;
  try {
    token = await fetchToken();
  } catch (err) {
    // Self-heal stale cached group IDs: if Superblocks tells us a group ID
    // we sent is invalid (group was deleted), evict from cache and retry
    // once without it. Avoids breaking sign-in until the container cycles.
    const invalid = parseInvalidGroupIds(err);
    if (!invalid.length || !user.groupIds) throw err;
    user.groupIds = user.groupIds.filter((id) => !invalid.includes(id));
    for (const [domain, id] of domainGroupIdCache) {
      if (invalid.includes(id)) domainGroupIdCache.delete(domain);
    }
    if (user.groupIds.length === 0) delete user.groupIds;
    console.warn(
      `[pre-token] retrying /public/token after evicting invalid group IDs: ${invalid.join(", ")}`,
    );
    token = await fetchToken();
  }

  event.response = {
    claimsAndScopeOverrideDetails: {
      idTokenGeneration: {
        claimsToAddOrOverride: {
          superblocks_token: token.access_token,
        },
      },
    },
  };

  return event;
};

// Exported for local testing only — see cognito/lambda/test-local.js.
exports._internals = { findGroupByName, createGroup, resolveDomainGroupId };
