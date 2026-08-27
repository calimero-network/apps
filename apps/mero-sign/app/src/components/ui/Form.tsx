import React, { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle } from 'lucide-react';

interface FormInputProps {
  type?: 'text' | 'email' | 'password';
  placeholder?: string;
  value?: string;
  onChange?: (value: string) => void;
  onBlur?: () => void;
  error?: string;
  success?: boolean;
  label?: string;
  required?: boolean;
  className?: string;
}

export const FormInput: React.FC<FormInputProps> = ({
  type = 'text',
  placeholder,
  value = '',
  onChange,
  onBlur,
  error,
  success = false,
  label,
  required = false,
  className = '',
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const [shouldShake, setShouldShake] = useState(false);

  useEffect(() => {
    if (error) {
      setShouldShake(true);
      const timer = setTimeout(() => setShouldShake(false), 500);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const handleFocus = () => setIsFocused(true);
  const handleBlur = () => {
    setIsFocused(false);
    onBlur?.();
  };

  const borderColor = error
    ? 'border-red-500'
    : success
      ? 'border-green-500'
      : isFocused
        ? 'border-primary'
        : 'border-current';

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="block text-sm font-medium text-current mb-2">
          {label} {required && <span className="text-red-500">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onFocus={handleFocus}
          onBlur={handleBlur}
          className={`
            w-full px-4 py-3 rounded-lg border-2 bg-card text-current 
            placeholder-secondary transition-all duration-200 focus-ring
            ${borderColor}
            ${shouldShake ? 'animate-shake' : ''}
            ${isFocused ? 'shadow-lg' : ''}
          `}
        />

        {/* Status icons */}
        {(error || success) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {error ? (
              <AlertCircle className="w-5 h-5 text-red-500" />
            ) : (
              <CheckCircle className="w-5 h-5 text-green-500" />
            )}
          </div>
        )}
      </div>

      {/* Error message */}
      {error && (
        <p className="mt-2 text-sm text-red-500 animate-fade-in-up">{error}</p>
      )}
    </div>
  );
};

interface FormButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  type?: 'button' | 'submit';
  variant?: 'primary' | 'secondary';
  loading?: boolean;
  disabled?: boolean;
  className?: string;
}

export const FormButton: React.FC<FormButtonProps> = ({
  children,
  onClick,
  type = 'button',
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '',
}) => {
  const baseClasses =
    'px-6 py-3 rounded-lg font-semibold transition-all duration-200 focus-ring btn-hover-lift';
  const variantClasses =
    variant === 'primary'
      ? 'bg-primary text-black hover:bg-green-500'
      : 'border-2 border-current text-current hover:bg-current hover:text-black';

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`
        ${baseClasses} ${variantClasses} ${className}
        ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''}
        ${loading ? 'relative' : ''}
      `}
    >
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
        </div>
      )}
      <span className={loading ? 'opacity-0' : ''}>{children}</span>
    </button>
  );
};
