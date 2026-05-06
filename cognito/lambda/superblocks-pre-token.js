/**
 * Cognito Pre Token Generation Lambda trigger (v2): fetch a Superblocks
 * session and add it to the ID token as the `superblocks_token` claim.
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
 *   SUPERBLOCKS_TOKEN     — Embed access token from Superblocks Admin
 *                           (recommended: source from AWS Secrets Manager)
 *   SUPERBLOCKS_REGION    — "app" (default) or "eu"
 *
 * @see https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso
 * @see https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
 */
const https = require("https");

const SUPERBLOCKS_REGION = process.env.SUPERBLOCKS_REGION || "app";
const SUPERBLOCKS_TOKEN_HOST = `${SUPERBLOCKS_REGION}.superblocks.com`;
const SUPERBLOCKS_TOKEN_PATH = "/api/v1/public/token";

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

const postJson = (host, path, headers, body) =>
  httpsJson("POST", host, path, headers, body);

exports.handler = async (event) => {
  if (!process.env.SUPERBLOCKS_TOKEN) {
    throw new Error("SUPERBLOCKS_TOKEN env var is not set on this Lambda");
  }

  const userAttrs = (event && event.request && event.request.userAttributes) || {};

  const user = {
    email: userAttrs.email,
    name: userAttrs.name || userAttrs.email,
    metadata: {
      cognitoUserId: userAttrs.sub,
    },
    // TODO(group association): programmatically look up the user's
    // Superblocks group based on their email domain — e.g. for
    // "name@walmart.com", find or create the Superblocks group named
    // "walmart.com" and pass its ID on `user.groupIds` below.
    //
    // Blocked on a Superblocks groups API. Until that's in place, every
    // user signs in without explicit group membership and inherits
    // whatever the org's "All Users" defaults grant.
  };

  const token = await postJson(
    SUPERBLOCKS_TOKEN_HOST,
    SUPERBLOCKS_TOKEN_PATH,
    { authorization: `Bearer ${process.env.SUPERBLOCKS_TOKEN}` },
    user,
  );

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
