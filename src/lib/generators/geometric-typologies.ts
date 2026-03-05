import * as turf from '@turf/turf';
import { generateBuildingLayout } from './layout-generator';
import { Feature, Polygon, MultiPolygon, Point, LineString } from 'geojson';
import { UnitTypology } from '../types';

export interface GeometricTypologyParams {
    wingDepth?: number;
    wingLengthA?: number; // Optional explicit lengths
    wingLengthB?: number;
    orientation: number;
    setback: number;
    minFootprint?: number;
    maxFootprint?: number;
    maxFloors?: number; // For future vertical scaling
    obstacles?: Feature<Polygon>[];
    targetPosition?: Feature<Point>;
    vastuCompliant?: boolean;
    unitMix?: UnitTypology[];
    // Dimensional Constraints
    minBuildingWidth?: number;
    maxBuildingWidth?: number;
    minBuildingLength?: number;
    maxBuildingLength?: number;
    // Directional Spacing
    sideSetback?: number;
    frontSetback?: number;
    rearSetback?: number;
    roadAccessSides?: string[];
    seed?: number; // For deterministic selection
    selectedUtilities?: string[]; // Propagate utility selection
}

export function checkCollision(poly: Feature<Polygon>, obstacles?: Feature<Polygon>[]): boolean {
    if (!obstacles || obstacles.length === 0) return false;
    for (const obs of obstacles) {
        try {
            // @ts-ignore
            const intersect = turf.intersect(poly, obs);
            if (intersect && turf.area(intersect) > 1) return true;
        } catch (e) {
            // Ignore intersection errors
        }
    }
    return false;
}

/**
 * Apply corner clearance to prevent building parts from touching at corners.
 * Shrinks each polygon slightly to create a minimum gap.
 */
function applyCornerClearance(
    parts: Feature<Polygon>[],
    minClearance: number = 2
): Feature<Polygon>[] {
    return parts.map(part => {
        try {
            // Shrink each part slightly to create clearance
            const shrunk = turf.buffer(part, -minClearance / 2000, { units: 'kilometers' });
            if (shrunk && turf.area(shrunk) > 50) {
                return shrunk as Feature<Polygon>;
            }
            return part; // If shrinking fails, return original
        } catch (e) {
            return part;
        }
    });
}

/**
 * Creates an offset polygon (buffer) for a LineString.
 * Used to create "Wings" along plot edges.
 */
function createWingFromEdge(
    edge: Feature<LineString>,
    depth: number,
    plotPoly: Feature<Polygon | MultiPolygon>
): Feature<Polygon> | null {
    try {
        // Buffer the edge by depth/2 (since buffer is radius)
        // But turf buffer is round. better to maximize and cut.
        // Actually, for building wings, we want a one-sided offset ideally.
        // But intersection with plot handles the outside part.

        // Use a large buffer then intersect with plot?
        // No, that fills the whole plot if depth is large.

        // Better: Create a rectangle along the edge.
        const coords = edge.geometry.coordinates;
        const p1 = coords[0];
        const p2 = coords[1];
        const bearing = turf.bearing(p1, p2);
        const dist = turf.distance(p1, p2, { units: 'meters' });

        // Create a box centered on the edge
        // Width = dist, Height = 2 * depth (to be safe on both sides)
        const center = turf.midpoint(p1, p2);
        const poly = turf.transformRotate(
            turf.bboxPolygon([
                center.geometry.coordinates[0] - dist / 200000, // tiny width initially? No.
                center.geometry.coordinates[1] - depth / 111000,
                center.geometry.coordinates[0] + dist / 200000,
                center.geometry.coordinates[1] + depth / 111000
            ]),
            bearing,
            { pivot: center }
        );

        // Wait, scratch that. 
        // Just Buffer the LineString. 
        // @ts-ignore
        const bufferedEdge = turf.buffer(edge, depth, { units: 'meters', steps: 1 }); // Square edges?

        // Intersect with Plot to keep only the functional part 'inside'
        // @ts-ignore
        const wing = turf.intersect(bufferedEdge, plotPoly);
        return wing as Feature<Polygon>;
    } catch (e) { return null; }
}

/**
 * Robust "Perimeter-Aligned" L-Shape Generator
 * 1. Identify Simplied Plot Corners.
 * 2. Generate Wings along adjacent edges.
 * 3. Union them.
 * 4. This guarantees the shape visually 'hugs' the plot corner, whatever the angle.
 */

/**
 * Helper to enforce Max Footprint by shrinking the polygon if necessary.
 * Uses iterative negative buffering.
 */
function enforceMaxFootprint(
    poly: Feature<Polygon | MultiPolygon>,
    maxArea: number | undefined,
    minArea: number | undefined
): Feature<Polygon | MultiPolygon> | null {
    if (!maxArea) return poly;

    let currentArea = turf.area(poly);
    if (currentArea <= maxArea) return poly;

    let temp = poly;
    let attempts = 0;
    // Aggressive shrinkage if way over, fine tuning if close
    let factor = 0.5;

    while (currentArea > maxArea && attempts < 15) {
        // If we are HUGE (double), shrink faster
        if (currentArea > maxArea * 2) factor = 2.0;
        else if (currentArea > maxArea * 1.5) factor = 1.0;
        else factor = 0.2; // Fine tune

        // @ts-ignore
        const shrunk = turf.buffer(temp, -factor, { units: 'meters' });

        // If vanished, return null (too small to sustain shape)
        if (!shrunk || !shrunk.geometry) return null;

        // If it split effectively into MultiPolygon, it's fine, but check area
        temp = shrunk as Feature<Polygon | MultiPolygon>;
        currentArea = turf.area(temp);
        attempts++;
    }

    if (currentArea <= maxArea) {
        if (minArea && currentArea < minArea) return null;
        return temp;
    }
    return null; // Could not shrink enough
}

// Diversity Selection Helper
function selectDiverseCandidate(
    candidates: { feature: any, score: number, variantId?: string, pairId?: string, parts?: any[] }[],
    seed: number
): any[] {
    if (candidates.length === 0) return [];

    // Group by variantId OR pairId
    const groups: Record<string, typeof candidates> = {};
    candidates.forEach(c => {
        const key = c.variantId || c.pairId || 'default';
        if (!groups[key]) groups[key] = [];
        groups[key].push(c);
    });



    // Sort within groups by score
    Object.values(groups).forEach(g => g.sort((a, b) => b.score - a.score));

    // Round Robin Interleaving
    const diverseList: typeof candidates = [];
    const groupKeys = Object.keys(groups);
    groupKeys.sort(); // Stable order

    let maxLen = 0;
    groupKeys.forEach(k => maxLen = Math.max(maxLen, groups[k].length));

    for (let i = 0; i < maxLen; i++) {
        for (const key of groupKeys) {
            if (groups[key][i]) {
                diverseList.push(groups[key][i]);
            }
        }
    }



    const selected = diverseList[seed % diverseList.length];
    return selected.parts || [];
}

/**
 * Robust "Perimeter-Aligned" U-Shape Generator
 * 1. Identify 3 Consecutive Edges (forming a U base).
 * 2. Generate Wings.
 * 3. Union.
 */
export function generateUShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const { wingDepth, setback, obstacles } = params;
    console.log(`[generateUShapes] Setbacks -> setback: ${setback}, sideSetback: ${params.sideSetback}`);

    // 1. Get Valid Area
    // @ts-ignore
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params as AlgoParams);
    if (!bufferedPlot) return [];
    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.00005, highQuality: true });

    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    // Determine Depth
    const bbox = turf.bbox(validArea);
    const widthM = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const heightM = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
    const minDim = Math.min(widthM, heightM);

    // Strict Depth Logic: Use maxBuildingWidth as target, ensure >= minBuildingWidth
    const minDepth = params.minBuildingWidth || 20;
    const maxDepth = params.maxBuildingWidth || 25;

    // Randomize depth for this U-Shape instance
    const rand = Math.abs(Math.sin((params.seed || 0) * 99.123));
    const targetDepth = minDepth + (rand * (maxDepth - minDepth));

    // Ensure safe depth relative to plot size, but don't go below min unless plot is tiny
    let safeDepth = Math.min(targetDepth, minDim * 0.45);
    if (safeDepth < minDepth) safeDepth = minDepth; // Force min width if possible
    if (safeDepth > targetDepth) safeDepth = targetDepth; // Cap at max

    const candidates: { feature: Feature<Polygon | MultiPolygon>, score: number, variantId?: string, parts?: Feature<Polygon>[] }[] = [];

    // Loop through corners (vertices) of 3 edges (4 vertices)
    for (let i = 0; i < coords.length - 2; i++) {
        try {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const p3 = coords[i + 2];
            const p4 = (i + 3 < coords.length) ? coords[i + 3] : coords[0];

            // Edges
            const edges = [
                turf.lineString([p1, p2]),
                turf.lineString([p2, p3]),
                turf.lineString([p3, p4])
            ];

            const variations = [
                { name: 'Standard', depthFactor: 1.0 },
                { name: 'Thick', depthFactor: 1.5 },
                { name: 'Thin', depthFactor: 0.75 }
            ];

            variations.forEach(v => {
                try {
                    const currentDepth = safeDepth * v.depthFactor;
                    let wings: Feature<Polygon>[] = [];
                    for (const edge of edges) {
                        try {
                            // @ts-ignore
                            const raw = turf.buffer(edge, currentDepth, { units: 'meters', steps: 1 });
                            // @ts-ignore
                            const trimmed = turf.intersect(raw, validArea);
                            if (trimmed) wings.push(trimmed as Feature<Polygon>);
                        } catch (e) { }
                    }

                    if (wings.length === 3) {
                        const side1 = wings[0];
                        const baseRaw = wings[1];
                        const side2 = wings[2];

                        // Trim base with gaps
                        // Buffer sides OUTWARD by sideSetback to create exclusion zones
                        const gap = params.sideSetback ?? params.setback ?? 6;
                        // @ts-ignore
                        const side1Buffered = turf.buffer(side1, gap, { units: 'meters' });
                        // @ts-ignore
                        const side2Buffered = turf.buffer(side2, gap, { units: 'meters' });
                        // @ts-ignore
                        const sidesExclusion = turf.union(side1Buffered, side2Buffered);
                        // @ts-ignore
                        const baseTrimmed = turf.difference(baseRaw, sidesExclusion);

                        if (side1 && side2 && baseTrimmed) {
                            const uParts: Feature<Polygon>[] = [];

                            // Segment Side 1 (p1 -> p2)
                            uParts.push(...segmentWing(side1, turf.point(p1), turf.point(p2), params, false));

                            // Segment Base (p2 -> p3)
                            uParts.push(...segmentWing(baseTrimmed as Feature<Polygon>, turf.point(p2), turf.point(p3), params, false));

                            // Segment Side 2 (p3 -> p4)
                            uParts.push(...segmentWing(side2, turf.point(p3), turf.point(p4), params, false));

                            if (uParts.length > 0) {
                                // @ts-ignore
                                const shape = turf.multiPolygon(uParts.map(p => p.geometry.coordinates));

                                // 4. ENFORCE FOOTPRINT
                                const enforced = enforceMaxFootprint(shape, params.maxFootprint, params.minFootprint);

                                if (enforced) {
                                    // Calculate Score
                                    const area = turf.area(enforced);
                                    // @ts-ignore
                                    const perimeter = turf.length(enforced, { units: 'meters' });
                                    const compactness = (4 * Math.PI * area) / (perimeter * perimeter);
                                    const score = area * compactness;

                                    // @ts-ignore
                                    candidates.push({
                                        feature: enforced,
                                        score,
                                        variantId: `U-Seq-${i}-${v.name}`,
                                        parts: uParts
                                    });
                                }
                            }
                        }
                    }
                } catch (e) { }
            });
        } catch (e) { }
    }

    // Diversity Selection (Seeded)
    if (candidates.length > 0) {
        // @ts-ignore
        const parts = selectDiverseCandidate(candidates, params.seed ?? 0);
        const clearedParts = applyCornerClearance(parts as Feature<Polygon>[], 3);
        // Add subtype
        // @ts-ignore
        clearedParts.forEach(p => p.properties = { ...p.properties, subtype: 'ushaped', type: 'generated' });
        // @ts-ignore
        return clearedParts;
    }

    return [];
}

