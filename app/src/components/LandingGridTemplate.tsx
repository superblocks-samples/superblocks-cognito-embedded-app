import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchAuthSession } from "aws-amplify/auth";
import "./LandingGrid.css";

export interface AppEntry {
  id: string;
  name: string;
  isDeployed?: boolean;
  lastDeployedAt?: string | null;
  creator?: { name?: string; email?: string };
}

interface UserContext {
  name?: string;
  email?: string;
}

const DEMO_APPS: AppEntry[] = [
  {
    id: "demo-revenue-dashboard",
    name: "Revenue Dashboard",
    isDeployed: true,
    lastDeployedAt: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    creator: { name: "Ada Lovelace", email: "ada@example.com" },
  },
  {
    id: "demo-customer-360",
    name: "Customer 360",
    isDeployed: true,
    lastDeployedAt: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(),
    creator: { name: "Grace Hopper", email: "grace@example.com" },
  },
  {
    id: "demo-internal-tools",
    name: "Internal Tools Hub",
    isDeployed: true,
    lastDeployedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3).toISOString(),
    creator: { name: "Linus Torvalds", email: "linus@example.com" },
  },
  {
    id: "demo-onboarding",
    name: "Employee Onboarding",
    isDeployed: false,
    lastDeployedAt: null,
    creator: { name: "Margaret Hamilton", email: "margaret@example.com" },
  },
];

// TODO: replace with a call to your backend.
async function loadAccessibleApps(): Promise<AppEntry[]> {
  return DEMO_APPS;
}

const readUserContext = async (): Promise<UserContext> => {
  const session = await fetchAuthSession();
  const payload = session.tokens?.idToken?.payload as
    | Record<string, unknown>
    | undefined;
  return {
    name: typeof payload?.name === "string" ? payload.name : undefined,
    email: typeof payload?.email === "string" ? payload.email : undefined,
  };
};

const formatRelative = (iso: string | null | undefined): string | undefined => {
  if (!iso) return undefined;
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return undefined;
  const diffMs = Date.now() - ts;
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const initialsFor = (name: string): string => {
  const trimmed = (name || "").trim();
  if (!trimmed) return "?";
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const firstNameOf = (name?: string, email?: string): string | undefined => {
  if (name) {
    const first = name.trim().split(/\s+/)[0];
    if (first) return first;
  }
  if (email) {
    const local = email.split("@")[0];
    if (local) {
      const seg = local.split(/[._-]+/)[0];
      if (seg) return seg.charAt(0).toUpperCase() + seg.slice(1);
    }
  }
  return undefined;
};

const greetingFor = (now: Date = new Date()): string => {
  const h = now.getHours();
  if (h >= 5 && h < 12) return "Good morning";
  if (h >= 12 && h < 18) return "Good afternoon";
  return "Good evening";
};

const APP_PALETTES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "#2E5BFF", to: "#7C5CFF" },
  { from: "#7C5CFF", to: "#EC4899" },
  { from: "#0EA5E9", to: "#2E5BFF" },
  { from: "#1FAE6F", to: "#0EA5E9" },
  { from: "#F59E0B", to: "#EC4899" },
  { from: "#EC4899", to: "#7C5CFF" },
];

const paletteFor = (key: string): { from: string; to: string } => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return APP_PALETTES[Math.abs(hash) % APP_PALETTES.length];
};

const SKELETON_COUNT = 6;

