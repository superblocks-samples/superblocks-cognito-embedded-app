import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import App from "./App";
import EmbeddedApp from "./components/EmbeddedApp";

const landingAppId = process.env.REACT_APP_SUPERBLOCKS_APPLICATION_ID;

const userPoolId = process.env.REACT_APP_COGNITO_USER_POOL_ID;
const userPoolClientId = process.env.REACT_APP_COGNITO_USER_POOL_CLIENT_ID;
const cognitoDomain = process.env.REACT_APP_COGNITO_DOMAIN;
// Allow overriding the redirect URLs (for environments behind a proxy/CDN);
// otherwise derive them from the current origin so localhost & prod both work.
const redirectSignIn =
  process.env.REACT_APP_COGNITO_REDIRECT_SIGN_IN ||
  `${window.location.origin}/login/callback`;
const redirectSignOut =
  process.env.REACT_APP_COGNITO_REDIRECT_SIGN_OUT || `${window.location.origin}/`;

const cognitoConfigured = Boolean(userPoolId && userPoolClientId && cognitoDomain);

if (cognitoConfigured) {
  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId: userPoolId as string,
        userPoolClientId: userPoolClientId as string,
        loginWith: {
          oauth: {
            domain: cognitoDomain as string,
            scopes: ["openid", "profile", "email"],
            redirectSignIn: [redirectSignIn],
            redirectSignOut: [redirectSignOut],
            responseType: "code",
          },
        },
      },
    },
  });
}

const ConfigurationError = () => (
  <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
    <h1>Configuration error</h1>
    <p>
      Set <code>REACT_APP_COGNITO_USER_POOL_ID</code>,{" "}
      <code>REACT_APP_COGNITO_USER_POOL_CLIENT_ID</code>, and{" "}
      <code>REACT_APP_COGNITO_DOMAIN</code> in <code>app/.env.local</code> (see{" "}
      <code>app/env.example</code>).
    </p>
  </div>
);

const NoLandingAppMessage = () => (
  <div style={{ padding: "2rem", fontFamily: "system-ui, sans-serif" }}>
    <h1>No landing Superblocks app configured</h1>
    <p>
      Open any Superblocks app directly at <code>/apps/&lt;applicationId&gt;</code>, or set{" "}
      <code>REACT_APP_SUPERBLOCKS_APPLICATION_ID</code> in <code>app/.env.local</code> to choose
      the app rendered at <code>/</code> (see <code>app/env.example</code>).
    </p>
  </div>
);

const Root = () => {
  if (!cognitoConfigured) {
    return <ConfigurationError />;
  }
  return (
    <App>
      <Routes>
        <Route path="/login/callback" element={null} />
        <Route path="/apps/:appId/*" element={<EmbeddedApp />} />
        <Route path="*" element={landingAppId ? <EmbeddedApp /> : <NoLandingAppMessage />} />
      </Routes>
    </App>
  );
};

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <Router>
    <Root />
  </Router>
);
