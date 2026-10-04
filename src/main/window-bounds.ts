import type {WindowBounds} from "../shared/models";

export function visibleBounds(saved: WindowBounds | undefined, workAreas: WindowBounds[]): WindowBounds {
    const primary = workAreas[0] ?? {x: 0, y: 0, width: 1280, height: 800};
    const desired = saved ?? {
        x: primary.x + (primary.width - 820) / 2,
        y: primary.y + (primary.height - 720) / 2,
        width: 820,
        height: 720
    };
    const area =
        workAreas.find(
            (area) =>
                desired.x >= area.x &&
                desired.y >= area.y &&
                desired.x < area.x + area.width &&
                desired.y < area.y + area.height
        ) ?? primary;
    const width = Math.min(Math.max(620, desired.width), area.width);
    const height = Math.min(Math.max(580, desired.height), area.height);
    return {
        x: Math.round(Math.min(Math.max(desired.x, area.x), area.x + area.width - width)),
        y: Math.round(Math.min(Math.max(desired.y, area.y), area.y + area.height - height)),
        width: Math.round(width),
        height: Math.round(height)
    };
}
