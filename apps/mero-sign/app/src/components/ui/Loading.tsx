import React from 'react';

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className = '',
}) => {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  return (
    <div className={`${sizeClasses[size]} ${className}`}>
      <div className="animate-spin rounded-full border-2 border-current border-t-transparent" />
    </div>
  );
};

interface LoadingShimmerProps {
  className?: string;
  children?: React.ReactNode;
}

export const LoadingShimmer: React.FC<LoadingShimmerProps> = ({
  className = '',
  children,
}) => {
  return (
    <div className={`shimmer bg-surface rounded ${className}`}>{children}</div>
  );
};

interface LoadingButtonProps {
  loading?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
}

export const LoadingButton: React.FC<LoadingButtonProps> = ({
  loading = false,
  children,
  onClick,
  className = '',
  disabled = false,
}) => {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`btn-hover-lift focus-ring relative ${className} ${
        loading ? 'cursor-not-allowed opacity-75' : ''
      }`}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <LoadingSpinner size="sm" className="text-current" />
        </div>
      )}
      <span className={loading ? 'opacity-0' : 'opacity-100'}>{children}</span>
    </button>
  );
};
