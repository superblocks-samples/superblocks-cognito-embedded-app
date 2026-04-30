# Configure AWS Cognito for this sample

The React app expects an Amazon Cognito **User Pool** with **Managed Login**
enabled (Authorization Code flow with PKCE). Managed Login is Cognito's
modern sign-in UI (released Nov 2024) and requires the **Essentials** or
**Plus** feature plan. If you'd rather use the older classic Hosted UI on
the cheaper Lite plan, see [Falling back to the classic Hosted UI](#falling-back-to-the-classic-hosted-ui)
at the bottom — the SPA + Lambda code is identical for either UI.

This guide uses the [AWS CLI](https://docs.aws.amazon.com/cli/) where possible.

## Pools and environments (read this first)

For anything beyond a personal demo, **use a separate User Pool per
environment, and ideally a separate AWS account** (for example a `dev`
account and a `prod` account, or at minimum dev/prod pools in the same
account). Splitting pools gives you:

- **Pool isolation** — change attributes, MFA policy, federated identity
  providers, branding, and Lambda triggers without touching production users.
- **Per-app URLs** — keeping `localhost:3000` out of the prod app client's
  callback / sign-out URL list removes a real attack surface.
- **Separate secrets** — the Pre Token Generation Lambda's
  `SUPERBLOCKS_TOKEN` is usually a different embed token in prod (and should
  live in AWS Secrets Manager, scoped to that account).
- **Different env vars per build** — `REACT_APP_COGNITO_USER_POOL_ID`,
  `REACT_APP_COGNITO_USER_POOL_CLIENT_ID`, and `REACT_APP_COGNITO_DOMAIN`
  differ per environment.

This guide first sets up the **local development** pool and SPA app client.
Repeat the same steps in your prod account/region — see
[Production setup](#production-setup) at the bottom.

## Install and log in

Install the AWS CLI ([install instructions](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
and configure credentials for the account where you want the User Pool to
live:

```bash
aws configure
# or, with SSO:
aws configure sso
```

Verify you're hitting the right account/region:

```bash
aws sts get-caller-identity
echo "Region: $(aws configure get region)"
```

> Tip: every command below assumes the CLI's default region matches where
> you want the User Pool. To override per-command, append `--region <region>`.

## Create the User Pool (local development)

```bash
aws cognito-idp create-user-pool \
  --pool-name "superblocks-embed-local" \
  --user-pool-tier ESSENTIALS \
  --auto-verified-attributes email \
  --username-attributes email \
  --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":false,"RequireUppercase":true}}'
```

> `--user-pool-tier ESSENTIALS` is what unlocks Managed Login. Drop the
> flag to default to LITE, which is cheaper (and free up to 50K MAUs) but
> only supports the classic Hosted UI.

From the JSON output, copy `UserPool.Id` — that's your
`REACT_APP_COGNITO_USER_POOL_ID` (e.g. `us-east-1_aBcDeFgHi`). Export it for
the next commands:

```bash
export USER_POOL_ID="us-east-1_aBcDeFgHi"   # paste from output above
```

## Create the Managed Login domain

The domain is what users see during the redirect (and what
`REACT_APP_COGNITO_DOMAIN` points at). Pick a unique prefix:

```bash
aws cognito-idp create-user-pool-domain \
  --user-pool-id "$USER_POOL_ID" \
  --managed-login-version 2 \
  --domain "superblocks-embed-local-$RANDOM"
```

`--managed-login-version 2` selects the Managed Login UI; pass `1` (or
omit) for the classic Hosted UI. The full domain becomes
`<prefix>.auth.<region>.amazoncognito.com`. Look it up at any time with:

```bash
aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" \
  --query 'UserPool.{Domain:Domain,CustomDomain:CustomDomain}' --output table
```

## Create the SPA app client

Local development URLs:

- **Callback URL:** `http://localhost:3000/login/callback` (must match
  `REACT_APP_COGNITO_REDIRECT_SIGN_IN`, which defaults to
  `${origin}/login/callback`)
- **Sign-out URL:** `http://localhost:3000/`
- **OAuth flow:** Authorization code grant (PKCE)
- **Scopes:** `openid profile email`
- **No client secret** — public SPAs can't keep one safe.

```bash
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
```

From the output, copy `UserPoolClient.ClientId` — that's your
`REACT_APP_COGNITO_USER_POOL_CLIENT_ID`. Export it for the next command:

```bash
export CLIENT_ID="<paste-client-id>"
```

CLI references:
[`create-user-pool`](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-user-pool.html),
[`create-user-pool-client`](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-user-pool-client.html),
[`create-user-pool-domain`](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/create-user-pool-domain.html).

## Create a Managed Login branding for the app client

When the domain runs Managed Login (v2), **every app client must have a
branding doc** or the login URL returns "Login pages unavailable / 403".
Accept the default Cognito theme to start; customize later via
**Cognito console → User Pool → App integration → App client → Login
pages → Branding designer**.

```bash
aws cognito-idp create-managed-login-branding \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --use-cognito-provided-values
```

To replace the branding with a custom asset/style payload later, use
[`update-managed-login-branding`](https://docs.aws.amazon.com/cli/latest/reference/cognito-idp/update-managed-login-branding.html)
or just edit it in the Branding designer. To remove and recreate:

```bash
BRANDING_ID="$(aws cognito-idp describe-managed-login-branding-by-client \
  --user-pool-id "$USER_POOL_ID" --client-id "$CLIENT_ID" \
  --query 'ManagedLoginBranding.ManagedLoginBrandingId' --output text)"

aws cognito-idp delete-managed-login-branding \
  --user-pool-id "$USER_POOL_ID" \
  --managed-login-branding-id "$BRANDING_ID"
```

> Skip this whole section if you used `--managed-login-version 1` (or
> omitted it) on the domain — classic Hosted UI doesn't need per-client
> branding docs.

## Refresh tokens

Refresh-token flow is enabled above (`ALLOW_REFRESH_TOKEN_AUTH`) and the SDK
(`aws-amplify` v6) refreshes silently when the access/ID token is near
expiry. The default refresh-token lifetime is 30 days; tune it on the app
client if you need a different window.

## Create a test user

Skip the email-verification round-trip during local dev by creating a user
with a permanent password:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id "$USER_POOL_ID" \
  --username "you@example.com" \
  --user-attributes Name=email,Value=you@example.com Name=email_verified,Value=true \
  --message-action SUPPRESS

aws cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "you@example.com" \
  --password 'Sup3rblocks!' \
  --permanent
```

## Production setup

For production, **do not** simply add prod URLs to the local app client.
Create a dedicated User Pool (preferably in a separate AWS account) and a
separate app client with prod URLs only:

```bash
aws cognito-idp create-user-pool \
  --pool-name "superblocks-embed-prod" \
  --user-pool-tier ESSENTIALS \
  --auto-verified-attributes email \
  --username-attributes email
# … same as above …

aws cognito-idp create-user-pool-domain \
  --user-pool-id "<prod-pool-id>" \
  --managed-login-version 2 \
  --domain "<your-prod-prefix>"

aws cognito-idp create-user-pool-client \
  --user-pool-id "<prod-pool-id>" \
  --client-name "superblocks-embed-spa-prod" \
  --no-generate-secret \
  --callback-urls "https://app.example.com/login/callback" \
  --logout-urls "https://app.example.com/" \
  --allowed-o-auth-flows code \
  --allowed-o-auth-scopes openid profile email \
  --allowed-o-auth-flows-user-pool-client \
  --supported-identity-providers COGNITO

aws cognito-idp create-managed-login-branding \
  --user-pool-id "<prod-pool-id>" \
  --client-id "<prod-client-id>" \
  --use-cognito-provided-values
```

Then in your hosting provider (S3, Netlify, Vercel, etc.) set the **prod**
values of:

- `REACT_APP_COGNITO_USER_POOL_ID`
- `REACT_APP_COGNITO_USER_POOL_CLIENT_ID`
- `REACT_APP_COGNITO_DOMAIN`
- `REACT_APP_SUPERBLOCKS_APPLICATION_ID`
- `REACT_APP_SUPERBLOCKS_URL`

Repeat the **Pre Token Generation Lambda** setup
([cognito-pre-token-trigger.md](cognito-pre-token-trigger.md)) inside the
prod account, with a production Superblocks embed token (in Secrets
Manager).

> If you genuinely have a throwaway demo and want to keep one app client,
> you can add the prod URLs to the local app client's allowed lists.
> Migrate to a dedicated prod app client before any real users hit it.

## Falling back to the classic Hosted UI

Managed Login requires the **Essentials** or **Plus** feature plan. If
you'd rather stay on the cheaper **Lite** plan (free up to 50K MAUs and
no Lambda invocation limits for our trigger), use the classic Hosted UI
instead — it's the older, less customizable, but functionally equivalent
sign-in screen. Three deltas vs. the steps above:

1. **Drop `--user-pool-tier ESSENTIALS`** from `create-user-pool` (LITE
   is the default).
2. **Drop `--managed-login-version 2`** (or pass `1`) on
   `create-user-pool-domain`.
3. **Skip the `create-managed-login-branding` step** entirely — classic
   Hosted UI doesn't use per-client branding docs. (Customize via
   "Hosted UI customization" on the User Pool itself if you want a logo
   or CSS override.)

The SPA + Lambda code in this repo is identical for either UI; everything
runs through the same OAuth `/oauth2/authorize` and `/oauth2/token`
endpoints.

To **switch a pool from classic → Managed Login** later, upgrade the
feature plan, flip the domain to v2, and add a branding doc per client:

```bash
aws cognito-idp update-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --user-pool-tier ESSENTIALS \
  --auto-verified-attributes email

aws cognito-idp update-user-pool-domain \
  --user-pool-id "$USER_POOL_ID" \
  --domain "<your-existing-prefix>" \
  --managed-login-version 2

aws cognito-idp create-managed-login-branding \
  --user-pool-id "$USER_POOL_ID" \
  --client-id "$CLIENT_ID" \
  --use-cognito-provided-values
```

## Next step

Configure the Pre Token Generation Lambda trigger:
[cognito-pre-token-trigger.md](cognito-pre-token-trigger.md).
