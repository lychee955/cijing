import brand from "./brand.json";

const rgb = (hex: string) => [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16));
const background = rgb(brand.icon.background),
    foreground = rgb(brand.icon.foreground),
    accent = rgb(brand.icon.accent);
const segments = brand.icon.strokes.flatMap((stroke) =>
    stroke.points.slice(1).map((point, i) => ({
        ax: stroke.points[i]![0]!,
        ay: stroke.points[i]![1]!,
        bx: point[0]!,
        by: point[1]!,
        radius: stroke.width / 2,
        color: stroke.accent ? accent : foreground
    }))
);

// Render the same rounded book/reading-lines geometry used by the SVG logo.
// Native icons use BGRA; PNG generation uses RGBA. macOS tray icons omit the background.
export function renderBrandPixels(size: number, template = false, bgra = false): Uint8Array {
    const pixels = new Uint8Array(size * size * 4);
    const radius = brand.icon.radius;
    for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
            const totals = [0, 0, 0],
                samples = 4;
            let opaque = 0;
            for (let sy = 0; sy < 2; sy++)
                for (let sx = 0; sx < 2; sx++) {
                    const px = ((x + (sx + 0.5) / 2) * 32) / size,
                        py = ((y + (sy + 0.5) / 2) * 32) / size;
                    const dx = Math.max(radius - px, px - (32 - radius), 0),
                        dy = Math.max(radius - py, py - (32 - radius), 0);
                    let color = !template && dx * dx + dy * dy <= radius * radius ? background : undefined;
                    for (const segment of segments) {
                        const vx = segment.bx - segment.ax,
                            vy = segment.by - segment.ay;
                        const t = Math.max(
                            0,
                            Math.min(1, ((px - segment.ax) * vx + (py - segment.ay) * vy) / (vx * vx + vy * vy))
                        );
                        const distance = (px - segment.ax - t * vx) ** 2 + (py - segment.ay - t * vy) ** 2;
                        if (distance <= segment.radius ** 2) color = template ? foreground : segment.color;
                    }
                    if (color) {
                        opaque++;
                        for (let c = 0; c < 3; c++) totals[c] = totals[c]! + color[c]!;
                    }
                }
            const offset = (y * size + x) * 4;
            for (let c = 0; c < 3; c++)
                pixels[offset + c] = opaque ? Math.round(totals[bgra ? 2 - c : c]! / opaque) : 0;
            pixels[offset + 3] = Math.round((opaque * 255) / samples);
        }
    return pixels;
}
