export interface RetryOptions {
    attempts?: number;
}
export declare function withRetry<T>(fn: (attempt: number) => Promise<T>, options?: RetryOptions): Promise<T>;
export declare function createRetryableMethod<T extends unknown[], R>(method: (...args: T) => Promise<R>, retryOptions?: RetryOptions): (...args: T) => Promise<R>;
