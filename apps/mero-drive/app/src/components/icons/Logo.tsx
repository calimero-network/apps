import React from 'react';

interface LogoProps {
  className?: string;
  size?: number;
}

export const Logo: React.FC<LogoProps> = ({ className = '', size = 32 }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Document shape with lock integration */}
      <rect
        x="6"
        y="4"
        width="20"
        height="24"
        rx="3"
        className="fill-primary"
      />
      {/* Lock body */}
      <rect
        x="12"
        y="13"
        width="8"
        height="7"
        rx="1.5"
        className="fill-primary-foreground"
      />
      {/* Lock shackle */}
      <path
        d="M13.5 13V11C13.5 9.61929 14.6193 8.5 16 8.5C17.3807 8.5 18.5 9.61929 18.5 11V13"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
      {/* Keyhole */}
      <circle
        cx="16"
        cy="16"
        r="1"
        className="fill-primary"
      />
      {/* Document lines */}
      <rect
        x="9"
        y="22"
        width="14"
        height="1.5"
        rx="0.75"
        className="fill-primary-foreground/60"
      />
      <rect
        x="9"
        y="25"
        width="10"
        height="1.5"
        rx="0.75"
        className="fill-primary-foreground/40"
      />
    </svg>
  );
};

export const LogoWithText: React.FC<LogoProps & { textClassName?: string }> = ({ 
  className = '', 
  size = 32,
  textClassName = ''
}) => {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Logo size={size} />
      <span className={`font-semibold text-xl tracking-tight ${textClassName}`}>
        Mero Drive
      </span>
    </div>
  );
};
