import {ClientError} from "./errors";
import {retryAfterDelay} from "../../shared/retry-after";

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
        const delay = retryAfterDelay(retryAfter, this.now());
        this.blockedUntil = Math.max(
            this.blockedUntil,
            this.now() + (delay === undefined ? 10_000 : Math.max(1000, delay))
        );
    }
}
