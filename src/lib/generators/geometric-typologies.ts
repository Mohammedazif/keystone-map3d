import * as turf from '@turf/turf';
import { generateBuildingLayout } from './layout-generator';
import { Feature, Polygon, MultiPolygon, Point, LineString } from 'geojson';
import { UnitTypology } from '../types';
import { applyVariableSetbacks } from './setback-utils';
import { AlgoParams } from './basic-generator';

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
    const targetDepth = Math.max(wingDepth || 14, params.minBuildingWidth || 20); // Default to at least minBuildingWidth
    const safeDepth = Math.min(targetDepth, minDim * 0.35);

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
        // Add subtype
        // @ts-ignore
        parts.forEach(p => p.properties = { ...p.properties, subtype: 'ushaped', type: 'generated' });
        // @ts-ignore
        return parts;
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
    const targetDepth = maxBuildingWidth;

    // Loop edges to find T-Junction spots
    for (let i = 0; i < coords.length - 1; i++) {
        try {
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
                // Return MultiPolygon
                const multi = turf.multiPolygon(tParts.map(p => p.geometry.coordinates));

                // 4. ENFORCE FOOTPRINT
                const enforced = enforceMaxFootprint(multi, params.maxFootprint, params.minFootprint);

                if (enforced) {
                    // Tag parts
                    tParts.forEach(p => p.properties = { ...p.properties, subtype: 'tshaped', type: 'generated' });

                    // @ts-ignore
                    candidates.push({
                        feature: enforced,
                        score: turf.area(enforced),
                        variantId: `T-Edge-${i}`,
                        parts: tParts
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
    const { maxBuildingLength = 55, sideSetback = 6, minBuildingLength = 15, minBuildingWidth = 10 } = params;

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
    const targetDepth = maxBuildingWidth; // Try max width first

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];

    // Loop through corners to find valid L-junctions
    for (let i = 0; i < coords.length - 1; i++) {
        try {
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
        parts.forEach(p => p.properties = { ...p.properties, subtype: 'lshaped', type: 'generated' });
        // @ts-ignore
        return parts;
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
                                            let shape = turf.multiPolygon(hParts.map(p => p.geometry.coordinates));

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
                                                    alignmentRotation: 0
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
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];
    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;

    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.00005, highQuality: true });

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
        if (length >= minBuildingLength) {
            validEdges.push({
                edge: turf.lineString([coords[i], coords[i + 1]]),
                length,
                bearing: turf.bearing(p1, p2)
            });
        }
    }

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

        // Offset for first building from corner? Maybe half side setback?
        currentDist += sideSetback / 2;

        // Multi-row logic: Try to fill depth-wise as well
        const rowGap = (frontSetback ?? 6) + (params.rearSetback ?? 6);

        while (currentDist + strategyMinLength <= totalDist) {
            const targetLength = Math.min(strategyMaxLength, totalDist - currentDist);
            const actualLength = Math.max(strategyMinLength, targetLength);

            if (currentDist + actualLength > totalDist) break;

            const edgeStart = turf.along(edgeData.edge, currentDist, { units: 'meters' });
            const p1 = edgeStart.geometry.coordinates;

            // Try to place a generic "Stack" of buildings in specific direction?
            // First we need to find the valid "Inward" direction for the FIRST building.
            let validTurn: number | null = null;
            let firstDepth = strategyMaxWidth; // Default to max

            // Adjust depth based on strategy
            if (strategy === 1) firstDepth = strategyMinWidth; // Prefer thin for Dense

            // Probing for direction with first block
            for (const turn of [90, -90]) {
                const probe = createRect(p1, edgeData.bearing, actualLength, firstDepth, turn);
                // @ts-ignore
                const intersect = turf.intersect(probe, validArea);
                // Check if intersection area is basically same as probe area (99% match to account for float errors)
                if (intersect && turf.area(intersect) >= turf.area(probe) * 0.99) {
                    validTurn = turn;
                    break;
                }
            }

            if (validTurn !== null) {
                // We have a valid direction. Now try to stack rows inward.
                let depthOffset = 0;
                let rowsAdded = 0;

                // PERIMETER ONLY: Limit to 1 row to avoid internal slabs
                while (rowsAdded < 1) {
                    const currentEdgeStart = turf.destination(
                        turf.point(p1),
                        depthOffset,
                        edgeData.bearing + validTurn,
                        { units: 'meters' }
                    );

                    let validPoly: Feature<Polygon> | null = null;

                    // Priority Order based on Strategy
                    let depthOptions = [strategyMaxWidth, strategyMinWidth];
                    // If Dense (1), prefer min depth first
                    if (strategy === 1) depthOptions = [strategyMinWidth, strategyMaxWidth];

                    // Try Depth Options
                    for (const depth of depthOptions) {
                        try {
                            const poly = createRect(
                                currentEdgeStart.geometry.coordinates,
                                edgeData.bearing,
                                actualLength,
                                depth,
                                validTurn
                            );

                            // Check valid area AND non-collision
                            // Use Strict Containment via Intersection
                            // @ts-ignore
                            const intersect = turf.intersect(poly, validArea);
                            const polyArea = turf.area(poly);

                            // 99% containment check
                            if (intersect && turf.area(intersect) >= polyArea * 0.99 && !checkCollision(poly, usedAreas)) {
                                validPoly = poly;
                                break; // Found biggest valid for this slot
                            }
                        } catch (e) { }
                    }

                    if (validPoly) {
                        // Place Building
                        const area = turf.area(validPoly);
                        const layout = generateBuildingLayout(validPoly, {
                            subtype: 'slab',
                            unitMix: params.unitMix,
                            alignmentRotation: edgeData.bearing
                        });

                        validPoly.properties = {
                            type: 'generated', subtype: 'slab', area: area,
                            cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                            scenarioId: `Slab-Row-${rowsAdded}-Seq-${candidates.length}`,
                            score: area
                        };

                        candidates.push({ feature: validPoly, score: area });
                        usedAreas.push(validPoly);

                        // Advance Depth
                        // Determine actual depth used
                        const b = turf.bbox(validPoly);
                        // Approximate depth based on area/length? 
                        // Or just reuse the loop var if we knew which one won.
                        // Let's re-measure relative to bearing?
                        // Simple way: check area / actualLength
                        const usedDepth = area / actualLength;

                        depthOffset += usedDepth + rowGap;
                        rowsAdded++;
                    } else {
                        // Blocked. Stop this column/stack.
                        break;
                    }
                }

                // If we placed at least one, advance Dist. 
                // If we placed ZERO (even first failed), we might still advance or break?
                if (rowsAdded > 0) {
                    currentDist += actualLength + sideSetback;
                } else {
                    currentDist += 5; // Skip small bit if totally invalid
                }
            } else {
                currentDist += 5; // Invalid turn
            }
        }
    }


    return candidates.map(c => c.feature);
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
        minBuildingWidth = 20, maxBuildingWidth = 25, // Default params
        seed = 0
    } = params;

    const strategy = seed % 3; // 0=Mid, 1=Min, 2=Max

    // Point Dimensions: Use Params!
    let targetSide = (minBuildingWidth + maxBuildingWidth) / 2;
    if (strategy === 1) targetSide = minBuildingWidth;
    if (strategy === 2) targetSide = maxBuildingWidth;

    // ... existing valid area logic ... 

    // 1. Valid Area
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];
    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.00005, highQuality: true });

    // Coords
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const usedAreas: Feature<Polygon>[] = [...(obstacles || [])];
    const spacing = 15; // Minimum spacing between towers

    // Loop through Corner Vertices
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const pCurrent = coords[i];

            // Point Dimensions: Use Params!
            // Strategy 0: Mid (Avg of min/max)
            // Strategy 1: Min (minBuildingWidth)
            // Strategy 2: Max (maxBuildingWidth)

            // targetSide is now defined at function scope

            const variations = [
                { name: 'Selected', side: targetSide }
            ];

            // Try aligning with Angle Bisector to fit into corner?
            // Or just align to edges like Slab?
            // Aligning to edges is safer.

            const pNext = coords[i + 1];
            const pCurrentPoint = turf.point(pCurrent);
            const pNextPoint = turf.point(pNext);
            const bearingNext = turf.bearing(pCurrentPoint, pNextPoint);

            variations.forEach(v => {
                // Try placing square at corner aligned with Next Edge
                [90, -90].forEach(turn => {
                    try {
                        // @ts-ignore
                        const v1 = pCurrentPoint;
                        // @ts-ignore
                        const v2 = turf.destination(pCurrentPoint, v.side, bearingNext, { units: 'meters' });
                        // @ts-ignore
                        const v3 = turf.destination(v2, v.side, bearingNext + turn, { units: 'meters' });
                        // @ts-ignore
                        const v4 = turf.destination(v1, v.side, bearingNext + turn, { units: 'meters' });

                        const poly = turf.polygon([[
                            v1.geometry.coordinates,
                            v2.geometry.coordinates,
                            v3.geometry.coordinates,
                            v4.geometry.coordinates,
                            v1.geometry.coordinates
                        ]]);

                        // Check Center Inside
                        // @ts-ignore
                        if (turf.booleanPointInPolygon(turf.centroid(poly), validArea)) {
                            // @ts-ignore
                            const intersect = turf.intersect(poly, validArea);
                            if (intersect && turf.area(intersect) > v.side * v.side * 0.8) {
                                if (!checkCollision(intersect as Feature<Polygon>, usedAreas)) {
                                    const layout = generateBuildingLayout(intersect as Feature<Polygon>, {
                                        subtype: 'point',
                                        unitMix: params.unitMix,
                                        alignmentRotation: bearingNext
                                    });

                                    intersect.properties = {
                                        type: 'generated', subtype: 'point', area: turf.area(intersect),
                                        cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                                        scenarioId: `Point-Corner-${i}-${v.name}`, score: turf.area(intersect)
                                    };
                                    candidates.push({ feature: intersect as Feature<Polygon>, score: turf.area(intersect), variantId: `Corner-${i}` });
                                    usedAreas.push(intersect as Feature<Polygon>);
                                }
                            }
                        }
                    } catch (e) { }
                });
            });
        } catch (e) { }
    }

    // --- PHASE 2: Edges ---
    // Iterate edges again to fill gaps
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);
            const edgeLength = turf.distance(p1, p2, { units: 'meters' });
            const bearing = turf.bearing(p1, p2);

            // Start after potential corner tower (approx targetSide + spacing)
            let currentDist = targetSide + spacing;
            // Stop before next corner
            const endDist = edgeLength - (targetSide + spacing);

            while (currentDist + targetSide <= endDist) {
                try {
                    // Try to place a tower along the edge
                    const startPt = turf.along(turf.lineString([coords[i], coords[i + 1]]), currentDist, { units: 'meters' });

                    // Try inward turn (90 or -90)
                    let validPoly: Feature<Polygon> | null = null;

                    for (const turn of [90, -90]) {
                        // @ts-ignore
                        const v1 = startPt.geometry.coordinates;
                        // @ts-ignore
                        const v2 = turf.destination(startPt, targetSide, bearing, { units: 'meters' }).geometry.coordinates;
                        // @ts-ignore
                        const v3 = turf.destination(turf.point(v2), targetSide, bearing + turn, { units: 'meters' }).geometry.coordinates;
                        // @ts-ignore
                        const v4 = turf.destination(startPt, targetSide, bearing + turn, { units: 'meters' }).geometry.coordinates;

                        const poly = turf.polygon([[v1, v2, v3, v4, v1]]);

                        // Check validity
                        // @ts-ignore
                        if (turf.booleanPointInPolygon(turf.centroid(poly), validArea)) {
                            // @ts-ignore
                            const intersect = turf.intersect(poly, validArea);
                            if (intersect && turf.area(intersect) > targetSide * targetSide * 0.9) {
                                if (!checkCollision(intersect as Feature<Polygon>, usedAreas)) {
                                    validPoly = intersect as Feature<Polygon>;
                                    break;
                                }
                            }
                        }
                    }

                    if (validPoly) {
                        const layout = generateBuildingLayout(validPoly, {
                            subtype: 'point',
                            unitMix: params.unitMix,
                            alignmentRotation: bearing
                        });

                        validPoly.properties = {
                            type: 'generated', subtype: 'point', area: turf.area(validPoly),
                            cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                            scenarioId: `Point-Edge-${i}-${currentDist}`, score: turf.area(validPoly)
                        };
                        candidates.push({ feature: validPoly, score: turf.area(validPoly) });
                        usedAreas.push(validPoly);

                        // Advance
                        currentDist += targetSide + spacing;
                    } else {
                        currentDist += spacing;
                    }

                } catch (e) {
                    currentDist += spacing;
                }
            }
        } catch (e) { }
    }

    return candidates.map(c => c.feature);
}

