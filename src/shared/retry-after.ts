export function retryAfterDelay(value: string | null, now: number, integerSecondsOnly = false): number | undefined {
    if (!value) return;
    const seconds = Number(value);
    const numeric = integerSecondsOnly ? /^\d+$/.test(value) : Number.isFinite(seconds);
    const delay = numeric ? seconds * 1000 : Date.parse(value) - now;
    return Number.isFinite(delay) ? delay : undefined;
}
