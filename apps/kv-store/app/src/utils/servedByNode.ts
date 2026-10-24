// A node serves an installed app from {52-char base32 app id}.{base_domain}/{version}/.
export const isNodeAppHost = (host: string): boolean => /^[a-z2-7]{52}\./.test(host);

export const SERVED_BY_NODE = isNodeAppHost(window.location.hostname);
