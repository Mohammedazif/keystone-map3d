import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon } from 'geojson';

export type AlgoTypology = 'lamella' | 'tower' | 'perimeter' | 'point' | 'slab' | 'lshaped' | 'ushaped' | 'tshaped' | 'hshaped' | 'oshaped';

export interface AlgoParams {
    typology: AlgoTypology;
    spacing: number;       // Gap between blocks (meters) or Grid Spacing
    width: number;         // Width of the block (meters) or Building Depth
    orientation: number;   // Rotation in degrees (0-180)
    setback: number;       // Boundary setback (meters)
    minLength?: number;    // Minimum viable block length

    // Extended Params (for UI binding)
    targetGFA?: number;
    targetFAR?: number;
    minFloors?: number;
    maxFloors?: number;
    minHeight?: number;
    maxHeight?: number; // Only used for constraints, not direct generation yet?
    minFootprint?: number;
    maxFootprint?: number;
    minSCR?: number;
    maxSCR?: number;
    parkingRatio?: number;
    gridOrientation?: number;
    avgUnitSize?: number;
    commercialPercent?: number;
    landUse?: string; // e.g. 'residential', 'commercial'
    selectedUtilities?: string[];
    programMix?: any;
    parkingType?: any;
    floorHeight?: number;


    // Multi-Typology & Vastu
    typologies?: string[];
    vastuCompliant?: boolean;

    // Advanced Placement
    obstacles?: Feature<Polygon>[];
}

export type LamellaParams = AlgoParams;

/**
 * Generates regular grid of towers
 */
export function generateTowers(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { spacing, width, orientation, setback, obstacles } = params;

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' as const });
    if (!bufferedPlot) return [];

    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;

    // 2. Create Grid of Points
    // stride = width + spacing
    const stride = width + spacing;

    const center = turf.centroid(validArea);
    const pMin = turf.point([minX, minY]);
    const pMax = turf.point([maxX, maxY]);
    const diagonal = turf.distance(pMin, pMax, { units: 'kilometers' as const }) * 1000;
    const genSize = diagonal * 1.5;

    const cols = Math.ceil(genSize / stride);
    const rows = Math.ceil(genSize / stride);

    const startX = -genSize / 2;
    const startY = -genSize / 2;

    // @ts-ignore
    const destination = turf.rhumbDestination || turf.destination;

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const xOffset = startX + (i * stride);
            const yOffset = startY + (j * stride);

            // Move from center along rotated axes
            // @ts-ignore
            const p1 = destination(center, xOffset, orientation, { units: 'meters' as const });
            // @ts-ignore
            const pointLoc = destination(p1, yOffset, orientation + 90, { units: 'meters' as const });

            // Create tower footprint (square)
            const hw = width / 2;
            // @ts-ignore
            const c1 = destination(pointLoc, hw * Math.sqrt(2), orientation + 45, { units: 'meters' as const });
            // @ts-ignore
            const c2 = destination(pointLoc, hw * Math.sqrt(2), orientation + 135, { units: 'meters' as const });
            // @ts-ignore
            const c3 = destination(pointLoc, hw * Math.sqrt(2), orientation + 225, { units: 'meters' as const });
            // @ts-ignore
            const c4 = destination(pointLoc, hw * Math.sqrt(2), orientation + 315, { units: 'meters' as const });

            const poly = turf.polygon([[
                c1.geometry.coordinates,
                c2.geometry.coordinates,
                c3.geometry.coordinates,
                c4.geometry.coordinates,
                c1.geometry.coordinates
            ]]);

            // Only keep if centroid is inside valid area
            // @ts-ignore
            // Ensure the centroid is within the valid area (setback applied)
            // We relax the full containment check because strict compliance with large footprints on small plots causes zero buildings.
            // @ts-ignore
            if (turf.booleanPointInPolygon(pointLoc, validArea)) {
                // Check intersection area to avoid buildings barely hanging on
                // @ts-ignore
                const intersect = turf.intersect(poly, validArea);
                if (intersect) {
                    const area = turf.area(intersect);
                    // If at least 50% of the building is inside the setback line, we allow it (clipping handled dynamically)
                    // We use the INTERSECT geometry to ensure it doesn't visually protrude out of the setback line
                    if (area > (width * width) * 0.5) {
                        // Use the clipped geometry
                        const clippedPoly = intersect as Feature<Polygon>;

                        // Check Collision with Obstacles
                        let collision = false;
                        if (obstacles && obstacles.length > 0) {
                            for (const obs of obstacles) {
                                // @ts-ignore
                                if (turf.booleanOverlap(clippedPoly, obs) || turf.booleanContains(obs, clippedPoly) || turf.booleanContains(clippedPoly, obs)) {
                                    collision = true;
                                    break;
                                }
                                // @ts-ignore
                                const obsIntersect = turf.intersect(clippedPoly, obs);
                                if (obsIntersect) {
                                    collision = true;
                                    break;
                                }
                            }
                        }

                        if (!collision) {
                            clippedPoly.properties = {
                                type: 'generated',
                                subtype: 'tower',
                                width,
                                area: area
                            };
                            buildings.push(clippedPoly);
                        }
                    }
                }
            }
        }
    }

    return buildings;
}

