import React from 'react';
import './ErrorPage.css';

interface ErrorPageProps {
  title?: string;
  message: string;
  details?: string;
  statusCode?: number;
  onRetry?: () => void;
  onLogout?: () => void;
  showRetry?: boolean;
  showLogout?: boolean;
}

const ErrorPage: React.FC<ErrorPageProps> = ({
  title = 'Something went wrong',
  message,
  details,
  statusCode,
  onRetry,
  onLogout,
  showRetry = true,
  showLogout = true,
}) => {
  return (
    <div className="error-page">
      <div className="error-container">
        <div className="error-icon">⚠️</div>
        
        {statusCode && (
          <div className="error-code">{statusCode}</div>
        )}
        
        <h1 className="error-title">{title}</h1>
        <p className="error-message">{message}</p>
        
        {details && (
          <details className="error-details">
            <summary>Technical Details:</summary>
            <div className="error-details-content">{details}</div>
          </details>
        )}
        
        <div className="error-actions">
          {showRetry && onRetry && (
            <button className="error-button error-button-primary" onClick={onRetry}>
              Retry
            </button>
          )}
          {showLogout && onLogout && (
            <button className="error-button error-button-secondary" onClick={onLogout}>
              Sign Out
            </button>
          )}
        </div>
        
        <div className="error-help">
          <p>If this problem persists, contact your administrator.</p>
        </div>
      </div>
    </div>
  );
};

export default ErrorPage;

