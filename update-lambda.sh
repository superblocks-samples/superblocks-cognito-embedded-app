#!/usr/bin/env bash
# Update the already-deployed superblocks-pre-token Lambda: re-zips the
# function code, pushes it, and refreshes env vars + timeout. Idempotent —
# safe to run repeatedly. Use deploy-lambda.sh for the first-time setup
# (creating the IAM role, function, and Cognito trigger).
#
# Usage:
#   set -a && source .env.lambda && set +a
#   ./update-lambda.sh
#
# Required env:
#   SUPERBLOCKS_TOKEN       Embed access token (mints Superblocks sessions)
# Optional env:
#   SUPERBLOCKS_REGION      "app" (default) or "eu"
#   FUNCTION_NAME           Lambda name (default: superblocks-pre-token)

set -euo pipefail

: "${SUPERBLOCKS_TOKEN:?SUPERBLOCKS_TOKEN is required. Did you forget: set -a && source .env.lambda && set +a ?}"

FUNCTION_NAME="${FUNCTION_NAME:-superblocks-pre-token}"

# 1) Re-package the function (uses Node's built-in https — no deps).
( cd cognito/lambda && zip -jq function.zip superblocks-pre-token.js )

# 2) Push code, then wait so the follow-up config update doesn't race.
echo "Pushing code to ${FUNCTION_NAME}..."
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://cognito/lambda/function.zip \
  --no-cli-pager > /dev/null
aws lambda wait function-updated --function-name "$FUNCTION_NAME"

# 3) Build env JSON via Node so token values containing =,",{} survive shell
#    quoting (the embed token commonly includes `=` and `/` which break the
#    AWS CLI's Variables={…} shorthand syntax).
ENV_JSON=$(node -e '
  const env = {
    SUPERBLOCKS_TOKEN: process.env.SUPERBLOCKS_TOKEN,
    SUPERBLOCKS_REGION: process.env.SUPERBLOCKS_REGION || "app",
  };
  process.stdout.write(JSON.stringify({ Variables: env }));
')

# 4) Push config (env vars + timeout). Timeout left at 10s to absorb cold-
#    start latency on the single Superblocks /public/token call.
echo "Pushing configuration to ${FUNCTION_NAME}..."
aws lambda update-function-configuration \
  --function-name "$FUNCTION_NAME" \
  --timeout 10 \
  --environment "$ENV_JSON" \
  --no-cli-pager > /dev/null
aws lambda wait function-updated --function-name "$FUNCTION_NAME"

echo "Updated $FUNCTION_NAME"
