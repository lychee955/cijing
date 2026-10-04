// Generate all logo assets from the shared Cijing book/reading-lines geometry.
const {deflateSync} = require("node:zlib");
const {writeFileSync, mkdirSync} = require("node:fs");
const {join} = require("node:path");
const brand = require("../src/shared/brand.json");
const esbuild = require("../node_modules/vite/node_modules/esbuild");
const source = esbuild.buildSync({
    entryPoints: [join(__dirname, "../src/shared/brand-icon.ts")],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false
}).outputFiles[0].text;
const iconModule = {exports: {}};
new Function("module", "exports", source)(iconModule, iconModule.exports);
const size = 512,
    pixels = iconModule.exports.renderBrandPixels(size);
const raw = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    raw.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
}

let table = new Uint32Array(256).map((_, n) => {
    for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
    return n;
});
const crc32 = (buffer) => {
    let crc = 0 ^ -1;
    for (const byte of buffer) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
};
function chunk(type, data) {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([header, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 8;
ihdr[9] = 6; // 8-bit RGBA
const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
]);
mkdirSync(join(__dirname, "../build"), {recursive: true});
writeFileSync(join(__dirname, "../build/icon.png"), png);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${brand.icon.radius}" fill="${brand.icon.background}"/>${brand.icon.strokes.map((stroke) => `<polyline points="${stroke.points.map((p) => p.join(",")).join(" ")}" fill="none" stroke="${stroke.accent ? brand.icon.accent : brand.icon.foreground}" stroke-width="${stroke.width}" stroke-linecap="round" stroke-linejoin="round"/>`).join("")}</svg>\n`;
writeFileSync(join(__dirname, "../build/logo.svg"), svg);
mkdirSync(join(__dirname, "../src/renderer/src/assets"), {recursive: true});
writeFileSync(join(__dirname, "../src/renderer/src/assets/logo.svg"), svg);
console.info(`build/icon.png written (${size}x${size}, ${png.length} bytes)`);
