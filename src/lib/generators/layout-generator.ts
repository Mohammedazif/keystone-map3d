
import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon, Point } from 'geojson';
import { Building, Core, Unit, UnitTypology, UtilityArea, UtilityType, EntryPoint } from '../types';
import { generateVastuGates } from '../vastu-gate-generator';

interface LayoutParams {
    minUnitSize?: number; // sqm, e.g. 50
    avgUnitSize?: number; // sqm, e.g. 100
    corridorWidth?: number; // meters, e.g. 2
    subtype?: string; // e.g. 'lshaped', 'ushaped', 'tshaped', 'hshaped'
    roadAccessSides?: string[]; // ['N', 'E']
    vastuCompliant?: boolean;
    unitMix?: UnitTypology[]; // Admin panel unit mix configuration
    alignmentRotation?: number; // The angle to rotate the building to align with axes (0deg) for internal layout generation
}

// Helper: Get cardinal direction of a bearing (0-360)
function getCardinalDirection(bearing: number): string {
    const b = (bearing + 360) % 360;
    if (b >= 315 || b < 45) return 'N';
    if (b >= 45 && b < 135) return 'E';
    if (b >= 135 && b < 225) return 'S';
    if (b >= 225 && b < 315) return 'W';
    return 'N';
}

// Helper: Get base color for unit type
function getColorForUnitType(unitName: string): string {
    const name = unitName.toLowerCase();
    if (name.includes('studio')) return '#ADD8E6';
    if (name.includes('1bhk') || name.includes('1 bhk')) return '#87CEFA';
    if (name.includes('2bhk') || name.includes('2 bhk')) return '#1E90FF';
    if (name.includes('3bhk') || name.includes('3 bhk')) return '#4169E1';
    if (name.includes('4bhk') || name.includes('4 bhk')) return '#FFD700';
    return '#87CEFA'; // Default to 1BHK color
}

// Helper: Darken a hex color by 10%
function darkenColor(hex: string): string {
    const num = parseInt(hex.replace('#', ''), 16);
    const r = Math.max(0, ((num >> 16) & 0xFF) - 25);
    const g = Math.max(0, ((num >> 8) & 0xFF) - 25);
    const b = Math.max(0, (num & 0xFF) - 25);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

/**
 * Helper: Create a rotated rectangle polygon.
 * @param center Centroid of the rectangle
 * @param widthWidth in meters
 * @param height Height in meters
 * @param bearing Bearing in degrees (0 = north, clockwise)
 */
function createRotatedRect(center: Feature<Point>, width: number, height: number, bearing: number = 0): Feature<Polygon> {
    const wHalf = width / 2;
    const hHalf = height / 2;

    // Create a 0-degree oriented rectangle around origin [0,0] then translate/rotate
    // Actually simpler to just use turf.destination to find corners

    // Corners relative to center at 0 bearing:
    // NW: [-w/2, +h/2], NE: [+w/2, +h/2], SE: [+w/2, -h/2], SW: [-w/2, -h/2]

    const corners = [
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(-wHalf, hHalf) * 180 / Math.PI }, // NW
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(wHalf, hHalf) * 180 / Math.PI },  // NE
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(wHalf, -hHalf) * 180 / Math.PI }, // SE
        { dist: Math.sqrt(wHalf ** 2 + hHalf ** 2), angle: bearing + Math.atan2(-wHalf, -hHalf) * 180 / Math.PI }, // SW
    ];

    const ring = corners.map(c => turf.destination(center, c.dist, c.angle, { units: 'meters' }).geometry.coordinates);
    ring.push(ring[0]); // Close polygon

    return turf.polygon([ring as any]);
}

/**
 * Helper: Determine the dominant orientation (bearing) of a plot.
 * Usually based on the longest edge.
 */
function getPlotOrientation(plotPoly: Feature<Polygon>): number {
    try {
        const coords = plotPoly.geometry.coordinates[0];
        let maxLen = -1;
        let dominantBearing = 0;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = turf.point(coords[i]);
            const p2 = turf.point(coords[i + 1]);
            const len = turf.distance(p1, p2, { units: 'meters' });
            if (len > maxLen) {
                maxLen = len;
                dominantBearing = turf.bearing(p1, p2);
            }
        }
        return dominantBearing;
    } catch (e) {
        return 0;
    }
}

/**
 * Generates an internal layout (Cores + Units) for a given building geometry.
 */
