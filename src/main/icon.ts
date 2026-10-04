import type {NativeImage} from "electron";
import {nativeImage} from "electron";
import {renderBrandPixels} from "../shared/brand-icon";

// Shared Cijing book mark; native icons do not depend on an external asset path.
const size = 32;
const bitmap = Buffer.from(renderBrandPixels(size, process.platform === "darwin", true));

// The tray draws at 16pt logical; the title bar and taskbar want raw 32px.
export function trayIcon(): NativeImage {
    const image = nativeImage.createFromBitmap(bitmap, {
        width: size,
        height: size,
        scaleFactor: 2
    });
    if (process.platform === "darwin") image.setTemplateImage(true);
    return image;
}

// Cosmetic only: a failed window icon must not abort startup (see tray-failure paths).
export function windowIcon(): NativeImage | undefined {
    try {
        return nativeImage.createFromBitmap(bitmap, {width: size, height: size});
    } catch {
        return undefined;
    }
}