const LandingGridTemplate: React.FC = () => {
  const navigate = useNavigate();
  const [apps, setApps] = useState<AppEntry[] | undefined>(undefined);
  const [user, setUser] = useState<UserContext | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | undefined>(undefined);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    setApps(undefined);
    setLoadError(undefined);

    (async () => {
      try {
        const ctx = await readUserContext();
        if (!cancelled) setUser(ctx);
        const accessible = await loadAccessibleApps();
        if (!cancelled) setApps(accessible);
      } catch (err) {
        if (cancelled) return;
        console.error("Failed to load apps:", err);
        setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const handleOpen = useCallback(
    (appId: string) => navigate(`/apps/${appId}/`),
    [navigate],
  );

  const filteredApps = useMemo(() => {
    if (!apps) return [];
    const q = search.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.creator?.name?.toLowerCase().includes(q),
    );
  }, [apps, search]);

  const firstName = firstNameOf(user?.name, user?.email);
  const heroSubtitle = useMemo(() => {
    if (loadError) return "We hit a snag loading your workspace.";
    if (apps === undefined) return "Pulling together the apps you can open…";
    if (apps.length === 0) {
      return "No apps are shared with you yet — once one is, it'll show up here.";
    }
    const noun = apps.length === 1 ? "app" : "apps";
    return `${apps.length} ${noun} ready to open. Pick one to dive in.`;
  }, [apps, loadError]);

  const showSearch = apps !== undefined && apps.length > 1;

  return (
    <div className="landing-grid-page">
      <header className="landing-grid-hero">
        <div className="landing-grid-hero-text">
          <p className="landing-grid-eyebrow">Workspace</p>
          <h1>
            {greetingFor()}
            {firstName ? (
              <>
                ,{" "}
                <span className="landing-grid-hero-name">{firstName}</span>
              </>
            ) : null}
          </h1>
          <p className="landing-grid-hero-subtitle">{heroSubtitle}</p>
        </div>
        {showSearch ? (
          <label className="landing-grid-search">
            <SearchIcon />
            <input
              type="search"
              placeholder="Search by name or owner…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search apps"
            />
          </label>
        ) : null}
      </header>

      <Content
        apps={apps}
        filteredApps={filteredApps}
        loadError={loadError}
        search={search}
        onOpen={handleOpen}
        onRetry={() => setLoadAttempt((n) => n + 1)}
        onClearSearch={() => setSearch("")}
      />
    </div>
  );
};

interface ContentProps {
  apps: AppEntry[] | undefined;
  filteredApps: AppEntry[];
  loadError: string | undefined;
  search: string;
  onOpen: (appId: string) => void;
  onRetry: () => void;
  onClearSearch: () => void;
}

const Content: React.FC<ContentProps> = ({
  apps,
  filteredApps,
  loadError,
  search,
  onOpen,
  onRetry,
  onClearSearch,
}) => {
  if (loadError) {
    return (
      <div className="landing-grid-state">
        <div className="landing-grid-state-icon" aria-hidden="true">⚠️</div>
        <h2>Couldn't load your apps</h2>
        <p className="landing-grid-state-message">{loadError}</p>
        <button className="landing-grid-button" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  if (apps === undefined) {
    return <SkeletonGrid />;
  }

  if (apps.length === 0) {
    return (
      <div className="landing-grid-state">
        <div className="landing-grid-state-illustration" aria-hidden="true">
          <EmptyIllustration />
        </div>
        <h2>Nothing shared with you yet</h2>
        <p className="landing-grid-state-message">
          Ask an administrator to share an application with you and it'll appear
          here automatically.
        </p>
      </div>
    );
  }

  if (filteredApps.length === 0) {
    return (
      <div className="landing-grid-state">
        <div className="landing-grid-state-icon" aria-hidden="true">🔎</div>
        <h2>No apps match "{search}"</h2>
        <p className="landing-grid-state-message">
          Try a different keyword, or clear the search to see everything.
        </p>
        <button className="landing-grid-button" onClick={onClearSearch}>
          Clear search
        </button>
      </div>
    );
  }

  return (
    <ul className="landing-grid">
      {filteredApps.map((app, idx) => {
        const palette = paletteFor(app.id || app.name);
        const cardStyle = {
          ["--icon-from" as never]: palette.from,
          ["--icon-to" as never]: palette.to,
          ["--card-idx" as never]: idx,
        } as React.CSSProperties;
        const updated = formatRelative(app.lastDeployedAt);
        return (
          <li key={app.id} style={cardStyle}>
            <button
              type="button"
              className="landing-card"
              onClick={() => onOpen(app.id)}
            >
              <div className="landing-card-top">
                <div className="landing-card-icon" aria-hidden="true">
                  {initialsFor(app.name)}
                </div>
                <span
                  className={`landing-card-status ${
                    app.isDeployed
                      ? "landing-card-status-live"
                      : "landing-card-status-draft"
                  }`}
                  title={
                    app.isDeployed
                      ? "Deployed and accessible"
                      : "Not yet deployed"
                  }
                >
                  <span className="landing-card-status-dot" aria-hidden="true" />
                  {app.isDeployed ? "Live" : "Draft"}
                </span>
              </div>
              <div className="landing-card-body">
                <h3 className="landing-card-title" title={app.name}>
                  {app.name}
                </h3>
                {app.creator?.name && (
                  <div className="landing-card-creator">
                    <span
                      className="landing-card-creator-avatar"
                      aria-hidden="true"
                    >
                      {initialsFor(app.creator.name)}
                    </span>
                    <span
                      className="landing-card-creator-name"
                      title={app.creator.email}
                    >
                      {app.creator.name}
                    </span>
                  </div>
                )}
              </div>
              <div className="landing-card-footer">
                <span className="landing-card-updated">
                  {updated ? `Updated ${updated}` : "Not yet deployed"}
                </span>
                <span className="landing-card-arrow" aria-hidden="true">
                  →
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

const SkeletonGrid: React.FC = () => (
  <ul className="landing-grid landing-grid-skeleton-grid" aria-hidden="true">
    {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
      <li key={i} style={{ ["--card-idx" as never]: i } as React.CSSProperties}>
        <div className="landing-card landing-card-skeleton">
          <div className="landing-card-top">
            <div className="landing-skeleton landing-skeleton-icon" />
            <div className="landing-skeleton landing-skeleton-pill" />
          </div>
          <div className="landing-card-body">
            <div className="landing-skeleton landing-skeleton-line landing-skeleton-line-title" />
            <div className="landing-skeleton landing-skeleton-line landing-skeleton-line-meta" />
          </div>
          <div className="landing-card-footer">
            <div className="landing-skeleton landing-skeleton-line landing-skeleton-line-footer" />
          </div>
        </div>
      </li>
    ))}
  </ul>
);

const SearchIcon: React.FC = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const EmptyIllustration: React.FC = () => (
  <svg
    width="96"
    height="72"
    viewBox="0 0 96 72"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="empty-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#EAF0FF" />
        <stop offset="100%" stopColor="#F2EAFF" />
      </linearGradient>
    </defs>
    <rect x="6" y="14" width="36" height="44" rx="6" fill="url(#empty-grad)" />
    <rect x="30" y="6" width="36" height="44" rx="6" fill="url(#empty-grad)" opacity="0.85" />
    <rect x="54" y="20" width="36" height="44" rx="6" fill="url(#empty-grad)" opacity="0.7" />
    <circle cx="24" cy="28" r="4" fill="#2E5BFF" opacity="0.55" />
    <circle cx="48" cy="20" r="4" fill="#7C5CFF" opacity="0.55" />
    <circle cx="72" cy="34" r="4" fill="#EC4899" opacity="0.45" />
  </svg>
);

export default LandingGridTemplate;
