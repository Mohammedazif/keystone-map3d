import * as turf from '@turf/turf';
import { generateBuildingLayout } from './layout-generator';
import { Feature, Polygon, MultiPolygon, Point, LineString } from 'geojson';
import { UnitTypology } from '../types';

export interface GeometricTypologyParams {
    wingDepth?: number;
    orientation: number;
    setback: number;
    minFootprint?: number;
    obstacles?: Feature<Polygon>[];
    targetPosition?: Feature<Point>;
    vastuCompliant?: boolean;
    unitMix?: UnitTypology[];
}

function checkCollision(poly: Feature<Polygon>, obstacles?: Feature<Polygon>[]): boolean {
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
export function generateLShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const { wingDepth, setback, obstacles } = params;

    // 1. Get Valid Area (Buffer)
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];
    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;

    // 2. Simplify Plot to finding main structural edges
    // @ts-ignore
    const simplified = turf.simplify(validArea, { tolerance: 0.00005, highQuality: true });

    // Get Coordinates (assuming Polygon)
    const coords = (simplified.geometry.type === 'Polygon')
        ? simplified.geometry.coordinates[0]
        : (simplified.geometry as MultiPolygon).coordinates[0][0];

    // Determine Depth
    const bbox = turf.bbox(validArea);
    const widthM = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const heightM = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
    const minDim = Math.min(widthM, heightM);
    const targetDepth = wingDepth || 14;
    const safeDepth = Math.min(targetDepth, minDim * 0.35);

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];

    // Loop through corners to generate L-shapes
    // An L-shape is formed by a Vertex and its two connected Edges.
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const pCurrent = coords[i];
            const pPrev = (i === 0) ? coords[coords.length - 2] : coords[i - 1];
            const pNext = coords[i + 1];

            // Filter out reflex angles (> 180)? 
            // We want convex corners typically for an L-shape main corner.
            const bearingPrev = turf.bearing(pCurrent, pPrev);
            const bearingNext = turf.bearing(pCurrent, pNext);
            const angle = (bearingNext - bearingPrev + 360) % 360;

            const edge1 = turf.lineString([pPrev, pCurrent]);
            const edge2 = turf.lineString([pCurrent, pNext]);

            // Variations
            const variations = [
                { name: 'Standard', depthFactor: 1.0 },
                { name: 'Thick', depthFactor: 1.5 }, // Request: "Building width 24m" -> 14 * 1.5 = 21m (close enough)
                { name: 'Thin', depthFactor: 0.75 }  // Request: "Shrink"
            ];

            variations.forEach(v => {
                try {
                    const currentDepth = safeDepth * v.depthFactor;

                    // Create Buffers (Wings)
                    // @ts-ignore
                    const rawWing1 = turf.buffer(edge1, currentDepth, { units: 'meters', steps: 1 });
                    // @ts-ignore
                    const rawWing2 = turf.buffer(edge2, currentDepth, { units: 'meters', steps: 1 });

                    // Intersect with Plot to trim
                    // @ts-ignore
                    const wing1 = turf.intersect(rawWing1, validArea);
                    // @ts-ignore
                    const wing2 = turf.intersect(rawWing2, validArea);

                    if (wing1 && wing2) {
                        // SPLIT LOGIC: Create 2 distinct parts
                        // Part 1: Full Wing 1
                        // Part 2: Wing 2 MINUS Wing 1 (to avoid overlap)
                        // @ts-ignore
                        const part2 = turf.difference(wing2, wing1);

                        // Valid parts?
                        // @ts-ignore
                        if (part2 && turf.area(wing1) > 50 && turf.area(part2) > 50) {

                            // Create MultiPolygon containing both parts
                            const coords1 = wing1.geometry.coordinates;
                            const coords2 = part2.geometry.coordinates;

                            // MultiPolygon coordinates structure: [PolygonCoords, PolygonCoords]
                            // PolygonCoords: [Ring1, Ring2...]
                            const multiCoords = [coords1, coords2];
                            const shape = turf.multiPolygon(multiCoords);

                            if (shape && turf.area(shape) > 400 && !checkCollision(shape as unknown as Feature<Polygon>, obstacles)) {
                                let score = 100 + (turf.area(shape) / 100);
                                if (v.name === 'Standard') score += 10;

                                // Note: Layout will be generated per-part in the store
                                // We store a placeholder layout here or just basic props

                                shape.properties = {
                                    type: 'generated', subtype: 'lshaped', area: turf.area(shape),
                                    // Store parts info if needed
                                    isSplit: true,
                                    scenarioId: `L-Corner-${i}-${v.name}`, score
                                };
                                // @ts-ignore
                                candidates.push({ feature: shape, score, variantId: `Corner-${i}` });
                            }
                        }
                    }
                } catch (e) { }
            });

        } catch (e) { }
    }

    // Diversity Selection (Ensure we pick from different corners if possible)
    const groups: { [key: string]: typeof candidates } = {};
    candidates.forEach(c => {
        const vid = c.variantId || 'default';
        if (!groups[vid]) groups[vid] = [];
        groups[vid].push(c);
    });

    const finalSelection: Feature<Polygon>[] = [];
    const groupKeys = Object.keys(groups);
    // Sort groups internally
    groupKeys.forEach(k => groups[k].sort((a, b) => b.score - a.score));

    // Round Robin
    let added = 0;
    groupKeys.forEach(k => {
        if (groups[k].length > 0) {
            finalSelection.push(groups[k][0].feature);
            groups[k].shift();
            added++;
        }
    });
    // Fill rest
    const remaining: typeof candidates = [];
    groupKeys.forEach(k => remaining.push(...groups[k]));
    remaining.sort((a, b) => b.score - a.score);
    while (finalSelection.length < 5 && remaining.length > 0) {
        finalSelection.push(remaining[0].feature);
        remaining.shift();
    }

    return finalSelection;
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

    // 1. Get Valid Area
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
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
    const targetDepth = wingDepth || 14;
    const safeDepth = Math.min(targetDepth, minDim * 0.35);

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];

    // Loop through sequences of 3 edges (4 vertices)
    for (let i = 0; i < coords.length - 2; i++) {
        try {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const p3 = coords[i + 2];
            const p4 = (i + 3 < coords.length) ? coords[i + 3] : coords[0]; // Wrap?

            // Edges: p1-p2, p2-p3, p3-p4
            const edges = [
                turf.lineString([p1, p2]),
                turf.lineString([p2, p3]),
                turf.lineString([p3, p4])
            ];

            // Variations
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
                        // @ts-ignore
                        const raw = turf.buffer(edge, currentDepth, { units: 'meters', steps: 1 });
                        // @ts-ignore
                        const trimmed = turf.intersect(raw, validArea);
                        if (trimmed) wings.push(trimmed as Feature<Polygon>);
                    }

                    if (wings.length === 3) {
                        // SPLIT LOGIC: Create 3 distinct parts
                        // Keep Wing 1 and Wing 3 full (sides)
                        // Cut Wing 2 (base) to fit between them
                        const side1 = wings[0];
                        const side2 = wings[2];
                        const baseRaw = wings[1];

                        // @ts-ignore
                        const sidesUnion = turf.union(side1, side2);
                        // @ts-ignore
                        const baseTrimmed = turf.difference(baseRaw, sidesUnion);

                        if (side1 && side2 && baseTrimmed) {
                            // Create MultiPolygon
                            const multiCoords = [
                                side1.geometry.coordinates,
                                baseTrimmed.geometry.coordinates,
                                side2.geometry.coordinates
                            ];
                            const shape = turf.multiPolygon(multiCoords);

                            if (shape && turf.area(shape) > 400 && !checkCollision(shape as unknown as Feature<Polygon>, obstacles)) {
                                let score = 100 + (turf.area(shape) / 100);
                                if (v.name === 'Standard') score += 10;

                                shape.properties = {
                                    type: 'generated', subtype: 'ushaped', area: turf.area(shape),
                                    isSplit: true,
                                    scenarioId: `U-Seq-${i}-${v.name}`, score
                                };
                                // @ts-ignore
                                candidates.push({ feature: shape, score, variantId: `Seq-${i}` });
                            }
                        }
                    }
                } catch (e) { }
            });
        } catch (e) { }
    }

    // Diversity Selection
    const groups: { [key: string]: typeof candidates } = {};
    candidates.forEach(c => {
        const vid = c.variantId || 'default';
        if (!groups[vid]) groups[vid] = [];
        groups[vid].push(c);
    });

    const finalSelection: Feature<Polygon>[] = [];
    const groupKeys = Object.keys(groups);
    groupKeys.forEach(k => groups[k].sort((a, b) => b.score - a.score));

    // Round Robin
    let added = 0;
    groupKeys.forEach(k => {
        if (groups[k].length > 0) {
            finalSelection.push(groups[k][0].feature);
            groups[k].shift();
            added++;
        }
    });
    // Fill rest
    const remaining: typeof candidates = [];
    groupKeys.forEach(k => remaining.push(...groups[k]));
    remaining.sort((a, b) => b.score - a.score);
    while (finalSelection.length < 5 && remaining.length > 0) {
        finalSelection.push(remaining[0].feature);
        remaining.shift();
    }

    return finalSelection;
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
export function generateTShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const { wingDepth, setback, obstacles } = params;

    // 1. Get Valid Area
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

    // Determine Depth
    const bbox = turf.bbox(validArea);
    const widthM = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const heightM = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
    const minDim = Math.min(widthM, heightM);
    const targetDepth = wingDepth || 14;
    const safeDepth = Math.min(targetDepth, minDim * 0.35);

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];
    const centroid = turf.centroid(validArea);

    // Loop through edges
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const p1 = coords[i];
            const p2 = coords[i + 1];
            const dist = turf.distance(p1, p2, { units: 'meters' });

            // Only consider reasonably long edges (> 20m?) as "Cap" candidates
            if (dist > 20) {
                const edge = turf.lineString([p1, p2]);
                const mid = turf.midpoint(p1, p2);

                // Variations
                const variations = [
                    { name: 'Standard', depthFactor: 1.0 },
                    { name: 'Thick', depthFactor: 1.5 },
                    { name: 'Thin', depthFactor: 0.75 }
                ];

                variations.forEach(v => {
                    try {
                        const currentDepth = safeDepth * v.depthFactor;

                        // Construct "Cap" Wing (Perimeter Edge: Buffer by full depth)
                        // @ts-ignore
                        const rawCap = turf.buffer(edge, currentDepth, { units: 'meters', steps: 1 });
                        // @ts-ignore
                        const cap = turf.intersect(rawCap, validArea);

                        if (cap) {
                            // Construct "Stem" Wing (Internal Line: Buffer by HALF depth)
                            const stemLine = turf.lineString([mid.geometry.coordinates, centroid.geometry.coordinates]);
                            const bearing = turf.bearing(mid, centroid);
                            const longDim = Math.max(widthM, heightM);
                            const stemEnd = turf.destination(mid, longDim * 1.5, bearing, { units: 'meters' });
                            const longStem = turf.lineString([mid.geometry.coordinates, stemEnd.geometry.coordinates]);

                            // @ts-ignore
                            // FIX: Divide depth by 2 for internal line buffer
                            const rawStem = turf.buffer(longStem, currentDepth / 2, { units: 'meters', steps: 1 });
                            // @ts-ignore
                            const stem = turf.intersect(rawStem, validArea);

                            // Combine
                            // Combine
                            if (stem) {
                                // SPLIT LOGIC: Create 2 distinct parts
                                // Keep Cap (Perimeter) full
                                // Cut Stem (Internal) to abut the Cap
                                // @ts-ignore
                                const stemTrimmed = turf.difference(stem, cap);

                                if (stemTrimmed && turf.area(cap) > 50 && turf.area(stemTrimmed) > 50) {
                                    // Create MultiPolygon
                                    const multiCoords = [
                                        cap.geometry.coordinates,
                                        stemTrimmed.geometry.coordinates
                                    ];
                                    const shape = turf.multiPolygon(multiCoords);

                                    if (shape && turf.area(shape) > 400 && !checkCollision(shape as unknown as Feature<Polygon>, obstacles)) {
                                        let score = 100 + (turf.area(shape) / 100);
                                        if (v.name === 'Standard') score += 10;

                                        shape.properties = {
                                            type: 'generated', subtype: 'tshaped', area: turf.area(shape),
                                            isSplit: true, // Marker for store to explode
                                            scenarioId: `T-Edge-${i}-${v.name}`, score
                                        };
                                        // @ts-ignore
                                        candidates.push({ feature: shape, score, variantId: `Edge-${i}` });
                                    }
                                }
                            }
                        }
                    } catch (e) { }
                });
            }
        } catch (e) { }
    }

    // Diversity Selection
    const groups: { [key: string]: typeof candidates } = {};
    candidates.forEach(c => {
        const vid = c.variantId || 'default';
        if (!groups[vid]) groups[vid] = [];
        groups[vid].push(c);
    });

    const finalSelection: Feature<Polygon>[] = [];
    const groupKeys = Object.keys(groups);
    groupKeys.forEach(k => groups[k].sort((a, b) => b.score - a.score));

    let added = 0;
    groupKeys.forEach(k => {
        if (groups[k].length > 0) {
            finalSelection.push(groups[k][0].feature);
            groups[k].shift();
            added++;
        }
    });

    const remaining: typeof candidates = [];
    groupKeys.forEach(k => remaining.push(...groups[k]));
    remaining.sort((a, b) => b.score - a.score);
    while (finalSelection.length < 5 && remaining.length > 0) {
        finalSelection.push(remaining[0].feature);
        remaining.shift();
    }

    return finalSelection;
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

    // Depth
    const bbox = turf.bbox(validArea);
    const widthM = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const heightM = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });
    const minDim = Math.min(widthM, heightM);
    const targetDepth = wingDepth || 14;
    const safeDepth = Math.min(targetDepth, minDim * 0.35);

    const candidates: { feature: Feature<Polygon>, score: number, pairId?: string }[] = [];

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
                                        // SPLIT LOGIC: Create 3 distinct parts
                                        // Part 1: Left Wing (Full)
                                        // Part 2: Right Wing (Full)
                                        // Part 3: Crossbar MINUS Wings (Trimmed)

                                        // @ts-ignore
                                        const wingsUnion = turf.union(wing1, wing2);
                                        // @ts-ignore
                                        const crossTrimmed = turf.difference(cross, wingsUnion);

                                        if (wing1 && wing2 && crossTrimmed) {

                                            // Collect ALL polygon coordinates
                                            const multiCoords: any[] = [];

                                            // Helper to push coords
                                            const addCoords = (f: Feature<Polygon | MultiPolygon>) => {
                                                if (f.geometry.type === 'Polygon') {
                                                    multiCoords.push(f.geometry.coordinates);
                                                } else if (f.geometry.type === 'MultiPolygon') {
                                                    f.geometry.coordinates.forEach(c => multiCoords.push(c));
                                                }
                                            };

                                            addCoords(wing1 as Feature<Polygon | MultiPolygon>);
                                            addCoords(crossTrimmed as Feature<Polygon | MultiPolygon>);
                                            addCoords(wing2 as Feature<Polygon | MultiPolygon>);

                                            const shape = turf.multiPolygon(multiCoords);

                                            if (shape && turf.area(shape) > 400 && !checkCollision(shape as unknown as Feature<Polygon>, obstacles)) {
                                                let score = 100 + (turf.area(shape) / 100);
                                                if (v.name === 'Standard') score += 10; // Prefer standard symmetry

                                                // Create a temporary UNION polygon for layout generation (avoid crash)
                                                // @ts-ignore
                                                const unionForLayout = turf.union(wingsUnion, crossTrimmed);

                                                const layout = generateBuildingLayout(unionForLayout as unknown as Feature<Polygon>, {
                                                    subtype: 'hshaped',
                                                    unitMix: params.unitMix,
                                                    alignmentRotation: 0
                                                });

                                                shape.properties = {
                                                    type: 'generated', subtype: 'hshaped', area: turf.area(shape),
                                                    cores: layout.cores, units: layout.units, entrances: layout.entrances, internalUtilities: layout.utilities,
                                                    scenarioId: `H-Pair-${i}-${j}-${v.name}`,
                                                    // Add metadata to help with diversity selection
                                                    pairId: `${i}-${j}`,
                                                    variant: v.name,
                                                    isSplit: true,
                                                    score
                                                };
                                                // @ts-ignore
                                                candidates.push({ feature: shape, score, pairId: `${i}-${j}` });
                                            }
                                        }
                                    }
                                }
                            } catch (e) { }
                        });
                    }
                }
            } catch (e) { }
        }
    }

    // DIVERSITY SELECTION
    // Ensure we pick candidates from DIFFERENT edge pairs (orientations) if possible.
    // 1. Group by Pair ID
    const groups: { [key: string]: typeof candidates } = {};
    candidates.forEach(c => {
        const pairId = c.pairId || 'default';
        if (!groups[pairId]) groups[pairId] = [];
        groups[pairId].push(c);
    });

    const finalSelection: Feature<Polygon>[] = [];
    const pairIds = Object.keys(groups);

    // Round-Robin Selection from each group (Orientation)
    let addedCount = 0;
    // let max perGroup = 2; // Allow up to 2 per orientation initially // This line was commented out in the instruction, keeping it commented.

    // Sort each group by score
    pairIds.forEach(pid => groups[pid].sort((a, b) => b.score - a.score));

    // Pass 1: Top 1 from each group
    pairIds.forEach(pid => {
        if (groups[pid].length > 0) {
            finalSelection.push(groups[pid][0].feature);
            groups[pid].shift(); // Remove used
            addedCount++;
        }
    });

    // Pass 2: Top 1 from each group again (if space)
    if (addedCount < 5) {
        pairIds.forEach(pid => {
            if (groups[pid].length > 0 && addedCount < 5) {
                finalSelection.push(groups[pid][0].feature);
                groups[pid].shift();
                addedCount++;
            }
        });
    }

    // Pass 3: Fill remaining slots with best available from any group
    const remaining: typeof candidates = [];
    pairIds.forEach(pid => remaining.push(...groups[pid]));
    remaining.sort((a, b) => b.score - a.score);

    while (finalSelection.length < 5 && remaining.length > 0) {
        finalSelection.push(remaining[0].feature);
        remaining.shift();
    }

    return finalSelection;
}


