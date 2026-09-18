import { nativeImage } from 'electron'
import type { NativeImage } from 'electron'

// Code-native M glyph shared by the tray, title bar and taskbar icons:
// no external font or asset path dependency.
const size = 32
const bitmap = Buffer.alloc(size * size * 4)
for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
  const glyph = y >= 8 && y <= 24 && (x >= 7 && x <= 10 || x >= 22 && x <= 25 ||
    y <= 18 && Math.abs(y - (x <= 16 ? x + 1 : 33 - x)) <= 2)
  const offset = (y * size + x) * 4
  if (process.platform === 'darwin') {
    bitmap[offset + 3] = glyph ? 255 : 0
  } else {
    bitmap[offset] = glyph ? 236 : 67
    bitmap[offset + 1] = glyph ? 246 : 91
    bitmap[offset + 2] = glyph ? 239 : 52
    bitmap[offset + 3] = 255
  }
}

// The tray draws at 16pt logical; the title bar and taskbar want raw 32px.
export function trayIcon(): NativeImage {
  const image = nativeImage.createFromBitmap(bitmap, { width: size, height: size, scaleFactor: 2 })
  if (process.platform === 'darwin') image.setTemplateImage(true)
  return image
}

// Cosmetic only: a failed window icon must not abort startup (see tray-failure paths).
export function windowIcon(): NativeImage | undefined {
  try { return nativeImage.createFromBitmap(bitmap, { width: size, height: size }) }
  catch { return undefined }
}
