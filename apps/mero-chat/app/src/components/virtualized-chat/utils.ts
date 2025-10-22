import DOMPurify from 'dompurify';

const customPolicy = {
  ALLOWED_TAGS: [
    'a',
    'strong',
    'b',
    'em',
    'i',
    'li',
    'ul',
    'ol',
    'p',
    'br',
    'span',
    'u',
    's',
    'strike',
    'pre',
    'code',
  ],
  ALLOWED_ATTR: [
    'href',
    'title',
    'className',
    'class',
    'style',
    'target',
    'rel',
    'data-list',
  ],
  FORBID_TAGS: ['script'],
};

const customPastePolicy = {
  ALLOWED_TAGS: [
    'strong',
    'b',
    'em',
    'i',
    'li',
    'ul',
    'ol',
    'p',
    'br',
    'u',
    's',
    'strike',
    'pre',
    'code',
  ],
  ALLOWED_ATTR: ['class', 'className', 'data-list'],
  FORBID_TAGS: ['script', 'a', 'img', 'video', 'span'],
};

export const sanitizeHtml = (html: string) =>
  DOMPurify.sanitize(html, customPolicy);

export const sanitizePasteHtml = (html: string) =>
  DOMPurify.sanitize(html, customPastePolicy);

export const elapsedTime = (timestampInSeconds: number) => {
  const now = new Date();
  const timestamp = new Date(timestampInSeconds * 1000);
  const diffInSeconds = (now.getTime() - timestamp.getTime()) / 1000;

  if (diffInSeconds < 60) {
    return 'now';
  } else if (diffInSeconds < 3600) {
    const minutes = Math.floor(diffInSeconds / 60);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  } else if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  } else if (diffInSeconds < 172800) {
    return 'yesterday';
  } else if (diffInSeconds < 604800) {
    const days = Math.floor(diffInSeconds / 86400);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  } else if (diffInSeconds < 2419200) {
    const weeks = Math.floor(diffInSeconds / 604800);
    return `${weeks} week${weeks === 1 ? '' : 's'} ago`;
  } else if (diffInSeconds < 29030400) {
    const months = Math.floor(diffInSeconds / 2592000);
    return `${months} month${months === 1 ? '' : 's'} ago`;
  } else if (diffInSeconds >= 29030400) {
    const years = Math.floor(diffInSeconds / 31556952);
    return `${years} year${years === 1 ? '' : 's'} ago`;
  } else {
    const day = timestamp.getDate().toString().padStart(2, '0');
    const month = (timestamp.getMonth() + 1).toString().padStart(2, '0');
    const year = timestamp.getFullYear();
    return `${day}/${month}/${year}`;
  }
};

export const formatTimeAgo = (timestampInSeconds: number, flag: boolean) => {
  const now = new Date();
  const timestamp = new Date(timestampInSeconds * 1000);
  if (
    timestamp.getDate() === now.getDate() &&
    timestamp.getMonth() === now.getMonth() &&
    timestamp.getFullYear() === now.getFullYear()
  ) {
    const hours = timestamp.getHours().toString().padStart(2, '0');
    const minutes = timestamp.getMinutes().toString().padStart(2, '0');
    return flag ? `today at ${hours}:${minutes}` : `${hours}:${minutes}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    timestamp.getDate() === yesterday.getDate() &&
    timestamp.getMonth() === yesterday.getMonth() &&
    timestamp.getFullYear() === yesterday.getFullYear()
  ) {
    return 'yesterday';
  }
  const day = timestamp.getDate().toString().padStart(2, '0');
  const month = (timestamp.getMonth() + 1).toString().padStart(2, '0');
  const year = timestamp.getFullYear();
  return `${day}/${month}/${year}`;
};
