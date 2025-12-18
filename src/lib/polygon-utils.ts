
import * as turf from '@turf/turf';
import type { Feature, Polygon } from '@turf/turf';

/**
 * Splits a polygon into a number of smaller polygons, with gaps between them.
 * @param polygon The parent polygon to split.
 * @param count The number of chunks to create.
 * @returns An array of smaller polygon features.
 */
export function splitPolygon(polygon: Feature<Polygon>, count: number): Feature<Polygon>[] {
    if (count <= 1) return [polygon];

    const bbox = turf.bbox(polygon);
    const [minX, minY, maxX, maxY] = bbox;
    const width = maxX - minX;
    const height = maxY - minY;

    const chunks: Feature<Polygon>[] = [];
    const isHorizontalSplit = width > height;
    const step = isHorizontalSplit ? width / count : height / count;
    const gap = 2; // Gap in meters between buildings

    for (let i = 0; i < count; i++) {
        let chunkBbox: turf.BBox;
        if (isHorizontalSplit) {
            chunkBbox = [minX + i * step, minY, minX + (i + 1) * step, maxY];
        } else {
            chunkBbox = [minX, minY + i * step, maxX, minY + (i + 1) * step];
        }
        
        try {
            const chunkPolygon = turf.bboxPolygon(chunkBbox);
            const intersection = turf.intersect(chunkPolygon, polygon);

            if (intersection && intersection.geometry.type === 'Polygon') {
                // Shrink the resulting polygon to create gaps
                const buffered = turf.buffer(intersection, -gap, { units: 'meters' });
                if (buffered) {
                    chunks.push(buffered as Feature<Polygon>);
                } else {
                    // if buffering fails (e.g. polygon is too thin), use the original intersection
                    chunks.push(intersection as Feature<Polygon>);
                }

            } else if (intersection && intersection.geometry.type === 'MultiPolygon') {
                const largestPoly = intersection.geometry.coordinates
                    .map(coords => turf.polygon(coords))
                    .sort((a,b) => turf.area(b) - turf.area(a))[0];
                
                if (largestPoly) {
                    const buffered = turf.buffer(largestPoly, -gap, { units: 'meters' });
                     if (buffered) {
                        chunks.push(buffered as Feature<Polygon>);
                    } else {
                        chunks.push(largestPoly);
                    }
                }
            }
        } catch(e) {
            console.error("Error creating polygon chunk", e);
        }
    }

    if (chunks.length > 0) {
        return chunks;
    }
    // Fallback if intersection fails, just return the original polygon
    return [polygon];
}
