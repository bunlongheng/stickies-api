// Pure color helpers shared by the notes UI. No React, no app state.

// The curated 12-color note/folder palette.
export const palette12: string[] = ["#FF3B30", "#FF6B4E", "#FF9500", "#FFCC00", "#D4E157", "#34C759", "#00C7BE", "#32ADE6", "#007AFF", "#5856D6", "#AF52DE", "#FF2D55"];
export const VIVID12 = palette12.slice(0, 12);

// Step through the palette at even intervals so fewer items get well-spaced colors.
export function taskColor(i: number, total: number): string {
    const step = Math.max(1, Math.floor(VIVID12.length / Math.min(total, VIVID12.length)));
    return VIVID12[(i * step) % VIVID12.length]!;
}

// Row/tile background tint. Folders get a lightened solid tint; notes get a
// gradient from gentle to strong across the list (index/total), rgba in light mode.
export function shadedRowBg(hex: string, index: number, total: number, isFolder = false, light = false): string {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    if (isFolder) {
        const mix = (c: number) => Math.round(c + (255 - c) * 0.35);
        return `rgba(${mix(r)},${mix(g)},${mix(b)},${light ? 0.35 : 0.19})`;
    }
    const ratio = total <= 1 ? 0 : index / (total - 1);
    if (light) {
        const minA = 0.25, maxA = 0.95;
        const alpha = minA + (maxA - minA) * ratio;
        return `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
    }
    const minOpacity = 0x22; // ~13% — gentle tint
    const maxOpacity = 0x66; // ~40% — strong tint
    const opacity = Math.round(minOpacity + (maxOpacity - minOpacity) * ratio);
    return `${hex}${opacity.toString(16).padStart(2, "0")}`;
}

// Perceived-luminance test (ITU-R BT.601) — true for light backgrounds.
export function isLightColor(hex: string): boolean {
    const h = hex.replace("#", "");
    if (h.length < 6) return false;
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 186;
}
