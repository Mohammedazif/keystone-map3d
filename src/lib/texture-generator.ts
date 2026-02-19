export type BuildingTextureType = 'Residential' | 'Commercial' | 'Institutional' | 'Mixed Use' | 'Industrial' | 'Hospitality' | 'Public';

/**
 * Generates a vertical mullion strip texture for buildings.
 * All types share the same approach (glass tint + white vertical lines)
 * to look consistent from all angles including top-down/roof view.
 * Columns and strip width vary per type for visual differentiation.
 */
export function generateBuildingTexture(type: BuildingTextureType, baseColor: string): ImageData | null {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // Config per type: [columns, mullionWidth, glassTintAlpha, centerDivider]
    let cols = 4;
    let mullionWidth = 2;
    let glassTintAlpha = 0.4;
    let centerDividerWidth = 0; // 0 = no center divider

    switch (type) {
        case 'Residential':
            cols = 4; mullionWidth = 2; glassTintAlpha = 0.4; centerDividerWidth = 8;
            break;
        case 'Commercial':
            cols = 6; mullionWidth = 1; glassTintAlpha = 0.45; centerDividerWidth = 0;
            break;
        case 'Hospitality':
            cols = 3; mullionWidth = 3; glassTintAlpha = 0.38; centerDividerWidth = 6;
            break;
        case 'Institutional':
        case 'Public':
            cols = 4; mullionWidth = 2; glassTintAlpha = 0.35; centerDividerWidth = 0;
            break;
        case 'Industrial':
            cols = 3; mullionWidth = 4; glassTintAlpha = 0.30; centerDividerWidth = 0;
            break;
        case 'Mixed Use':
            cols = 5; mullionWidth = 2; glassTintAlpha = 0.40; centerDividerWidth = 5;
            break;
        default:
            cols = 4; mullionWidth = 2; glassTintAlpha = 0.40; centerDividerWidth = 0;
    }

    // Base building color
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);

    // Glass tint overlay
    ctx.fillStyle = `rgba(200, 240, 255, ${glassTintAlpha})`;
    ctx.fillRect(0, 0, size, size);

    // Vertical mullion lines
    const colW = size / cols;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
    for (let c = 0; c <= cols; c++) {
        const x = Math.round(c * colW);
        ctx.fillRect(x - Math.floor(mullionWidth / 2), 0, mullionWidth, size);
    }

    // Optional center accent divider (thicker, slightly different opacity)
    if (centerDividerWidth > 0) {
        ctx.fillStyle = 'rgba(200, 200, 200, 0.30)';
        ctx.fillRect(size / 2 - Math.floor(centerDividerWidth / 2), 0, centerDividerWidth, size);
    }

    return ctx.getImageData(0, 0, size, size);
}
