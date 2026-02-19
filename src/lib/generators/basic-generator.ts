import * as turf from '@turf/turf';
import type { Feature, Polygon, MultiPolygon, Point } from 'geojson';
import { UnitTypology } from '../types';
import { applyVariableSetbacks } from './setback-utils';

export type AlgoTypology = 'lamella' | 'tower' | 'perimeter' | 'point' | 'slab' | 'lshaped' | 'ushaped' | 'tshaped' | 'hshaped' | 'oshaped';

export interface AlgoParams {
    typology: AlgoTypology;
    spacing: number;       // Gap between blocks (meters) or Grid Spacing
    width: number;         // Width of the block (meters) or Building Depth
    setback: number;       // Boundary setback (meters)

    // Variable Setbacks
    frontSetback?: number;
    rearSetback?: number;
    sideSetback?: number;
    roadAccessSides?: string[]; // 'N', 'S', 'E', 'W'

    orientation: number;   // Rotation in degrees (0-180)
    wingDepth?: number;    // Building wing depth (for L/T/U/H shapes)
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
    programMix?: { residential: number; commercial: number; institutional: number; hospitality: number; };
    allocationMode?: 'floor' | 'plot'; // 'floor' = vertical stacking, 'plot' = building-wise distribution
    parkingType?: any;
    parkingTypes?: ('ug' | 'pod' | 'surface' | 'ground' | 'none')[];
    floorHeight?: number;
    maxAllowedFAR?: number; // Override FAR limit for compliance scaling
    siteCoverage?: number;
    seedOffset?: number;

    // Dimensional Constraints
    minBuildingWidth?: number;
    maxBuildingWidth?: number;
    minBuildingLength?: number;
    maxBuildingLength?: number;

    // Multi-Typology & Vastu
    typologies?: string[];
    vastuCompliant?: boolean;

    // Advanced Placement
    obstacles?: Feature<Polygon>[];
    targetPosition?: Feature<Point>;

    // Optional Hints
    wingLengthA?: number;
    wingLengthB?: number;

    // Seed for pagination/refresh
    seed?: number;

    // Unit Mix Configuration
    unitMix?: UnitTypology[];
}

export type LamellaParams = AlgoParams;

/**
 * Generates regular grid of towers
 */
/**
 * Pseudo-random generator for consistent variations
 */
function seededRandom(x: number, y: number, seed: number = 0) {
    const vector = Math.sin(x * 12.9898 + y * 78.233 + seed) * 43758.5453;
    return vector - Math.floor(vector);
}