// Helper to get midpoint of a LineString or coords
function getMidpoint(coords: number[][]): number[] {
    const len = coords.length;
    if (len < 2) return coords[0];
    const p1 = coords[0];
    const p2 = coords[coords.length - 1]; // Use ends for simplified logic
    return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
}

/**
 * Robust "Perimeter-Aligned" T-Shape Generator
 * 1. Identify "Long Edges" of the plot.
 * 2. Create "Cap" by buffering the edge.
 * 3. Create "Stem" by extending inward from the edge midpoint (towards centroid).
 */
// T-Shape Generator (Stubbed/Updated)
// TODO: Implement proper T-shape segmentation similar to L-shape
// T-Shape Generator: Junction at Edge Midpoint, Wings Left/Right/In
export function generateTShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const { wingDepth, setback, obstacles, minBuildingWidth = 20, maxBuildingWidth = 25 } = params;
    console.log(`[generateTShapes] Setbacks -> setback: ${setback}, sideSetback: ${params.sideSetback}`);
    console.log(`[generateTShapes] Dimensions -> minWidth: ${minBuildingWidth}, maxWidth: ${maxBuildingWidth}`);

    // 1. Valid Area
    // @ts-ignore
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params as AlgoParams);
    if (!bufferedPlot) return [];
    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.00005, highQuality: true });

    // Coords
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    const candidates: { feature: Feature<Polygon | MultiPolygon>, score: number, variantId?: string, parts?: Feature<Polygon>[] }[] = [];

    // Strict Depth Logic
    // const targetDepth = maxBuildingWidth || 25;
    const minDepth = minBuildingWidth || 20;
    const maxDepth = maxBuildingWidth || 25;

    // Loop edges to find T-Junction spots
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            // Randomize depth for this T-junction
            const rand = Math.abs(Math.sin(i * 43.234 + (params.seed || 0) * 12.111));
            const targetDepth = minDepth + (rand * (maxDepth - minDepth));

            const p1 = coords[i];
            const p2 = coords[i + 1];
            const edgeLine = turf.lineString([p1, p2]);
            const edgeLen = turf.length(edgeLine, { units: 'meters' });

            if (edgeLen < 40) continue; // Too short for a T-Cap

            // Midpoint
            const midP = turf.midpoint(turf.point(p1), turf.point(p2));
            const bearing = turf.bearing(turf.point(p1), turf.point(p2)); // Bearing of edge

            // Perpendicular bearing (Inward)
            // Need to determine which side is "in".
            // Test +90 and -90 check point in polygon.
            const testPPlus = turf.destination(midP, 5, bearing + 90, { units: 'meters' });
            // @ts-ignore
            const isPlusIn = turf.booleanPointInPolygon(testPPlus, validArea);
            const bearingIn = isPlusIn ? bearing + 90 : bearing - 90;

            // 1. Junction Block (Square at center)
            const junctionSize = targetDepth;
            // Build junction centered on midP? Or strictly inside?
            // Usually "inside" the setback line means we can build right up to the line.
            // So place junction such that its edge is on the plot edge.
            // i.e. move junction center "in" by half size.

            const junctionCenter = turf.destination(midP, junctionSize / 2, bearingIn, { units: 'meters' });
            // createRect builds around center? No, let's assume createRect semantics or build manually.
            // To be safe, build manually.

            const halfS = junctionSize / 2;
            const j1 = turf.destination(junctionCenter, halfS, bearing, { units: 'meters' }); // Right
            const j2 = turf.destination(junctionCenter, -halfS, bearing, { units: 'meters' }); // Left
            // Extend "in" and "out"?
            // We want depth = junctionSize.
            // Front face is at edge. Back face is at edge + depth.
            // So construct 4 corners relative to midP?
            // Front-Left
            const fl = turf.destination(midP, -halfS, bearing, { units: 'meters' });
            // Front-Right
            const fr = turf.destination(midP, halfS, bearing, { units: 'meters' });
            // Back-Right
            const br = turf.destination(fr, junctionSize, bearingIn, { units: 'meters' });
            // Back-Left
            const bl = turf.destination(fl, junctionSize, bearingIn, { units: 'meters' });

            const junctionPoly = turf.polygon([[
                fl.geometry.coordinates,
                fr.geometry.coordinates,
                br.geometry.coordinates,
                bl.geometry.coordinates,
                fl.geometry.coordinates
            ]]);

            // validate junction
            // @ts-ignore
            if (!turf.booleanContains(validArea, turf.centroid(junctionPoly))) continue;
            // Note: validArea might be concave, so junction might peek out. 
            // Better: intersect with validArea? 
            // For now, assume good placement.

            // Better: intersect with validArea? 
            // For now, assume good placement.
            const tParts: Feature<Polygon>[] = [junctionPoly];

            // 2. Wings (Left, Right)
            // Left Wing: From fl, direction = bearing + 180 (reverse)
            // Right Wing: From fr, direction = bearing

            // We create "Guide Rays" (points)
            const dirLeft = turf.destination(fl, 100, bearing + 180, { units: 'meters' });
            const dirRight = turf.destination(fr, 100, bearing, { units: 'meters' });

            // Cap Wings (full length along edge)
            // Let's Buffer the edge to get the "Swath"
            // Then cut it?

            // Better: create "Wing Polygons" by extending from junction.
            // Left Wing Polygon:
            // Start at fl/bl face. Extend along edge reversed.
            // Width = junctionSize.
            // Intersect with validArea.

            const createWingPoly = (startP: any, dirP: any) => {
                const b = turf.bearing(startP, dirP);
                const len = 200; // max extension
                const pEnd = turf.destination(startP, len, b, { units: 'meters' });

                // Build box
                const bPerp = bearingIn; // Depth direction
                const pStartBack = turf.destination(startP, junctionSize, bPerp, { units: 'meters' });
                const pEndBack = turf.destination(pEnd, junctionSize, bPerp, { units: 'meters' });

                return turf.polygon([[
                    startP.geometry.coordinates,
                    pEnd.geometry.coordinates,
                    pEndBack.geometry.coordinates,
                    pStartBack.geometry.coordinates,
                    startP.geometry.coordinates
                ]]);
            };

            // Left Wing Base
            const leftWingBase = createWingPoly(turf.point(fl.geometry.coordinates), dirLeft);
            // @ts-ignore
            const leftWingValid = turf.intersect(leftWingBase, validArea);

            // Right Wing Base
            const rightWingBase = createWingPoly(turf.point(fr.geometry.coordinates), dirRight);
            // @ts-ignore
            const rightWingValid = turf.intersect(rightWingBase, validArea);

            // Stem Wing Base (Inward)
            // Start at bl/br face (back of junction).
            // Center?
            const stemStartL = bl;
            const stemStartR = br;
            // Extend along bearingIn
            const stemDir = turf.destination(midP, 100, bearingIn, { units: 'meters' });

            // Stem Box
            // Width = junctionSize (or thinner?)
            // Let's use junctionSize.
            const stemLen = 200;
            const stemEndL = turf.destination(bl, stemLen, bearingIn, { units: 'meters' });
            const stemEndR = turf.destination(br, stemLen, bearingIn, { units: 'meters' });

            const stemBase = turf.polygon([[
                bl.geometry.coordinates,
                br.geometry.coordinates,
                stemEndR.geometry.coordinates,
                stemEndL.geometry.coordinates,
                bl.geometry.coordinates
            ]]);
            // @ts-ignore
            const stemValid = turf.intersect(stemBase, validArea);

            // Segment Wings
            if (leftWingValid) {
                tParts.push(...segmentWing(leftWingValid as Feature<Polygon>, turf.point(fl.geometry.coordinates), dirLeft, params));
            }
            if (rightWingValid) {
                tParts.push(...segmentWing(rightWingValid as Feature<Polygon>, turf.point(fr.geometry.coordinates), dirRight, params));
            }
            if (stemValid) {
                // Stem starts at back of junction?
                // Center of back face?
                const backCenter = turf.midpoint(bl, br);
                const backDir = turf.destination(backCenter, 10, bearingIn);
                tParts.push(...segmentWing(stemValid as Feature<Polygon>, backCenter, backDir, params));
            }

            if (tParts.length > 1) {
                // Apply corner clearance to prevent parts from touching
                const clearedParts = applyCornerClearance(tParts, 3);

                // Return MultiPolygon
                const multi = turf.multiPolygon(clearedParts.map(p => p.geometry.coordinates));

                // 4. ENFORCE FOOTPRINT
                const enforced = enforceMaxFootprint(multi, params.maxFootprint, params.minFootprint);

                if (enforced) {
                    // Tag parts
                    clearedParts.forEach(p => p.properties = { ...p.properties, subtype: 'tshaped', type: 'generated' });

                    // @ts-ignore
                    candidates.push({
                        feature: enforced,
                        score: turf.area(enforced),
                        variantId: `T-Edge-${i}`,
                        parts: clearedParts
                    });
                }
            }

        } catch (e) { }
    }

    // Sort and return
    if (candidates.length > 0) {
        // @ts-ignore
        return selectDiverseCandidate(candidates, params.seed ?? 0);
    }

    return [];
}

