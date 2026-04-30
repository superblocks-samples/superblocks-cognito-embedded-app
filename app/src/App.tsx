import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  createContext,
  useContext,
} from "react";
import {
  fetchAuthSession,
  signInWithRedirect,
  signOut as amplifySignOut,
} from "aws-amplify/auth";
import { Hub } from "aws-amplify/utils";
import { useLocation, useNavigate } from "react-router-dom";
import ErrorPage from "./components/ErrorPage";
import "./App.css";

interface AppError {
  title: string;
  message: string;
  details?: string;
  statusCode?: number;
}

interface SuperblocksAuthContextValue {
  token: string;
  signOut: () => void;
  reportAuthError: (error: AppError) => void;
}

const SuperblocksAuthContext = createContext<SuperblocksAuthContextValue | undefined>(undefined);

export const useSuperblocksAuth = (): SuperblocksAuthContextValue => {
  const ctx = useContext(SuperblocksAuthContext);
  if (!ctx) {
    throw new Error("useSuperblocksAuth must be used within <App>");
  }
  return ctx;
};

// Amplify's Hosted UI flow doesn't carry custom app state through the OAuth
// redirect the way Auth0's `appState` does, so stash the pre-login URL in
// session storage ourselves and restore it after `signedIn` fires.
const RETURN_TO_KEY = "superblocks.returnTo";

type AuthState = "loading" | "authenticated" | "unauthenticated";

const loadingContainerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  height: "100vh",
  flexDirection: "column",
  gap: "1rem",
};

const spinnerStyle: React.CSSProperties = {
  border: "4px solid #f3f3f3",
  borderTop: "4px solid #3498db",
  borderRadius: "50%",
  width: "40px",
  height: "40px",
  animation: "spin 1s linear infinite",
};

const toolbarButtonStyle: React.CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  fontFamily: "system-ui, sans-serif",
  background: "#fff",
  color: "#111",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  cursor: "pointer",
};

const LoadingScreen = ({ message }: { message: string }) => (
  <div className="App">
    <div style={loadingContainerStyle}>
      <div style={spinnerStyle} />
      <p>{message}</p>
    </div>
  </div>
);

