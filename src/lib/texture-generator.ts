export type BuildingTextureType = 'Residential' | 'Commercial' | 'Retail' | 'Office' | 'Institutional' | 'Mixed Use' | 'Industrial' | 'Hospitality' | 'Public';

function hexToRgba(hex: string, alpha: number): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Generates a vertical mullion strip texture for buildings.
 * All types share the same approach (glass tint + white vertical lines)
 * to look consistent from all angles including top-down/roof view.
 * Columns and strip width vary per type for visual differentiation.
 */
export function generateBuildingTexture(type: BuildingTextureType, baseColor: string, opacity: number = 1.0, isSelected: boolean = false): ImageData | null {
    const canvas = document.createElement('canvas');
    const size = 128;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    let cols = 4;
    let mullionWidth = 2;
    let glassTintAlpha = 0.4;
    let centerDividerWidth = 0;

    switch (type) {
        case 'Residential':
            cols = 4; mullionWidth = 2; glassTintAlpha = 0.4; centerDividerWidth = 8;
            break;
        case 'Commercial':
            cols = 6; mullionWidth = 1; glassTintAlpha = 0.45; centerDividerWidth = 0;
            break;
        case 'Retail':
            cols = 3; mullionWidth = 4; glassTintAlpha = 0.50; centerDividerWidth = 0;
            break;
        case 'Office':
            cols = 8; mullionWidth = 1; glassTintAlpha = 0.45; centerDividerWidth = 2;
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

    const finalGlassAlpha = glassTintAlpha * opacity;
    const finalMullionAlpha = 0.55 * opacity;
    const finalCenterAlpha = 0.30 * opacity;

    if (baseColor.startsWith('#')) {
        ctx.fillStyle = hexToRgba(baseColor, opacity);
    } else {
        ctx.globalAlpha = opacity;
        ctx.fillStyle = baseColor;
    }
    
    ctx.fillRect(0, 0, size, size);
    
    ctx.globalAlpha = 1.0;

    ctx.fillStyle = `rgba(200, 240, 255, ${finalGlassAlpha})`;
    ctx.fillRect(0, 0, size, size);

    const colW = size / cols;
    ctx.fillStyle = `rgba(255, 255, 255, ${finalMullionAlpha})`;
    for (let c = 0; c <= cols; c++) {
        const x = Math.round(c * colW);
        ctx.fillRect(x - Math.floor(mullionWidth / 2), 0, mullionWidth, size);
    }

    if (centerDividerWidth > 0) {
        ctx.fillStyle = `rgba(200, 200, 200, ${finalCenterAlpha})`;
        ctx.fillRect(size / 2 - Math.floor(centerDividerWidth / 2), 0, centerDividerWidth, size);
    }
    if (isSelected) {
        ctx.strokeStyle = '#00fbff';
        ctx.lineWidth = 12;
        ctx.strokeRect(0, 0, size, size);
    }

    return ctx.getImageData(0, 0, size, size);
}