// Helper to segment a wing polygon along an axis
function segmentWing(
    wingPoly: Feature<Polygon>,
    startPoint: Feature<Point>, // Start of the wing (e.g. junction)
    directionPoint: Feature<Point>, // Direction to extend
    params: GeometricTypologyParams,
    initialGap: boolean = true
): Feature<Polygon>[] {
    const { maxBuildingLength = 55, sideSetback = 6, minBuildingLength = 15, minBuildingWidth = 10, maxBuildingWidth = 25 } = params;

    const segments: Feature<Polygon>[] = [];
    const bearing = turf.bearing(startPoint, directionPoint);

    // Segmentation Gap: Use sideSetback if available, else setback, else 6m default
    const gap = sideSetback ?? params.setback ?? 6;
    console.log(`[segmentWing] Gaps -> sideSetback: ${sideSetback}, paramSetback: ${params.setback}, effectiveGap: ${gap}`);

    // Create a "Ray" or iterating cutter
    // We assume the wingPoly defines the spatial limits (width/depth).
    // We just chop it along the length.

    let currentDist = initialGap ? 0 : -gap;

    // Safety break
    for (let i = 0; i < 20; i++) {
        // Add gap if not first segment (and strictly we want gaps between blocks)
        currentDist += gap;

        const segmentLen = maxBuildingLength;

        // Define cutter box
        const pStart = turf.destination(startPoint, currentDist, bearing, { units: 'meters' });
        const pEnd = turf.destination(startPoint, currentDist + segmentLen, bearing, { units: 'meters' });

        // Construct a wide cutter perpendicular to bearing
        const width = 500; // Wide enough
        const bearingPerp = bearing + 90;
        const offset = width / 2;

        const p1 = turf.destination(pStart, offset, bearingPerp, { units: 'meters' });
        const p2 = turf.destination(pStart, -offset, bearingPerp, { units: 'meters' });
        const p3 = turf.destination(pEnd, -offset, bearingPerp, { units: 'meters' });
        const p4 = turf.destination(pEnd, offset, bearingPerp, { units: 'meters' });

        const cutter = turf.polygon([[
            p1.geometry.coordinates,
            p2.geometry.coordinates,
            p3.geometry.coordinates,
            p4.geometry.coordinates,
            p1.geometry.coordinates
        ]]);

        // Intersect
        // @ts-ignore
        const piece = turf.intersect(wingPoly, cutter);

        console.log('[segmentWing] Iter', i, '- Piece:', piece ? 'EXISTS' : 'NULL', 'Area:', piece ? turf.area(piece) : 0);
        if (piece) {
            const pieceBbox = turf.bbox(piece);
            const wingBbox = turf.bbox(wingPoly);
            console.log('[segmentWing] Piece bbox:', pieceBbox);
            console.log('[segmentWing] Wing bbox:', wingBbox);
        }

        if (piece) {
            const area = turf.area(piece);
            // Robust Dimension Check: Solve for side lengths from Area and Perimeter
            // This handles rotated segments correctly (unlike bbox which inflates dimensions)
            // x^2 - (P/2)x + A = 0
            const P = turf.length(piece, { units: 'meters' });
            const A = area;
            const semiP = P / 2;

            // Quadratic formula discriminant: b^2 - 4ac -> semiP^2 - 4*1*A
            const discriminant = (semiP * semiP) - (4 * A);

            let dim1 = 0;
            let dim2 = 0;

            if (discriminant >= 0) {
                const sqRoot = Math.sqrt(discriminant);
                dim1 = (semiP + sqRoot) / 2;
                dim2 = (semiP - sqRoot) / 2;
            } else {
                // Should not happen for valid rectangles, but fallback to bbox if non-rectangular
                // or if math precision fails
                const bbox = turf.bbox(piece);
                dim1 = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
                dim2 = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
            }

            const minSide = Math.min(dim1, dim2);
            const maxSide = Math.max(dim1, dim2);

            // STRCITLY ENFORCE params.minBuildingWidth and params.minBuildingLength
            // Use -1m tolerance for floating point/corner cutting
            // AND ensure we don't exceed maxBuildingLength (handled by cutter) 
            // AND ensure width is within range

            // Check if ANY side is within width range (minWidth to maxWidth)
            // And OTHER side is within length range (minLength to maxLength)

            // Allow rotation: Width could be dim1 or dim2.
            const isWidthValid = (dim1 >= (minBuildingWidth - 1) && dim1 <= (maxBuildingWidth + 2)) || (dim2 >= (minBuildingWidth - 1) && dim2 <= (maxBuildingWidth + 2));
            const isLengthValid = (dim1 >= (minBuildingLength - 1)) || (dim2 >= (minBuildingLength - 1));

            // Actually, we just want to ensure it's not too small. 
            // The cutter determines the max length (segmentLen).
            // The wingPoly width determines the max width.

            if (minSide >= (minBuildingWidth - 1) && maxSide >= (minBuildingLength - 1)) {
                segments.push(piece as Feature<Polygon>);
                currentDist += segmentLen;
            } else {
                console.log(`[segmentWing] Rejected piece (Robust): ${minSide.toFixed(1)}m x ${maxSide.toFixed(1)}m (Min: ${minBuildingWidth}x${minBuildingLength})`);
                // Too small, skip or break
                if (currentDist > 20) break;
            }
        } else {
            // No valid piece found implies end of wing or gap
            if (currentDist > 20) break;
            break;
        }
    }

    return segments;
}

export function generateLShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        wingDepth, setback, obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        minBuildingLength = 25, maxBuildingLength = 55,
        sideSetback = 6
    } = params;

    console.log(`[generateLShapes] Setbacks -> sideSetback: ${sideSetback}, setback: ${setback}`);
    console.log(`[generateLShapes] Dimensions -> minWidth: ${minBuildingWidth}, maxWidth: ${maxBuildingWidth}, minLength: ${minBuildingLength}, maxLength: ${maxBuildingLength}`);

    // 1. Valid Area
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];
    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.00005, highQuality: true });

    // Get Coordinates
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    // Determine target depth (width)
    // const targetDepth = maxBuildingWidth || 25; // Try max width first
    const minDepth = minBuildingWidth || 20;
    const maxDepth = maxBuildingWidth || 25;

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];

    // Loop through corners to find valid L-junctions
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            // Randomize depth for this specific corner candidate
            // Use index 'i' as seed component
            const rand = Math.abs(Math.sin(i * 12.9898 + (params.seed || 0) * 78.233));
            const targetDepth = minDepth + (rand * (maxDepth - minDepth));
            const pCorner = turf.point(coords[i]);
            // Previous point (wrap around)
            const pPrev = turf.point(coords[i === 0 ? coords.length - 2 : i - 1]);
            // Next point
            const pNext = turf.point(coords[i + 1]);

            // Check angle - roughly 90 degrees?
            const bearingPrev = turf.bearing(pCorner, pPrev);
            const bearingNext = turf.bearing(pCorner, pNext);
            const angle = Math.abs(bearingPrev - bearingNext);

            // Accept corners roughly 60-120 degrees (very loose) or just check validity
            // Construct Corner Block
            // Start with a square at the corner
            const cornerSize = Math.max(minBuildingWidth, targetDepth); // Square corner

            // Vector to Prev
            // Vector to Next
            // We need to inset/shift to fit inside?
            // "createRect" generates from p1 towards p2.

            // Let's try to generate two "Slab Sequences" starting from this corner.
            // 1. Corner Block
            // 2. Wing A (along Prev)
            // 3. Wing B (along Next)

            // We need to ensure the corner block is valid first.
            // Bisector direction?
            // Let's try simpler: Place a block along Edge Next, and Edge Prev, and see if they meet?

            // Strategy:
            // 1. Build a block along Edge Next starting at Corner.
            // 2. Build a block along Edge Prev starting at Corner.
            // 3. Union them?

            // Edge 1
            const distNext = turf.distance(pCorner, pNext, { units: 'meters' });
            const distPrev = turf.distance(pCorner, pPrev, { units: 'meters' });

            if (distNext < minBuildingLength || distPrev < minBuildingLength) continue;

            // Generate candidates for this corner
            // ...

            // Let's use the Slab Generation logic but constrained to these two edges and shared corner.

            // Corner Block (Square aligned with Next edge, check if fits)
            // Note: Corner handling is tricky with setbacks.
            // Let's place the corner block first.

            // Angle detection to know "inside" turn
            // We need to know which side is "in". validArea check helps.

            let cornerPoly: Feature<Polygon> | null = null;
            let cornerDepth = targetDepth;
            let validTurn = 0;

            for (const turn of [90, -90]) {
                try {
                    // Try to make a square corner piece
                    const poly = createRect(pCorner.geometry.coordinates, bearingNext, cornerSize, cornerSize, turn);
                    // @ts-ignore
                    const intersect = turf.intersect(poly, validArea);
                    // Strict containment check (99%)
                    if (intersect && turf.area(intersect) >= turf.area(poly) * 0.99 && !checkCollision(poly, usedAreas)) {
                        cornerPoly = poly;
                        validTurn = turn; // This turn is "in" relative to bearingNext
                        break;
                    }
                } catch (e) { }
            }

            if (cornerPoly) {
                // We have a valid corner.
                // Now extend wings.
                const lShapeParts: Feature<Polygon>[] = [cornerPoly];

                // Wing 1: Along Next (bearingNext)
                // Start after corner block + sideSetback? NO, L-shape is continuous usually?
                // Request says: "L should be same as it is and give setbacks now on each 55 m length"
                // So continuous, then broken.
                // So Corner Block is just the start.

                // Let's treat the whole "Next" edge as a line to fill.
                // Start dist = 0 (Corner). 
                // We already filled 0 to cornerSize.
                // Next block starts at cornerSize + sideSetback?
                // IF we want continuous L, there is NO setback at the corner itself.
                // It's one building mass?
                // "setbacks now on each 55 m length" -> Implies strict separation.
                // So Corner Block (approx 25m) is distinct? Or part of the first 55m segment?

                // Let's assume Corner Block is part of Wing A's first segment.
                // Actually, an L-shape is often ONE building.
                // If the user wants setbacks every 55m, it implies the L-shape is BROKEN into multiple buildings forming an L configuration.

                // Sequence along Next Edge:
                // Start at Corner + cornerSize (since we placed corner).
                // Or better: Start at Corner.
                // Segment 1: Corner + extension. Length up to 55m.
                // But turning the corner is hard if we just perform linear cut.

                // Use segmentWing for arms
                // Wing 1 (Next) starts after corner block
                const pNextStart = turf.along(turf.lineString([coords[i], coords[i + 1]]), cornerSize, { units: 'meters' });

                // Construct Wing 1 Polygon (Buffer Edge + Intersect ValidArea)
                try {
                    const edgeNext = turf.lineString([coords[i], coords[i + 1]]);
                    const wingNextRaw = turf.buffer(edgeNext, targetDepth, { units: 'meters' });
                    // @ts-ignore
                    const wingNext = turf.intersect(wingNextRaw, validArea);

                    if (wingNext) {
                        // initialGap=true (default) adds setback from corner block
                        const segs = segmentWing(wingNext as Feature<Polygon>, pNextStart, pNext, params, true);
                        segs.forEach(s => s.properties = { ...s.properties, subtype: 'lshaped', type: 'generated' });
                        lShapeParts.push(...segs);
                    }
                } catch (e) { }

                // Wing 2 (Prev) logic
                // Vector from Corner to Prev
                const vecLine = turf.lineString([coords[i], coords[i === 0 ? coords.length - 2 : i - 1]]);
                const pPrevStart = turf.along(vecLine, cornerSize, { units: 'meters' });
                const pPrevEnd = turf.point(vecLine.geometry.coordinates[1]);

                try {
                    const wingPrevRaw = turf.buffer(vecLine, targetDepth, { units: 'meters' });
                    // @ts-ignore
                    const wingPrev = turf.intersect(wingPrevRaw, validArea);

                    if (wingPrev) {
                        const segs = segmentWing(wingPrev as Feature<Polygon>, pPrevStart, pPrevEnd, params, true);
                        segs.forEach(s => s.properties = { ...s.properties, subtype: 'lshaped', type: 'generated' });
                        lShapeParts.push(...segs);
                    }
                } catch (e) { }

                if (lShapeParts.length >= 2) {
                    // Collect candidate
                    // @ts-ignore
                    const multi = turf.multiPolygon(lShapeParts.map(p => p.geometry.coordinates));
                    const score = turf.area(multi);

                    candidates.push({
                        feature: multi,
                        score,
                        variantId: `L-Corner-${i}-Turn-${validTurn}`,
                        // @ts-ignore
                        parts: lShapeParts
                    } as any);
                }
            }

        } catch (e) { }
    }

    // Pick a diverse candidate (Seeded)
    if (candidates.length > 0) {
        // @ts-ignore
        const parts = selectDiverseCandidate(candidates, params.seed ?? 0);
        // Ensure subtype is set
        // @ts-ignore
        // Apply corner clearance
        const clearedParts = applyCornerClearance(parts as Feature<Polygon>[], 3);
        // Ensure subtype is set
        // @ts-ignore
        clearedParts.forEach(p => p.properties = { ...p.properties, subtype: 'lshaped', type: 'generated' });
        // @ts-ignore
        return clearedParts;
    }

    return [];
}



