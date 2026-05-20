# Cognito Pre Token Generation Lambda (Superblocks token)

Cognito's Pre Token Generation trigger is the equivalent of the old Auth0
Post-Login Action: it runs server-side during the OAuth code-exchange,
calls Superblocks to mint a session token, and adds it to the ID token as
the `superblocks_token` claim. The React app then reads that claim and
hands it to `SuperblocksEmbed`.

Official Superblocks steps:
[Login embed users with Auth0](https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso)
(the SSO contract is the same — only the IdP changes).

## Source file in this repo

Use [cognito/lambda/superblocks-pre-token.js](../cognito/lambda/superblocks-pre-token.js)
as the Lambda code (adjust `metadata` / `groupIds` if needed).

> **Per environment.** Lambda triggers are wired to one User Pool in one
> account. If you use separate dev/prod accounts (recommended — see
> [setup-cognito-user-pool.md](setup-cognito-user-pool.md#pools-and-environments-read-this-first)),
> repeat the steps below in **each** account and give the prod Lambda a
> production-grade `SUPERBLOCKS_EMBED_TOKEN` (sourced from Secrets Manager).

## Console / CLI setup

### 1. Create the Lambda

```bash
# Package the function (no dependencies — uses Node's built-in https):
cd cognito/lambda
zip function.zip superblocks-pre-token.js
cd ../..

# Create an execution role (one-time):
aws iam create-role \
  --role-name superblocks-pre-token-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }'
aws iam attach-role-policy \
  --role-name superblocks-pre-token-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Wait a few seconds for the role to propagate, then create the Lambda.
aws lambda create-function \
  --function-name superblocks-pre-token \
  --runtime nodejs20.x \
  --role "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):role/superblocks-pre-token-role" \
  --handler superblocks-pre-token.handler \
  --zip-file fileb://cognito/lambda/function.zip \
  --environment "Variables={SUPERBLOCKS_EMBED_TOKEN=<your-superblocks-embed-token>,SUPERBLOCKS_ORG_ADMIN_TOKEN=<your-superblocks-org-admin-token>,SUPERBLOCKS_REGION=app}" \
  --timeout 10
```

> **Secrets in production.** Don't set `SUPERBLOCKS_EMBED_TOKEN` or
> `SUPERBLOCKS_ORG_ADMIN_TOKEN` as plain Lambda env vars in prod. Store them in
> AWS Secrets Manager and either:
> (a) use Lambda env-var encryption helpers and KMS-encrypted env vars,
> or (b) `GetSecretValue` from the handler at cold-start. Option (b) avoids
> the tokens ever appearing in `aws lambda get-function-configuration`.

### 2. Allow Cognito to invoke the Lambda

```bash
aws lambda add-permission \
  --function-name superblocks-pre-token \
  --statement-id cognito-invoke \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn "arn:aws:cognito-idp:$(aws configure get region):$(aws sts get-caller-identity --query Account --output text):userpool/$USER_POOL_ID"
```

### 3. Wire the trigger to the User Pool (V2)

The `superblocks_token` claim ships in the ID token, so the V2 trigger event
("Basic features + access token customization") is sufficient. Console
path: **Cognito → User Pools → <your pool> → Extensions → Pre token
generation → Edit**, choose your Lambda, and set **Trigger event version**
to `Basic features + access token customization`.

CLI:

```bash
LAMBDA_ARN="arn:aws:lambda:$(aws configure get region):$(aws sts get-caller-identity --query Account --output text):function:superblocks-pre-token"

aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --lambda-config "PreTokenGenerationConfig={LambdaArn=$LAMBDA_ARN,LambdaVersion=V2_0}" \
  --auto-verified-attributes email
```

> `update-user-pool` overwrites the entire Lambda-config block, so if you
> already have other triggers wired up, include them in the same call (run
> `aws cognito-idp describe-user-pool ... --query 'UserPool.LambdaConfig'`
> to see what's currently set).

### 4. Iterate on the Lambda

```bash
cd cognito/lambda
zip -j function.zip superblocks-pre-token.js
aws lambda update-function-code \
  --function-name superblocks-pre-token \
  --zip-file fileb://function.zip
cd ../..
```

## Group association (email-domain → Superblocks group)

When `SUPERBLOCKS_ORG_ADMIN_TOKEN` is set on the Lambda, the handler resolves
each signed-in user's email domain to a Superblocks group via the
[SCIM 2.0 Groups API](https://docs.superblocks.com/admin/org-administration/auth/scim)
and includes its ID on the `/public/token` request:

| Email                  | Group lookup (SCIM `displayName eq …`) | Action          |
| ---------------------- | -------------------------------------- | --------------- |
| `alice@walmart.com`    | `walmart.com`                          | use existing ID |
| `bob@new-customer.com` | `new-customer.com` (not found)         | create + use ID |

- **Token type.** Use an **Org Admin** access token from Superblocks Admin
  → Organization Settings → Access Tokens — the Embed token used for
  `/public/token` is not authorized to call SCIM.
- **Endpoint.** `https://<region>.superblocks.com/scim/v2/Groups`
  (US: `app`, EU: `eu`).
- **Caching.** Resolved `domain → groupId` is cached in-memory for the
  warm-container lifetime, so SCIM is only hit on cold start.
- **Self-healing.** If `/public/token` later rejects a cached ID
  (`"The following requested group IDs are invalid: …"` after the group
  was deleted in Superblocks), the handler evicts that ID and retries
  once without it.
- **Fallback.** If `SUPERBLOCKS_ORG_ADMIN_TOKEN` is unset or SCIM is
  unreachable, group resolution is skipped (logged) and the user signs
  in with only the org's "All Users" defaults.

### Test locally before deploying

```bash
# At repo root:
cp cognito/lambda/env.example .env.lambda           # gitignored
# Edit .env.lambda — set SUPERBLOCKS_EMBED_TOKEN (and SUPERBLOCKS_ORG_ADMIN_TOKEN if
# you want group resolution to run)
set -a && source .env.lambda && set +a

# Run the full handler against a mock Cognito event and decode the resulting
# Superblocks JWT:
node cognito/lambda/test-local.js abc@mycompany.com "Test User"

# Or poke the SCIM Groups API directly:
node cognito/lambda/test-local.js list                  # list all groups
node cognito/lambda/test-local.js list mycompany.com    # filter by displayName
```

### Where to put the secrets

| Value | Local dev | Lambda dev | Lambda prod |
| --- | --- | --- | --- |
| `SUPERBLOCKS_EMBED_TOKEN` (embed) | `.env.lambda` (gitignored) | plain Lambda env var | **Secrets Manager** |
| `SUPERBLOCKS_ORG_ADMIN_TOKEN` (org admin / SCIM) | `.env.lambda` (gitignored) | plain Lambda env var | **Secrets Manager** |

For prod, store both tokens in Secrets Manager, grant the Lambda role
`secretsmanager:GetSecretValue` on the secret ARNs, and have the handler
load them at cold start (cache for the container lifetime).

## Verify

After a full sign-in (sign out of the app and clear Cognito's Hosted-UI
cookies if needed), decode the ID token in [jwt.io](https://jwt.io)
(do not share production tokens) or in dev console:

```ts
import { fetchAuthSession } from "aws-amplify/auth";
const session = await fetchAuthSession();
console.log(session.tokens?.idToken?.payload?.superblocks_token);
```

You should see a Superblocks JWT.

If the claim is missing:

- Check the Lambda's CloudWatch logs (`/aws/lambda/superblocks-pre-token`)
  for errors from the Superblocks API call.
- Confirm `SUPERBLOCKS_EMBED_TOKEN` is set on the Lambda (`aws lambda
  get-function-configuration --function-name superblocks-pre-token`).
- Confirm the Pre Token Generation trigger is wired with `LambdaVersion=V2_0`
  on the User Pool.
- Confirm Cognito is allowed to invoke the Lambda (step 2 above).
