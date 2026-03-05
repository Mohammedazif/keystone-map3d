import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon } from 'geojson';

/**
 * Generates a "Perimeter Ring" - a strip of building depth following the exact plot boundary
 */
function generatePerimeterRing(
    validArea: Feature<Polygon | MultiPolygon>,
    depth: number
): Feature<Polygon | MultiPolygon> | null {
    try {
        const innerPoly = turf.buffer(validArea, -depth / 1000, { units: 'kilometers' });

        if (!innerPoly) {
            return validArea;
        }

        const ring = turf.difference(validArea, innerPoly);
        return ring as Feature<Polygon | MultiPolygon>;
    } catch (e) {
        console.warn('Perimeter Ring generation failed:', e);
        return null;
    }
}

/**
 * Creates a "Mask" polygon to cut the Perimeter Ring into desired shapes (L, U, T, H)
 */
function createMaskPolygon(
    bbox: number[],
    typology: 'lshaped' | 'ushaped' | 'tshaped' | 'hshaped',
    orientation: number = 0
): Feature<Polygon> {
    const [minX, minY, maxX, maxY] = bbox;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    const padding = 100; // meters padding

    const northHalf = turf.polygon([[[minX - padding, midY], [maxX + padding, midY], [maxX + padding, maxY + padding], [minX - padding, maxY + padding], [minX - padding, midY]]]);
    const southHalf = turf.polygon([[[minX - padding, minY - padding], [maxX + padding, minY - padding], [maxX + padding, midY], [minX - padding, midY], [minX - padding, minY - padding]]]);
    const eastHalf = turf.polygon([[[midX, minY - padding], [maxX + padding, minY - padding], [maxX + padding, maxY + padding], [midX, maxY + padding], [midX, minY - padding]]]);
    const westHalf = turf.polygon([[[minX - padding, minY - padding], [midX, minY - padding], [midX, maxY + padding], [minX - padding, maxY + padding], [minX - padding, minY - padding]]]);

    let mask: Feature<Polygon | MultiPolygon> | null = null;

    const rot = (orientation % 360 + 360) % 360;

    if (typology === 'lshaped') {
        // L-Shape: Intersection of 2 adjacent halves? No, Union of 2 adjacent quadrants.
        if (rot >= 315 || rot < 45) { // 0 - SW
            mask = turf.union(southHalf, westHalf);
        } else if (rot >= 45 && rot < 135) { // 90 - SE
            mask = turf.union(southHalf, eastHalf);
        } else if (rot >= 135 && rot < 225) { // 180 - NE
            mask = turf.union(northHalf, eastHalf);
        } else { // 270 - NW
            mask = turf.union(northHalf, westHalf);
        }

    } else if (typology === 'ushaped') {
        // U-Shape: 3 sides. Union of 3 halves? 
        // Union(West, South, East) = Open North.

        if (rot >= 315 || rot < 45) { // 0 - Open North (South+West+East)
            mask = turf.union(southHalf, turf.union(westHalf, eastHalf));
        } else if (rot >= 45 && rot < 135) { // 90 - Open West (North+South+East)
            mask = turf.union(eastHalf, turf.union(northHalf, southHalf));
        } else if (rot >= 135 && rot < 225) { // 180 - Open South (North+West+East)
            mask = turf.union(northHalf, turf.union(westHalf, eastHalf));
        } else { // 270 - Open East (North+South+West)
            mask = turf.union(westHalf, turf.union(northHalf, southHalf));
        }
    } else if (typology === 'tshaped') {
        // T-Shape: Hard to do with strict halves.
        // Top Bar + Center Stem
        const w = (maxX - minX);
        const h = (maxY - minY);

        // 0 deg: T (Bar at Top, Stem Down)
        const topBar = turf.polygon([[[minX - padding, maxY - h * 0.4], [maxX + padding, maxY - h * 0.4], [maxX + padding, maxY + padding], [minX - padding, maxY + padding], [minX - padding, maxY - h * 0.4]]]); // Top 40%
        const stem = turf.polygon([[[midX - w * 0.2, minY - padding], [midX + w * 0.2, minY - padding], [midX + w * 0.2, maxY + padding], [midX - w * 0.2, maxY + padding], [midX - w * 0.2, minY - padding]]]); // Center 40% width

        const t0 = turf.union(topBar, stem);

        mask = turf.transformRotate(t0, orientation, { pivot: [midX, midY] });

    } else if (typology === 'hshaped') {
        const w = (maxX - minX);
        const h = (maxY - minY);

        // H: Left Bar + Right Bar + Center Bar
        const leftBar = turf.polygon([[[minX - padding, minY - padding], [minX + w * 0.35, minY - padding], [minX + w * 0.35, maxY + padding], [minX - padding, maxY + padding], [minX - padding, minY - padding]]]);
        const rightBar = turf.polygon([[[maxX - w * 0.35, minY - padding], [maxX + padding, minY - padding], [maxX + padding, maxY + padding], [maxX - w * 0.35, maxY + padding], [maxX - w * 0.35, minY - padding]]]);
        const centerBar = turf.polygon([[[minX - padding, midY - h * 0.2], [maxX + padding, midY - h * 0.2], [maxX + padding, midY + h * 0.2], [minX - padding, midY + h * 0.2], [minX - padding, midY - h * 0.2]]]);

        const h0 = turf.union(leftBar, turf.union(rightBar, centerBar));

        mask = turf.transformRotate(h0, orientation, { pivot: [midX, midY] });
    }

    return (mask || northHalf) as Feature<Polygon>;
}