/**
             * Robust "Perimeter-Aligned" H-Shape Generator
             * 1. Identify "Opposite Edges" (roughly parallel, facing each other).
             * 2. Create "Right/Left Wings" by buffering these edges.
             * 3. Create "Crossbar" by connecting their midpoints.
             */
export function generateHShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const { wingDepth, setback, obstacles } = params;
    console.log(`[generateHShapes] Setbacks -> setback: ${setback}, sideSetback: ${params.sideSetback}`);

    // 1. Valid Area
    // @ts-ignore
    const bufferedPlot = applyVariableSetbacks(plotGeometry, params as AlgoParams);
    if (!bufferedPlot) return [];
    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.00005, highQuality: true });

    // Coords
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    // Depth
    const bbox = turf.bbox(validArea);
    const widthM = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const heightM = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
    const minDim = Math.min(widthM, heightM);
    const targetDepth = Math.max(wingDepth || 14, params.minBuildingWidth || 20); // Default to at least minBuildingWidth
    const safeDepth = Math.min(targetDepth, minDim * 0.35);

    const candidates: { feature: Feature<Polygon | MultiPolygon>, score: number, pairId?: string, parts?: Feature<Polygon>[] }[] = [];

    // Loop through pairs of edges to find "Parallel Opposites"
    // Complexity: O(N^2), but N is small (simplified plot).
    for (let i = 0; i < coords.length - 1; i++) {
        for (let j = i + 2; j < coords.length - 1; j++) { // Skip adjacent
            try {
                const p1 = coords[i];
                const p2 = coords[i + 1];
                const p3 = coords[j];
                const p4 = coords[j + 1];

                const bearing1 = turf.bearing(p1, p2);
                const bearing2 = turf.bearing(p3, p4);

                // Check parallelism (Relax to 45 deg?)
                // H-shapes can accommodate slightly non-parallel sides too.
                let angleDiff = Math.abs(bearing1 - bearing2);
                if (angleDiff > 180) angleDiff = 360 - angleDiff;

                // Ideally parallel edges have angle diff ~0 or ~180 depending on direction.
                // Usually polygon edges traverse in same winding order, so opposite edges are ~180 apart.
                // Relaxed to 45 degrees to find "rotated" views even on weird plots
                const isOpposite = Math.abs(angleDiff - 180) < 45 || Math.abs(angleDiff) < 45;

                if (isOpposite) {
                    const edge1 = turf.lineString([p1, p2]);
                    const edge2 = turf.lineString([p3, p4]);

                    const mid1 = turf.midpoint(p1, p2);
                    const mid2 = turf.midpoint(p3, p4);

                    const distCheck = turf.distance(mid1, mid2, { units: 'meters' });
                    // Must be separated enough to force a crossbar
                    if (distCheck > minDim * 0.3) { // relaxed distance check too

                        // Define Variations to Generate Variety
                        const variations = [
                            { name: 'Standard', offset: 0, depthFactor: 1.0 },
                            { name: 'Thick', offset: 0, depthFactor: 1.5 },   // 24m width requested
                            { name: 'Thin', offset: 0, depthFactor: 0.75 },   // Shrink requested
                            { name: 'Offset Low', offset: -0.2, depthFactor: 1.0 },
                            { name: 'Offset High', offset: 0.2, depthFactor: 1.0 }
                        ];

                        variations.forEach(v => {
                            try {
                                const currentDepth = safeDepth * v.depthFactor;

                                // Construct Wings (Perimeter: Buffer full depth)
                                // @ts-ignore
                                const rawWing1 = turf.buffer(edge1, currentDepth, { units: 'meters', steps: 1 });
                                // @ts-ignore
                                const rawWing2 = turf.buffer(edge2, currentDepth, { units: 'meters', steps: 1 });
                                // @ts-ignore
                                const wing1 = turf.intersect(rawWing1, validArea);
                                // @ts-ignore
                                const wing2 = turf.intersect(rawWing2, validArea);

                                if (wing1 && wing2) {
                                    // Construct Crossbar (Internal: Buffer HALF depth)
                                    // Connect Midpoints with Offset
                                    // Calculate offset point along the edge
                                    const len1 = turf.length(edge1, { units: 'meters' });
                                    // const len2 = turf.length(edge2, { units: 'meters' }); // This line was not used, keeping it as is.

                                    // Offset along edge1 (midpoint is at 0.5)
                                    // Clamp offset so it doesn't go off edge (0.2 to 0.8 safe range)
                                    const secureOffset = Math.max(-0.35, Math.min(0.35, v.offset));
                                    const pt1 = turf.along(edge1, len1 * (0.5 + secureOffset), { units: 'meters' }); // Be careful with direction

                                    // Find corresponding point on edge2? Or just offset similarly?
                                    // If edges are parallel but opposite direction, 0.5 + offset on one matches
                                    // 0.5 - offset on the other if we want them aligned perpendicularly?
                                    // Actually if opposite winding, 0.2 on one corresponds to 0.8 on other spatially.
                                    // Let's project pt1 onto edge2 for robustness.
                                    const pt2 = turf.nearestPointOnLine(edge2, pt1);

                                    const crossLine = turf.lineString([pt1.geometry.coordinates, pt2.geometry.coordinates]);
                                    // FIX: Divide depth by 2 for internal line buffer
                                    // @ts-ignore
                                    const rawCross = turf.buffer(crossLine, currentDepth / 2, { units: 'meters', steps: 1 });
                                    // @ts-ignore
                                    const cross = turf.intersect(rawCross, validArea);

                                    if (cross) {
                                        const hParts: Feature<Polygon>[] = [];

                                        // Segment Wing 1 (axis p1->p2)
                                        if (wing1) {
                                            const segs = segmentWing(wing1 as Feature<Polygon>, turf.point(p1), turf.point(p2), params, false);
                                            segs.forEach(s => s.properties = { ...s.properties, subtype: 'hshaped', type: 'generated' });
                                            hParts.push(...segs);
                                        }

                                        // Segment Wing 2 (axis p3->p4)
                                        if (wing2) {
                                            const segs = segmentWing(wing2 as Feature<Polygon>, turf.point(p3), turf.point(p4), params, false);
                                            segs.forEach(s => s.properties = { ...s.properties, subtype: 'hshaped', type: 'generated' });
                                            hParts.push(...segs);
                                        }

                                        // Segment Crossbar (Trimmed with Gaps)
                                        // Buffer wings OUTWARD by sideSetback to create exclusion zones
                                        const gap = params.sideSetback ?? params.setback ?? 6;
                                        // @ts-ignore
                                        const wing1Buffered = turf.buffer(wing1, gap, { units: 'meters' });
                                        // @ts-ignore
                                        const wing2Buffered = turf.buffer(wing2, gap, { units: 'meters' });
                                        // @ts-ignore
                                        const wingsExclusion = turf.union(wing1Buffered, wing2Buffered);
                                        // @ts-ignore
                                        const crossTrimmed = turf.difference(cross, wingsExclusion);

                                        if (crossTrimmed) {
                                            // Axis: pt1 -> pt2
                                            const segs = segmentWing(crossTrimmed as Feature<Polygon>, pt1, pt2, params, false);
                                            segs.forEach(s => s.properties = { ...s.properties, subtype: 'hshaped', type: 'generated' });
                                            hParts.push(...segs);
                                        }

                                        if (hParts.length > 0) {
                                            // Apply corner clearance to prevent parts from touching
                                            const clearedParts = applyCornerClearance(hParts, 3);

                                            let shape = turf.multiPolygon(clearedParts.map(p => p.geometry.coordinates));

                                            // ENFORCE FOOTPRINT (Massing Compliance)
                                            // @ts-ignore
                                            if (params.maxFootprint) {
                                                const startArea = turf.area(shape);
                                                // @ts-ignore
                                                if (startArea > params.maxFootprint) {
                                                    // Shrink the WHOLE shape if too big
                                                    // @ts-ignore
                                                    const constrained = enforceMaxFootprint(shape, params.maxFootprint);
                                                    if (constrained) {
                                                        // @ts-ignore
                                                        shape = constrained;
                                                    } else {
                                                        return;
                                                    }
                                                }
                                            }

                                            if (shape && turf.area(shape) > 400 && !checkCollision(shape as unknown as Feature<Polygon>, obstacles)) {
                                                let score = 100 + (turf.area(shape) / 100);
                                                if (v.name === 'Standard') score += 10;

                                                // Create a temporary UNION polygon for layout generation
                                                // @ts-ignore
                                                const unionForLayout = turf.union(wing1, wing2, crossTrimmed || cross);

                                                const layout = generateBuildingLayout(unionForLayout as unknown as Feature<Polygon>, {
                                                    subtype: 'hshaped',
                                                    unitMix: params.unitMix,
                                                    alignmentRotation: 0,
                                                    selectedUtilities: params.selectedUtilities
                                                });

                                                shape.properties = {
                                                    type: 'generated', subtype: 'hshaped', area: turf.area(shape),
                                                    cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                                                    scenarioId: `H-Pair-${i}-${j}-${v.name}`,
                                                    pairId: `${i}-${j}`,
                                                    variant: v.name,
                                                    isSplit: true,
                                                    score
                                                };
                                                candidates.push({
                                                    feature: shape,
                                                    score,
                                                    pairId: `${i}-${j}`,
                                                    // @ts-ignore
                                                    parts: hParts
                                                });
                                            }
                                        }
                                    }
                                }
                            } catch (e) {
                                console.error('[H-Shape Debug] Error in candidate loop:', e);
                            }
                        });
                    }
                }
            } catch (e) { }
        }
    }



    if (candidates.length > 0) {
        // @ts-ignore
        const result = selectDiverseCandidate(candidates, params.seed ?? 0);

        return result;
    }

    return [];
}


