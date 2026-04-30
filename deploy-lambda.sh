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
  --timeout 5

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