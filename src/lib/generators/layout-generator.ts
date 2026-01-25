
import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon } from 'geojson';
import { Building, Core, Unit, UnitTypology } from '../types';

interface LayoutParams {
    minUnitSize?: number; // sqm, e.g. 50
    avgUnitSize?: number; // sqm, e.g. 100
    corridorWidth?: number; // meters, e.g. 2
    subtype?: string; // e.g. 'lshaped', 'ushaped', 'tshaped', 'hshaped'
    roadAccessSides?: string[]; // ['N', 'E']
    vastuCompliant?: boolean;
    unitMix?: UnitTypology[]; // Admin panel unit mix configuration
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
): { cores: Core[], units: Unit[], entrances: any[], efficiency?: number } {
    const cores: Core[] = [];
    const units: Unit[] = [];
    const entrances: any[] = []; // EntryPoint type but using any here to avoid importing deep types

    const minUnitSize = params.minUnitSize || 60;
    const targetUnitSize = params.avgUnitSize || 120;

    // 1. Generate Core
    // Strategy: Try Centroid -> CenterOfMass -> PointOnFeature (Fallback)
    let centerPoint = turf.centroid(buildingPoly);

    // Specific logic for complex shapes
    if (params.subtype === 'hshaped') {
        centerPoint = turf.center(buildingPoly);
    } else if (params.subtype === 'ushaped') {
        centerPoint = turf.pointOnFeature(buildingPoly);
    } else {
        // @ts-ignore
        if (!turf.booleanContains(buildingPoly, centerPoint)) {
            centerPoint = turf.centerOfMass(buildingPoly);
            // @ts-ignore
            if (!turf.booleanContains(buildingPoly, centerPoint)) {
                centerPoint = turf.pointOnFeature(buildingPoly);
            }
        }
    }

    const bbox = turf.bbox(buildingPoly);
    const width = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const depth = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });

    const coreSizeFactor = params.subtype === 'ushaped' ? 0.10 : 0.15;
    const coreW = Math.min(8, Math.max(4, width * coreSizeFactor));
    const coreD = Math.min(8, Math.max(4, depth * coreSizeFactor));

    // Create Core Polygon centered at calculated center
    const centerCoords = centerPoint.geometry.coordinates;
    let corePoly = turf.bboxPolygon([
        centerCoords[0] - (coreW / 2) / 111320,
        centerCoords[1] - (coreD / 2) / 110540,
        centerCoords[0] + (coreW / 2) / 111320,
        centerCoords[1] + (coreD / 2) / 110540
    ]);

    // CRITICAL: Clip core to building footprint to prevent overhang
    // @ts-ignore
    const clippedCore = turf.intersect(corePoly, buildingPoly);
    if (clippedCore) {
        corePoly = clippedCore as Feature<Polygon>;
    }

    cores.push({
        id: `core-${Math.random().toString(36).substr(2, 5)}`,
        type: 'Lobby',
        geometry: corePoly as Feature<Polygon>
    });

    const coreGeom = cores[0].geometry;

    // 2. Generate Units based on Unit Mix Configuration
    const corridorW = params.corridorWidth || 2;
    const coreWithCorridor = turf.buffer(coreGeom, corridorW / 1000, { units: 'kilometers' });

    // Use the buffered core to cut the hole
    // @ts-ignore
    let leasablePoly = turf.difference(buildingPoly, coreWithCorridor || coreGeom);

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

    return { cores, units, entrances, efficiency: parseFloat(efficiencyPercent) };
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