/**
 * Slab Generator (Rectangular Blocks at Corners/Edges)
 * Replaces generic "Lamella" with specific corner-based logic.
 */
/**
 * Slab Generator (Rectangular Blocks along Edges)
 * Creates discrete elongated slabs centered on plot edges
 */
// Helper to get strip polygon along an edge based on depth
function getStrip(edge: Feature<LineString>, depth: number, plotPoly: Feature<Polygon | MultiPolygon>): Feature<Polygon> | null {
    try {
        const buffered = turf.buffer(edge, depth, { units: 'meters' });
        // @ts-ignore
        const intersect = turf.intersect(buffered, plotPoly);
        return intersect as Feature<Polygon>;
    } catch (e) { return null; }
}

// Helper for deterministic random numbers
function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

export function generateSlabShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        wingDepth, setback, obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        minBuildingLength = 25, maxBuildingLength = 55,
        sideSetback = 6, frontSetback = 12, // Default spacing
        seed = 0
    } = params;

    // DIVERSITY: Strategy based on seed
    const strategy = seed % 3; // 0=Balanced, 1=Dense, 2=Heavy

    // Adjust limits based on strategy, BUT stay within global min/max
    let strategyMinLength = minBuildingLength;
    let strategyMaxLength = maxBuildingLength;
    let strategyMinWidth = minBuildingWidth;
    let strategyMaxWidth = maxBuildingWidth;

    if (strategy === 1) {
        // Dense: Prefer shorter buildings
        strategyMaxLength = Math.min(maxBuildingLength, minBuildingLength + 15); // Cap length
    } else if (strategy === 2) {
        // Heavy: Prefer thicker, longer buildings
        strategyMinWidth = Math.max(minBuildingWidth, maxBuildingWidth - 2); // Force thickness
        strategyMinLength = Math.max(minBuildingLength, 40); // Force length
    }

    console.log(`[SlabGen] Strategy=${strategy}, Limits: W[${strategyMinWidth}-${strategyMaxWidth}] L[${strategyMinLength}-${strategyMaxLength}]`);
    console.log(`[SlabGen] Spacing: Side=${sideSetback}m, Front=${frontSetback}m, Setback=${setback}m`);

    // 1. Valid Area
    // NOTE: The plotGeometry chunk passed in already has setbacks applied from validAreaPoly.
    // We do NOT apply setbacks again here to avoid double-shrinking the available area.
    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;

    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });

    // Coords for edge detection
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];

    // 2. Sequential Placement Logic
    // We basically walk along the longest valid edges and place "Blocks"

    // Get all edges long enough to fit at least one min-building
    const validEdges: { edge: Feature<LineString>, length: number, bearing: number }[] = [];

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = turf.point(coords[i]);
        const p2 = turf.point(coords[i + 1]);
        const length = turf.distance(p1, p2, { units: 'meters' });
        if (length >= strategyMinLength) {
            validEdges.push({
                edge: turf.lineString([coords[i], coords[i + 1]]),
                length,
                bearing: turf.bearing(p1, p2)
            });
        }
    }

    // FALLBACK: If Strategy 2 (Heavy) is too strict and found no edges, relax to global min
    if (validEdges.length === 0 && strategy === 2) {
        console.log(`[SlabGen] Strategy 2 (Heavy) found no edges >= ${strategyMinLength}m. Relaxing to ${minBuildingLength}m...`);
        strategyMinLength = minBuildingLength;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);
            const length = turf.distance(p1, p2, { units: 'meters' });
            if (length >= strategyMinLength) {
                validEdges.push({
                    edge: turf.lineString([coords[i], coords[i + 1]]),
                    length,
                    bearing: turf.bearing(p1, p2)
                });
            }
        }
    }

    console.log(`[Debug SlabGen] Valid Edges Found: ${validEdges.length} (Min Length: ${strategyMinLength}m)`);

    // DIVERSITY: Shuffle edge order based on seed for different layouts
    // Use seed to create deterministic but varied ordering
    const seededRandom = (index: number) => {
        const x = Math.sin(seed + index) * 10000;
        return x - Math.floor(x);
    };

    validEdges.sort((a, b) => {
        if (strategy === 1) {
            // Dense: Shuffle edges for variety
            const weightA = b.length + seededRandom(validEdges.indexOf(a)) * 20;
            const weightB = a.length + seededRandom(validEdges.indexOf(b)) * 20;
            return weightA - weightB;
        } else {
            // Balanced/Heavy: Longest edges first (Standard)
            return b.length - a.length;
        }
    });

    // Try to fill edges
    for (const edgeData of validEdges) {
        let currentDist = 0;
        const totalDist = edgeData.length;

        // Offset for first building from corner?
        // Respect maximum utilization - start as close as possible
        const rowGap = (frontSetback ?? 6) + (params.rearSetback ?? 6);
        const cornerMargin = Math.max(sideSetback ?? 6, 3); // Min 3m margin
        currentDist = cornerMargin;

        const limitDist = totalDist - cornerMargin;
        console.log(`[Debug SlabGen] Edge Dist: ${totalDist.toFixed(1)}m. Start: ${currentDist}m, Limit: ${limitDist.toFixed(1)}m`);

        while (currentDist + strategyMinLength <= limitDist) {
            // Randomize length within allowed range for this block
            const randL = seededRandom(candidates.length + currentDist);
            const maxAvailableLen = Math.min(strategyMaxLength, limitDist - currentDist);
            const actualLength = strategyMinLength + (randL * (maxAvailableLen - strategyMinLength));

            const clearance = 3.5; // Compensation for applyCornerClearance (3m shrink + 0.5m safety)
            const compLength = actualLength + clearance;

            if (currentDist + actualLength > limitDist && candidates.length > 0) {
                console.log(`[Debug SlabGen] Breaking @ ${currentDist.toFixed(1)}m: next block length ${actualLength.toFixed(1)}m exceeds limit ${limitDist.toFixed(1)}m`);
                break;
            } else if (currentDist + actualLength > limitDist) {
                // If it's the first building and it doesn't fit, we have to skip this edge
                break;
            }

            const edgeStart = turf.along(edgeData.edge, currentDist, { units: 'meters' });
            const pStart = edgeStart.geometry.coordinates;

            // Try to place a generic "Stack" of buildings in specific direction?
            // First we need to find the valid "Inward" direction for the FIRST building.
            let validTurn: number | null = null;

            // Randomize depth for this block
            const randW = seededRandom(candidates.length + 99);
            const rawDepth = strategyMinWidth + (randW * (strategyMaxWidth - strategyMinWidth));
            const compDepth = rawDepth + clearance;

            // Probing for direction with first block
            for (const turn of [90, -90]) {
                try {
                    const probe = createRect(pStart, edgeData.bearing, compLength, compDepth, turn);
                    // @ts-ignore
                    const cleanedProbe = turf.buffer(probe, 0);
                    // @ts-ignore
                    const intersect = turf.intersect(cleanedProbe, validArea);

                    const probeArea = turf.area(probe);
                    const intersectArea = intersect ? turf.area(intersect) : 0;

                    if (intersect && intersectArea >= probeArea * 0.60) {
                        validTurn = turn;
                        break;
                    } else {
                        console.log(`[Debug SlabGen] Probe ${turn} failed: ${intersectArea.toFixed(1)} / ${probeArea.toFixed(1)} m²`);
                    }
                } catch (e) {
                    console.warn('[Generator] Probe failed:', e);
                }
            }

            if (validTurn !== null) {
                let depthOffset = 0;
                let rowsAdded = 0;

                // PERIMETER ONLY: Limit to 1 row to avoid internal slabs
                while (rowsAdded < 1) {
                    const currentEdgeStart = turf.destination(
                        turf.point(pStart),
                        depthOffset,
                        edgeData.bearing + (validTurn as number),
                        { units: 'meters' }
                    );

                    let validPoly: Feature<Polygon> | null = null;
                    let winningDepth = 0;

                    // Try current randomized depth first, fallback to min
                    let depthOptions = [rawDepth, strategyMinWidth];

                    for (const d of depthOptions) {
                        try {
                            const cDepth = d + clearance;
                            const poly = createRect(
                                currentEdgeStart.geometry.coordinates,
                                edgeData.bearing,
                                compLength,
                                cDepth,
                                validTurn as number
                            );

                            let intersect = null;
                            try {
                                // @ts-ignore
                                intersect = turf.intersect(poly, validArea);
                            } catch (e) {
                                // @ts-ignore
                                const cleanedPoly = turf.buffer(poly, 0);
                                // @ts-ignore
                                const cleanedArea = turf.buffer(validArea, 0);
                                // @ts-ignore
                                intersect = turf.intersect(cleanedPoly, cleanedArea);
                            }

                            const polyArea = turf.area(poly);
                            if (intersect && turf.area(intersect) >= polyArea * 0.70) {
                                if (!checkCollision(poly, usedAreas)) {
                                    // Clip the building to the valid area to avoid protruding outside
                                    // @ts-ignore
                                    const clipped = turf.intersect(poly, validArea);
                                    if (clipped) {
                                        // Validate clipped dimensions still meet minimums
                                        const bbox = turf.bbox(clipped);
                                        const clippedW = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
                                        const clippedH = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
                                        const clippedMinDim = Math.min(clippedW, clippedH);
                                        const clippedMaxDim = Math.max(clippedW, clippedH);
                                        if (clippedMinDim >= strategyMinWidth && clippedMaxDim >= strategyMinLength) {
                                            validPoly = clipped as Feature<Polygon>;
                                            winningDepth = d;
                                            break;
                                        } else {
                                            console.log(`[Debug SlabGen] Clipped building too small: ${clippedMinDim.toFixed(1)}m x ${clippedMaxDim.toFixed(1)}m (min: ${strategyMinWidth}m x ${strategyMinLength}m). Skipping.`);
                                        }
                                    }
                                } else {
                                    console.log('[Debug SlabGen] Collision blocked placement');
                                }
                            } else {
                                console.log(`[Debug SlabGen] Containment failed: ${intersect ? turf.area(intersect).toFixed(1) : 0} / ${polyArea.toFixed(1)} m²`);
                            }
                        } catch (e) { }
                    }

                    if (validPoly) {
                        const area = turf.area(validPoly);
                        const layout = generateBuildingLayout(validPoly, {
                            subtype: 'slab', unitMix: params.unitMix, alignmentRotation: edgeData.bearing, selectedUtilities: params.selectedUtilities
                        });

                        validPoly.properties = {
                            type: 'generated', subtype: 'slab', area: area,
                            cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                            alignmentRotation: edgeData.bearing,
                            scenarioId: `Slab-Row-${rowsAdded}-Seq-${candidates.length}`,
                            score: area
                        };

                        candidates.push({ feature: validPoly, score: area });
                        usedAreas.push(validPoly);
                        console.log(`[Debug SlabGen] Placed building ${candidates.length}. Size: ${actualLength.toFixed(1)}x${winningDepth.toFixed(1)}m. Area: ${area.toFixed(1)}m²`);

                        depthOffset += winningDepth + rowGap;
                        rowsAdded++;
                    } else {
                        break;
                    }
                }

                if (rowsAdded > 0) {
                    currentDist += actualLength + sideSetback;
                } else {
                    currentDist += 5;
                }
            } else {
                currentDist += 5;
            }
        }
    }


    // Apply clearance to slab collection as well, just in case
    const slabFeatures = candidates.map(c => c.feature);
    return applyCornerClearance(slabFeatures, 3);
}

