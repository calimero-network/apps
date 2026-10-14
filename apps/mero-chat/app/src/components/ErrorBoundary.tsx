import React, { Component, type ReactNode, type ErrorInfo } from "react";
import styled from "styled-components";
import { log } from "../utils/logger";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

const ErrorContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem;
  background-color: var(--glass-surface-solid);
  color: var(--glass-ink);
`;

const ErrorTitle = styled.h1`
  font-size: 24px;
  margin-bottom: 1rem;
  color: var(--glass-bad-ink);
`;

const ErrorMessage = styled.p`
  font-size: 16px;
  margin-bottom: 1.5rem;
  text-align: center;
  max-width: 600px;
  color: var(--glass-ink-2);
`;

const ErrorDetails = styled.pre`
  background-color: var(--glass-surface-solid);
  padding: 1rem;
  border-radius: 12px;
  max-width: 800px;
  overflow-x: auto;
  font-size: 12px;
  color: var(--glass-bad-ink);
  margin-bottom: 1.5rem;
`;

const RetryButton = styled.button`
  padding: 0.75rem 1.5rem;
  background-color: var(--glass-ink);
  color: var(--glass-on-ink);
  border: none;
  border-radius: 12px;
  font-size: 16px;
  cursor: pointer;
  transition: background-color 0.2s;

  &:hover {
    background-color: var(--glass-ink-2);
  }

  &:focus {
    outline: 2px solid var(--glass-accent);
    outline-offset: 2px;
  }
`;

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    // Log error to console and external service
    log.error("ErrorBoundary", "React error boundary caught an error", {
      error: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    // Call optional error callback
    this.props.onError?.(error, errorInfo);
  }

  handleReset = (): void => {
    this.setState({
      hasError: false,
      error: null,
    });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Default error UI
      return (
        <ErrorContainer role="alert" aria-live="assertive">
          <ErrorTitle>Something went wrong</ErrorTitle>
          <ErrorMessage>
            We're sorry for the inconvenience. An unexpected error has occurred.
            Please try refreshing the page.
          </ErrorMessage>
          {import.meta.env.DEV && this.state.error && (
            <ErrorDetails role="status" aria-label="Error details">
              {this.state.error.message}
              {"\n\n"}
              {this.state.error.stack}
            </ErrorDetails>
          )}
          <RetryButton
            onClick={this.handleReset}
            aria-label="Retry and recover from error"
          >
            Try Again
          </RetryButton>
        </ErrorContainer>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
