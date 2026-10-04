import {join, resolve} from "node:path";
import brand from "../../shared/brand.json";

export const DATABASE_FILENAME = "cijing.sqlite3";

// Normalize Electron's package/product defaults while preserving explicit overrides.
export function resolveDataPath(appData: string, current = join(appData, brand.packageName)): string {
    const defaults = [join(appData, brand.packageName), join(appData, brand.name)];
    return defaults.some((path) => resolve(path) === resolve(current)) ? join(appData, brand.packageName) : current;
}
