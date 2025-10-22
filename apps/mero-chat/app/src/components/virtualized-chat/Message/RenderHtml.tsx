// eslint-disable-next-line
import React, { memo, useMemo } from 'react';
import { sanitizeHtml } from '../utils';

export interface RenderHtmlProps {
  html: string;
}

const RenderHtml: React.FC<RenderHtmlProps> = ({ html }) => {
  // Memoize the sanitized HTML to avoid expensive re-sanitization
  const sanitizedHtml = useMemo(() => sanitizeHtml(html), [html]);
  
  return (
    <div
      className="msg-content"
      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
    />
  );
};

// Memoize the component to prevent re-rendering when html hasn't changed
export default memo(RenderHtml);
