# Superblocks Embed + React + AWS Cognito

This example shows how to embed a Superblocks application in a React app
using [Amazon Cognito](https://aws.amazon.com/cognito/) for identity and a
[Cognito Pre Token Generation Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html)
to mint a Superblocks session token. The flow follows
[Login embed users with Auth0](https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso)
(the SSO contract is the same — only the IdP changes).

## Architecture

```
┌─────────────┐         ┌──────────────────┐         ┌───────────────┐
│  React App  │────────▶│  Cognito User    │         │  Superblocks  │
│  (Embed)    │◀────────│  Pool + Managed  │         │               │
└─────────────┘         │  Login + Lambda  │         └───────────────┘
      │                 └──────────────────┘                 ▲
      │                          │                            │
      │   Pre Token Generation Lambda calls Superblocks public token
      │   API and adds ID token claim: superblocks_token
      └────────────────────────────────────────────────────────┘
```

**Flow**

1. User signs in via the Cognito Managed Login screen (Authorization Code
   + PKCE, refresh tokens enabled on the SPA app client).
2. During the code-exchange, a Pre Token Generation Lambda trigger
   calls Superblocks `POST /api/v1/public/token` with your **Embed access
   token** and user profile, then adds `superblocks_token` to the ID token.
3. The React app reads `superblocks_token` from ID-token claims (via
   `fetchAuthSession()` from `aws-amplify/auth`) and passes it to
   `SuperblocksEmbed`.

## Prerequisites

- **Node.js** 20+ and **npm** 10+
- **AWS account** with permission to create User Pools, Lambdas, and IAM
  roles
- **AWS CLI** v2 configured (`aws configure` or `aws configure sso`):
  [Install the AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- **Superblocks** org with embed enabled and an **Embed** access token
  ([Create an Embed access token](https://docs.superblocks.com/admin/org-administration/auth/access-tokens))

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/superblocks-samples/superblocks-cognito-embedded-app.git
cd superblocks-cognito-embedded-app
cd app && npm install && cd ..
```

### 2. Create the Cognito User Pool, Managed Login domain, and SPA app client

Pick the AWS region your Cognito User Pool should live in, then run:

```bash
# User pool on the Essentials feature plan (required for Managed Login,
# the modern Cognito sign-in UI). Drop --user-pool-tier to default to LITE
# + classic Hosted UI.
aws cognito-idp create-user-pool \
  --pool-name "superblocks-embed-local" \
  --user-pool-tier ESSENTIALS \
  --auto-verified-attributes email \
  --username-attributes email
# Copy UserPool.Id from the JSON output, e.g. us-east-1_aBcDeFgHi
export USER_POOL_ID="us-east-1_aBcDeFgHi"

# Domain serving the Managed Login UI (--managed-login-version 2 = Managed
# Login; 1 = classic Hosted UI). Pick a unique prefix.
aws cognito-idp create-user-pool-domain \
  --user-pool-id "$USER_POOL_ID" \
  --managed-login-version 2 \
  --domain "superblocks-embed-local-$RANDOM"
# Domain becomes <prefix>.auth.<region>.amazoncognito.com

aws cognito-idp create-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-name "superblocks-embed-spa-local" \
  --no-generate-secret \
  --supported-identity-providers COGNITO \
  --callback-urls "http://localhost:3000/login/callback" \
  --logout-urls "http://localhost:3000/" \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid profile email \
  --allowed-o-auth-flows-user-pool-client \
  --explicit-auth-flows ALLOW_REFRESH_TOKEN_AUTH ALLOW_USER_SRP_AUTH \
  --prevent-user-existence-errors ENABLED
# Copy UserPoolClient.ClientId from the output, then export it:
export CLIENT_ID="<paste-client-id>"

# Required for Managed Login: each app client needs a branding doc to
# exist or the login URL returns "Login pages unavailable / 403". The
# --use-cognito-provided-values flag accepts the default theme; customize
# later via Cognito console → App client → Login pages → Branding designer.
aws cognito-idp create-managed-login-branding \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --use-cognito-provided-values
```

Note the **User Pool ID**, **App Client ID**, and the **Managed Login domain**.
More detail (including production hardening + how to fall back to the
classic Hosted UI on the Lite tier): [docs/setup-cognito-user-pool.md](docs/setup-cognito-user-pool.md).

### 3. Deploy the Pre Token Generation Lambda

Package [cognito/lambda/superblocks-pre-token.js](cognito/lambda/superblocks-pre-token.js)
(no third-party deps), create an execution role + the Lambda, allow
Cognito to invoke it, and wire it to the User Pool as a **Pre Token
Generation V2** trigger. Set `SUPERBLOCKS_TOKEN` to your Superblocks Embed
access token (and optionally `SUPERBLOCKS_REGION` to `eu`).

```bash
# These should already be set from step 2:
#   $USER_POOL_ID            (e.g. us-east-1_aBcDeFgHi)
# Plus your Superblocks Embed access token:
export SUPERBLOCKS_TOKEN="<your-superblocks-embed-token>"

# Resolve account / region for ARN building:
ACCOUNT_ID="$(aws sts get-caller-identity --query Account --output text)"
REGION="$(aws configure get region)"

# 1) Package the function (uses Node's built-in https — no deps):
( cd cognito/lambda && zip -j function.zip superblocks-pre-token.js )

# 2) Create an IAM execution role for the Lambda:
aws iam create-role \
  --role-name superblocks-pre-token-role \
  --assume-role-policy-document '{
    "Version":"2012-10-17",
    "Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]
  }'
aws iam attach-role-policy \
  --role-name superblocks-pre-token-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# 3) Create the Lambda (sleep covers IAM role propagation):
sleep 10
aws lambda create-function \
  --function-name superblocks-pre-token \
  --runtime nodejs20.x \
  --role "arn:aws:iam::$ACCOUNT_ID:role/superblocks-pre-token-role" \
  --handler superblocks-pre-token.handler \
  --zip-file fileb://cognito/lambda/function.zip \
  --environment "Variables={SUPERBLOCKS_TOKEN=$SUPERBLOCKS_TOKEN,SUPERBLOCKS_REGION=app}" \
  --timeout 10

# 4) Allow Cognito to invoke the Lambda for this specific user pool:
aws lambda add-permission \
  --function-name superblocks-pre-token \
  --statement-id cognito-invoke \
  --action lambda:InvokeFunction \
  --principal cognito-idp.amazonaws.com \
  --source-arn "arn:aws:cognito-idp:$REGION:$ACCOUNT_ID:userpool/$USER_POOL_ID"

# 5) Wire the trigger to the User Pool with Lambda event version V2:
LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:superblocks-pre-token"
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --lambda-config "PreTokenGenerationConfig={LambdaArn=$LAMBDA_ARN,LambdaVersion=V2_0}" \
  --auto-verified-attributes email
```

> `update-user-pool` overwrites the entire Lambda-config block — if you
> already have other triggers wired up, include them in the same call (run
> `aws cognito-idp describe-user-pool ... --query 'UserPool.LambdaConfig'`
> to see what's currently set).

To iterate on the Lambda after the initial deploy, use
[`update-lambda.sh`](update-lambda.sh) — it re-zips, pushes the code, and
refreshes env vars + timeout in one shot:

```bash
# Source your secrets first (same .env.lambda used by test-local.js):
set -a && source .env.lambda && set +a
./update-lambda.sh
```

Or, if you only want to push code (no env-var changes):

```bash
( cd cognito/lambda && zip -j function.zip superblocks-pre-token.js )
aws lambda update-function-code \
  --function-name superblocks-pre-token \
  --zip-file fileb://cognito/lambda/function.zip
```

More detail (including a Secrets Manager pattern for the prod
`SUPERBLOCKS_TOKEN`): [docs/cognito-pre-token-trigger.md](docs/cognito-pre-token-trigger.md).
The Superblocks tutorial is here: [use-auth-for-sso](https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso).

### 4. Configure the React app

Create React App loads variables whose names start with `REACT_APP_` from a
file named **`.env.local`** in the **`app/`** directory (not the repo
root). Restart the dev server after you change this file.

```bash
cp app/env.example app/.env.local
```

Edit **`app/.env.local`** and set the values below (no quotes around simple
values; no spaces around `=`).

| Variable | Where to get the value |
| -------- | ---------------------- |
| `REACT_APP_COGNITO_USER_POOL_ID` | `UserPool.Id` from `create-user-pool` (or AWS Console → Cognito → User Pools → your pool). |
| `REACT_APP_COGNITO_USER_POOL_CLIENT_ID` | `UserPoolClient.ClientId` from `create-user-pool-client` (or User Pools → your pool → App integration → App client list). |
| `REACT_APP_COGNITO_DOMAIN` | The full Managed Login (or classic Hosted UI) domain, e.g. `superblocks-embed-local-1234.auth.us-east-1.amazoncognito.com` (no `https://`). Look it up with `aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" --query 'UserPool.Domain'` (prefix only — append `.auth.<region>.amazoncognito.com`). |
| `REACT_APP_SUPERBLOCKS_APPLICATION_ID` | **Optional.** Superblocks Admin → **Applications** → open your app → copy its **application ID** (UUID) from the URL or app settings. The app you set here renders at `/` — typically a landing page you build in Superblocks (a list of apps, an integrations launcher, etc.). Leave unset to show a placeholder at `/`; either way, any Superblocks app in your org renders dynamically at `/apps/<applicationId>` using its UUID. |
| `REACT_APP_SUPERBLOCKS_URL` | Your Superblocks instance **origin only**: `https://app.superblocks.com` (US) or `https://eu.superblocks.com` (EU), or your org's custom host. Do not include a path or trailing slash. |

Example (replace with your real values):

```env
REACT_APP_COGNITO_USER_POOL_ID=us-east-1_aBcDeFgHi
REACT_APP_COGNITO_USER_POOL_CLIENT_ID=1abc23defghi45jkl67mnopq89
REACT_APP_COGNITO_DOMAIN=superblocks-embed-local-1234.auth.us-east-1.amazoncognito.com
REACT_APP_SUPERBLOCKS_APPLICATION_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
REACT_APP_SUPERBLOCKS_URL=https://app.superblocks.com
```

### 5. Run locally

Run this from the **repository root** (the folder that contains the root
`package.json`, e.g. `superblocks-cognito-embedded-app`), not from inside
`app/`:

```bash
npm start
```

That runs `react-scripts start` in **`app/`** via the root script. You must
finish **step 1** first so dependencies exist under **`app/node_modules`**
(including `react-scripts`). If you skipped install or it failed, run:

```bash
cd app && npm install && cd ..
```

Then try `npm start` again from the repo root.

**Alternative:** from **`app/`** you can run `npm run dev` (same dev
server; uses the `dev` script in `app/package.json`).

Open [http://localhost:3000](http://localhost:3000). You should be
redirected to the Cognito Managed Login screen, then return to the app
with the embed loaded.

## Production

Repeat the Quick start in a **separate, prod-only environment** — don't
reuse the User Pool, Lambda, or env vars you set up for local dev. The
same commands apply, with these substitutions:

- **Dedicated AWS account & Cognito User Pool.** Create a new User Pool
  (and ideally a separate AWS account, e.g. `mycompany-dev` /
  `mycompany-prod`) instead of adding prod URLs to the local app client.
  Mixing environments widens the redirect-URI attack surface. Use prod
  values in the step 2 / step 3 CLI commands:
  - `--callback-urls "https://app.example.com/login/callback"`
  - `--logout-urls "https://app.example.com/"`
  - A prod-specific pool name and Managed Login domain prefix.
  - See [docs/setup-cognito-user-pool.md → Production setup](docs/setup-cognito-user-pool.md#production-setup)
    for the full command list.
- **Pre Token Generation Lambda in the prod account.** Re-run
  [docs/cognito-pre-token-trigger.md](docs/cognito-pre-token-trigger.md)
  with a **production** Superblocks embed token in `SUPERBLOCKS_TOKEN`,
  sourced from AWS Secrets Manager (not committed to the repo).
- **Build & host the React app.** `cd app && npm run build` and host
  `app/build/` on S3, Netlify, Vercel, etc.
- **Set prod env vars on your host.** `REACT_APP_COGNITO_USER_POOL_ID`,
  `REACT_APP_COGNITO_USER_POOL_CLIENT_ID`, `REACT_APP_COGNITO_DOMAIN`,
  `REACT_APP_SUPERBLOCKS_APPLICATION_ID` (optional), and
  `REACT_APP_SUPERBLOCKS_URL` should all point at the prod values, never
  the local ones.

## Configuration reference

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `REACT_APP_COGNITO_USER_POOL_ID` | Yes | Cognito User Pool ID (e.g. `us-east-1_aBcDeFgHi`) |
| `REACT_APP_COGNITO_USER_POOL_CLIENT_ID` | Yes | SPA app client ID (no client secret) |
| `REACT_APP_COGNITO_DOMAIN` | Yes | Full Managed Login / Hosted UI domain (no `https://`) |
| `REACT_APP_COGNITO_REDIRECT_SIGN_IN` | No | Override the OAuth callback URL; default `${origin}/login/callback` |
| `REACT_APP_COGNITO_REDIRECT_SIGN_OUT` | No | Override the post sign-out URL; default `${origin}/` |
| `REACT_APP_SUPERBLOCKS_APPLICATION_ID` | No | Superblocks app embedded at `/`. Leave unset to show a placeholder at `/` reminding you to set it. |
| `REACT_APP_SUPERBLOCKS_URL` | Yes | Superblocks instance URL |
| `REACT_APP_SUPERBLOCKS_APP_VERSION` | No | `2.0` (code mode) or `1.0` (legacy); default `2.0` |

### Landing page

`/` renders the Superblocks application identified by
`REACT_APP_SUPERBLOCKS_APPLICATION_ID`. The intended pattern is to build
your landing page **in Superblocks** (a list of apps, an integrations
launcher, a dashboard, etc.) and embed it here. Other apps live at
`/apps/<applicationId>/` using their UUID.

If `REACT_APP_SUPERBLOCKS_APPLICATION_ID` is unset, `/` shows a
placeholder pointing at the env var to configure.

## Scripts

Run **`npm start`** and **`npm run build`** from the **repository root**.
Install dependencies from **`app/`** (see step 1).

| Command | Where | Description |
| ------- | ----- | ----------- |
| `npm install` | `app/` | Install React app dependencies (`react-scripts`, embed SDK, `aws-amplify`, etc.) |
| `npm start` | repo root | Start the dev server (port 3000) |
| `npm run build` | `app/` | Production build → `app/build/` |

## Troubleshooting

**`react-scripts: command not found`**  
Dependencies are not installed in **`app/`**. From the repo root run
`cd app && npm install`. Confirm **`app/node_modules/.bin/react-scripts`**
exists. If `npm install` in `app/` fails with **401** on
`@superblocksteam/embed-react`, fix registry authentication (see step 1),
then install again.

**`EACCES: permission denied … app/node_modules/.cache`** (or other
`EACCES` errors during `npm install` / `npm start`)  
`app/node_modules` was created with elevated permissions (e.g. an earlier
`sudo npm install`), so the dev server can't write its cache. Fix
ownership and reinstall:

```bash
sudo chown -R "$(id -un)":"$(id -gn)" app/node_modules
cd app && rm -rf node_modules/.cache && npm install
```

**`superblocks_token` missing on ID token**  
Confirm the Lambda is deployed, `SUPERBLOCKS_TOKEN` env var is set, the
Pre Token Generation trigger is wired with `LambdaVersion=V2_0`, and
Cognito has `lambda:InvokeFunction` permission on it. Check the Lambda's
CloudWatch logs (`/aws/lambda/superblocks-pre-token`) for the request to
Superblocks. Sign out and sign in again.

**Redirect URI mismatch**  
The callback URL on the Cognito app client must exactly match
`https://<your-host>/login/callback` (or `http://localhost:3000/login/callback`
for local dev). Update with:

```bash
aws cognito-idp update-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "<your-client-id>" \
  --callback-urls "http://localhost:3000/login/callback" \
  --logout-urls "http://localhost:3000/"
```

**"Login pages unavailable / Please contact an administrator" (HTTP 403)**  
You're on Managed Login but the app client doesn't have a branding doc yet.
Create one (defaults to the standard Cognito theme):

```bash
aws cognito-idp create-managed-login-branding \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "<your-client-id>" \
  --use-cognito-provided-values
```

## Resources

- [Superblocks: Login embed users with Auth0](https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso)
  (the SSO contract is identical for any IdP)
- [Embedded app authentication](https://docs.superblocks.com/hosting/embedded-apps/authentication)
- [Amazon Cognito Developer Guide](https://docs.aws.amazon.com/cognito/latest/developerguide/)
- [Cognito Managed Login](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-managed-login.html)
- [Cognito User Pool feature plans (Lite / Essentials / Plus)](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-sign-in-feature-plans.html)
- [Cognito Pre Token Generation Lambda trigger](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-pre-token-generation.html)
- [AWS Amplify Auth (v6) — OAuth (Hosted UI)](https://docs.amplify.aws/react/build-a-backend/auth/concepts/external-identity-providers/)

## License

Sample/demo application for reference (MIT).
