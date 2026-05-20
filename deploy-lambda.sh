# Required env vars before running this script:
#   USER_POOL_ID            Cognito User Pool ID
#   SUPERBLOCKS_EMBED_TOKEN       Superblocks Embed access token (mints session tokens)
# Optional env vars:
#   SUPERBLOCKS_ORG_ADMIN_TOKEN   Org Admin access token (SCIM group resolution)
#   SUPERBLOCKS_REGION      "app" (default) or "eu"

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

# 3) Create the Lambda (sleep covers IAM role propagation).
#    Env JSON is built via Node so token values containing =,",{} survive
#    shell quoting (embed/admin tokens commonly include `=` and `/`).
sleep 10
ENV_JSON=$(node -e '
  const env = {
    SUPERBLOCKS_EMBED_TOKEN: process.env.SUPERBLOCKS_EMBED_TOKEN,
    SUPERBLOCKS_REGION: process.env.SUPERBLOCKS_REGION || "app",
  };
  if (process.env.SUPERBLOCKS_ORG_ADMIN_TOKEN) {
    env.SUPERBLOCKS_ORG_ADMIN_TOKEN = process.env.SUPERBLOCKS_ORG_ADMIN_TOKEN;
  }
  process.stdout.write(JSON.stringify({ Variables: env }));
')
aws lambda create-function \
  --function-name superblocks-pre-token \
  --runtime nodejs20.x \
  --role "arn:aws:iam::$ACCOUNT_ID:role/superblocks-pre-token-role" \
  --handler superblocks-pre-token.handler \
  --zip-file fileb://cognito/lambda/function.zip \
  --environment "$ENV_JSON" \
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