// Helper
function createRect(startCoord: number[], bearing: number, length: number, depth: number, turnAngle: number): Feature<Polygon> {
    const p1 = turf.point(startCoord);
    const p2 = turf.destination(p1, length, bearing, { units: 'meters' });
    const p3 = turf.destination(p2, depth, bearing + turnAngle, { units: 'meters' });
    const p4 = turf.destination(p1, depth, bearing + turnAngle, { units: 'meters' });

    return turf.polygon([[
        p1.geometry.coordinates,
        p2.geometry.coordinates,
        p3.geometry.coordinates,
        p4.geometry.coordinates,
        p1.geometry.coordinates
    ]]);
}

/**
 * Point Generator (Square Towers at Corners)
 */
export function generatePointShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const {
        wingDepth, setback, obstacles,
        minBuildingWidth = 20, maxBuildingWidth = 25,
        seed = 0
    } = params;

    const strategy = seed % 3; // 0=Mid, 1=Min, 2=Max
    let targetSide = (minBuildingWidth + maxBuildingWidth) / 2;
    if (strategy === 1) targetSide = minBuildingWidth;
    if (strategy === 2) targetSide = maxBuildingWidth;

    // 1. Valid Area
    // NOTE: The plotGeometry chunk passed in already has setbacks applied from validAreaPoly.
    // We do NOT apply setbacks again here to avoid double-shrinking the available area.
    const validArea = plotGeometry as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.000001, highQuality: true });

    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];
    const spacing = params.sideSetback ?? 6; // Use regulation sideSetback as tower gap
    
    // Minimum corner distance constraint to avoid clumping (towers need breathing room at corners)
    const cornerMargin = Math.max(spacing, 6);

    // --- PHASE 1: Corners ---
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const pCurrent = coords[i];
            const pNext = coords[i + 1];
            const bearingNext = turf.bearing(turf.point(pCurrent), turf.point(pNext));

            // Randomize side length for this specific tower
            const rand = seededRandom(i + seed);
            const rawSide = minBuildingWidth + (rand * (maxBuildingWidth - minBuildingWidth));
            const clearance = 3.5;
            const compSide = rawSide + clearance;

            // Try two turn options to find inward direction
            for (const turn of [90, -90]) {
                try {
                    const p1 = turf.point(pCurrent);
                    const p2 = turf.destination(p1, compSide, bearingNext, { units: 'meters' });
                    const p3 = turf.destination(p2, compSide, bearingNext + turn, { units: 'meters' });
                    const p4 = turf.destination(p1, compSide, bearingNext + turn, { units: 'meters' });

                    const poly = turf.polygon([[
                        p1.geometry.coordinates,
                        p2.geometry.coordinates,
                        p3.geometry.coordinates,
                        p4.geometry.coordinates,
                        p1.geometry.coordinates
                    ]]);

                    // @ts-ignore
                    const intersect = turf.intersect(poly, validArea);
                    const polyArea = turf.area(poly);

                    if (intersect && turf.area(intersect) >= polyArea * 0.95) {
                        if (!checkCollision(poly, usedAreas)) {
                            const layout = generateBuildingLayout(poly, {
                                subtype: 'point',
                                unitMix: params.unitMix,
                                alignmentRotation: bearingNext
                            });

                            poly.properties = {
                                type: 'generated', subtype: 'point', area: polyArea,
                                cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                                alignmentRotation: bearingNext,
                                scenarioId: `Point-Corner-${i}`, score: polyArea
                            };
                            candidates.push({ feature: poly, score: polyArea });
                            usedAreas.push(poly);
                            // console.log(`[Debug PointGen] Added corner tower ${i}`);
                            break; // Successfully placed, move to next corner
                        }
                    }
                } catch (e) { }
            }
        } catch (e) { }
    }

    // --- PHASE 2: Edges ---
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);
            const edgeLength = turf.distance(p1, p2, { units: 'meters' });
            const bearing = turf.bearing(p1, p2);

            let currentDist = minBuildingWidth + spacing / 2; // Start closer to corners
            const endDist = edgeLength - (minBuildingWidth + spacing / 2);

            while (currentDist + minBuildingWidth <= endDist) {
                try {
                    const startCoords = turf.along(turf.lineString([coords[i], coords[i + 1]]), currentDist, { units: 'meters' }).geometry.coordinates;
                    let validPoly: Feature<Polygon> | null = null;
                    let winningSide = 0;
                    let winningRawSide = 0;

                    // Randomize side length for this edge tower
                    const rand = seededRandom(i + currentDist + seed);
                    const rawSide = minBuildingWidth + (rand * (maxBuildingWidth - minBuildingWidth));
                    const clearance = 3.5;
                    const compSide = rawSide + clearance;

                    for (const turn of [90, -90]) {
                        const v1 = startCoords;
                        const v2 = turf.destination(turf.point(v1), compSide, bearing, { units: 'meters' }).geometry.coordinates;
                        const v3 = turf.destination(turf.point(v2), compSide, bearing + turn, { units: 'meters' }).geometry.coordinates;
                        const v4 = turf.destination(turf.point(v1), compSide, bearing + turn, { units: 'meters' }).geometry.coordinates;

                        const poly = turf.polygon([[v1, v2, v3, v4, v1]]);
                        // @ts-ignore
                        const intersect = turf.intersect(poly, validArea);
                        if (intersect && turf.area(intersect) >= compSide * compSide * 0.85 && !checkCollision(poly, usedAreas)) {
                            validPoly = poly;
                            winningSide = compSide;
                            winningRawSide = rawSide;
                            break;
                        }
                    }

                    if (validPoly) {
                        const area = turf.area(validPoly);
                        const layout = generateBuildingLayout(validPoly, {
                            subtype: 'point', unitMix: params.unitMix, alignmentRotation: bearing, selectedUtilities: params.selectedUtilities
                        });

                        validPoly.properties = {
                            type: 'generated', subtype: 'point', area: area,
                            cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                            alignmentRotation: bearing,
                            scenarioId: `Point-Edge-${i}-${currentDist.toFixed(0)}`, score: area
                        };
                        candidates.push({ feature: validPoly, score: area });
                        usedAreas.push(validPoly);
                        currentDist += winningRawSide + spacing;
                    } else {
                        currentDist += minBuildingWidth / 2; // Smaller step on failure to find more spots
                    }
                } catch (e) {
                    currentDist += minBuildingWidth / 2;
                }
            }
        } catch (e) { }
    }

    if (candidates.length === 0) {
        console.warn(`[Debug PointGen] No towers generated. Corners: ${coords.length - 1}, Valid Area: ${turf.area(validArea).toFixed(1)}m²`);
    }

    const towerFeatures = candidates.map(c => c.feature);
    return applyCornerClearance(towerFeatures, 3);
}


/**
 * Large-Footprint Generator for Commercial / Public / Industrial
 * Creates 1–4 large rectangular buildings sized by site utilization.
 *
 * Strategy: Create rectangular buildings using coordinate math, place them
 * within the plot, then clip to the plot boundary. No turf.buffer is used.
 *
 *   1 building  → Single rectangle centered in plot
 *   2 buildings → Two rectangles side by side along longer axis
 *   3 buildings → Three rectangles in a row along longer axis
 *   4 buildings → 2×2 grid of rectangles
 */
