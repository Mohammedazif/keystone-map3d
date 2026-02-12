
import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon } from 'geojson';
import { Building, Core, Unit, UnitTypology, UtilityArea, UtilityType } from '../types';

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
 * Generates an internal layout (Cores + Units) for a given building geometry.
 */
export function generateBuildingLayout(
    buildingPoly: Feature<Polygon | MultiPolygon>,
    params: LayoutParams = {}
): { cores: Core[], units: Unit[], entrances: any[], utilities: UtilityArea[], efficiency?: number } {

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
            grid.features.forEach((cell) => {
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
 * Generates site utilities (STP, WTP, Water Tank) based on Vastu or logical placement.
 */
export function generateSiteUtilities(
    plotPoly: Feature<Polygon>,
    buildings: any[], // detailed shape validation done inside
    vastuCompliant: boolean = false
): any[] {
    const utilities: any[] = [];
    const bbox = turf.bbox(plotPoly); // [minX, minY, maxX, maxY]
    const minX = bbox[0], minY = bbox[1], maxX = bbox[2], maxY = bbox[3];
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    // Define Quadrant BBoxes
    const qNE = [midX, midY, maxX, maxY]; // Top-Right
    const qNW = [minX, midY, midX, maxY]; // Top-Left
    const qSE = [midX, minY, maxX, midY]; // Bottom-Right
    const qSW = [minX, minY, midX, midY]; // Bottom-Left (Avoid for utilities in Vastu)

    // Helper to find a valid spot in a quadrant
    const findSpotInQuadrant = (quadBBox: number[], utilSize = 6): Feature<Polygon> | null => {
        // Try random spots in quadrant
        for (let i = 0; i < 15; i++) {
            const w = (utilSize / 111320); // deg approx
            const h = (utilSize / 110540);

            // Random pos within quadrant (with margin)
            const x = quadBBox[0] + Math.random() * (quadBBox[2] - quadBBox[0] - w);
            const y = quadBBox[1] + Math.random() * (quadBBox[3] - quadBBox[1] - h);

            const poly = turf.bboxPolygon([x, y, x + w, y + h]);

            // 1. Must be inside Plot
            // @ts-ignore
            if (!turf.booleanContains(plotPoly, poly)) continue;

            // 2. Must NOT intersect Buildings
            let overlap = false;
            for (const b of buildings) {
                // @ts-ignore
                if (turf.booleanOverlap(poly, b.geometry) || turf.booleanIntersects(poly, b.geometry)) {
                    overlap = true;
                    break;
                }
            }
            if (overlap) continue;

            // 3. Must NOT intersect existing utilities
            for (const u of utilities) {
                // @ts-ignore
                if (turf.booleanDisjoint(poly, u.geometry) === false) { overlap = true; break; }
            }
            if (overlap) continue;

            return poly as Feature<Polygon>;
        }
        return null;
    };

    // Configuration
    // Vastu: Tank->NE, STP->NW, WTP->SE
    // Non-Vastu: Group them in service corners (Rear/Side) -> usually NW/SE/SW. SW is fine if not Vastu.

    // 1. Water Tank (Underground)
    let tankQuad = vastuCompliant ? qNE : qNW;
    const tankPoly = findSpotInQuadrant(tankQuad, 5); // 5x5m
    if (tankPoly) {
        utilities.push({
            id: `util-tank-${Date.now()}`,
            name: 'Water Tank (UG)',
            type: 'Water Tank',
            geometry: tankPoly,
            area: 25,
            centroid: turf.centroid(tankPoly),
            visible: true
        });
    }

    // 2. STP (Sewage)
    let stpQuad = vastuCompliant ? qNW : qSE; // Vastu: NW or SE (NW preferred for septic). Non-Vastu: SE (Low point?)
    const stpPoly = findSpotInQuadrant(stpQuad, 8); // 8x8m larger
    if (stpPoly) {
        utilities.push({
            id: `util-stp-${Date.now()}`,
            name: 'STP Plant',
            type: 'STP', // Matches color purple
            geometry: stpPoly,
            area: 64,
            centroid: turf.centroid(stpPoly),
            visible: true
        });
    }

    // 3. WTP (Water Treatment)
    let wtpQuad = vastuCompliant ? qSE : qSW; // Vastu: SE (Fire corner/Pumps). Non-Vastu: Any
    const wtpPoly = findSpotInQuadrant(wtpQuad, 6);
    if (wtpPoly) {
        utilities.push({
            id: `util-wtp-${Date.now()}`,
            name: 'WTP Plant',
            type: 'WTP', // Matches color blue
            geometry: wtpPoly,
            area: 36,
            centroid: turf.centroid(wtpPoly),
            visible: true
        });
    }

    return utilities;
}
