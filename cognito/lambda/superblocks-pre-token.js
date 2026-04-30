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
 *   SUPERBLOCKS_TOKEN  — Embed access token from Superblocks Admin
 *                        (recommended: source from AWS Secrets Manager)
 *   SUPERBLOCKS_REGION — "app" (default) or "eu"
 *
 * @see https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso
 * @see https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html
 */
const https = require("https");

const SUPERBLOCKS_REGION = process.env.SUPERBLOCKS_REGION || "app";
const SUPERBLOCKS_TOKEN_HOST = `${SUPERBLOCKS_REGION}.superblocks.com`;
const SUPERBLOCKS_TOKEN_PATH = "/api/v1/public/token";

// Map a Cognito `custom:role` value to a Superblocks group id. Add the role
// to a user with:
//   aws cognito-idp admin-update-user-attributes \
//     --user-pool-id "$USER_POOL_ID" --username "you@example.com" \
//     --user-attributes Name=custom:role,Value=contractor
// (Requires `custom:role` to be declared on the pool via add-custom-attributes.)
const ROLE_TO_GROUP_ID = {
  contractor: "YOUR_GROUP_ID",
};

const postJson = (host, path, headers, body) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request(
      {
        host,
        path,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload),
          ...headers,
        },
      },
      (res) => {
        let chunks = "";
        res.on("data", (c) => (chunks += c));
        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(JSON.parse(chunks));
            } catch (e) {
              reject(new Error(`Invalid JSON from Superblocks: ${e.message}`));
            }
          } else {
            reject(new Error(`Superblocks ${res.statusCode}: ${chunks}`));
          }
        });
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });

exports.handler = async (event) => {
  if (!process.env.SUPERBLOCKS_TOKEN) {
    throw new Error("SUPERBLOCKS_TOKEN env var is not set on this Lambda");
  }

  const userAttrs = event.request.userAttributes || {};
  const role = userAttrs["custom:role"];
  const groupId = role ? ROLE_TO_GROUP_ID[role] : undefined;

  const user = {
    email: userAttrs.email,
    name: userAttrs.name || userAttrs.email,
    metadata: {
      external_role: role,
      cognitoUserId: userAttrs.sub,
    },
  };
  if (groupId) {
    user.groupIds = [groupId];
  }

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