export function generateBuildingLayout(
    buildingPoly: Feature<Polygon | MultiPolygon>,
    params: LayoutParams = {}
): { cores: Core[], units: Unit[], entrances: any[], utilities: UtilityArea[], efficiency?: number } {
    console.log('[Layout Generator] Generating layout with params:', params);

    // --- ROTATION WRAPPER START ---
    // If an alignment rotation is provided, we temporarily rotate the building to 0deg (aligned),
    // generate the layout in aligned space (where bounding boxes work nicely),
    // and then rotate everything back to the original orientation.

    let workingPoly = buildingPoly;
    const rotationAngle = params.alignmentRotation || 0;
    const center = turf.centroid(buildingPoly);

    if (rotationAngle !== 0) {
        // Rotate "Back" to Aligned Space
        // @ts-ignore
        workingPoly = turf.transformRotate(buildingPoly, -rotationAngle, { pivot: center });
    }
    // --- ROTATION WRAPPER END ---

    const cores: Core[] = [];
    const units: Unit[] = [];
    const entrances: any[] = [];
    const utilities: UtilityArea[] = [];

    const minUnitSize = params.minUnitSize || 60;
    const targetUnitSize = params.avgUnitSize || 120;

    // 1. Generate Core(s) - Typology-Specific Placement
    const bbox = turf.bbox(workingPoly);
    const width = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const depth = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });

    const coreSizeFactor = params.subtype === 'ushaped' ? 0.10 : 0.15;
    const coreW = Math.min(8, Math.max(4, width * coreSizeFactor));
    const coreD = Math.min(8, Math.max(4, depth * coreSizeFactor));

    // Helper: Create a core at a specific point
    const createCoreAtPoint = (point: Feature<any>, id: string): Feature<Polygon> | null => {
        const coords = point.geometry.coordinates;
        let corePoly = turf.bboxPolygon([
            coords[0] - (coreW / 2) / 111320,
            coords[1] - (coreD / 2) / 110540,
            coords[0] + (coreW / 2) / 111320,
            coords[1] + (coreD / 2) / 110540
        ]);

        // Clip to building footprint
        // @ts-ignore
        const clipped = turf.intersect(corePoly, workingPoly);
        if (clipped && turf.area(clipped) > 10) { // Minimum 10sqm core
            return clipped as Feature<Polygon>;
        }
        return null;
    };

    // Typology-Specific Core Placement
    console.log('[Layout Generator] Generating cores for subtype:', params.subtype);

    // (Using workingPoly instead of buildingPoly)
    if (params.subtype === 'lshaped') {
        // L-Shape: Core at the inner corner junction
        console.log('[Layout Generator] L-Shape detected - placing core at junction');
        const [minX, minY, maxX, maxY] = bbox;

        // For L-shapes, the inner corner is where the two wings meet
        // Try multiple candidate positions to find the actual junction
        const candidates = [
            turf.point([minX + (maxX - minX) * 0.35, minY + (maxY - minY) * 0.35]), // SW inner
            turf.point([maxX - (maxX - minX) * 0.35, minY + (maxY - minY) * 0.35]), // SE inner
            turf.point([maxX - (maxX - minX) * 0.35, maxY - (maxY - minY) * 0.35]), // NE inner
            turf.point([minX + (maxX - minX) * 0.35, maxY - (maxY - minY) * 0.35]), // NW inner
            // Additional candidates closer to edges
            turf.point([minX + (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]),
            turf.point([maxX - (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]),
            turf.point([maxX - (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]),
            turf.point([minX + (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]),
        ];

        for (const candidate of candidates) {
            // @ts-ignore
            if (turf.booleanContains(workingPoly, candidate)) {
                const core = createCoreAtPoint(candidate, 'core-l-junction');
                if (core) {
                    console.log('[Layout Generator] L-Shape core placed at junction');
                    cores.push({ id: 'core-l-junction', type: 'Lobby', geometry: core });
                    break;
                }
            }
        }

    } else if (params.subtype === 'ushaped') {
        // U-Shape: Two cores at the base inner corners
        console.log('[Layout Generator] U-Shape detected - placing two cores');
        const [minX, minY, maxX, maxY] = bbox;

        // Simplified U-shape candidates (Base Corners)
        const candidates = [
            turf.point([minX + (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]), // SW
            turf.point([maxX - (maxX - minX) * 0.25, minY + (maxY - minY) * 0.25]), // SE
            turf.point([maxX - (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]), // NE
            turf.point([minX + (maxX - minX) * 0.25, maxY - (maxY - minY) * 0.25]), // NW
        ];
        // Place 2 cores for U-Shape if possible
        let placed = 0;
        for (const candidate of candidates) {
            if (placed >= 2) break;
            // @ts-ignore
            if (turf.booleanContains(workingPoly, candidate)) {
                const core = createCoreAtPoint(candidate, `core-u-${placed}`);
                if (core) {
                    cores.push({ id: `core-u-${placed}`, type: 'Lobby', geometry: core });
                    placed++;
                }
            }
        }

    } else if (params.subtype === 'tshaped') {
        // T-Shape: Core at the stem/cap junction
        console.log('[Layout Generator] T-Shape detected - placing core at junction');
        const [minX, minY, maxX, maxY] = bbox;
        const midX = (minX + maxX) / 2;

        // Junction is where stem meets cap - try multiple heights
        const candidates = [
            turf.point([midX, maxY - (maxY - minY) * 0.35]),
            turf.point([midX, maxY - (maxY - minY) * 0.40]),
            turf.point([midX, maxY - (maxY - minY) * 0.30]),
            turf.point([midX, minY + (maxY - minY) * 0.50]), // Center fallback
        ];

        for (const candidate of candidates) {
            // @ts-ignore
            if (turf.booleanContains(buildingPoly, candidate)) {
                const core = createCoreAtPoint(candidate, 'core-t-junction');
                if (core) {
                    console.log('[Layout Generator] T-Shape core placed at junction');
                    cores.push({ id: 'core-t-junction', type: 'Lobby', geometry: core });
                    break;
                }
            }
        }

    } else if (params.subtype === 'hshaped') {
        // H-Shape: Two cores at the crossbar junctions
        console.log('[Layout Generator] H-Shape detected - placing two cores');
        const [minX, minY, maxX, maxY] = bbox;
        const midY = (minY + maxY) / 2;

        // Cores at left and right crossbar junctions
        const leftCandidates = [
            turf.point([minX + (maxX - minX) * 0.25, midY]),
            turf.point([minX + (maxX - minX) * 0.20, midY]),
            turf.point([minX + (maxX - minX) * 0.30, midY]),
        ];

        const rightCandidates = [
            turf.point([maxX - (maxX - minX) * 0.25, midY]),
            turf.point([maxX - (maxX - minX) * 0.20, midY]),
            turf.point([maxX - (maxX - minX) * 0.30, midY]),
        ];

        // Try left core
        for (const candidate of leftCandidates) {
            // @ts-ignore
            if (turf.booleanPointInPolygon(candidate, buildingPoly)) {
                const core = createCoreAtPoint(candidate, 'core-h-left');
                if (core) {
                    cores.push({ id: 'core-h-left', type: 'Lobby', geometry: core });
                    console.log('[Layout Generator] H-Shape left core placed');
                    break;
                }
            }
        }

        // Try right core
        for (const candidate of rightCandidates) {
            // @ts-ignore
            if (turf.booleanPointInPolygon(candidate, buildingPoly)) {
                const core = createCoreAtPoint(candidate, 'core-h-right');
                if (core) {
                    cores.push({ id: 'core-h-right', type: 'Lobby', geometry: core });
                    console.log('[Layout Generator] H-Shape right core placed');
                    break;
                }
            }
        }

    } else {
        // Default: Single core using centroid logic
        console.log('[Layout Generator] Default core placement (subtype:', params.subtype, ')');
        let centerPoint = turf.centroid(buildingPoly);

        // @ts-ignore
        if (!turf.booleanContains(buildingPoly, centerPoint)) {
            centerPoint = turf.centerOfMass(buildingPoly);
            // @ts-ignore
            if (!turf.booleanContains(buildingPoly, centerPoint)) {
                centerPoint = turf.pointOnFeature(buildingPoly);
            }
        }

        const core = createCoreAtPoint(centerPoint, 'core-default');
        if (core) cores.push({ id: 'core-default', type: 'Lobby', geometry: core });
    }

    // Fallback: If no cores were placed, use pointOnFeature
    if (cores.length === 0) {
        console.warn('[Layout Generator] No cores placed, using fallback');
        const fallbackPoint = turf.pointOnFeature(buildingPoly);
        const core = createCoreAtPoint(fallbackPoint, 'core-fallback');
        if (core) cores.push({ id: 'core-fallback', type: 'Lobby', geometry: core });
    }

    console.log('[Layout Generator] Total cores placed:', cores.length);

    // Safety check: If no cores were placed, return empty layout
    if (cores.length === 0) {
        console.warn('[Layout Generator] No cores placed, returning empty layout');
        return { cores: [], units: [], utilities: [], entrances: [] };
    }

    const coreGeom = cores[0].geometry;

    // 1.1 Generate Electrical Shaft (Vertical Utility)
    // Place it adjacent to the core
    try {
        const coreBbox = turf.bbox(coreGeom);
        const elecW = 2; // 2 meters
        const elecD = 2; // 2 meters
        const wDeg = elecW / 111320;
        const hDeg = elecD / 110540;

        // Candidate positions relative to Core BBox [minX, minY, maxX, maxY]
        const candidates = [
            // Right (original)
            [coreBbox[2], coreBbox[1], coreBbox[2] + wDeg, coreBbox[1] + hDeg],
            // Left
            [coreBbox[0] - wDeg, coreBbox[1], coreBbox[0], coreBbox[1] + hDeg],
            // Top
            [coreBbox[0], coreBbox[3], coreBbox[0] + wDeg, coreBbox[3] + hDeg],
            // Bottom
            [coreBbox[0], coreBbox[1] - hDeg, coreBbox[0] + wDeg, coreBbox[1]]
        ];

        let placedElec = false;

        // Strategy 1: Try adjacent to core
        for (const box of candidates) {
            const elecPoly = turf.bboxPolygon(box as [number, number, number, number]);

            // @ts-ignore
            if (turf.booleanContains(buildingPoly, elecPoly)) {
                // Perfect fit inside
                utilities.push({
                    id: `util-elec-${Math.random().toString(36).substr(2, 5)}`,
                    name: 'Electrical Shaft',
                    type: UtilityType.Electrical,
                    geometry: elecPoly as Feature<Polygon>,
                    centroid: turf.centroid(elecPoly),
                    area: turf.area(elecPoly),
                    visible: true
                });
                placedElec = true;
                console.log('[Layout Generator] Placed Electrical Shaft (Contains)');
                break;
            } else {
                // Try Intersection as fallback
                // @ts-ignore
                const clipped = turf.intersect(elecPoly, buildingPoly);
                if (clipped && turf.area(clipped) > 1.5) { // Ensure at least 1.5sqm remains
                    utilities.push({
                        id: `util-elec-${Math.random().toString(36).substr(2, 5)}`,
                        name: 'Electrical Shaft',
                        type: UtilityType.Electrical,
                        geometry: clipped as Feature<Polygon>,
                        centroid: turf.centroid(clipped),
                        area: turf.area(clipped),
                        visible: true
                    });
                    placedElec = true;
                    console.log('[Layout Generator] Placed Electrical Shaft (Intersect)');
                    break;
                }
            }
        }

        // Strategy 2: FORCE Placement inside building if candidates failed
        if (!placedElec) {
            console.log('[Layout Generator] Fallback: Forcing Electrical Shaft inside building');
            // Find a point guaranteed to be inside
            const innerPoint = turf.pointOnFeature(buildingPoly); // Uses pointOnSurface logic
            const [ix, iy] = innerPoint.geometry.coordinates;
            // Create a small box around it
            const forcePoly = turf.bboxPolygon([
                ix - wDeg / 2, iy - hDeg / 2,
                ix + wDeg / 2, iy + hDeg / 2
            ]);

            // Intersect again to be safe
            // @ts-ignore
            const safePoly = turf.intersect(forcePoly, buildingPoly) || forcePoly;

            utilities.push({
                id: `util-elec-force-${Math.random().toString(36).substr(2, 5)}`,
                name: 'Electrical Shaft',
                type: UtilityType.Electrical,
                geometry: safePoly as Feature<Polygon>,
                centroid: turf.centroid(safePoly),
                area: turf.area(safePoly),
                visible: true
            });
        }
    } catch (e) {
        console.warn('Failed to place Electrical Shaft', e);
    }

    // 1.2 Generate HVAC Zone (Rooftop)
    // Create a small corner box (4x4m) instead of full footprint
    try {
        const bBox = turf.bbox(buildingPoly);
        const hvacSize = 4; // 4x4 meter HVAC unit
        const hvacSizeDeg = hvacSize / 111320; // Convert to degrees

        // Try to place in NW corner (Vastu preferred for mechanical equipment)
        // Position: Top-left corner with small inset
        const inset = 1 / 111320; // 1m inset from edge

        const hvacBox = turf.bboxPolygon([
            bBox[0] + inset,
            bBox[3] - hvacSizeDeg - inset,
            bBox[0] + hvacSizeDeg + inset,
            bBox[3] - inset
        ]);

        // Check if the entire box is inside the building to prevent overhangs
        // @ts-ignore
        const isInside = turf.booleanContains(buildingPoly, hvacBox);

        let hvacPoly = hvacBox; // Use the fixed-size box directly

        // If NW corner is not fully inside, try NE corner
        if (!isInside) {
            console.log('[Layout Generator] NW corner overhangs, trying NE corner');
            const neBox = turf.bboxPolygon([
                bBox[2] - hvacSizeDeg - inset,
                bBox[3] - hvacSizeDeg - inset,
                bBox[2] - inset,
                bBox[3] - inset
            ]);
            // @ts-ignore
            if (turf.booleanContains(buildingPoly, neBox)) {
                hvacPoly = neBox;
            } else {
                // Try SW corner
                const swBox = turf.bboxPolygon([
                    bBox[0] + inset,
                    bBox[1] + inset,
                    bBox[0] + hvacSizeDeg + inset,
                    bBox[1] + hvacSizeDeg + inset
                ]);
                // @ts-ignore
                if (turf.booleanContains(buildingPoly, swBox)) {
                    hvacPoly = swBox;
                } else {
                    // Final fallback: Use pointOnFeature which GUARANTEES a point inside the polygon
                    // reliable for U/L/H shapes where centroid might be outside
                    console.log('[Layout Generator] Corner placement failed, using pointOnFeature');
                    const innerPoint = turf.pointOnFeature(buildingPoly);
                    const [ix, iy] = innerPoint.geometry.coordinates;
                    hvacPoly = turf.bboxPolygon([
                        ix - hvacSizeDeg / 2,
                        iy - hvacSizeDeg / 2,
                        ix + hvacSizeDeg / 2,
                        iy + hvacSizeDeg / 2
                    ]);
                }
            }
        }


        utilities.push({
            id: `util-hvac-${Math.random().toString(36).substr(2, 5)}`,
            name: 'Rooftop HVAC Unit',
            type: UtilityType.HVAC,
            geometry: hvacPoly as Feature<Polygon>,
            centroid: turf.centroid(hvacPoly),
            area: turf.area(hvacPoly),
            visible: true
        });
        console.log('[Layout Generator] Placed Rooftop HVAC Unit (4x4m box)');
    } catch (e) {
        console.warn('Failed to place HVAC Zone', e);
    }

    // 2. Generate Units based on Unit Mix Configuration
    const corridorW = params.corridorWidth || 2;
    const coreWithCorridor = turf.buffer(coreGeom, corridorW / 1000, { units: 'kilometers' });

    // Combine Core + Electrical + Corridor for subtraction
    let obstacles: any = coreWithCorridor || coreGeom;
    const elecShaft = utilities.find(u => u.type === UtilityType.Electrical);
    if (elecShaft) {
        // Buffer electrical slightly to include in obstacle
        const bufferedElec = turf.buffer(elecShaft.geometry, 0.1 / 1000, { units: 'kilometers' });
        // @ts-ignore
        obstacles = turf.union(obstacles, bufferedElec || elecShaft.geometry);
    }

    // Use the obstacles to cut the hole
    // @ts-ignore
    let leasablePoly = turf.difference(buildingPoly, obstacles);

    if (!leasablePoly) {
        // Fallback if difference fails
        // @ts-ignore
        leasablePoly = turf.difference(buildingPoly, coreGeom);
        if (!leasablePoly) leasablePoly = buildingPoly;
    }

    // Use unitMix if provided, otherwise fall back to default behavior
    if (params.unitMix && params.unitMix.length > 0) {
        // Calculate total leasable area
        const totalLeasableArea = turf.area(leasablePoly);

        // Calculate weighted average unit size from mix
        const weightedAvgSize = params.unitMix.reduce((acc, unit) =>
            acc + (unit.area * unit.mixRatio), 0);

        // Estimate total units that can fit
        const estimatedTotalUnits = Math.floor(totalLeasableArea / weightedAvgSize);

        console.log(`[Layout Generator] UnitMix Mode: ${estimatedTotalUnits} total units estimated`);

        // Generate units for each type in the mix
        let unitIndex = 0;
        params.unitMix.forEach(unitType => {
            const targetCount = Math.round(estimatedTotalUnits * unitType.mixRatio);
            const gridSizeM = Math.sqrt(unitType.area);

            console.log(`[Layout Generator] Generating ${targetCount}x ${unitType.name} (${unitType.area}m²)`);

            // Create adaptive grid for this unit type
            const gridOptions = { mask: buildingPoly, units: 'meters' as const };
            // @ts-ignore
            const grid = turf.squareGrid(bbox, gridSizeM, gridOptions);

            let unitsCreated = 0;
            grid.features.forEach((cell: Feature<Polygon>) => {
                if (unitsCreated >= targetCount) return; // Stop when we have enough of this type

                try {
                    // @ts-ignore
                    const intersection = turf.intersect(cell, leasablePoly);

                    if (intersection) {
                        const area = turf.area(intersection);

                        // Accept if area is close to target (±30% tolerance)
                        if (area > unitType.area * 0.7 && area < unitType.area * 1.3) {
                            // Alternate colors for visual distinction
                            const baseColor = getColorForUnitType(unitType.name);
                            const color = unitIndex % 2 === 0 ? baseColor : darkenColor(baseColor);

                            units.push({
                                id: `unit-${unitIndex}`,
                                type: unitType.name,
                                geometry: intersection as Feature<Polygon>,
                                color
                            });
                            unitsCreated++;
                            unitIndex++;
                        }
                    }
                } catch (e) { }
            });

            console.log(`[Layout Generator] Created ${unitsCreated}/${targetCount} ${unitType.name} units`);
        });

    } else {
        // Fallback: Original grid-based approach with hardcoded thresholds
        const gridSizeM = Math.sqrt(targetUnitSize);
        const gridOptions = { mask: buildingPoly, units: 'meters' as const };
        // @ts-ignore
        const grid = turf.squareGrid(bbox, gridSizeM, gridOptions);

        grid.features.forEach((cell: any, idx: number) => {
            try {
                // @ts-ignore
                const intersection = turf.intersect(cell, leasablePoly);

                if (intersection) {
                    const area = turf.area(intersection);

                    if (area > minUnitSize * 0.5) {
                        let type = 'Studio';
                        let color = '#ADD8E6';

                        if (area > 245) { type = '4BHK+'; color = idx % 2 === 0 ? '#FFD700' : '#E6C200'; }
                        else if (area > 185) { type = '3BHK'; color = idx % 2 === 0 ? '#4169E1' : '#3658B8'; }
                        else if (area > 140) { type = '2BHK'; color = idx % 2 === 0 ? '#1E90FF' : '#1578D6'; }
                        else if (area > 55) { type = '1BHK'; color = idx % 2 === 0 ? '#87CEFA' : '#76B5DE'; }
                        else { type = 'Studio'; color = idx % 2 === 0 ? '#ADD8E6' : '#9AC0CD'; }

                        units.push({
                            id: `unit-${idx}`,
                            type,
                            geometry: intersection as Feature<Polygon>,
                            color
                        });
                    }
                }
            } catch (e) { }
        });
    }

    // 3. Generate Entrances (NEW)
    try {
        // Find best edge for entrance based on Vastu/Roads
        const buildingCenter = turf.centroid(buildingPoly);
        // Explode polygon to gets points (edges are between points)
        // @ts-ignore
        const vertices = turf.explode(buildingPoly).features;

        let bestCandidatePoint: any = null;
        let bestCandidateScore = -1;

        // Iterate edges (pairs of vertices)
        for (let i = 0; i < vertices.length - 1; i++) {
            const p1 = vertices[i];
            const p2 = vertices[i + 1];
            const edgeMid = turf.midpoint(p1, p2);

            // Get direction from building center to edge mid
            const bearing = turf.bearing(buildingCenter, edgeMid);
            const direction = getCardinalDirection(bearing);

            let score = 0;

            if (params.vastuCompliant) {
                // Vastu Priorities: NE (Best), E, N
                // NE implies bearing ~45
                const b = (bearing + 360) % 360;
                if (b > 20 && b < 70) score = 100; // NE
                else if (direction === 'E') score = 80;
                else if (direction === 'N') score = 70;
                else if (direction === 'S') score = 10;
                else if (direction === 'W') score = 20;
                else score = 30; // Others (SE, NW, SW)
            }
            else if (params.roadAccessSides && params.roadAccessSides.length > 0) {
                // Determine score based on road access
                if (params.roadAccessSides.includes(direction)) score = 100;
                else score = 10;
            }
            else {
                // Default fallback (South entry is standard/safe default?)
                // Actually, just pick any valid edge that's long enough
                if (direction === 'S') score = 60;
                else score = 50;
            }

            // Penalize very short edges (corners/notches)
            const dist = turf.distance(p1, p2, { units: 'meters' });
            if (dist < 4) score -= 50;

            if (score > bestCandidateScore) {
                bestCandidateScore = score;
                bestCandidatePoint = edgeMid;
            }
        }

        if (bestCandidatePoint) {
            entrances.push({
                id: 'main-access',
                type: 'Both',
                position: bestCandidatePoint.geometry.coordinates as [number, number],
                name: 'Main Entrance / Exit'
            });
        }

    } catch (e) {
        console.warn('Error generating entrance:', e);
    }

    // 4. Efficiency Validation
    const totalArea = turf.area(buildingPoly);
    let totalUnitArea = 0;
    units.forEach(u => totalUnitArea += turf.area(u.geometry));
    const efficiency = totalUnitArea / totalArea;
    const efficiencyPercent = (efficiency * 100).toFixed(1);

    return { cores, units, entrances, utilities, efficiency: parseFloat(efficiencyPercent) };
}

/**
 * Determines Utility Size and Placement based on Vastu or User Logic
 * NOW: Uses deterministic, calculation-based sizing and placement
 */
interface UtilityDef {
    type: UtilityType;
    name: string;
    area: number; // m2
    color: string;
    height: number;
}

/**
 * Calculate corner reservation zones for utilities (to be avoided by buildings)
 * This should be called BEFORE building generation when Vastu is enabled
 */
export function calculateUtilityReservationZones(
    plotPoly: Feature<Polygon>,
    vastuCompliant: boolean = false
): Feature<Polygon>[] {
    if (!vastuCompliant) return [];

    const reservationZones: Feature<Polygon>[] = [];
    const bbox = turf.bbox(plotPoly);
    const minX = bbox[0];
    const minY = bbox[1];
    const maxX = bbox[2];
    const maxY = bbox[3];

    // Reserve approximately 35m x 35m in each required corner (Increased to 35m to ensure gap)
    // This is a rough estimate - actual utilities will be placed within these zones
    const reserveSize = 35; // meters
    const wPerDeg = 111320;
    const hPerDeg = 110540;
    const reserveSizeDegX = reserveSize / wPerDeg;
    const reserveSizeDegY = reserveSize / hPerDeg;

    // NE Corner - Water (UGT)
    const neZone = turf.bboxPolygon([
        maxX - reserveSizeDegX,
        maxY - reserveSizeDegY,
        maxX,
        maxY
    ]);
    reservationZones.push(neZone);

    // SE Corner - Electrical/Fire
    const seZone = turf.bboxPolygon([
        maxX - reserveSizeDegX,
        minY,
        maxX,
        minY + reserveSizeDegY
    ]);
    reservationZones.push(seZone);

    // NW Corner - STP/WTP/Waste
    const nwZone = turf.bboxPolygon([
        minX,
        maxY - reserveSizeDegY,
        minX + reserveSizeDegX,
        maxY
    ]);
    reservationZones.push(nwZone);

    console.log(`[Utility Reservation] Created ${reservationZones.length} corner zones for Vastu utilities`);
    return reservationZones;
}

export function generateSiteUtilities(
    plotPoly: Feature<Polygon>,
    buildings: any[], // Array of building features containing units
    vastuCompliant: boolean = false,
    obstacles: Feature<Polygon>[] = [] // Roads, Parking, etc.
): { utilities: any[], buildings: any[] } {
    const utilities: any[] = [];
    const minX = turf.bbox(plotPoly)[0];
    const minY = turf.bbox(plotPoly)[1];
    const maxX = turf.bbox(plotPoly)[2];
    const maxY = turf.bbox(plotPoly)[3];

    // --- 1. CALCULATE DEMAND ---

    // Estimate population
    let totalUnits = 0;
    buildings.forEach(b => {
        if (b.properties && b.properties.units && Array.isArray(b.properties.units)) {
            totalUnits += b.properties.units.length;
        } else {
            // Estimate based on area if units not populated yet
            try {
                // Handle various input shapes (Feature or Geometry)
                let area = 0;
                if (b.type === 'Feature' || b.type === 'Polygon' || b.type === 'MultiPolygon') {
                    area = turf.area(b);
                } else if (b.geometry) {
                    area = turf.area(b.geometry);
                }

                if (area > 0) {
                    const floors = (b.properties && b.properties.floors) ? b.properties.floors : 5;
                    totalUnits += Math.floor(area / 80) * floors;
                }
            } catch (e) {
                console.warn('[Utility Generator] Error calculating building area for unit estimate:', e);
            }
        }
    });

    if (totalUnits === 0) totalUnits = 50; // Safety baseline

    // Assumptions
    const avgPersonsPerUnit = 4; // Standard assumption
    const population = totalUnits * avgPersonsPerUnit;
    const waterDemandPerPerson = 135; // LPCD
    const totalWaterDemand = population * waterDemandPerPerson; // Liters/Day

    // --- 2. SIZING UTILITIES ---

    // STP (Sewage Treatment Plant)
    // Formula: C_stp = (P * 135) * 0.8 / 1000 (KLD)
    const stpCapacityKLD = (population * 135 * 0.8) / 1000;
    const stpArea = Math.max(9, Math.ceil(stpCapacityKLD * 1.0)); // 1.0 sqm per KLD

    // UGT (Underground Water Tank)
    // Formula: Volume = TDD = Population * 135
    const ugtVolume = (population * 135) / 1000; // m3
    const ugtArea = Math.max(15, Math.ceil(ugtVolume / 2.5)); // Min 15m2, 2.5m depth

    // WTP (Water Treatment Plant)
    // Formula: C_wtp = P * 135 * 1.1 / 1000
    const wtpCapacityKLD = (population * 135 * 1.1) / 1000;
    const wtpArea = Math.max(6, Math.ceil(wtpCapacityKLD * 0.4));

    // OWC (Organic Waste Converter)
    // Formula: Capacity = Total Units * 0.5 kg/day
    const owcCapacityKg = totalUnits * 0.5;
    const owcArea = Math.max(6, Math.ceil(owcCapacityKg / 40));

    // DG Set (Diesel Generator)
    // Formula: KVA = (Essential Load * 0.8) / (0.9 * 0.8)
    // Essential Load = 3kW * No of units
    const essentialLoad = 3 * totalUnits;
    const dgKVA = (essentialLoad * 0.8) / (0.9 * 0.8);
    const dgArea = Math.max(9, Math.ceil(dgKVA * 0.08));

    // Electrical Room / Transformer
    const transformerArea = 12;
    const electricalRoomArea = 8;

    // Gas Bank
    const gasArea = 8;

    // Fire Pump Room (SE)
    const firePumpRoomArea = Math.max(15, Math.ceil(population * 0.01));

    // Admin / Security Office (SW)
    const adminBlockArea = Math.max(20, Math.ceil(population * 0.02));

    console.log(`[Utility Generator] Units: ${totalUnits}, Pop: ${population}, Demand: ${totalWaterDemand}L`);
    console.log(`[Utility Sizes] STP: ${stpArea}m², UGT: ${ugtArea}m², DG: ${dgArea}m²`);

    // --- 3. GROUPING & PLACEMENT ZONES ---

    const groupNE: UtilityDef[] = [];
    const groupSE: UtilityDef[] = [];
    const groupNW: UtilityDef[] = [];
    const groupSW: UtilityDef[] = [];

    const plotOrientation = getPlotOrientation(plotPoly);

    if (vastuCompliant) {
        // VASTU LOGIC
        // NE: Water (Elements: Water, Divine)
        groupNE.push({ type: UtilityType.Water, name: 'UGT (Water)', area: ugtArea, color: '#4FC3F7', height: 0.5 }); // Underground

        // SE: Fire / Electrical (Element: Fire)
        groupSE.push({ type: UtilityType.Electrical, name: 'Transformer Yard', area: transformerArea, color: '#FF9800', height: 3 });
        groupSE.push({ type: UtilityType.Electrical, name: 'DG Set', area: dgArea, color: '#FFB74D', height: 2.5 });
        groupSE.push({ type: UtilityType.Gas, name: 'Gas Bank', area: gasArea, color: '#F48FB1', height: 2 });
        groupSE.push({ type: UtilityType.Fire, name: 'Fire Pump Room', area: firePumpRoomArea, color: '#FF5722', height: 2.5 }); // Strictly SE

        // NW: Waste
        groupNW.push({ type: UtilityType.STP, name: 'STP Plant', area: stpArea, color: '#BA68C8', height: 0.5 });
        groupNW.push({ type: UtilityType.SolidWaste, name: 'OWC (Waste)', area: owcArea, color: '#8D6E63', height: 2 });
        // WTP also in NW (Water processing/Waste related)
        groupNW.push({ type: UtilityType.WTP, name: 'WTP Plant', area: wtpArea, color: '#29B6F6', height: 3 });

        // SW: Heavy / Earth / Admin
        // Vastu: Admin/Security in SW (Earth element, Owner's Cabin)
        groupSW.push({ type: UtilityType.Admin, name: 'Admin / Security', area: adminBlockArea, color: '#FDD835', height: 3 }); // Yellow for Earth

    } else {
        // NON-VASTU / USER DEFINED LOGIC
        // Corner 1 (NE): Water + Fire
        groupNE.push({ type: UtilityType.Water, name: 'UGT (Water)', area: ugtArea, color: '#4FC3F7', height: 0.5 });
        groupNE.push({ type: UtilityType.Fire, name: 'Fire Tank', area: 50, color: '#F44336', height: 2 }); // Separate fire tank if customized

        // Corner 2 (SE): Electrical
        groupSE.push({ type: UtilityType.Electrical, name: 'Electrical Cluster', area: transformerArea + dgArea + electricalRoomArea, color: '#FF9800', height: 3 });

        // Corner 3 (NW): STP + OWC
        groupNW.push({ type: UtilityType.STP, name: 'STP + WTP', area: stpArea + wtpArea, color: '#BA68C8', height: 0.5 });
        groupNW.push({ type: UtilityType.SolidWaste, name: 'OWC', area: owcArea, color: '#8D6E63', height: 2 });

        // Corner 4 (SW): Gas + Others
        groupSW.push({ type: UtilityType.Gas, name: 'Gas Bank', area: gasArea, color: '#F48FB1', height: 2 });
    }

    // --- 3. PLACEMENT ALGORITHM ---

    const placeGroupInCorner = (group: UtilityDef[], corner: 'NE' | 'SE' | 'SW' | 'NW'): UtilityDef[] => {
        const failedItems: UtilityDef[] = [];
        if (group.length === 0) return [];

        // Constants for placement
        const margin = 1.5; // Reduced from 3m for compact layout
        const gap = 1.0; // Reduced from 2m for compact layout
        const wPerDeg = 111320;
        const hPerDeg = 110540;

        // Determine Corner Coordinates (BBox)
        let cornerX = 0, cornerY = 0;
        let growX = 0, growY = 0; // Direction for packing: 1 or -1

        if (corner === 'NE') { cornerX = maxX; cornerY = maxY; growX = -1; growY = -1; }
        if (corner === 'SE') { cornerX = maxX; cornerY = minY; growX = -1; growY = 1; }
        if (corner === 'SW') { cornerX = minX; cornerY = minY; growX = 1; growY = 1; }
        if (corner === 'NW') { cornerX = minX; cornerY = maxY; growX = 1; growY = -1; }

        console.log(`[Utility Debug] Placing in ${corner}: bbox=[${minX}, ${minY}, ${maxX}, ${maxY}], corner=[${cornerX}, ${cornerY}]`);

        // Find Valid Start Point (March inward from corner towards centroid)
        const plotCentroid = turf.centroid(plotPoly);
        const centerCoords = plotCentroid.geometry.coordinates;
        let currentPoint = turf.point([cornerX, cornerY]);

        // Safety Break
        let steps = 0;
        const maxSteps = 1000; // 1000 meters max search inward (Increased for large plots)

        // March Inward Loop
        // @ts-ignore
        while (!turf.booleanPointInPolygon(currentPoint, plotPoly) && steps < maxSteps) {
            // Move 1 meter towards centroid
            const bearing = turf.bearing(currentPoint, plotCentroid);
            currentPoint = turf.destination(currentPoint, 1, bearing, { units: 'meters' });
            steps++;
        }

        if (steps >= maxSteps) {
            console.warn(`[Utility Debug] Could not find valid start point for corner ${corner}`);
            return group; // Skip this group if no valid point found
        }

        // Apply Margin inward
        const bearing = turf.bearing(currentPoint, plotCentroid);
        currentPoint = turf.destination(currentPoint, margin, bearing, { units: 'meters' });

        let [cursorX, cursorY] = currentPoint.geometry.coordinates;

        // Packing Strategy:
        // Attempt to place items in a row along X (Width).
        // If row is full or blocked, move to next row (Y).

        // Grid Search Strategy: Scans nearest valid spots to the corner
        // 0 to 50m range in both X and Y directions

        group.forEach(util => {
            let placed = false;
            let bestDist = Infinity;
            let bestPoly: Feature<Polygon> | null = null;

            const side = Math.sqrt(util.area);
            const uW = side;
            const uH = side;
            const uWDeg = uW / wPerDeg;
            const uHDeg = uH / hPerDeg;

            // Search range: 0 to 40 (steps) roughly covering 0-120m
            // Step size approx 3m
            const maxSteps = 40;
            const stepM = 3;

            for (let i = 0; i < maxSteps; i++) {
                for (let j = 0; j < maxSteps; j++) {
                    if (placed) break; // Optimization if we decided to break early (not used for best-fit logic but valid here)

                    // Calculate offsets based on Grow direction
                    // growX=1 means we want to interact with higher X (move Right)
                    // We start at corner and move INWARD.

                    const offsetX = i * stepM / wPerDeg * growX;
                    const offsetY = j * stepM / hPerDeg * growY;

                    // Define Candidate Poly (Top-Left anchor relative to scan)
                    // Original logic: x1 is Start, x2 is Start + Width
                    // We need to ensure we shift FROM the cursor

                    const originX = cursorX + offsetX;
                    const originY = cursorY + offsetY;

                    // Use rotated rectangle helper!
                    const poly = createRotatedRect(turf.point([originX, originY]), uW, uH, plotOrientation);

                    // 1. BOUNDARY CHECK
                    let inside = false;
                    try {
                        // Use a strictly buffered safe zone (-1.0m) to enforce the requested setback
                        // @ts-ignore
                        const safeContainer = turf.buffer(plotPoly, -1.0, { units: 'meters' }) || plotPoly;
                        // @ts-ignore
                        inside = turf.booleanContains(safeContainer, poly);
                    } catch (e) { }

                    if (!inside) continue;

                    // 2. PRE-CALCULATE BUFFERED POLY (Ensure Gap)
                    let bufferedPoly;
                    try {
                        // Use consistent gap of 1.0m for all checks
                        // @ts-ignore
                        bufferedPoly = turf.buffer(poly, 1.0, { units: 'meters' });
                    } catch (e) { bufferedPoly = poly; }
                    const checkPoly = bufferedPoly || poly;

                    // 3. OBSTACLE CHECK (Roads, Parking, etc) - Use BUFFERED to ensure gap
                    let obstacleOverlap = false;
                    for (const obst of obstacles) {
                        try {
                            if (obst && obst.geometry) {
                                // Check against buffered/gapped geometry
                                // @ts-ignore
                                if (turf.booleanIntersects(checkPoly, obst.geometry)) { obstacleOverlap = true; break; }
                            }
                        } catch (e) { }
                    }

                    if (obstacleOverlap) continue;

                    // 4. EXISTING BUILDING CHECK - Use BUFFERED
                    let buildingOverlap = false;
                    for (const b of buildings) {
                        try {
                            if (b && b.geometry && b.visible !== false) {
                                // Check against buffered/gapped geometry
                                // @ts-ignore
                                if (turf.booleanIntersects(checkPoly, b.geometry)) { buildingOverlap = true; break; }
                            }
                        } catch (e) { }
                    }

                    // FORCE RESOLVE: If overlapping building at PRIORITY CORNER spot
                    if (buildingOverlap) {
                        // Priority range increased to 10 steps to ensure Vastu spot
                        const isHighPriority = (i <= 10 && j <= 10);

                        if (isHighPriority) {
                            // Identify colliders
                            const colliding = buildings.filter(b => b.visible !== false && turf.booleanIntersects(checkPoly, b.geometry));

                            for (const b of colliding) {
                                if (!b.geometry) continue;

                                // Helper: Validate if a geometry works (Fits in plot, clears utility, no building clashes)
                                const isValidCandidate = (geo: any) => {
                                    try {
                                        // 1. Must be inside Plot - REMOVED: Since we rely on Resize (Scale) in place, 
                                        // we assume original building was valid. strict check against 'plotPoly' (which might be innerSetback) 
                                        // would incorrectly flag buildings in the setback as invalid.
                                        // if (!turf.booleanContains(plotPoly, geo)) return false;

                                        // 2. Must NOT overlap the Utility (+Gap) we are trying to place
                                        // @ts-ignore
                                        if (turf.booleanIntersects(geo, checkPoly)) return false;

                                        // 3. Must NOT overlap OTHER buildings
                                        for (const other of buildings) {
                                            if (other.id === b.id || other.visible === false) continue;
                                            // @ts-ignore
                                            if (turf.booleanIntersects(geo, other.geometry)) return false;
                                        }
                                        return true;
                                    } catch (e) { return false; }
                                };

                                let resolved = false;

                                // STRATEGY 1: RESIZE (Shrink)
                                try {
                                    const bbox = turf.bbox(b);
                                    // @ts-ignore
                                    const w = turf.distance(turf.point([bbox[0], bbox[1]]), turf.point([bbox[2], bbox[1]]), { units: 'meters' });
                                    // @ts-ignore
                                    const h = turf.distance(turf.point([bbox[0], bbox[1]]), turf.point([bbox[0], bbox[3]]), { units: 'meters' });

                                    if (w > 20 && h > 20) { // Only shrink if reasonable size
                                        const scales = [0.9, 0.8, 0.7, 0.65, 0.6]; // Try more aggressive reduction (down to 60%)
                                        for (const s of scales) {
                                            // @ts-ignore
                                            const scaled = turf.transformScale(b, s);
                                            if (isValidCandidate(scaled.geometry)) {
                                                b.geometry = scaled.geometry;
                                                console.log(`[Utility Force] Shrunk building ${b.id} by factor ${s} to fit`);
                                                resolved = true;
                                                break;
                                            }
                                        }
                                    }
                                } catch (e) { console.warn('Resize failed', e); }

                                if (resolved) continue;

                                // STRATEGY 2: REMOVE (Last Resort - Move Removed to prevent overlaps)
                                b.visible = false;
                                console.log(`[Utility Force] Removing building ${b.id} (Resize failed)`);
                            }
                            // Assume resolved
                            buildingOverlap = false;
                        }
                    }

                    if (buildingOverlap) continue;

                    // 4. UTILITY CHECK - Strict (with gap)
                    let utilityOverlap = false;
                    let bufferedCandidate;
                    try {
                        // Check against buffered candidate to ensure gap
                        // @ts-ignore
                        bufferedCandidate = turf.buffer(poly, gap, { units: 'meters' });
                    } catch (e) { bufferedCandidate = poly; }

                    for (const u of utilities) {
                        try {
                            // Check direct overlap (Critical)
                            // @ts-ignore
                            if (turf.booleanIntersects(poly, u.geometry)) { utilityOverlap = true; break; }

                            // Check gap overlap
                            // @ts-ignore
                            if (bufferedCandidate && turf.booleanIntersects(bufferedCandidate, u.geometry)) { utilityOverlap = true; break; }
                        } catch (e) { }
                    }
                    if (utilityOverlap) continue;

                    // VALID SPOT FOUND
                    // Logic: We want the one closest to the corner (i=0, j=0)
                    // Since we iterate i,j from 0..Max, the first one we find is roughly the best "corner-most"
                    // However, diagonal (1,1) might be better than (0,5).
                    // Let's settle for first valid for now (greedy), or minimize i+j.

                    // Greedy approach:
                    utilities.push({
                        id: `util-${util.type.toLowerCase()}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
                        name: util.name,
                        type: util.type,
                        geometry: poly as Feature<Polygon>,
                        area: util.area,
                        centroid: turf.centroid(poly),
                        visible: true,
                        color: util.color
                    });

                    console.log(`[Utility Debug] ✓ Placed ${util.name} in ${corner} (Grid ${i},${j})`);
                    placed = true;

                    // Update cursor for next utility in group? 
                    // No, for next utility we should check collisions with THIS utility, so we can restart scan.
                    // But we don't want to stack them exactly on top of the search path.
                    // The 'utilityOverlap' check handles this. We just continue loop.
                    break;
                }
                if (placed) break;
            }

            if (!placed) {
                console.warn(`[Utility] Could not place ${util.name} in ${corner} after grid search.`);
                failedItems.push(util);
            }
        });
        return failedItems;
    };

    // Execute Placement (Primary Vastu Directions)
    // We capture failures to attempt secondary (acceptable) directions
    const failedNE = placeGroupInCorner(groupNE, 'NE');
    const failedSE = placeGroupInCorner(groupSE, 'SE');
    const failedNW = placeGroupInCorner(groupNW, 'NW'); // STP/OWC/WTP might fail here
    const failedSW = placeGroupInCorner(groupSW, 'SW');

    // --- FAILOVER LOGIC (Strict Vastu Compliance) ---

    // 1. STP / WTP / OWC: Best = NW, Good = SE. Avoid = NE.
    // If NW failed, try SE.
    const retrySE: UtilityDef[] = [];
    failedNW.forEach(u => {
        if (['STP', 'WTP', 'OWC'].some(t => u.type.includes(t) || u.name.includes(t))) {
            console.log(`[Utility Failover] Moving ${u.name} from NW to SE (Acceptable Direction)`);
            retrySE.push(u);
        }
    });

    if (retrySE.length > 0) {
        placeGroupInCorner(retrySE, 'SE');
    }

    return { utilities, buildings };
}

/**
 * Generates entry and exit points for the site.
 * Logic:
 * 1. If Vastu is enabled: Place gates in the auspicious zones (N3, N4, E3, E4, S3, S4, W3, W4)
 *    that intersect with the plot boundary on sides with road access.
 * 2. If Vastu is disabled: Place gates where internal roads intersect with the external plot boundary.
 */
export function generateSiteGates(
    plotPoly: Feature<Polygon | MultiPolygon>,
    vastuCompliant: boolean = false,
    roadAccessSides: string[] = [],
    internalRoads: Feature<Polygon | MultiPolygon>[] = [],
    existingBuildings: Building[] = []
): EntryPoint[] {
    const gates: EntryPoint[] = [];

    // Auto-detect road sides from plot bbox if not provided
    let sides = roadAccessSides.length > 0 ? roadAccessSides : ['N', 'S', 'E', 'W'];
    console.log(`[Gates] Using road access sides: ${sides.join(', ')} (auto=${roadAccessSides.length === 0})`);

    // Get plot boundary coordinates
    const bbox = turf.bbox(plotPoly);
    const [minX, minY, maxX, maxY] = bbox;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    // Get the plot boundary ring for finding the closest point on boundary
    let coords: number[][] = [];
    try {
        const geom = plotPoly.type === 'Feature' ? plotPoly.geometry : plotPoly;
        if (geom.type === 'Polygon') {
            coords = (geom as Polygon).coordinates[0];
        } else if (geom.type === 'MultiPolygon') {
            coords = (geom as MultiPolygon).coordinates[0][0];
        }
    } catch (e) {
        console.warn('[Gates] Could not extract coordinates');
        return [];
    }

    if (coords.length < 4) return [];

    // Helper: find the point on the plot boundary closest to a target point
    const findClosestBoundaryPoint = (targetLng: number, targetLat: number): [number, number] => {
        const targetPt = turf.point([targetLng, targetLat]);
        const plotLine = turf.polygonToLine(plotPoly);
        const snapped = turf.nearestPointOnLine(plotLine as any, targetPt);
        return snapped.geometry.coordinates as [number, number];
    };

    // Helper: Check if a point collides with any existing building (with buffer)
    const isColliding = (point: [number, number]): boolean => {
        const pt = turf.point(point);
        // Add 5m buffer around gate point for safety
        const buffer = turf.buffer(pt, 5, { units: 'meters' });

        return existingBuildings.some(b => {
            // Use building geometry for collision check
            // @ts-ignore
            return turf.booleanOverlap(buffer, b.geometry) || turf.booleanContains(b.geometry, pt) || turf.booleanPointInPolygon(pt, b.geometry);
        });
    };

    // Helper: Find a valid non-colliding position near target point
    const findValidPosition = (targetLng: number, targetLat: number): [number, number] | null => {
        let bestPos = findClosestBoundaryPoint(targetLng, targetLat);

        if (!existingBuildings || existingBuildings.length === 0) return bestPos;

        if (!isColliding(bestPos)) return bestPos;

        // If colliding, search along boundary in both directions
        const plotLine = turf.polygonToLine(plotPoly);
        const lineLength = turf.length(plotLine as any, { units: 'meters' });
        const step = 5; // Search every 5 meters
        const maxSearch = 50; // Search up to 50m in each direction

        const startPt = turf.point(bestPos);
        // @ts-ignore
        const startDist = turf.nearestPointOnLine(plotLine as any, startPt).properties.location;

        for (let d = step; d <= maxSearch; d += step) {
            // Check forward
            const fwdDist = (startDist + d) % lineLength;
            const fwdPt = turf.along(plotLine as any, fwdDist, { units: 'meters' });
            const fwdPos = fwdPt.geometry.coordinates as [number, number];
            if (!isColliding(fwdPos)) return fwdPos;

            // Check backward
            let backDist = (startDist - d);
            if (backDist < 0) backDist += lineLength;
            const backPt = turf.along(plotLine as any, backDist, { units: 'meters' });
            const backPos = backPt.geometry.coordinates as [number, number];
            if (!isColliding(backPos)) return backPos;
        }

        console.warn('[Gates] Could not find non-colliding position for gate, defaulting to collision');
        return bestPos;
    };

    // Vastu-compliant gate placement targets specific angular sectors
    // Non-Vastu just places gates at the midpoint of each road-facing side
    const sideTargets: Record<string, [number, number]> = {
        'N': [cx, maxY],             // North midpoint
        'S': [cx, minY],             // South midpoint
        'E': [maxX, cy],             // East midpoint
        'W': [minX, cy],             // West midpoint
    };

    if (vastuCompliant) {
        console.log(`[Gate Generator] Vastu mode enabled. Sides: ${sides.join(', ')}`);
        // Use the dedicated Vastu Gate Generator for precise ray-casting
        const center: [number, number] = [cx, cy];
        const newGates = generateVastuGates(plotPoly as Feature<Polygon>, center, sides);

        // Add collision checking for the generated gates
        newGates.forEach(g => {
            // Check if the generated position collides with buildings
            // If so, try to find a valid position nearby
            let pos = g.position;
            if (isColliding(pos)) {
                const validPos = findValidPosition(pos[0], pos[1]);
                if (validPos) {
                    pos = validPos;
                } else {
                    return; // Skip if no valid position found
                }
            }

            gates.push({
                ...g,
                position: pos
            });
        });
    } else {
        // Non-Vastu: place at side midpoints
        sides.forEach(side => {
            const target = sideTargets[side];
            if (!target) return;
            const pos = findValidPosition(target[0], target[1]);
            if (!pos) return;

            gates.push({
                id: `gate-side-${side}-${Math.random().toString(36).substr(2, 5)}`,
                type: 'Both',
                position: pos,
                name: `${side} Gate`
            });
        });
    }

    console.log(`[Gates] Successfully generated ${gates.length} gates`);
    return gates;
}