export function generateTowers(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { spacing, width, orientation, setback, obstacles, minBuildingWidth, maxBuildingWidth, seedOffset = 0 } = params;

    const maxWidth = maxBuildingWidth || width;
    const minWidth = minBuildingWidth || (maxWidth * 0.7); // Fallback min

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params);
    if (!bufferedPlot) return [];

    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;

    // 2. Create Grid of Points
    // Directional Spacing
    // Use MAX width for stride to avoid overlap
    const sideGap = params.sideSetback ?? params.spacing ?? 6;
    const depthGap = (params.frontSetback ?? 6) + (params.rearSetback ?? 6);

    const strideX = maxWidth + sideGap;
    const strideY = maxWidth + depthGap;

    const center = turf.centroid(validArea);
    const pMin = turf.point([minX, minY]);
    const pMax = turf.point([maxX, maxY]);
    const diagonal = turf.distance(pMin, pMax, { units: 'kilometers' as const }) * 1000;
    const genSize = diagonal * 1.5;

    const cols = Math.ceil(genSize / strideX);
    const rows = Math.ceil(genSize / strideY);

    const startX = -genSize / 2;
    const startY = -genSize / 2;

    // @ts-ignore
    const destination = turf.rhumbDestination || turf.destination;

    for (let i = 0; i < cols; i++) {
        for (let j = 0; j < rows; j++) {
            const xOffset = startX + (i * strideX);
            const yOffset = startY + (j * strideY);

            // Move from center along rotated axes
            // @ts-ignore
            const p1 = destination(center, xOffset, orientation, { units: 'meters' as const });
            // @ts-ignore
            const pointLoc = destination(p1, yOffset, orientation + 90, { units: 'meters' as const });

            // Randomize Width for this tower
            const rand = seededRandom(i, j, seedOffset);
            const currentWidth = minWidth + (rand * (maxWidth - minWidth));

            // Create tower footprint (square)
            const hw = currentWidth / 2;
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
                    if (area > (currentWidth * currentWidth) * 0.5) {

                        // Check GFA Constraints
                        if (params.targetGFA && params.maxFloors) {
                            const currentGFA = buildings.reduce((sum, b) => sum + (turf.area(b) * params.maxFloors!), 0);
                            const potentialGFA = area * params.maxFloors;

                            // Strict Cap: If adding this building exceeds target by > 10%, skip it or stop
                            if (currentGFA + potentialGFA > params.targetGFA * 1.1) {
                                continue; // Skip this block
                            }
                        }

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
                                width: currentWidth,
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
    // Destructure new params
    const { width, setback, minBuildingWidth, maxBuildingWidth, seedOffset = 0 } = params;

    // Calculate dynamic width
    const minW = minBuildingWidth || (width * 0.8);
    const maxW = maxBuildingWidth || width;

    // Randomize width for this generation instance
    // Use a fixed seed for the whole perimeter block
    const rand = seededRandom(1, 1, seedOffset);
    const currentWidth = minW + (rand * (maxW - minW));

    // 1. Apply Setback (Outer boundary)
    // @ts-ignore
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params);
    if (!bufferedPlot) return [];

    // @ts-ignore
    const outerPoly = bufferedPlot as Feature<Polygon>;

    // 2. Inner Boundary (Courtyard)
    // @ts-ignore
    const innerPoly = turf.buffer(outerPoly, -currentWidth / 1000, { units: 'kilometers' as const });

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

        geoms.forEach((geom: Feature<Polygon>) => {
            const area = turf.area(geom);

            // Check GFA Constraints
            if (params.targetGFA && params.maxFloors) {
                const currentGFA = buildings.reduce((sum, b) => sum + (turf.area(b) * params.maxFloors!), 0);
                const potentialGFA = area * params.maxFloors;

                // Strict Cap
                if (currentGFA + potentialGFA > params.targetGFA * 1.1) {
                    return;
                }
            }

            geom.properties = {
                type: 'generated',
                subtype: 'perimeter',
                width,
                area: area
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
    const { spacing, width, orientation, setback, minLength = 10, minBuildingWidth, maxBuildingWidth, seedOffset = 0 } = params;

    const minW = minBuildingWidth || (width * 0.8);
    const maxW = maxBuildingWidth || width;

    // Use a consistent random width for the whole set of lamellas (or could vary per bar)
    // Let's vary per bar for "organic" look, or consistent for "strict" look?
    // Consistent is safer for layout.
    const rand = seededRandom(2, 2, seedOffset);
    const currentWidth = minW + (rand * (maxW - minW));

    console.log('[generateLamellas] params:', params);

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params);

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

    const stride = currentWidth + spacing;
    const generationSize = diagonal * 1.5;

    // 4. Generate Lines
    // @ts-ignore
    const destination = turf.rhumbDestination || turf.destination;

    const rot = orientation;

    const count = Math.ceil(generationSize / stride);

    for (let i = -Math.floor(count / 2); i <= Math.ceil(count / 2); i++) {
        const offset = i * stride;

        // Randomize width per bar for variety
        const rand = seededRandom(i, count, seedOffset);
        const currentWidth = minW + (rand * (maxW - minW));

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
        const buildingPoly = turf.buffer(line, currentWidth / 2 / 1000, { units: 'kilometers', steps: 4 });

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

            polys.forEach(poly => {
                const area = turf.area(poly);

                // Check if segment is long enough
                if (area > (width * minLength)) {
                    // Check GFA Constraints
                    if (params.targetGFA && params.maxFloors) {
                        const currentGFA = buildings.reduce((sum, b) => sum + (turf.area(b) * params.maxFloors!), 0);
                        const potentialGFA = area * params.maxFloors;

                        // Strict Cap: If adding this building exceeds target by > 10%, skip it or stop
                        if (currentGFA + potentialGFA > params.targetGFA * 1.1) {
                            return; // Skip this block
                        }
                    }

                    poly.properties = {
                        type: 'generated',
                        subtype: 'lamella',
                        width,
                        area
                    };
                    buildings.push(poly);
                }
            });
        }
    }

    return buildings;
}
