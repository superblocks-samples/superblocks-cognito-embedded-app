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
import UserProfileSlideout, { UserProfile } from "./components/UserProfileSlideout";
import "./App.css";

interface AppError {
  title: string;
  message: string;
  details?: string;
  statusCode?: number;
  icon?: string;
  showRetry?: boolean;
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

const LoadingScreen = ({ message }: { message: string }) => (
  <div className="App">
    <div className="app-loading">
      <div className="app-spinner" />
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
  const [userProfile, setUserProfile] = useState<UserProfile>({});
  const [profileOpen, setProfileOpen] = useState(false);
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

  // "/" is owned by the landing-app embed (or the placeholder when no
  // landing app is configured), so only surface a "back" button when we're
  // inside an /apps/<id>/ route.
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
      // Cache the user profile from the same ID token so the toolbar avatar
      // and the slideout don't need a second fetchAuthSession() round-trip.
      const payload = idToken.payload as Record<string, unknown>;
      setUserProfile({
        name: typeof payload.name === "string" ? payload.name : undefined,
        email: typeof payload.email === "string" ? payload.email : undefined,
        emailVerified:
          payload.email_verified === true || payload.email_verified === "true",
        sub: typeof payload.sub === "string" ? payload.sub : undefined,
      });

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

  // Clear any in-flight error whenever the route changes. Without this, the
  // access-denied screen's "Back to your apps" button would change the URL
  // but the still-set `error` keeps <ErrorPage> mounted, so nothing visibly
  // happens.
  useEffect(() => {
    setError(null);
  }, [location.pathname]);

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

  // Errors win over loading/redirect screens: a failed OAuth code exchange
  // (e.g., stale PKCE verifier) leaves us "unauthenticated" with an error
  // set, and we'd otherwise show "Redirecting to login..." forever instead
  // of surfacing the actual problem.
  if (error) {
    return (
      <ErrorPage
        title={error.title}
        message={error.message}
        details={error.details}
        statusCode={error.statusCode}
        icon={error.icon}
        showRetry={error.showRetry !== false}
        onRetry={handleRetry}
        onLogout={handleLogout}
      />
    );
  }

  if (authState === "loading") {
    return <LoadingScreen message="Loading..." />;
  }

  if (authState === "unauthenticated") {
    return <LoadingScreen message="Redirecting to login..." />;
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
            <button
              type="button"
              className="app-toolbar-brand"
              onClick={() => navigate("/")}
              aria-label="Go to home"
            >
              <img
                src="https://cdn.brandfetch.io/idgF9FqCgW/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1667820887617"
                alt="Amplitude"
                className="app-toolbar-logo"
              />
            </button>
            {showBackToLanding && (
              <button onClick={() => navigate("/")} className="toolbar-button">
                ← Back to landing page
              </button>
            )}
          </div>
          <div className="app-toolbar-right">
            <button
              type="button"
              className="app-toolbar-avatar"
              onClick={() => setProfileOpen(true)}
              aria-label="Open profile"
              aria-haspopup="dialog"
              aria-expanded={profileOpen}
            >
              {avatarInitials(userProfile)}
            </button>
          </div>
        </div>
        <div className="app-content">{children}</div>
      </div>
      <UserProfileSlideout
        open={profileOpen}
        user={userProfile}
        onClose={() => setProfileOpen(false)}
        onSignOut={() => {
          setProfileOpen(false);
          handleLogout();
        }}
      />
    </SuperblocksAuthContext.Provider>
  );
};

/** Toolbar avatar — derive 2-letter initials from name, fall back to email. */
const avatarInitials = (user: UserProfile): string => {
  const source = (user.name || user.email || "").trim();
  if (!source) return "?";
  if (source.includes("@")) {
    const local = source.split("@")[0];
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export default App;
