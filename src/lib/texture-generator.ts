export type BuildingTextureType = 'Residential' | 'Commercial' | 'Institutional' | 'Mixed Use' | 'Industrial' | 'Hospitality';

/**
 * Generates a procedural window pattern texture for buildings.
 * Returns ImageData that can be added to Mapbox via map.addImage().
 */
export function generateBuildingTexture(type: BuildingTextureType, baseColor: string): ImageData | null {
    const canvas = document.createElement('canvas');
    const size = 128; // Texture size (should be power of 2 for better performance usually, but Mapbox handles it)
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    if (!ctx) return null;

    // Fill Background with the base color (tinted slightly lighter or darker for glass contrast)
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, size, size);

    // Configure Window Style based on Type
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // Slab/Frame color
    ctx.lineWidth = 2;

    // Common Grid Logic
    // We want to simulate floors and windows.
    // Since we map this texture to a wall, it will repeat.

    // Draw Windows based on type
    if (type === 'Residential') {
        // Residential: Vertical Mullions Only (Slabs provide horizontal lines)
        const cols = 4; // 4 windows per chunk
        const colW = size / cols;
        const pad = 2;

        ctx.fillStyle = 'rgba(200, 240, 255, 0.4)'; // Glass tint

        // Fill background with glass
        ctx.fillRect(0, 0, size, size);

        // Draw Vertical Mullions
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)'; // White mullion
        for (let c = 0; c <= cols; c++) {
            const x = c * colW;
            ctx.fillRect(x - 1, 0, 2, size); // 2px wide vertical line
        }

        // Optional: Add some random vertical variation for "balcony dividers"
        ctx.fillStyle = 'rgba(200, 200, 200, 0.3)';
        ctx.fillRect(size / 2 - 4, 0, 8, size); // Thicker center divider

    } else if (type === 'Commercial') {
        // Commercial: Sleek vertical glass strips
        ctx.fillStyle = 'rgba(200, 230, 255, 0.6)';
        ctx.fillRect(0, 0, size, size);

        const cols = 4;
        const colW = size / cols;

        ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)'; // Subtle vertical lines
        ctx.lineWidth = 1;

        // Vertical lines only
        for (let c = 0; c <= cols; c++) {
            ctx.beginPath();
            ctx.moveTo(c * colW, 0);
            ctx.lineTo(c * colW, size);
            ctx.stroke();
        }

    } else {
        // Institutional: Simple vertical grid
        ctx.fillStyle = 'rgba(220, 230, 240, 0.5)';
        ctx.fillRect(0, 0, size, size);

        const cols = 4;
        const colW = size / cols;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        for (let c = 0; c < cols; c++) {
            ctx.fillRect(c * colW, 0, 1, size);
        }
    }

    // Add a slight noise or gradient for realism? (Optional, skipping for perf)

    return ctx.getImageData(0, 0, size, size);
}
