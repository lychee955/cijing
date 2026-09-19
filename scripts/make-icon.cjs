// Generates build/icon.png (512x512) from the same code-native M glyph as src/main/icon.ts,
// so the exe/installer icon matches the tray. Nearest-neighbor upscale keeps the glyph pixels.
const { deflateSync } = require('node:zlib')
const { writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')

const cell = 16, size = 32 * cell // 16x supersample of the 32px glyph grid
const radius = Math.round(size * 0.225) // rounded corners, brand-mark style
const background = [52, 91, 67] // #345B43, same green as the brand mark / tray
const glyph = [236, 246, 239] // #ECF6EF, same as the tray M

function glyphAt(x, y) { // identical predicate to src/main/icon.ts on the 32px grid
  const gx = Math.floor(x / cell), gy = Math.floor(y / cell)
  return gy >= 8 && gy <= 24 && (gx >= 7 && gx <= 10 || gx >= 22 && gx <= 25 ||
    gy <= 18 && Math.abs(gy - (gx <= 16 ? gx + 1 : 33 - gx)) <= 2)
}

function cornerAlpha(x, y) { // 1px anti-aliased rounded-corner mask, corner regions only
  const inLeft = x < radius, inRight = x >= size - radius
  const inTop = y < radius, inBottom = y >= size - radius
  if (!((inLeft || inRight) && (inTop || inBottom))) return 255
  const cx = inLeft ? radius : size - radius, cy = inTop ? radius : size - radius
  const d = Math.hypot(x - cx, y - cy)
  return Math.max(0, Math.min(255, Math.round((radius - d + 0.5) * 255)))
}

const raw = Buffer.alloc((size * 4 + 1) * size)
for (let y = 0; y < size; y++) {
  raw[y * (size * 4 + 1)] = 0 // filter: none
  for (let x = 0; x < size; x++) {
    const offset = y * (size * 4 + 1) + 1 + x * 4
    const inside = glyphAt(x, y)
    raw[offset] = inside ? glyph[0] : background[0]
    raw[offset + 1] = inside ? glyph[1] : background[1]
    raw[offset + 2] = inside ? glyph[2] : background[2]
    raw[offset + 3] = cornerAlpha(x, y)
  }
}

let table = new Uint32Array(256).map((_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xEDB88320 ^ n >>> 1 : n >>> 1; return n })
const crc32 = buffer => { let crc = 0 ^ -1; for (const byte of buffer) crc = table[(crc ^ byte) & 0xFF] ^ crc >>> 8; return (crc ^ -1) >>> 0 }
function chunk(type, data) {
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([header, body, crc])
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
])
mkdirSync(join(__dirname, '../build'), { recursive: true })
writeFileSync(join(__dirname, '../build/icon.png'), png)
console.info(`build/icon.png written (${size}x${size}, ${png.length} bytes)`)
