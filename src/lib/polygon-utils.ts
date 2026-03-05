
import * as turf from '@turf/turf';
import { Feature, Polygon, BBox } from 'geojson';

/**
 * Splits a polygon into a number of smaller polygons, with gaps between them.
 * @param polygon 
 * @param count 
 * @returns 
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
    const gap = 2; 

    for (let i = 0; i < count; i++) {
        let chunkBbox: BBox;
        if (isHorizontalSplit) {
            chunkBbox = [minX + i * step, minY, minX + (i + 1) * step, maxY];
        } else {
            chunkBbox = [minX, minY + i * step, maxX, minY + (i + 1) * step];
        }
        
        try {
            const chunkPolygon = turf.bboxPolygon(chunkBbox);
            const intersection = turf.intersect(chunkPolygon, polygon);

            if (intersection && intersection.geometry.type === 'Polygon') {
                const buffered = turf.buffer(intersection, -gap, { units: 'meters' });
                if (buffered) {
                    chunks.push(buffered as Feature<Polygon>);
                } else {
                    chunks.push(intersection as Feature<Polygon>);
                }

            } else if (intersection && intersection.geometry.type === 'MultiPolygon') {
                const largestPoly = intersection.geometry.coordinates
                    .map((coords: any) => turf.polygon(coords))
                    .sort((a: any, b: any) => turf.area(b) - turf.area(a))[0];
                
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
    return [polygon];
}
