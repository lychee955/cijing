import {describe, expect, it} from "vitest";
import {retryAfterDelay} from "../../src/shared/retry-after";
import {retryAfter} from "../../src/main/ai/adapters";
import {RateLimiter} from "../../src/main/maimemo/rate-limiter";

describe("Retry-After parsing and caller policies", () => {
    const now = Date.parse("2026-10-05T00:00:00Z");
    it.each([
        ["60", 60_000],
        ["0", 0],
        ["-2", -2000],
        ["1.5", 1500],
        ["Mon, 05 Oct 2026 00:01:00 GMT", 60_000]
    ] as const)("parses %s without imposing a caller's minimum", (value, expected) => {
        expect(retryAfterDelay(value, now)).toBe(expected);
    });
    it.each([null, "", "invalid", "Infinity"])("returns no delay for %s", (value) => {
        expect(retryAfterDelay(value, now)).toBeUndefined();
    });
    it("retains integer-only parsing for dictionary and update callers", () => {
        expect(retryAfterDelay("60", now, true)).toBe(60_000);
        expect(retryAfterDelay("Mon, 05 Oct 2026 00:01:00 GMT", now, true)).toBe(60_000);
        expect(retryAfterDelay("1.5", now, true)).toBe(Date.parse("1.5") - now);
    });
    it("keeps AI's rounded minimum and Maimemo's fallback and minimum", () => {
        expect(retryAfter("1.5")).toBe(2);
        expect(retryAfter("0")).toBe(1);
        expect(retryAfter(null)).toBeUndefined();
        for (const [value, duration] of [
            [null, 10_000],
            ["invalid", 10_000],
            ["0", 1000],
            ["1.5", 1500]
        ] as const) {
            let clock = now;
            const limiter = new RateLimiter(() => clock);
            limiter.block(value);
            clock += duration - 1;
            expect(() => limiter.take()).toThrow();
            clock++;
            expect(() => limiter.take()).not.toThrow();
        }
    });
});