/**
 * Slab Generator (Rectangular Blocks at Corners/Edges)
 * Replaces generic "Lamella" with specific corner-based logic.
 */
/**
 * Slab Generator (Rectangular Blocks along Edges)
 * Creates discrete elongated slabs centered on plot edges
 */
export function generateSlabShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const { wingDepth, setback, obstacles } = params;

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

    console.log(`[SlabGen] Valid Area: ${turf.area(validArea).toFixed(0)}m², Corners: ${coords.length}`);

    const candidates: { feature: Feature<Polygon>, score: number, variantId?: string }[] = [];

    // NEW APPROACH: Create slabs centered on EDGES (not corners)
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);

            // Edge properties
            const edgeLength = turf.distance(p1, p2, { units: 'meters' });
            const edgeBearing = turf.bearing(p1, p2);
            const midpoint = turf.midpoint(p1, p2);

            // Skip very short edges
            if (edgeLength < 8) {
                console.log(`[SlabGen] Edge ${i} too short: ${edgeLength.toFixed(1)}m`);
                continue;
            }

            // Slab dimensions - adaptive to edge length
            const slabLength = Math.min(30, edgeLength * 0.9); // 90% coverage, max 30m
            const slabDepth = wingDepth || 14;

            const variations = [
                { name: 'Standard', length: slabLength, depth: slabDepth },
            ];

            variations.forEach(v => {
                try {
                    // Create rectangle centered on edge midpoint
                    const halfLen = v.length / 2;

                    // Points along the edge (centered)
                    // @ts-ignore
                    const edgeStart = turf.destination(midpoint, halfLen, edgeBearing + 180, { units: 'meters' });
                    // @ts-ignore
                    const edgeEnd = turf.destination(midpoint, halfLen, edgeBearing, { units: 'meters' });

                    // Try both inward directions (+90 and -90 from edge bearing)
                    [90, -90].forEach(turn => {
                        try {
                            // Create inner edge (perpendicular to plot edge)
                            // @ts-ignore
                            const innerStart = turf.destination(edgeStart, v.depth, edgeBearing + turn, { units: 'meters' });
                            // @ts-ignore
                            const innerEnd = turf.destination(edgeEnd, v.depth, edgeBearing + turn, { units: 'meters' });

                            const poly = turf.polygon([[
                                edgeStart.geometry.coordinates,
                                edgeEnd.geometry.coordinates,
                                innerEnd.geometry.coordinates,
                                innerStart.geometry.coordinates,
                                edgeStart.geometry.coordinates
                            ]]);

                            // Check if centroid is inside valid area
                            // @ts-ignore
                            if (turf.booleanPointInPolygon(turf.centroid(poly), validArea)) {
                                // @ts-ignore
                                const intersect = turf.intersect(poly, validArea);
                                if (intersect) {
                                    const intArea = turf.area(intersect);
                                    const targetArea = v.length * v.depth;

                                    if (intArea > targetArea * 0.6) { // At least 60% inside
                                        if (!checkCollision(intersect as Feature<Polygon>, obstacles)) {
                                            const layout = generateBuildingLayout(intersect as Feature<Polygon>, {
                                                subtype: 'slab',
                                                unitMix: params.unitMix,
                                                alignmentRotation: edgeBearing
                                            });

                                            intersect.properties = {
                                                type: 'generated',
                                                subtype: 'slab',
                                                area: intArea,
                                                cores: layout.cores,
                                                units: layout.units,
                                                entrances: layout.entrances,
                                                internalUtilities: layout.utilities,
                                                scenarioId: `Slab-Edge-${i}-${v.name}`,
                                                score: intArea
                                            };
                                            candidates.push({ feature: intersect as Feature<Polygon>, score: intArea, variantId: `Edge-${i}` });
                                        } else {
                                            console.log(`[SlabGen] Collision at Edge ${i}`);
                                        }
                                    } else {
                                        console.log(`[SlabGen] Area too small at Edge ${i}: ${intArea.toFixed(0)} < ${(targetArea * 0.6).toFixed(0)}`);
                                    }
                                } else {
                                    console.log(`[SlabGen] No intersection at Edge ${i}`);
                                }
                            } else {
                                console.log(`[SlabGen] Centroid outside at Edge ${i}`);
                            }
                        } catch (e) {
                            console.error(`[SlabGen] Error creating slab on Edge ${i}`, e);
                        }
                    });
                } catch (e) {
                    console.error(`[SlabGen] Error processing Edge ${i}`, e);
                }
            });
        } catch (e) {
            console.error(`[SlabGen] Error at Edge ${i}`, e);
        }
    }

    // Diversity Selection
    console.log(`[SlabGen] Total candidates found: ${candidates.length}`);

    // Sort by Score (Area)
    candidates.sort((a, b) => b.score - a.score);

    const finalSelection: Feature<Polygon>[] = [];

    for (const cand of candidates) {
        // Check overlap with already selected
        let overlap = false;
        for (const existing of finalSelection) {
            // @ts-ignore
            if (turf.booleanOverlap(cand.feature, existing) || turf.booleanContains(cand.feature, existing) || turf.booleanContains(existing, cand.feature) || turf.intersect(cand.feature, existing)) {
                overlap = true;
                break;
            }
        }
        if (!overlap) {
            finalSelection.push(cand.feature);
            if (finalSelection.length >= 4) break; // Max 4 slabs
        }
    }

    return finalSelection;
}

