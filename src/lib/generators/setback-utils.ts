
import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon, Position } from 'geojson';
import { AlgoParams } from './basic-generator';

/**
 * Applies variable setbacks (Front, Rear, Side) to a polygon.
 * 
 * Strategy:
 * 1. Calculate Bounding Box of the polygon.
 * 2. Identify "Front" edges based on `roadAccessSides` (N, S, E, W).
 *    - N: Top edge (Max Y)
 *    - S: Bottom edge (Min Y)
 *    - E: Right edge (Max X)
 *    - W: Left edge (Min X)
 * 3. Identify "Rear" edge (Opposite to Front).
 *    - If multiple Fronts, Rear might be ambiguous, defaulting to remaining edges as Side or specific logic.
 *    - Simple case: Single Front -> Opposite is Rear.
 * 4. Apply setbacks by offsetting edges or intersecting with half-planes.
 * 
 * Fallback:
 * - If `roadAccessSides` is empty or undefined, use `setback` (uniform) or `frontSetback` as uniform.
 */
export function applyVariableSetbacks(
    poly: Feature<Polygon | MultiPolygon>,
    params: AlgoParams
): Feature<Polygon | MultiPolygon> | null {
    const {
        setback,
        frontSetback,
        rearSetback,
        sideSetback,
        roadAccessSides
    } = params;

    // 0. Defaults:
    // If no specific setbacks are provided, use uniform setback (defaulting to 6m if even that is missing, though caller handles defaults)
    const effectiveUniform = setback ?? 0;

    // If we don't have specific variable setbacks OR don't know where the road is, use Uniform.
    if (
        (frontSetback === undefined && rearSetback === undefined && sideSetback === undefined) ||
        !roadAccessSides ||
        roadAccessSides.length === 0
    ) {
        // Use Uniform Setback
        if (effectiveUniform === 0) return poly; // No setback needed
        // @ts-ignore
        return turf.buffer(poly, -effectiveUniform, { units: 'meters' });
    }

    // 1. Prepare Values
    const valFront = frontSetback ?? effectiveUniform;
    const valRear = rearSetback ?? effectiveUniform;
    const valSide = sideSetback ?? effectiveUniform; // Default side to uniform if not specified

    // 2. Explode Polygon to Edges causes issues with concave shapes if we just offset edges.
    // Better approach: Buffer by specific amounts for specific edges?
    // Turf doesn't support variable buffer easily.

    // Robust Approach:
    // Create 4 "Half-Plane" rectangles representing the setbacks from the Bounding Box limits,
    // AND Subtract them from the original polygon.

    // Wait, BBox approach assumes the plot is roughly rectangular and aligned-ish.
    // If the plot is 45deg rotated, BBox cutting is bad.

    // Better Robust Approach:
    // 1. Offset the whole polygon by `valSide` (Minimum setback).
    // 2. If Front/Rear are larger than Side, we need to cut *more* from those specific sides.
    //    How to identify those sides on an arbitrary polygon?
    //    We use the BBox of the *original* plot to identifying "Northern", "Southern", etc. limits.

    // Let's try:
    // 1. Uniform buffer by `valSide` (assuming side is the smallest).
    // 2. Identify "Extra Setback" needed for Front (valFront - valSide) and Rear (valRear - valSide).
    // 3. Create "Cutters" for these extra setbacks based on BBox.

    const bbox = turf.bbox(poly); // [minX, minY, maxX, maxY]
    const [minX, minY, maxX, maxY] = bbox;
    const width = maxX - minX;
    const height = maxY - minY;

    // Safety check for tiny plots
    if (width < 1 || height < 1) return null;

    // Apply Base Setback (Smallest of the set? Or just Side?)
    // Usually Side is smallest (e.g. 3m), Front is 6m, Rear is 4m.
    // So buffer by -Side first.
    // @ts-ignore
    let shrunkPoly = turf.buffer(poly, -valSide, { units: 'meters' });

    if (!shrunkPoly) return null;

    // Now cut extra for Front/Rear
    const extraFront = Math.max(0, valFront - valSide);
    const extraRear = Math.max(0, valRear - valSide);

    if (extraFront === 0 && extraRear === 0) {
        return shrunkPoly as Feature<Polygon | MultiPolygon>;
    }

    const cutters: Feature<Polygon>[] = [];

    // Helper to create cutter
    // margin: amount to cut into the box
    // edge: 'N', 'S', 'E', 'W'
    const createCutter = (edge: string, margin: number) => {
        if (margin <= 0) return;
        // Make the cutter huge to cover irregular boundaries
        const huge = 1000; // meters extension out

        /*
          BBox:
          minX,maxY (NW) ------ maxX,maxY (NE)
              |                     |
          minX,minY (SW) ------ maxX,minY (SE)
        */

        let cPoly: Feature<Polygon> | null = null;

        switch (edge) {
            case 'N': // Top Edge
                // Box from maxY down to maxY - margin
                cPoly = turf.bboxPolygon([
                    minX - huge,
                    maxY - (margin / 111111), // approx degrees. better to use meter offset
                    maxX + huge,
                    maxY + huge
                ]);
                break;
            case 'S': // Bottom Edge
                cPoly = turf.bboxPolygon([
                    minX - huge,
                    minY - huge,
                    maxX + huge,
                    minY + (margin / 111111)
                ]);
                break;
            case 'E': // Right Edge
                cPoly = turf.bboxPolygon([
                    maxX - (margin / 111111), // approx meters to deg. Longitude varies... use simple approximation for now or proper turf.destination
                    minY - huge,
                    maxX + huge,
                    maxY + huge
                ]);
                break;
            case 'W': // Left Edge
                cPoly = turf.bboxPolygon([
                    minX - huge,
                    minY - huge,
                    minX + (margin / 111111),
                    maxY + huge
                ]);
                break;
        }

        // Re-do with proper meter offset using turf.destination for accuracy
        if (edge === 'N') {
            // Top Cutter: A box covering everything "Above" the setback line
            // Limit line is: maxY translated South by margin.
            // We want to remove everything North of that line.
            const nw = turf.point([minX, maxY]);
            const cutLine = turf.destination(nw, margin, 180, { units: 'meters' });
            const cutY = cutLine.geometry.coordinates[1];

            cPoly = turf.bboxPolygon([minX - 0.1, cutY, maxX + 0.1, maxY + 0.1]); // Add buffer
        }
        else if (edge === 'S') {
            const sw = turf.point([minX, minY]);
            const cutLine = turf.destination(sw, margin, 0, { units: 'meters' });
            const cutY = cutLine.geometry.coordinates[1];

            cPoly = turf.bboxPolygon([minX - 0.1, minY - 0.1, maxX + 0.1, cutY]);
        }
        else if (edge === 'E') {
            const ne = turf.point([maxX, maxY]);
            const cutLine = turf.destination(ne, margin, 270, { units: 'meters' });
            const cutX = cutLine.geometry.coordinates[0];

            cPoly = turf.bboxPolygon([cutX, minY - 0.1, maxX + 0.1, maxY + 0.1]);
        }
        else if (edge === 'W') {
            const nw = turf.point([minX, maxY]);
            const cutLine = turf.destination(nw, margin, 90, { units: 'meters' });
            const cutX = cutLine.geometry.coordinates[0];

            cPoly = turf.bboxPolygon([minX - 0.1, minY - 0.1, cutX, maxY + 0.1]);
        }

        if (cPoly) cutters.push(cPoly);
    };

    // Apply Front Setbacks
    roadAccessSides.forEach(side => {
        // Map 'N', 'S', 'E', 'W' or 'North', 'South'...
        const s = side.charAt(0).toUpperCase();
        createCutter(s, extraFront);
    });

    // Apply Rear Setbacks (Opposite to Front)
    // If multiple fronts (e.g. Corner Plot NE), Rear is SW? 
    // Logic: If N is Front, S is Rear. If E is Front, W is Rear.
    // If N and E are Front (Corner), S and W are Rear (or Sides? Corner plot logic implies Rear is opposite to "Main" front)
    // For simplicity: Mark opposites of ALL fronts as Rear.
    const rearSides = new Set<string>();
    roadAccessSides.forEach(side => {
        const s = side.charAt(0).toUpperCase();
        if (s === 'N') rearSides.add('S');
        if (s === 'S') rearSides.add('N');
        if (s === 'E') rearSides.add('W');
        if (s === 'W') rearSides.add('E');
    });

    // Remove conflicts (if a side is both Front and Rear, it's Front)
    roadAccessSides.forEach(side => {
        const s = side.charAt(0).toUpperCase();
        rearSides.delete(s);
    });

    rearSides.forEach(s => {
        createCutter(s, extraRear);
    });

    // Note: Side setbacks are already handled by the initial uniform buffer (valSide).
    // If Side > Front (unlikely), our "Extra" calc would be negative/zero, so it works (shrunk by side is enough).
    // If Side < Front, we cut extra.

    // Execute Cuts
    for (const cutter of cutters) {
        try {
            // @ts-ignore
            shrunkPoly = turf.difference(shrunkPoly, cutter);
            if (!shrunkPoly) return null;
        } catch (e) {
            console.warn("Setback cut failed", e);
            return null;
        }
    }

    return shrunkPoly as Feature<Polygon | MultiPolygon>;
}
