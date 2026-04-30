import React, { useCallback } from "react";
import { useParams, useLocation, useNavigate, Navigate } from "react-router-dom";
import { SuperblocksEmbed } from "@superblocksteam/embed-react";
import { useSuperblocksAuth } from "../App";

// embed-react v2 only re-exports `SuperblocksEmbed` from its package root, so
// mirror the relevant event shapes locally to match the v2 callback signatures.
type NavigationEvent = {
  url: string;
  href: string;
  appId?: string;
  pathname?: string;
  search?: string;
  queryParams?: Record<string, string>;
};
type AuthErrorEvent = { error: string };

const landingAppId = process.env.REACT_APP_SUPERBLOCKS_APPLICATION_ID;

// SuperblocksEmbed's iframe echoes these SDK-internal params back through
// onNavigation's `search` field; they're meaningless to the host and would
// just clutter the URL bar.
const EMBED_INTERNAL_PARAMS = ["embed_id", "embed_mode"];

const stripEmbedParams = (search: string): string => {
  if (!search) return "";
  const trimmed = search.startsWith("?") ? search.slice(1) : search;
  if (!trimmed) return "";
  const params = new URLSearchParams(trimmed);
  for (const key of EMBED_INTERNAL_PARAMS) {
    params.delete(key);
  }
  const result = params.toString();
  return result ? `?${result}` : "";
};

// Canonical host URL for an app. The landing app owns the root namespace,
// so it lives at "/<sub>"; every other app lives at "/apps/<id>/<sub>".
const buildAppPath = (targetAppId: string, pathname: string, search: string) => {
  const cleanPath = pathname.replace(/^\/+/, "");
  const cleanSearch = stripEmbedParams(search);
  if (targetAppId === landingAppId) {
    return `/${cleanPath}${cleanSearch}`;
  }
  return `/apps/${targetAppId}${cleanPath ? `/${cleanPath}` : ""}${cleanSearch}`;
};

const EmbeddedApp = () => {
  const params = useParams();
  const splat = params["*"] ?? "";
  // When rendered at /apps/:appId/* the id comes from the URL; when rendered
  // at the catch-all route ("*") there is no :appId, so we fall back to the
  // configured landing app id.
  const appId = params.appId ?? landingAppId ?? "";
  const location = useLocation();
  const navigate = useNavigate();
  const { token, signOut, reportAuthError } = useSuperblocksAuth();

  const superblocksUrl = process.env.REACT_APP_SUPERBLOCKS_URL;
  const superblocksAppVersion = process.env.REACT_APP_SUPERBLOCKS_APP_VERSION || "2.0";

  const subPath = splat ? `/${splat}` : "";
  const basePath =
    superblocksAppVersion === "2.0" ? "/code-mode/embed/applications" : "/embed/applications";
  const src = `${superblocksUrl}${basePath}/${appId}${subPath}${location.search}`;

  const navigateToApp = useCallback(
    (targetAppId: string, pathname: string = "", search: string = "") => {
      const newPath = buildAppPath(targetAppId, pathname, search);

      if (`${window.location.pathname}${window.location.search}` === newPath) {
        return;
      }

      if (targetAppId === appId) {
        // In-app virtual nav: only sync the URL bar so the iframe doesn't reload.
        // React Router's location stays put, which keeps `src` stable.
        window.history.pushState({ path: newPath }, "", newPath);
      } else {
        // Cross-app nav: route through React Router so `:appId` updates and
        // `key={appId}` on SuperblocksEmbed remounts the iframe with the new app.
        navigate(newPath, { replace: false });
      }
    },
    [appId, navigate],
  );

  const handleNavigation = (event: NavigationEvent) => {
    const targetAppId = event.appId ?? appId;
    navigateToApp(targetAppId, event.pathname ?? "", event.search ?? "");
  };

  const handleAuthError = (event: AuthErrorEvent) => {
    console.error("Superblocks authentication error:", event);
    reportAuthError({
      title: "Session Expired",
      message: "Your Superblocks session has expired or encountered an authentication error.",
      details: event?.error,
    });
  };

  const handleEvents = (eventName: string, payload: Record<string, unknown>) => {
    switch (eventName) {
      case "logout":
        signOut();
        break;
      case "navigateToApp": {
        const targetAppId = (payload?.appId ?? payload?.applicationId) as string | undefined;
        if (!targetAppId) {
          console.warn("navigateToApp event missing appId/applicationId", payload);
          return;
        }
        // Accept either { path: "/foo?a=1" } or { pathname, search } in the payload.
        const path = payload?.path as string | undefined;
        if (path !== undefined) {
          const queryIdx = path.indexOf("?");
          const pathname = queryIdx >= 0 ? path.slice(0, queryIdx) : path;
          const search = queryIdx >= 0 ? path.slice(queryIdx) : "";
          navigateToApp(targetAppId, pathname, search);
        } else {
          navigateToApp(
            targetAppId,
            (payload?.pathname as string | undefined) ?? "",
            (payload?.search as string | undefined) ?? "",
          );
        }
        break;
      }
      default:
        console.log(`Unknown event ${eventName}`, payload);
    }
  };

  // Anyone landing on /apps/<landingAppId>/* gets redirected to the canonical URL "/<splat>"
  // so the landing app only ever lives at one URL.
  if (landingAppId && params.appId === landingAppId) {
    return <Navigate to={`/${splat}${location.search}`} replace />;
  }

  if (!appId) {
    return null;
  }

  return (
    <SuperblocksEmbed
      key={appId}
      src={src}
      token={token}
      onNavigation={handleNavigation}
      onAuthError={handleAuthError}
      onEvent={handleEvents}
    />
  );
};

export default EmbeddedApp;