/**
 * Generates a perimeter block (courtyard)
 */
export function generatePerimeter(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { width, setback } = params; // width is building depth here

    // 1. Apply Setback (Outer boundary)
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' as const });
    if (!bufferedPlot) return [];

    // @ts-ignore
    const outerPoly = bufferedPlot as Feature<Polygon>;

    // 2. Inner Boundary (Courtyard)
    // @ts-ignore
    const innerPoly = turf.buffer(outerPoly, -width / 1000, { units: 'kilometers' as const });

    if (!innerPoly) {
        // Solid block if too small for courtyard
        outerPoly.properties = { type: 'generated', subtype: 'block' };
        return [outerPoly];
    }

    // 3. Subtract Inner from Outer
    // @ts-ignore
    const block = turf.difference(outerPoly, innerPoly);

    if (block) {
        // Handle MultiPolygon (e.g. if ring is cut)
        const geoms = block.geometry.type === 'MultiPolygon'
            ? block.geometry.coordinates.map((c: any) => turf.polygon(c))
            : [block as Feature<Polygon>];

        geoms.forEach(geom => {
            geom.properties = {
                type: 'generated',
                subtype: 'perimeter',
                width,
                area: turf.area(geom)
            };
            buildings.push(geom as Feature<Polygon>);
        });
    }

    return buildings;
}

/**
 * Generates parallel "Lamella" (linear) blocks inside a given polygon.
 */
export function generateLamellas(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { spacing, width, orientation, setback, minLength = 10 } = params;

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' as const });

    if (!bufferedPlot) return [];

    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;

    // 2. Create Bounding Box
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;

    // 3. Setup Grid
    // Use points for distance
    const point1 = turf.point([minX, minY]);
    const point2 = turf.point([maxX, maxY]);
    const diagonal = turf.distance(point1, point2, { units: 'kilometers' as const }) * 1000;
    const center = turf.centroid(validArea);

    const stride = width + spacing;
    const generationSize = diagonal * 1.5;

    // 4. Generate Lines
    // @ts-ignore
    const destination = turf.rhumbDestination || turf.destination;

    const rot = orientation;

    const count = Math.ceil(generationSize / stride);

    for (let i = -Math.floor(count / 2); i <= Math.ceil(count / 2); i++) {
        const offset = i * stride;

        // Move perpendicular to orientation (rot + 90)
        // @ts-ignore
        const origin = destination(center, offset, rot + 90, { units: 'meters' as const });

        // Create line segment
        // @ts-ignore
        const p1 = destination(origin, generationSize / 2, rot, { units: 'meters' as const });
        // @ts-ignore
        const p2 = destination(origin, generationSize / 2, rot + 180, { units: 'meters' as const });

        const line = turf.lineString([p1.geometry.coordinates, p2.geometry.coordinates]);

        // Buffer line to create rectangle
        // @ts-ignore
        const buildingPoly = turf.buffer(line, width / 2 / 1000, { units: 'kilometers', steps: 4 });

        if (!buildingPoly) continue;

        // Intersect
        let intersection = null;
        try {
            // @ts-ignore
            intersection = turf.intersect(validArea, buildingPoly);
        } catch (e) {
            continue;
        }

        if (intersection) {
            const geomType = intersection.geometry.type;
            let polys: Feature<Polygon>[] = [];

            if (geomType === 'Polygon') {
                polys = [intersection as Feature<Polygon>];
            } else if (geomType === 'MultiPolygon') {
                const coords = (intersection as Feature<MultiPolygon>).geometry.coordinates;
                polys = coords.map(c => turf.polygon(c) as Feature<Polygon>);
            }

            polys.forEach(geom => {
                const area = turf.area(geom);
                if (area < (width * minLength)) return;

                // Check Collision with Obstacles
                let collision = false;
                if (params.obstacles && params.obstacles.length > 0) {
                    for (const obs of params.obstacles) {
                        // @ts-ignore
                        if (turf.booleanOverlap(geom, obs) || turf.booleanContains(obs, geom) || turf.booleanContains(geom, obs)) {
                            collision = true;
                            break;
                        }
                        // @ts-ignore
                        const obsIntersect = turf.intersect(geom, obs);
                        if (obsIntersect) {
                            collision = true;
                            break;
                        }
                    }
                }

                if (!collision) {
                    // Add properties
                    geom.properties = {
                        type: 'generated',
                        subtype: 'lamella',
                        width,
                        area,
                        ...geom.properties
                    };
                    buildings.push(geom);
                }
            });
        }
    }

    return buildings;
}
