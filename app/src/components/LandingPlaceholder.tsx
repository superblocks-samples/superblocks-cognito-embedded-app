import React from "react";
import "./LandingPlaceholder.css";

/**
 * Default page shown at "/" when REACT_APP_SUPERBLOCKS_APPLICATION_ID is not
 * set. The intended pattern is for the customer to build their landing page
 * inside Superblocks (e.g. a list of apps, dashboards, or an integrations
 * launcher) and embed it here by setting that env var.
 */
const LandingPlaceholder: React.FC = () => (
  <div className="landing-placeholder">
    <div className="landing-placeholder-card">
      <div className="landing-placeholder-icon" aria-hidden="true">
        <PlaceholderIcon />
      </div>
      <h1 className="landing-placeholder-title">
        Embed your Superblocks landing page here
      </h1>
      <p className="landing-placeholder-subtitle">
        Build a landing page inside Superblocks (e.g. a list of apps, an
        integrations launcher, a dashboard) and point this app at it. It'll
        render at <code>/</code>; other apps live at{" "}
        <code>/apps/&lt;applicationId&gt;</code>.
      </p>
      <div className="landing-placeholder-step">
        <span className="landing-placeholder-step-num">1</span>
        <div>
          Set <code>REACT_APP_SUPERBLOCKS_APPLICATION_ID</code> in{" "}
          <code>app/.env.local</code> to your Superblocks landing app's UUID.
        </div>
      </div>
      <div className="landing-placeholder-step">
        <span className="landing-placeholder-step-num">2</span>
        <div>Restart the dev server (CRA only re-reads env files at boot).</div>
      </div>
    </div>
  </div>
);

const PlaceholderIcon: React.FC = () => (
  <svg
    width="56"
    height="56"
    viewBox="0 0 56 56"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="lp-grad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="var(--color-primary)" />
        <stop offset="100%" stopColor="var(--color-accent-purple)" />
      </linearGradient>
    </defs>
    <rect
      x="6"
      y="10"
      width="44"
      height="36"
      rx="6"
      stroke="url(#lp-grad)"
      strokeWidth="2"
      strokeDasharray="4 4"
      fill="none"
    />
    <rect x="14" y="20" width="10" height="10" rx="2" fill="url(#lp-grad)" opacity="0.35" />
    <rect x="28" y="20" width="14" height="3" rx="1.5" fill="url(#lp-grad)" opacity="0.55" />
    <rect x="28" y="26" width="10" height="3" rx="1.5" fill="url(#lp-grad)" opacity="0.35" />
    <rect x="14" y="34" width="28" height="3" rx="1.5" fill="url(#lp-grad)" opacity="0.25" />
  </svg>
);

export default LandingPlaceholder;