/**
 * Point Generator (Square Towers at Corners)
 */
export function generatePointShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const { wingDepth, setback, obstacles } = params;

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

    // Loop through Corner Vertices
    for (let i = 0; i < coords.length - 1; i++) {
        try {
            const pCurrent = coords[i];

            // Point Dimensions (Square)
            const baseSide = 16; // Approx 16m x 16m (tower)

            const variations = [
                { name: 'Standard', side: baseSide },
                { name: 'Small', side: baseSide * 0.75 },
                { name: 'Large', side: baseSide * 1.25 },
            ];

            // Try aligning with Angle Bisector to fit into corner?
            // Or just align to edges like Slab?
            // Aligning to edges is safer.

            const pNext = coords[i + 1];
            const bearingNext = turf.bearing(pCurrent, pNext);

            variations.forEach(v => {
                // Try placing square at corner aligned with Next Edge
                [90, -90].forEach(turn => {
                    try {
                        // @ts-ignore
                        const v1 = pCurrent;
                        // @ts-ignore
                        const v2 = turf.destination(pCurrent, v.side, bearingNext, { units: 'meters' });
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
                                if (!checkCollision(intersect as Feature<Polygon>, obstacles)) {
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
                                }
                            }
                        }
                    } catch (e) { }
                });
            });

        } catch (e) { }
    }

    // Diversity Selection (Greedy non-overlapping)
    candidates.sort((a, b) => b.score - a.score);
    const finalSelection: Feature<Polygon>[] = [];

    for (const cand of candidates) {
        let overlap = false;
        for (const existing of finalSelection) {
            // @ts-ignore
            if (turf.booleanOverlap(cand.feature, existing) || turf.booleanContains(cand.feature, existing) || turf.booleanContains(existing, cand.feature) || turf.intersect(cand.feature, existing)) {
                overlap = true;
                break;
            }
        }
        if (!overlap) {
            finalSelection.push(cand.feature);
            if (finalSelection.length >= 4) break;
        }
    }

    return finalSelection;
}
