import React, { useEffect, useMemo, useRef } from "react";
import "./UserProfileSlideout.css";

export interface UserProfile {
  name?: string;
  email?: string;
  emailVerified?: boolean;
  sub?: string;
}

interface UserProfileSlideoutProps {
  open: boolean;
  user: UserProfile;
  onClose: () => void;
  onSignOut: () => void;
}

const initialsFor = (name: string | undefined, fallback: string | undefined): string => {
  const source = (name || fallback || "").trim();
  if (!source) return "?";
  if (source.includes("@")) {
    // For "abc.user@mycompany.com" prefer the first letter of each
    // dot-separated chunk of the local part (ABC, A.U → AU).
    const local = source.split("@")[0];
    const parts = local.split(/[._-]+/).filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const UserProfileSlideout: React.FC<UserProfileSlideoutProps> = ({
  open,
  user,
  onClose,
  onSignOut,
}) => {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  // Close on Esc + auto-focus the close button when the slideout opens.
  useEffect(() => {
    if (!open) return;
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while the slideout is open so the page underneath
  // doesn't scroll if the user moves the wheel.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const initials = useMemo(
    () => initialsFor(user.name, user.email),
    [user.name, user.email],
  );

  return (
    <div
      className={`profile-slideout-root ${open ? "is-open" : ""}`}
      aria-hidden={!open}
    >
      <div
        className="profile-slideout-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="profile-slideout-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-slideout-title"
      >
        <header className="profile-slideout-header">
          <h2 id="profile-slideout-title">Profile</h2>
          <button
            ref={closeButtonRef}
            type="button"
            className="profile-slideout-close"
            aria-label="Close"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="profile-slideout-body">
          <div className="profile-slideout-identity">
            <div className="profile-slideout-avatar">{initials}</div>
            <div className="profile-slideout-identity-text">
              <div className="profile-slideout-name">
                {user.name || user.email || "Unknown user"}
              </div>
              {user.email && user.email !== user.name && (
                <div className="profile-slideout-email">
                  {user.email}
                  {user.emailVerified ? (
                    <span
                      className="profile-slideout-badge profile-slideout-badge-success"
                      title="Email verified"
                    >
                      Verified
                    </span>
                  ) : (
                    <span
                      className="profile-slideout-badge profile-slideout-badge-warning"
                      title="Email not verified"
                    >
                      Unverified
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {user.sub && (
            <section className="profile-slideout-section">
              <h3>Account</h3>
              <dl className="profile-slideout-meta">
                <dt>Cognito ID</dt>
                <dd className="profile-slideout-meta-mono">{user.sub}</dd>
              </dl>
            </section>
          )}
        </div>

        <footer className="profile-slideout-footer">
          <button
            type="button"
            className="profile-slideout-signout"
            onClick={onSignOut}
          >
            Sign out
          </button>
        </footer>
      </aside>
    </div>
  );
};

export default UserProfileSlideout;