const App = ({ children }: { children: React.ReactNode }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<AuthState>("loading");
  const [superblocksToken, setSuperblocksToken] = useState<string | undefined>();
  const [error, setError] = useState<AppError | null>(null);
  // signInWithRedirect navigates away from the page, but guard anyway so we
  // don't fire it twice if React re-runs the effect before navigation occurs.
  const redirectingRef = useRef(false);
  // Amplify v6 fires the `signedOut` Hub event *before* it redirects to
  // Cognito's /logout endpoint. Without this guard the auto-login effect
  // sees `unauthenticated` and races signOut() to call signInWithRedirect(),
  // which usually wins and bounces the user straight back to the Hosted UI
  // login screen with their Cognito session still alive.
  const signingOutRef = useRef(false);

  const handleLogout = useCallback(async () => {
    signingOutRef.current = true;
    try {
      await amplifySignOut();
    } catch (err) {
      signingOutRef.current = false;
      console.error("Sign-out failed:", err);
    }
  }, []);

  // The landing app owns "/" and any non-/apps path (via the catch-all route),
  // so only show the back button when we're inside a non-landing app's route.
  const showBackToLanding = location.pathname.startsWith("/apps/");

  const loadSuperblocksTokenFromIdToken = useCallback(async () => {
    setError(null);
    try {
      const session = await fetchAuthSession();
      const idToken = session.tokens?.idToken;
      if (!idToken) {
        setAuthState("unauthenticated");
        return;
      }
      const token = idToken.payload.superblocks_token as string | undefined;
      if (!token) {
        setAuthState("authenticated");
        setError({
          title: "Superblocks token missing",
          message:
            "Your ID token does not include superblocks_token. Add the Pre Token Generation Lambda trigger to your Cognito User Pool and ensure it sets this claim.",
          details:
            "See cognito/lambda/superblocks-pre-token.js and https://docs.superblocks.com/hosting/embedded-apps/how-tos/use-auth-for-sso",
        });
        return;
      }
      setSuperblocksToken(token);
      setAuthState("authenticated");
    } catch (err) {
      console.error("Failed to read Cognito session:", err);
      // No active session is the normal "not signed in yet" path.
      setAuthState("unauthenticated");
    }
  }, []);

  const handleRetry = () => {
    setError(null);
    loadSuperblocksTokenFromIdToken();
  };

  // Bootstrap: check current session and listen for Hub auth events so we
  // pick up the `signedIn` event after Amplify finishes the OAuth code
  // exchange on /login/callback.
  useEffect(() => {
    loadSuperblocksTokenFromIdToken();

    const unsubscribe = Hub.listen("auth", ({ payload }) => {
      switch (payload.event) {
        case "signedIn":
        case "tokenRefresh":
          loadSuperblocksTokenFromIdToken();
          break;
        case "signedOut":
          setSuperblocksToken(undefined);
          setAuthState("unauthenticated");
          break;
        case "signInWithRedirect_failure":
        case "tokenRefresh_failure":
          setError({
            title: "Authentication error",
            message: "Could not complete sign-in. Try signing out and signing in again.",
            details:
              "data" in payload && payload.data && "error" in payload.data
                ? String((payload.data as { error: unknown }).error)
                : undefined,
          });
          break;
        default:
          break;
      }
    });

    return unsubscribe;
  }, [loadSuperblocksTokenFromIdToken]);

  // After we land back on /login/callback and the session resolves, restore
  // the original URL the user was trying to reach before sign-in.
  useEffect(() => {
    if (authState !== "authenticated") return;
    if (location.pathname !== "/login/callback") return;
    const returnTo = sessionStorage.getItem(RETURN_TO_KEY) || "/";
    sessionStorage.removeItem(RETURN_TO_KEY);
    navigate(returnTo, { replace: true });
  }, [authState, location.pathname, navigate]);

  // If we're not signed in (and not currently in the middle of the OAuth
  // callback exchange) push the user to the Cognito Hosted UI.
  useEffect(() => {
    if (authState !== "unauthenticated") return;
    if (location.pathname === "/login/callback") return;
    if (redirectingRef.current) return;
    if (signingOutRef.current) return;
    redirectingRef.current = true;
    const returnTo = `${location.pathname}${location.search}`;
    sessionStorage.setItem(RETURN_TO_KEY, returnTo);
    signInWithRedirect().catch((err) => {
      redirectingRef.current = false;
      console.error("Failed to start Cognito sign-in:", err);
      setError({
        title: "Sign-in failed",
        message: "Could not redirect to Cognito. Check your Cognito configuration.",
        details: err instanceof Error ? err.message : String(err),
      });
    });
  }, [authState, location.pathname, location.search]);

  if (authState === "loading") {
    return <LoadingScreen message="Loading..." />;
  }

  if (authState === "unauthenticated") {
    return <LoadingScreen message="Redirecting to login..." />;
  }

  if (error) {
    return (
      <ErrorPage
        title={error.title}
        message={error.message}
        details={error.details}
        statusCode={error.statusCode}
        onRetry={handleRetry}
        onLogout={handleLogout}
      />
    );
  }

  if (!superblocksToken) {
    return <LoadingScreen message="Authenticating..." />;
  }

  return (
    <SuperblocksAuthContext.Provider
      value={{
        token: superblocksToken,
        signOut: handleLogout,
        reportAuthError: setError,
      }}
    >
      <div className="App app-shell">
        <div className="app-toolbar">
          <div className="app-toolbar-left">
            {showBackToLanding && (
              <button onClick={() => navigate("/")} style={toolbarButtonStyle}>
                ← Back to landing page
              </button>
            )}
          </div>
          <div className="app-toolbar-right">
            <button onClick={handleLogout} style={toolbarButtonStyle}>
              Sign out
            </button>
          </div>
        </div>
        <div className="app-content">{children}</div>
      </div>
    </SuperblocksAuthContext.Provider>
  );
};

export default App;
