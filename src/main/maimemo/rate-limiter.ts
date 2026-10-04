import {ClientError} from "./errors";

// A conservative process-wide limiter; other clients still consume server quota.
export class RateLimiter {
    private timestamps: number[] = [];
    private blockedUntil = 0;
    constructor(private readonly now = Date.now) {}

    take(): void {
        const now = this.now();
        this.timestamps = this.timestamps.filter((t) => now - t < 18_000_000);
        if (
            now < this.blockedUntil ||
            [
                [10_000, 20],
                [60_000, 40],
                [18_000_000, 2000]
            ].some(([window, max]) => this.timestamps.filter((t) => now - t < window!).length >= max!)
        ) {
            throw new ClientError("RATE_LIMIT");
        }
        this.timestamps.push(now);
    }

    block(retryAfter: string | null): void {
        const seconds = Number(retryAfter);
        const delay =
            retryAfter && Number.isFinite(seconds)
                ? seconds * 1000
                : retryAfter
                  ? Date.parse(retryAfter) - this.now()
                  : 10_000;
        this.blockedUntil = Math.max(
            this.blockedUntil,
            this.now() + (Number.isFinite(delay) ? Math.max(1000, delay) : 10_000)
        );
    }
}
