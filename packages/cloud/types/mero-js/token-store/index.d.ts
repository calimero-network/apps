import type { TokenData } from '../mero-js.js';
export interface TokenStore {
    getTokens(): TokenData | null;
    setTokens(data: TokenData): void;
    clear(): void;
    /**
     * Run `fn` holding a lock that every process sharing this store respects.
     * MeroJs holds it around a token refresh, so two processes on one store never
     * spend the same single-use refresh token. Web Locks cover tabs of one
     * browser; a store shared across processes (a file read by several CLIs, say)
     * needs its own lock, and implements this. Takes precedence over Web Locks.
     */
    withLock?<T>(fn: () => Promise<T>): Promise<T>;
}
export declare class MemoryTokenStore implements TokenStore {
    private tokens;
    getTokens(): TokenData | null;
    setTokens(data: TokenData): void;
    clear(): void;
}
export declare class LocalStorageTokenStore implements TokenStore {
    private readonly key;
    constructor(key?: string);
    getTokens(): TokenData | null;
    setTokens(data: TokenData): void;
    clear(): void;
}