export function generateLargeFootprint(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams & { buildingCount?: number; mainSetback?: number }
): Feature<Polygon>[] {
    const {
        obstacles,
        sideSetback = 6,
        frontSetback = 6,
        rearSetback = 6,
        roadAccessSides = [],
        maxFootprint,
        seed = 0
    } = params;

    const buildingCount = Math.max(1, Math.min(4, params.buildingCount ?? 2));

    // Get workable polygon
    let workArea: Feature<Polygon>;
    if (plotGeometry.geometry.type === 'MultiPolygon') {
        const largest = ensurePolygonFeature(plotGeometry);
        if (!largest) {
            console.warn('[LargeFootprint] Could not extract Polygon');
            return [];
        }
        workArea = largest;
    } else {
        workArea = plotGeometry as Feature<Polygon>;
    }

    // NOTE: The plotGeometry chunk passed in already has UNIFORM mainSetback applied from validAreaPoly.
    // We do NOT re-apply that uniform setback. BUT we DO need to apply EXTRA directional setbacks
    // for front/rear/side if they differ from mainSetback.
    // E.g., if mainSetback=6m and frontSetback=12m, the chunk is 6m inset on all sides,
    // so we need 6m MORE on the front (road-facing) side.
    const alreadyApplied = (params as any).mainSetback ?? 0;
    const extraFront = Math.max(0, frontSetback - alreadyApplied);
    const extraRear = Math.max(0, rearSetback - alreadyApplied);
    const extraSide = Math.max(0, sideSetback - alreadyApplied);

    console.log(`[LargeFootprint] Processing Directional Setbacks (Targeting: Front ${frontSetback}m, Rear ${rearSetback}m, Sides ${sideSetback}m)`);

    // Apply extra side setback uniformly if needed
    if (extraSide > 0) {
        // @ts-ignore
        const buffered = turf.buffer(workArea, -extraSide / 1000, { units: 'kilometers' });
        if (buffered) {
            const poly = ensurePolygonFeature(buffered);
            if (poly) {
                workArea = poly;
                console.log(`[LargeFootprint] Applied extra side setback: ${extraSide}m`);
            }
        }
    }

    // Apply extra front/rear setback via bbox clipping (direction-aware)
    if ((extraFront > 0 || extraRear > 0) && roadAccessSides.length > 0) {
        const wBbox = turf.bbox(workArea);
        const [wMinX, wMinY, wMaxX, wMaxY] = wBbox;

        // Identify front (road-facing) and rear (opposite) sides
        const frontSides = new Set(roadAccessSides.map((s: string) => s.charAt(0).toUpperCase()));
        const rearSidesSet = new Set<string>();
        frontSides.forEach(s => {
            if (s === 'N') rearSidesSet.add('S');
            if (s === 'S') rearSidesSet.add('N');
            if (s === 'E') rearSidesSet.add('W');
            if (s === 'W') rearSidesSet.add('E');
        });
        // If a side is both front and rear (corner plot), front wins
        frontSides.forEach(s => rearSidesSet.delete(s));

        // Cut helper: translate the polygon away from the edge, then intersect!
        // This is a mathematically elegant way to offset specific edges even on angled plots.
        const cutEdge = (edge: string, distance: number) => {
            if (distance <= 0) return;
            
            // Determine direction to shift AWAY from the edge
            let bearing = 0;
            switch (edge) {
                case 'N': bearing = 180; break; // Shift South
                case 'S': bearing = 0; break;   // Shift North
                case 'E': bearing = 270; break; // Shift West
                case 'W': bearing = 90; break;  // Shift East
            }

            try {
                // @ts-ignore
                const shifted = turf.transformTranslate(workArea, distance, bearing, { units: 'meters' });
                // @ts-ignore
                const result = turf.intersect(workArea, shifted);
                
                if (result) {
                    const poly = ensurePolygonFeature(result);
                    if (poly) {
                        workArea = poly;
                        console.log(`[LargeFootprint] Set back ${edge} edge by ${distance}m (Total from boundary: ${(alreadyApplied + distance).toFixed(1)}m)`);
                    }
                }
            } catch (e) {
                console.warn(`[LargeFootprint] Failed to cut ${edge} edge via translate:`, e);
            }
        };

        // Apply front setback cuts (road-facing sides)
        frontSides.forEach(s => cutEdge(s, extraFront));
        // Apply rear setback cuts (opposite to road)
        rearSidesSet.forEach(s => cutEdge(s, extraRear));

        console.log(`[LargeFootprint] After directional setbacks, area=${turf.area(workArea).toFixed(0)}m²`);
    }

    const plotArea = turf.area(workArea);
    const bbox = turf.bbox(workArea);
    const [minLng, minLat, maxLng, maxLat] = bbox;

    // Meter ↔ degree conversion factors for this location
    const widthM = turf.distance([minLng, minLat], [maxLng, minLat], { units: 'meters' });
    const heightM = turf.distance([minLng, minLat], [minLng, maxLat], { units: 'meters' });

    if (widthM < 10 || heightM < 10) {
        console.warn('[LargeFootprint] Plot too narrow');
        return [];
    }

    const degPerMLng = (maxLng - minLng) / widthM;
    const degPerMLat = (maxLat - minLat) / heightM;

    // Centroid of workArea
    const centroid = turf.centroid(workArea);
    const [cLng, cLat] = centroid.geometry.coordinates;

    // --- Continuous seed-based variation (unlimited scenarios) ---
    const sr = (offset: number) => {
        const x = Math.sin((seed + offset) * 9.8765) * 10000;
        return x - Math.floor(x); // 0..1
    };

    // Determine layout direction using seed for continuous variation
    const baseSplitAlongWidth = widthM >= heightM;
    const aspectRatio = Math.max(widthM, heightM) / Math.min(widthM, heightM);
    
    // Use seed to decide: flip axis? (probability-based for continuous variation)
    let splitAlongWidth = baseSplitAlongWidth;
    if (aspectRatio < 2.5 && sr(1) > 0.5) {
        splitAlongWidth = !baseSplitAlongWidth; // 50% chance to flip if aspect allows
    }

    // Gap multiplier: continuous range 1x to 3x based on seed
    const gapMultiplier = 1 + sr(2) * 2; // 1.0 to 3.0 continuous

    // Inter-building gap
    const gapXM = Math.max(sideSetback * gapMultiplier, 3 * gapMultiplier);
    const gapYM = Math.max(sideSetback * gapMultiplier, 3 * gapMultiplier);
    
    // We need both because for 4 buildings, it splits both ways
    const gapLng = widthM > 0 ? (maxLng - minLng) * (gapXM / widthM) : 0;
    const gapLat = heightM > 0 ? (maxLat - minLat) * (gapYM / heightM) : 0;

    console.log(`[LargeFootprint] START: count=${buildingCount}, seed=${seed}, splitAlong=${splitAlongWidth ? 'width' : 'height'}, gapM=${gapMultiplier.toFixed(2)}`);
    console.log(`[LargeFootprint] Bbox: ${widthM.toFixed(0)}×${heightM.toFixed(0)}m, gapX=${gapXM.toFixed(1)}m, gapY=${gapYM.toFixed(1)}m`);

    const createFallbackRect = (cx: number, cy: number, wM: number, hM: number): Feature<Polygon> => {
        const halfW = (wM / 2) * degPerMLng;
        const halfH = (hM / 2) * degPerMLat;
        return turf.polygon([[
            [cx - halfW, cy - halfH],
            [cx + halfW, cy - halfH],
            [cx + halfW, cy + halfH],
            [cx - halfW, cy + halfH],
            [cx - halfW, cy - halfH],
        ]]);
    };

    const slicePolygonToArea = (poly: Feature<Polygon>, targetArea: number, direction: 'N' | 'S' | 'E' | 'W'): Feature<Polygon> => {
        const totalA = turf.area(poly);
        if (targetArea >= totalA * 0.99) return poly;
        
        const b = turf.bbox(poly);
        const huge = 1000;
        let low = (direction === 'N' || direction === 'S') ? b[1] : b[0];
        let high = (direction === 'N' || direction === 'S') ? b[3] : b[2];
        
        let bestPoly = poly;
        
        for (let i = 0; i < 25; i++) {
            const current = (low + high) / 2;
            let cutter: Feature<Polygon>;
            if (direction === 'N') cutter = turf.bboxPolygon([b[0] - huge, current, b[2] + huge, b[3] + huge]);
            else if (direction === 'S') cutter = turf.bboxPolygon([b[0] - huge, b[1] - huge, b[2] + huge, current]);
            else if (direction === 'E') cutter = turf.bboxPolygon([current, b[1] - huge, b[2] + huge, b[3] + huge]);
            else cutter = turf.bboxPolygon([b[0] - huge, b[1] - huge, current, b[3] + huge]);
            
            try {
                // @ts-ignore
                const intersected = turf.intersect(poly, cutter);
                if (!intersected) {
                    if (direction === 'N' || direction === 'E') high = current; else low = current;
                    continue;
                }
                
                let resPoly: Feature<Polygon> | null = null;
                if (intersected.geometry.type === 'Polygon') resPoly = intersected as Feature<Polygon>;
                else if (intersected.geometry.type === 'MultiPolygon') {
                    // @ts-ignore
                    const parts = turf.flatten(intersected);
                    resPoly = parts.features.sort((x: any, y: any) => turf.area(y) - turf.area(x))[0];
                }
                if (!resPoly) continue;
                
                const area = turf.area(resPoly);
                bestPoly = resPoly;
                
                if (Math.abs(area - targetArea) < targetArea * 0.02) break;
                
                if (direction === 'N' || direction === 'E') {
                    if (area > targetArea) low = current; else high = current;
                } else {
                    if (area > targetArea) high = current; else low = current;
                }
            } catch (e) {
                break;
            }
        }
        bestPoly.properties = { ...bestPoly.properties, skipScale: true };
        return bestPoly;
    };

    // Helper: clip workArea by a bbox and return all valid Polygon pieces
    const clipShapeToBbox = (clipBbox: [number, number, number, number], label: string): Feature<Polygon>[] => {
        const results: Feature<Polygon>[] = [];
        try {
            const clipPoly = turf.bboxPolygon(clipBbox);
            // @ts-ignore
            const clipped = turf.intersect(workArea, clipPoly);
            if (clipped) {
                if (clipped.geometry.type === 'Polygon') {
                    results.push(clipped as Feature<Polygon>);
                } else if (clipped.geometry.type === 'MultiPolygon') {
                    // @ts-ignore
                    const parts = turf.flatten(clipped);
                    let maxArea = 0;
                    let bestPart: Feature<Polygon> | null = null;
                    parts.features.forEach((f: Feature<Polygon>) => {
                        const a = turf.area(f);
                        if (a > maxArea && a > 10) {
                            maxArea = a;
                            bestPart = f;
                        }
                    });
                    if (bestPart) results.push(bestPart);
                }
                console.log(`[LargeFootprint] ${label}: ${results.length} pieces, total area=${results.reduce((s, f) => s + turf.area(f), 0).toFixed(0)}m²`);
            } else {
                console.warn(`[LargeFootprint] ${label}: no intersection`);
            }
        } catch (e) {
            console.error(`[LargeFootprint] ${label}: clip error`, e);
        }
        return results;
    };

    // Generate plot-shaped building footprints
    let rawBuildings: Feature<Polygon>[] = [];

    const totalTarget = maxFootprint ?? (plotArea * 0.5);
    const perBuildingTarget = totalTarget / buildingCount;

    if (buildingCount === 1) {
        // 7 variations for 1 building, cycling with seed
        // 0=Center(buffer), 1=Front, 2=Rear, 3=Left, 4=Right, 5=Front-Left, 6=Front-Right
        const variation = seed % 7;

        console.log(`[LargeFootprint] 1 building: variation=${variation}, plotArea=${plotArea.toFixed(0)}m², target=${perBuildingTarget.toFixed(0)}m²`);
        
        let frontEdge = 'S';
        if (roadAccessSides && roadAccessSides.length > 0) {
            frontEdge = roadAccessSides[0].charAt(0).toUpperCase();
        }

        // Map directions based on front edge
        const dirMap: Record<string, Record<string, 'N'|'S'|'E'|'W'>> = {
            'S': { front: 'S', rear: 'N', left: 'W', right: 'E' },
            'N': { front: 'N', rear: 'S', left: 'E', right: 'W' },
            'E': { front: 'E', rear: 'W', left: 'N', right: 'S' },
            'W': { front: 'W', rear: 'E', left: 'S', right: 'N' },
        };
        const dirs = dirMap[frontEdge] || dirMap['S'];

        if (variation === 0) {
            // Centered: use buffer inset (follows plot shape!)
            rawBuildings.push(workArea);
            // Will be scaled with buffer below
        } else if (variation === 1) {
            // Hug front edge
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.front));
        } else if (variation === 2) {
            // Hug rear edge
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.rear));
        } else if (variation === 3) {
            // Hug left side
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.left));
        } else if (variation === 4) {
            // Hug right side
            rawBuildings.push(slicePolygonToArea(workArea, perBuildingTarget, dirs.right));
        } else if (variation === 5) {
            // Front-left corner: slice front then slice left
            const frontSlice = slicePolygonToArea(workArea, plotArea * 0.7, dirs.front);
            rawBuildings.push(slicePolygonToArea(frontSlice, perBuildingTarget, dirs.left));
        } else {
            // Front-right corner: slice front then slice right
            const frontSlice = slicePolygonToArea(workArea, plotArea * 0.7, dirs.front);
            rawBuildings.push(slicePolygonToArea(frontSlice, perBuildingTarget, dirs.right));
        }

    } else if (buildingCount <= 3) {
        // 6 distinct strategies for 2-3 buildings, cycling with seed
        const strategy = seed % 6;
        
        // Decide axis and proportions based on strategy
        let useWidth = baseSplitAlongWidth;
        let splitRatios: number[] = []; // Proportional sizes for each building
        let stratGapMul = 1;
        
        switch (strategy) {
            case 0: // Natural axis, equal splits
                useWidth = baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                break;
            case 1: // Opposite axis, equal splits (flipped direction)
                useWidth = aspectRatio < 2.5 ? !baseSplitAlongWidth : baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                break;
            case 2: // Natural axis, unequal (60/40 or 50/25/25)
                useWidth = baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.6, 0.4] : [0.5, 0.25, 0.25];
                break;
            case 3: // Opposite axis, unequal
                useWidth = aspectRatio < 2.5 ? !baseSplitAlongWidth : baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.4, 0.6] : [0.25, 0.5, 0.25];
                break;
            case 4: // Natural axis, extra wide gap
                useWidth = baseSplitAlongWidth;
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                stratGapMul = 3;
                break;
            case 5: // Short axis, equal splits (bars across the narrow width)
                useWidth = !baseSplitAlongWidth; // Force opposite of natural
                splitRatios = buildingCount === 2 ? [0.5, 0.5] : [0.33, 0.34, 0.33];
                stratGapMul = 1.5;
                break;
        }
        
        console.log(`[LargeFootprint] ${buildingCount} buildings: strategy=${strategy}, axis=${useWidth ? 'width' : 'height'}, ratios=[${splitRatios}], gapMul=${stratGapMul}`);

        // Strip-based splitting
        const localGapLng = widthM > 0 ? (maxLng - minLng) * (Math.max(sideSetback * stratGapMul, 3 * stratGapMul) / widthM) : 0;
        const localGapLat = heightM > 0 ? (maxLat - minLat) * (Math.max(sideSetback * stratGapMul, 3 * stratGapMul) / heightM) : 0;

        for (let i = 0; i < buildingCount; i++) {
            let clipBbox: [number, number, number, number];
                const ratio = splitRatios[i] || (1 / buildingCount);
                
                // Calculate cumulative start position
                const prevRatioSum = splitRatios.slice(0, i).reduce((a, b) => a + b, 0);

                if (useWidth) {
                    const totalUsable = maxLng - minLng - localGapLng * (buildingCount - 1);
                    const stripW = totalUsable * ratio;
                    const sLng = minLng + prevRatioSum * totalUsable + i * localGapLng;
                    const eLng = sLng + stripW;
                    clipBbox = [sLng, minLat - 0.01, eLng, maxLat + 0.01];
                } else {
                    const totalUsable = maxLat - minLat - localGapLat * (buildingCount - 1);
                    const stripH = totalUsable * ratio;
                    const sLat = minLat + prevRatioSum * totalUsable + i * localGapLat;
                    const eLat = sLat + stripH;
                    clipBbox = [minLng - 0.01, sLat, maxLng + 0.01, eLat];
                }

                const pieces = clipShapeToBbox(clipBbox, `Strip${i}`);
                if (pieces.length > 0) {
                    rawBuildings.push(...pieces);
                } else {
                    console.warn(`[LargeFootprint] Strip ${i}: clip failed, using fallback rectangle`);
                    const cx = useWidth ? (clipBbox[0] + clipBbox[2]) / 2 : cLng;
                    const cy = useWidth ? cLat : (clipBbox[1] + clipBbox[3]) / 2;
                    const fw = useWidth ? (clipBbox[2] - clipBbox[0]) / degPerMLng * 0.9 : widthM * 0.8;
                    const fh = useWidth ? heightM * 0.8 : (clipBbox[3] - clipBbox[1]) / degPerMLat * 0.9;
                    rawBuildings.push(createFallbackRect(cx, cy, fw, fh));
                }
            }
    } else {
        // 4 buildings: 2×2 grid using quadrant clips
        // Continuous crosshair offset based on seed
        const hShift = (sr(4) - 0.5) * 0.3; // -0.15 to +0.15 of range
        const vShift = (sr(5) - 0.5) * 0.3;
        
        let midLng = (minLng + maxLng) / 2 + hShift * (maxLng - minLng);
        let midLat = (minLat + maxLat) / 2 + vShift * (maxLat - minLat);
        
        const halfGapLng = gapLng / 2;
        const halfGapLat = gapLat / 2;

        const quadrants: { bbox: [number, number, number, number], label: string }[] = [
            { bbox: [minLng - 0.01, minLat - 0.01, midLng - halfGapLng, midLat - halfGapLat], label: 'SW' },
            { bbox: [midLng + halfGapLng, minLat - 0.01, maxLng + 0.01, midLat - halfGapLat], label: 'SE' },
            { bbox: [minLng - 0.01, midLat + halfGapLat, midLng - halfGapLng, maxLat + 0.01], label: 'NW' },
            { bbox: [midLng + halfGapLng, midLat + halfGapLat, maxLng + 0.01, maxLat + 0.01], label: 'NE' },
        ];

        for (const q of quadrants) {
            const pieces = clipShapeToBbox(q.bbox, q.label);
            if (pieces.length > 0) {
                rawBuildings.push(...pieces);
            } else {
                const cx = (q.bbox[0] + q.bbox[2]) / 2;
                const cy = (q.bbox[1] + q.bbox[3]) / 2;
                rawBuildings.push(createFallbackRect(cx, cy, widthM * 0.35, heightM * 0.35));
            }
        }
    }

    console.log(`[LargeFootprint] Generated ${rawBuildings.length} plot-shaped footprints`);

    // Scale footprints to match target area — use buffer inset (follows plot shape!)
    const scaledBuildings: Feature<Polygon>[] = [];
    rawBuildings.forEach((poly, idx) => {
        try {
            // Skip scaling for sliced polygons (already sized correctly)
            if (poly.properties?.skipScale) {
                scaledBuildings.push(poly);
                console.log(`[LargeFootprint] Piece ${idx} kept at ${turf.area(poly).toFixed(0)}m² (pre-sliced)`);
                return;
            }

            const currentArea = turf.area(poly);
            if (currentArea > perBuildingTarget * 1.05) {
                // Use binary search with turf.buffer for plot-conforming shrink
                let lo = 0, hi = Math.min(widthM, heightM) / 2;
                let bestBuf: any = poly;

                for (let iter = 0; iter < 20; iter++) {
                    const mid = (lo + hi) / 2;
                    // @ts-ignore
                    const buffered = turf.buffer(poly, -mid, { units: 'meters' });
                    if (!buffered) { hi = mid; continue; }
                    
                    const bArea = turf.area(buffered);
                    if (bArea < perBuildingTarget * 0.1) { hi = mid; continue; } // Too small
                    
                    bestBuf = buffered as Feature<Polygon>;
                    
                    if (Math.abs(bArea - perBuildingTarget) < perBuildingTarget * 0.03) break;
                    
                    if (bArea > perBuildingTarget) lo = mid; else hi = mid;
                }

                // Ensure it's a Polygon (buffer can return MultiPolygon)
                let finalPoly: Feature<Polygon>;
                if (bestBuf.geometry.type === 'MultiPolygon') {
                    // @ts-ignore
                    const parts = turf.flatten(bestBuf);
                    finalPoly = parts.features.sort((a: any, b: any) => turf.area(b) - turf.area(a))[0];
                } else {
                    finalPoly = bestBuf as Feature<Polygon>;
                }

                scaledBuildings.push(finalPoly);
                console.log(`[LargeFootprint] Piece ${idx} buffer-shrunk: ${currentArea.toFixed(0)}m² -> ${turf.area(finalPoly).toFixed(0)}m² (target ${perBuildingTarget.toFixed(0)}m²)`);
            } else {
                scaledBuildings.push(poly);
                console.log(`[LargeFootprint] Piece ${idx} kept at ${currentArea.toFixed(0)}m² (target was ${perBuildingTarget.toFixed(0)}m²)`);
            }
        } catch (e) {
            console.warn(`[LargeFootprint] Failed to scale piece ${idx}, using original`, e);
            scaledBuildings.push(poly);
        }
    });

    // Set properties for each building
    const finalBuildings: Feature<Polygon>[] = [];
    scaledBuildings.forEach((poly: Feature<Polygon>, idx: number) => {
        try {
            const area = turf.area(poly);
            const coords = poly.geometry.coordinates[0];
            let maxEdgeLen = 0;
            let alignBearing = 0;
            for (let j = 0; j < coords.length - 1; j++) {
                const len = turf.distance(coords[j], coords[j + 1], { units: 'meters' });
                if (len > maxEdgeLen) {
                    maxEdgeLen = len;
                    alignBearing = turf.bearing(coords[j], coords[j + 1]);
                }
            }

            poly.properties = {
                type: 'generated',
                subtype: 'large-footprint',
                area,
                cores: [],
                units: [],
                entrances: [],
                internalUtilities: [],
                alignmentRotation: alignBearing,
                scenarioId: `LargeFootprint-${buildingCount}-${idx}`,
                score: area
            };

            // Try layout generation
            try {
                const layout = generateBuildingLayout(poly, {
                    subtype: 'large-footprint',
                    unitMix: params.unitMix,
                    alignmentRotation: alignBearing
                });
                if (layout) {
                    poly.properties.cores = layout.cores;
                    poly.properties.units = layout.units;
                    poly.properties.entrances = layout.entrances;
                    poly.properties.internalUtilities = layout.utilities;
                }
            } catch (layoutErr) {
                console.warn(`[LargeFootprint] Layout gen failed for building ${idx}`);
            }

            finalBuildings.push(poly);
        } catch (e) {
            console.error(`[LargeFootprint] Error for building ${idx}:`, e);
        }
    });

    console.log(`[LargeFootprint] FINAL: ${finalBuildings.length}/${buildingCount} buildings. Total footprint: ${finalBuildings.reduce((s, b) => s + turf.area(b), 0).toFixed(0)}m²`);

    return finalBuildings;
}

/** Helper: ensure a GeoJSON feature is a single Polygon */
function ensurePolygonFeature(f: any): Feature<Polygon> | null {
    if (!f || !f.geometry) return null;
    if (f.geometry.type === 'Polygon') return f as Feature<Polygon>;
    if (f.geometry.type === 'MultiPolygon') {
        try {
            // @ts-ignore
            const parts = turf.flatten(f);
            let best: Feature<Polygon> | null = null;
            let bestArea = 0;
            parts.features.forEach((p: any) => {
                const a = turf.area(p);
                if (a > bestArea) {
                    bestArea = a;
                    best = p as Feature<Polygon>;
                }
            });
            return best;
        } catch (e) {
            if (f.geometry.coordinates && f.geometry.coordinates.length > 0) {
                return turf.polygon(f.geometry.coordinates[0]) as Feature<Polygon>;
            }
        }
    }
    return null;
}

