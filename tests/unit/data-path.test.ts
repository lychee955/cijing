import {describe, expect, it} from "vitest";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {resolveDataPath} from "../../src/main/storage/data-path";

describe("Cijing data directory", () => {
    const appData = join(tmpdir(), "cijing-profile-test");

    it("uses the same directory for package and product default names", () => {
        const expected = join(appData, "cijing");
        expect(resolveDataPath(appData)).toBe(expected);
        expect(resolveDataPath(appData, expected)).toBe(expected);
        expect(resolveDataPath(appData, join(appData, "词境"))).toBe(expected);
    });

    it("preserves explicitly configured directories for isolated runs", () => {
        const explicit = join(appData, "isolated");
        expect(resolveDataPath(appData, explicit)).toBe(explicit);
    });
});
