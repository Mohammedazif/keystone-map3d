
import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon, Point } from 'geojson';
import { Building, Core, Unit, UnitTypology, UtilityArea, UtilityType, EntryPoint, BuildingIntendedUse } from '../types';
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
    intendedUse?: BuildingIntendedUse | string; // Mixed Use Support
    numFloors?: number;
    floorHeight?: number;
    shuffleUnits?: boolean; // Randomize unit order on each floor
    buildingId?: string; // Used to detect podium vs tower for utility placement
    selectedUtilities?: string[]; // List of enabled utilities
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
    if (name.includes('studio')) return '#ADD8E6'; // Light Blue
    if (name.includes('1bhk') || name.includes('1 bhk')) return '#80BC65'; // Green
    if (name.includes('2bhk') || name.includes('2 bhk')) return '#1E90FF'; // Blue
    if (name.includes('3bhk') || name.includes('3 bhk')) return '#DA70D6'; // Orchid
    if (name.includes('4bhk') || name.includes('4 bhk')) return '#FFD700'; // Gold
    if (name.includes('office')) return '#A9A9A9'; // Dark Gray
    if (name.includes('guest room') || name.includes('suite')) return '#70c8daff'; 
    if (name.includes('hall') || name.includes('public')) return '#F0E68C'; // Khaki
    return '#414141';
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
export function getPlotOrientation(plotPoly: Feature<Polygon>): number {
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
    const intendedUse = params.intendedUse || 'Residential';

    // ---CORE CALCULATION LOGIC ---
    const floorArea = turf.area(workingPoly); // Area per floor (BUA)
    const floors = params.numFloors || 5; 
    const height = floors * (params.floorHeight || 3.1);

    // Determine Population (POP) per floor
    let popPerFloor = 0;
    let assumedUnitsPerFloor = 0;
    
    if (intendedUse === 'Residential') {
        const estUnitSize = targetUnitSize;
        assumedUnitsPerFloor = Math.max(1, Math.floor((floorArea * 0.75) / estUnitSize)); // Assuming 75% efficiency
        popPerFloor = assumedUnitsPerFloor * 5; // 5 persons per unit
    } else if (intendedUse === 'Commercial' || intendedUse === 'Industrial') {
        popPerFloor = floorArea / 10; // 10 sqm per person
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public') {
        popPerFloor = floorArea / 6; // 6 sqm per person
    } else {
        popPerFloor = floorArea / 10; // Fallback
    }

    if (popPerFloor < 1) popPerFloor = 10; // Minimum safety

    // 3. LIFT CALCULATIONS
    let numLifts = 0;
    let passengerLifts = 0;
    let serviceLifts = 0;
    let stretcherLifts = 0;

    if (intendedUse === 'Residential') {
        passengerLifts = Math.max(1, Math.ceil(assumedUnitsPerFloor / 80)); // 1 per 70-90 units
    } else if (intendedUse === 'Commercial' || intendedUse === 'Industrial') {
        passengerLifts = Math.max(1, Math.ceil(popPerFloor / 275)); // 1 per 250-300 pop
        // OR 1 per 800-1000 sqm
        const areaBasedLifts = Math.max(1, Math.ceil(floorArea / 900));
        passengerLifts = Math.max(passengerLifts, areaBasedLifts);
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public' || intendedUse === 'Hospitality') {
        passengerLifts = Math.max(1, Math.ceil(floorArea / 2250)); // 1 per 2000-2500 sqm
        stretcherLifts = 1; // Mandatory
    } else {
        passengerLifts = Math.max(1, Math.ceil(floorArea / 1000));
    }

    // Height overrides
    if (floors > 10) serviceLifts += 1; // Fire lift essentially
    if (floors > 20) serviceLifts += 1;

    const liftArea = (passengerLifts * 2.5) + (serviceLifts * 5.0) + (stretcherLifts * 6.0);
    numLifts = passengerLifts + serviceLifts + stretcherLifts;

    // 4. STAIRCASE CALCULATIONS
    let numStairs = (popPerFloor <= 30 && height <= 20) ? 1 : 2;
    if (popPerFloor > 500 && (intendedUse === 'Commercial' || intendedUse === 'Institutional')) {
        numStairs = 3;
    }

    let stairAreaPerStair = 15; // default residential
    if (intendedUse === 'Commercial') stairAreaPerStair = 22;
    else if (intendedUse === 'Institutional' || intendedUse === 'Public') stairAreaPerStair = 28;

    const stairArea = numStairs * stairAreaPerStair;

    // 5. LOBBY & CORRIDOR CALCULATIONS
    let lobbyMultiplier = 4; // Res default
    if (intendedUse === 'Commercial') lobbyMultiplier = 6;
    else if (intendedUse === 'Institutional' || intendedUse === 'Public') lobbyMultiplier = 8;
    
    const lobbyArea = numLifts * lobbyMultiplier;

    let corridorArea = 0;
    if (intendedUse === 'Residential') {
        if (assumedUnitsPerFloor <= 4) corridorArea = 8;
        else if (assumedUnitsPerFloor <= 8) corridorArea = 16;
        else corridorArea = 28;
    } else if (intendedUse === 'Commercial') {
        corridorArea = floorArea * 0.08; // 8%
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public') {
        corridorArea = floorArea * 0.12; // 12%
    }

    // 6. SHAFT CALCULATIONS
    let shaftArea = 0;
    // Plumbing (Res: 1 per 4 units, Comm: 1 per 750sqm, Inst: 1 per 500sqm)
    let plumbingShafts = 1;
    if (intendedUse === 'Residential') {
        plumbingShafts = Math.ceil(assumedUnitsPerFloor / 4);
    } else if (intendedUse === 'Institutional' || intendedUse === 'Public') {
        plumbingShafts = Math.ceil(floorArea / 500);
    } else {
        plumbingShafts = Math.ceil(floorArea / 750);
    }
    shaftArea += plumbingShafts * 0.8;
    
    // Elec/Fire (1 per core roughly)
    const numPhysicalCores = params.subtype === 'ushaped' ? 2 : 1; 
    shaftArea += (numPhysicalCores * 0.6) + (numPhysicalCores * 0.5); // Elec + Fire

    // HVAC Riser
    if (intendedUse === 'Commercial') shaftArea += Math.ceil(floorArea / 1000) * 3;
    else if (intendedUse === 'Institutional') shaftArea += numPhysicalCores * 4.5;

    // Garbage/Others
    if (intendedUse === 'Residential' && assumedUnitsPerFloor >= 6) shaftArea += 0.7;
    else if (intendedUse === 'Hospitality' || intendedUse === 'Institutional') shaftArea += 1.5;

    // Fire Check Lobby
    let fireLobbyArea = 0;
    if (height > 24) {
        fireLobbyArea = numPhysicalCores * 10;
    }

    const calculatedCoreAreaPerFloor = liftArea + stairArea + lobbyArea + corridorArea + shaftArea + fireLobbyArea;
    const coreAreaPerNode = calculatedCoreAreaPerFloor / numPhysicalCores;
    
    // 8. CORE & CIRCULATION COMBINED EFFICIENCY TARGETS (INDUSTRY STANDARDS)
    // These are % of GFA for core + circulation combined (lifts, stairs, lobbies, corridors, shafts)
    // ┌───────────────────────┬───────────────────────────┐
    // │ Development Type      │ Core & Circulation (% GFA)│
    // ├───────────────────────┼───────────────────────────┤
    // │ Residential           │ 15 – 25%                  │
    // │ Commercial (Office)   │ 25 – 35%                  │
    // │ Commercial (Retail)   │ 35 – 50%                  │
    // │ Hospitality (Hotels)  │ 25 – 40%                  │
    // │ Institutional         │ 30 – 40%                  │
    // │ Mixed-Use             │ 25 – 35%                  │
    // └───────────────────────┴───────────────────────────┘
    const coreRatio = calculatedCoreAreaPerFloor / floorArea;
    
    let healthyMin = 0.25, healthyMax = 0.35; // Default: Mixed-Use
    if (intendedUse === 'Residential') { healthyMin = 0.15; healthyMax = 0.25; }
    else if (intendedUse === 'Retail') { healthyMin = 0.35; healthyMax = 0.50; }
    else if (intendedUse === 'Commercial' || intendedUse === 'Office' || intendedUse === 'Industrial') { healthyMin = 0.25; healthyMax = 0.35; }
    else if (intendedUse === 'Hospitality') { healthyMin = 0.25; healthyMax = 0.40; }
    else if (intendedUse === 'Institutional' || intendedUse === 'Public') { healthyMin = 0.30; healthyMax = 0.40; }
    else if (intendedUse === 'MixedUse' || params.subtype === 'mixed') { healthyMin = 0.25; healthyMax = 0.35; }
    
    if (coreRatio < healthyMin || coreRatio > healthyMax) {
        console.warn(`[Audit] Core ratio ${(coreRatio*100).toFixed(1)}% is outside healthy range (${healthyMin*100}-${healthyMax*100}%) for ${intendedUse}!`);
    } else {
        console.log(`[Audit] Core ratio ${(coreRatio*100).toFixed(1)}% is within healthy bounds (${healthyMin*100}-${healthyMax*100}%) for ${intendedUse}.`);
    }
    
    // Fallbacks just in case calculations result in extremely small or massive areas
    const minCoreArea = Math.max(20, floorArea * healthyMin / numPhysicalCores);
    const maxCoreArea = floorArea * (healthyMax + 0.05) / numPhysicalCores;
    
    let finalCoreArea = coreAreaPerNode;
    if (coreAreaPerNode < minCoreArea) {
        console.warn(`[Layout Gen] Core calculation (${coreAreaPerNode.toFixed(1)} sqm) is below healthy minimum (${minCoreArea.toFixed(1)} sqm). Enforcing minimum benchmark area.`);
        finalCoreArea = minCoreArea;
    } else if (coreAreaPerNode > maxCoreArea) {
        finalCoreArea = maxCoreArea;
    }

    // 1. Generate Core(s) - Typology-Specific Placement
    const bbox = turf.bbox(workingPoly);
    const width = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
    const depth = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });

    // Derive dimensions dynamically from area to act as a central spine/corridor
    const isHorizontal = width > depth;
    const longAxis = isHorizontal ? width : depth;
    const shortAxis = isHorizontal ? depth : width;
    
    let coreW = 0;
    let coreD = 0;
    
    // For standard slab/point scenarios, we stretch the core to reach peripheral units 
    // We leave an ~8m buffer on ends to let units wrap around the ends
    let spineLength = Math.max(10, longAxis - 16); 
    let spineThickness = finalCoreArea / spineLength;

    // Constrain thickness between reasonable limits (min 2.5m corridor, max 50% of short axis)
    if (spineThickness < 2.5) {
        spineThickness = 2.5;
        spineLength = finalCoreArea / spineThickness;
    } else if (spineThickness > shortAxis * 0.5) {
        spineThickness = shortAxis * 0.5;
        spineLength = finalCoreArea / spineThickness;
    }
    
    if (isHorizontal) {
        coreW = spineLength;
        coreD = spineThickness;
    } else {
        coreW = spineThickness;
        coreD = spineLength;
    }

    // Prevent core from entirely overflowing narrow wings
    coreW = Math.min(coreW, width * 0.95);
    coreD = Math.min(coreD, depth * 0.95);

    console.log(`[Layout Gen] Computed Core -> Pop: ${popPerFloor.toFixed(0)}, Lifts: ${numLifts}, Stairs: ${numStairs}, Area: ${finalCoreArea.toFixed(1)} sqm, Dims: ${coreW.toFixed(1)}x${coreD.toFixed(1)}`);

    // Helper: Create a core at a specific point
    const createCoreAtPoint = (point: Feature<any>, id: string): Feature<Polygon> | null => {
        const coords = point.geometry.coordinates;
        // turf.destination calculates true meter distances on the globe avoiding latitude squishing
        const pt = turf.point(coords);
        
        // Bounding box using proper distance offsets
        const n = turf.destination(pt, coreD / 2 / 1000, 0).geometry.coordinates[1];
        const s = turf.destination(pt, coreD / 2 / 1000, 180).geometry.coordinates[1];
        const e = turf.destination(pt, coreW / 2 / 1000, 90).geometry.coordinates[0];
        const w = turf.destination(pt, coreW / 2 / 1000, -90).geometry.coordinates[0];
        
        let corePoly = turf.bboxPolygon([w, s, e, n]);

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
            if (turf.booleanContains(workingPoly, candidate)) {
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
            if (turf.booleanPointInPolygon(candidate, workingPoly)) {
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
            if (turf.booleanPointInPolygon(candidate, workingPoly)) {
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
        let centerPoint = turf.centroid(workingPoly);

        // @ts-ignore
        if (!turf.booleanContains(workingPoly, centerPoint)) {
            centerPoint = turf.centerOfMass(workingPoly);
            // @ts-ignore
            if (!turf.booleanContains(workingPoly, centerPoint)) {
                centerPoint = turf.pointOnFeature(workingPoly);
            }
        }

        const core = createCoreAtPoint(centerPoint, 'core-default');
        if (core) cores.push({ id: 'core-default', type: 'Lobby', geometry: core });
    }

    // Fallback: If no cores were placed, use pointOnFeature
    if (cores.length === 0) {
        console.warn('[Layout Generator] No cores placed, using fallback');
        const fallbackPoint = turf.pointOnFeature(workingPoly);
        const core = createCoreAtPoint(fallbackPoint, 'core-fallback');
        if (core) cores.push({ id: 'core-fallback', type: 'Lobby', geometry: core });
    }

    console.log('[Layout Generator] Total cores placed:', cores.length);

    // Safety check: If no cores were placed, return empty layout
    if (cores.length === 0) {
        console.warn('[Layout Generator] No cores placed, returning empty layout');
        return { cores: [], units: [], utilities: [], entrances: [] };
    }

    let coreGeom = cores[0].geometry;

    const shouldInclude = (type: string) => {
        if (!params.selectedUtilities || params.selectedUtilities.length === 0) return true;
        // Map Utility Infrastructure names to UtilityType if they differ
        const mapping: Record<string, string> = {
            'Electrical': UtilityType.Electrical,
            'HVAC': UtilityType.HVAC,
            'Solar PV': UtilityType.SolarPV,
            'Rooftop Solar': UtilityType.SolarPV,
            'EV Charging': UtilityType.EVStation
        };
        const mappedType = mapping[type] || type;
        return params.selectedUtilities.some(u => {
            const mU = mapping[u] || u;
            return u === type || mU === mappedType;
        });
    };

    // 1.1 Generate Electrical Shaft (Vertical Utility)
    // Place it adjacent to the core
    if (shouldInclude('Electrical')) {
    try {
        const bBox = turf.bbox(workingPoly);
        const minX = bBox[0];
        const minY = bBox[1];
        
        // Electrical Shaft Area: ~1.0% to 1.5% of the single floor Gross Area
        // Typical rule of thumb: 1.5% for robust distribution
        const elecTargetArea = Math.max(2, (width * depth) * 0.015);
        const elecDim = Math.sqrt(elecTargetArea); // Square shaft
        
        // Find a safe spot inside the building, ideally near the core spine
        const startPoint = coreGeom ? turf.centroid(coreGeom) : turf.pointOnFeature(workingPoly);
        
        // Create an exact geometric square of the target area
        const elecBoxFeature = turf.envelope(turf.buffer(startPoint, elecDim / 2, { units: 'meters' }));
        
        // Force Intersection inside the building to prevent overhangs in weird shapes
        // @ts-ignore
        const safeElecPoly = turf.intersect(elecBoxFeature, workingPoly) || elecBoxFeature;

        utilities.push({
            id: `util-elec-${Math.random().toString(36).substr(2, 5)}`,
            name: 'Electrical Shaft',
            type: UtilityType.Electrical,
            geometry: safeElecPoly as Feature<Polygon>,
            centroid: turf.centroid(safeElecPoly as Feature<Polygon>),
            area: turf.area(safeElecPoly as Feature<Polygon>),
            visible: true
        });
        console.log('[Layout Generator] Placed Parameterized Electrical Shaft');
    } catch (e) {
        console.warn('Failed to place Electrical Shaft', e);
    }
    }

    // 1.2 Generate HVAC Zone (Rooftop) - Vastu: W/SW side of building
    // Per Vastu: Air-conditioning chiller plant / Cooling towers → West or South-West
    // Skip for podium buildings — the tower handles rooftop utilities
    const isPodiumBuilding = params.buildingId?.includes('-podium');
    if (!isPodiumBuilding && shouldInclude('HVAC')) {
    try {
        // Rooftop HVAC / Plant Room Area: ~1.5% to 2% of the Total Building GFA (all floors combined)
        // @ts-ignore - Assuming params has maxFloors based on other context, falling back to 5
        const floorsCount = params.numFloors || 5;
        const totalGFA = (width * depth) * Math.max(1, floorsCount);
        const hvacTargetArea = Math.max(16, totalGFA * 0.015); // Minimum 16m2 package
        
        const bBox = turf.bbox(workingPoly);
        // HVAC occupies the western half of the rooftop (Vastu: West/SW)
        const hvacW = width * 0.45; // ~45% of building width
        const hvacD = Math.min(depth * 0.45, hvacTargetArea / (width * 0.45)); // Fit area
        const hvacActualD = Math.max(3, hvacD); // Minimum 3m depth
        
        // SW corner point, inset 1m from edges
        const swPoint = turf.point([bBox[0], bBox[1]]);
        const startPoint = turf.transformTranslate(swPoint, 1, 45, { units: 'meters' });
        const startCoords = startPoint.geometry.coordinates;
        
        // Build HVAC box from SW corner inward (west side)
        const hvacWDeg = hvacW / 111320;
        const hvacDDeg = hvacActualD / 110540;
        const hvacBoxFeature = turf.bboxPolygon([
            startCoords[0], startCoords[1],
            startCoords[0] + hvacWDeg, startCoords[1] + hvacDDeg
        ]);
        
        // Force intersection inside the building footprint
        // @ts-ignore
        let hvacPoly = turf.intersect(hvacBoxFeature, workingPoly);
        if (!hvacPoly || turf.area(hvacPoly) < 4) {
            // Fallback: use building center west half
            const center = turf.center(workingPoly);
            const hvacSize = Math.sqrt(hvacTargetArea);
            const fallbackCenter = turf.transformTranslate(center, width * 0.15, -90, { units: 'meters' }); // Shift west
            hvacPoly = turf.envelope(turf.buffer(fallbackCenter, hvacSize / 2, { units: 'meters' }));
            // @ts-ignore
            hvacPoly = turf.intersect(hvacPoly, workingPoly) || hvacPoly;
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
        console.log('[Layout Generator] Placed Rooftop HVAC Unit (W/SW - Vastu compliant)');
    } catch (e) {
        console.warn('Failed to place HVAC Zone', e);
    }
    } // end isPodiumBuilding check for HVAC

    // 1.3 Generate Rooftop Solar PV - Vastu: South-facing roof for max efficiency
    // Skip for podium buildings — Solar PV goes on tower rooftop only
    if (!isPodiumBuilding && (shouldInclude('Solar PV') || shouldInclude('Rooftop Solar'))) {
    try {
        const bBox = turf.bbox(workingPoly);
        const footprintArea = turf.area(workingPoly);
        // Use SE half of rooftop (opposite of HVAC which is W/SW)
        // Solar PV covers ~40% of rooftop on the eastern/SE side
        const solarW = width * 0.45;
        const solarD = depth * 0.45;
        
        // SE corner point, inset 1m from edges
        const sePoint = turf.point([bBox[2], bBox[1]]);
        const solarStart = turf.transformTranslate(sePoint, 1, -135, { units: 'meters' }); // inset NW
        const solarCoords = solarStart.geometry.coordinates;
        
        const solarWDeg = solarW / 111320;
        const solarDDeg = solarD / 110540;
        const solarBoxFeature = turf.bboxPolygon([
            solarCoords[0] - solarWDeg, solarCoords[1],
            solarCoords[0], solarCoords[1] + solarDDeg
        ]);
        
        // @ts-ignore
        let solarPoly = turf.intersect(solarBoxFeature, workingPoly);
        if (!solarPoly || turf.area(solarPoly) < 4) {
            // Fallback: use building center east half
            const center = turf.center(workingPoly);
            const fallbackCenter = turf.transformTranslate(center, width * 0.15, 90, { units: 'meters' }); // Shift east
            const solarSize = Math.sqrt(solarW * solarD);
            solarPoly = turf.envelope(turf.buffer(fallbackCenter, solarSize / 2, { units: 'meters' }));
            // @ts-ignore
            solarPoly = turf.intersect(solarPoly, workingPoly) || solarPoly;
        }

        const solarArea = turf.area(solarPoly);
        utilities.push({
            id: `util-solar-roof-${Math.random().toString(36).substr(2, 5)}`,
            name: 'Rooftop Solar PV',
            type: UtilityType.SolarPV,
            geometry: solarPoly as Feature<Polygon>,
            centroid: turf.centroid(solarPoly),
            area: solarArea,
            visible: true
        });
        console.log(`[Layout Generator] Placed Rooftop Solar PV (S/SE - ${solarArea.toFixed(1)}m²)`);
    } catch (e) {
        console.warn('Failed to place Rooftop Solar PV', e);
    }
    } // end isPodiumBuilding check for Solar PV

    // 1.4 Generate EV Station Zone (Basement context)
    // EV charging is in basement parking — belongs to podiums and normal buildings.
    // Skip for towers as they sit on top of the podium/parking shared zone.
    const isTowerBuilding = params.buildingId?.includes('-tower');
    if (!isTowerBuilding && shouldInclude('EV Charging')) {
    try {
        const bBox = turf.bbox(workingPoly);
        // Place EV stations along the North edge (2m deep zone)
        const evW = width * 0.8; // Cover most of the width
        const evD = 2.0; // 2m deep charging zone
        
        // NW corner point, inset 0.5m
        const nwPoint = turf.point([bBox[0], bBox[3]]);
        const evStart = turf.transformTranslate(nwPoint, 0.5, 135, { units: 'meters' });
        const evCoords = evStart.geometry.coordinates;
        
        const evWDeg = evW / 111320;
        const evDDeg = evD / 110540;
        const evBoxFeature = turf.bboxPolygon([
            evCoords[0], evCoords[1] - evDDeg,
            evCoords[0] + evWDeg, evCoords[1]
        ]);
        
        // @ts-ignore
        let evPoly = turf.intersect(evBoxFeature, workingPoly);
        if (evPoly && turf.area(evPoly) > 2) {
            utilities.push({
                id: `util-ev-${Math.random().toString(36).substr(2, 5)}`,
                name: 'EV Charging Station',
                type: UtilityType.EVStation,
                geometry: evPoly as Feature<Polygon>,
                centroid: turf.centroid(evPoly),
                area: turf.area(evPoly),
                visible: true
            });
            console.log('[Layout Generator] Placed EV Charging Zone sub-polygon');
        }
    } catch (e) {
        console.warn('Failed to place EV Station polygon', e);
    }
    } // end isTowerBuilding check for EV

    // 2. Generate Units based on Unit Mix Configuration
    let obstacles: any = undefined;

    if (coreGeom) {
        // Minimal buffer just to prevent turf topology intersection errors, allowing units to touch cores
        const corridorW = params.corridorWidth || 0.1;
        const coreWithCorridor = turf.buffer(coreGeom, corridorW / 1000, { units: 'kilometers' });

        // Combine Core + Electrical + Corridor for subtraction
        obstacles = coreWithCorridor || coreGeom;
        const elecShaft = utilities.find(u => u.type === UtilityType.Electrical);
        if (elecShaft) {
            // Buffer electrical slightly to include in obstacle
            const bufferedElec = turf.buffer(elecShaft.geometry, 0.1 / 1000, { units: 'kilometers' });
            // @ts-ignore
            obstacles = turf.union(obstacles, bufferedElec || elecShaft.geometry);
        }
    }

    // Use the obstacles to cut the hole on the ALIGNED workingPoly
    let leasablePoly = workingPoly; 
    if (obstacles) {
        try {
            // @ts-ignore
            leasablePoly = turf.difference(workingPoly, obstacles);
        } catch (err) {
            console.warn('turf.difference failed, trying small buffer fallback', err);
            try {
                // @ts-ignore
                leasablePoly = turf.difference(workingPoly, turf.buffer(obstacles, 0.001, { units: 'kilometers' }));
            } catch (err2) {
                console.warn('Buffer fallback also failed for difference. Using original polygon.', err2);
            }
        }
        if (!leasablePoly) {
            // Fallback if difference fails -> Difference with just core
            if (coreGeom) {
                // @ts-ignore
                leasablePoly = turf.difference(workingPoly, coreGeom);
            }
            if (!leasablePoly) leasablePoly = workingPoly;
        }
    }

    // Override or Setup defaults based on Intended Use
    let useUnitMix = params.unitMix;

    // If specific non-residential use, override the mix
    if (params.intendedUse === BuildingIntendedUse.Commercial) {
        useUnitMix = [{ name: 'Office', mixRatio: 1, area: 150 }];
    } else if (params.intendedUse === BuildingIntendedUse.Hospitality) {
        useUnitMix = [{ name: 'Guest Room', mixRatio: 1, area: 35 }];
    } else if (params.intendedUse === BuildingIntendedUse.Public || params.intendedUse === BuildingIntendedUse.Industrial) {
        useUnitMix = [{ name: 'Hall', mixRatio: 1, area: 500 }];
    } else if (!useUnitMix || useUnitMix.length === 0) {
        // Default residential mix if none provided
        useUnitMix = [
            { name: '2BHK', mixRatio: 0.30, area: 140 },
            { name: '3BHK', mixRatio: 0.35, area: 185 },
            { name: '4BHK', mixRatio: 0.35, area: 245 }
        ];
    }

    // Now we ALWAYS have a useUnitMix array.
    const weightedAvgSize = useUnitMix.reduce((acc, unit) => acc + (unit.area * unit.mixRatio), 0);
    
    // Use a FINE grid for accurate area representation.
    // Divide the smallest unit area by 5 to get ~28sqm cells (~5.3m per side)
    // This allows 2BHK(140)=5cells, 3BHK(185)=7cells, 4BHK(245)=9cells — much more precise.
    const smallestUnitArea = Math.min(...useUnitMix.map(u => u.area));
    const baseGridUnitSize = Math.max(10, Math.round(smallestUnitArea / 5));
    
    // 1. Create a fine-grained grid for precise unit area representation
    const nominalGridSizeM = Math.sqrt(baseGridUnitSize);

    // Calculate discrete number of cells across width and depth
    const cellsX = Math.max(1, Math.round(width / nominalGridSizeM));
    const cellsY = Math.max(1, Math.round(depth / nominalGridSizeM));
    
    // Derive exact cell dimensions DIRECTLY from bbox degree extent
    const bboxWidthDeg = bbox[2] - bbox[0];
    const bboxHeightDeg = bbox[3] - bbox[1];
    const wDegGrid = bboxWidthDeg / cellsX;
    const hDegGrid = bboxHeightDeg / cellsY;

    // Actual cell area in m² (needed for threshold check)
    const gridW = width / cellsX;
    const gridH = depth / cellsY;
    const actualCellAreaM2 = gridW * gridH;

    // 2. Create an exact mathematical grid of rectangular polygons
    let gridFeatures: { poly: Feature<Polygon>, i: number, j: number }[] = [];
    const minXGrid = bbox[0], minYGrid = bbox[1];
    
    for (let i = 0; i < cellsX; i++) {
        for (let j = 0; j < cellsY; j++) {
            const cellMinX = minXGrid + (i * wDegGrid);
            const cellMinY = minYGrid + (j * hDegGrid);
            const cellMaxX = cellMinX + wDegGrid;
            const cellMaxY = cellMinY + hDegGrid;
            
            gridFeatures.push({
                poly: turf.bboxPolygon([cellMinX, cellMinY, cellMaxX, cellMaxY]),
                i, j
            });
        }
    }

    // 3. Keep only modules that fall inside the leasable area
    let validModules: { poly: Feature<Polygon>, validPoly: Feature<Polygon>, i: number, j: number }[] = [];
    gridFeatures.forEach((cell) => {
        try {
            // @ts-ignore
            const intersection = turf.intersect(cell.poly, leasablePoly);
            if (intersection && turf.area(intersection) > actualCellAreaM2 * 0.02) {
                validModules.push({ ...cell, validPoly: intersection as Feature<Polygon> });
            }
        } catch (e) { }
    });

    const totalValidCells = validModules.length;
    const leasableAreaM2 = validModules.reduce((sum, m) => sum + turf.area(m.validPoly), 0);
    console.log(`[Layout Generator] Tiled Grid: ${totalValidCells} modules, cell≈${actualCellAreaM2.toFixed(1)}m², leasable≈${leasableAreaM2.toFixed(0)}m²`);

    // 4. GEOMETRIC UNIT SUBDIVISION
    // Instead of grid-based placement (which causes gaps, irregular shapes, and sizing issues),
    // we directly subdivide the leasable area into clean rectangular units.
    // 
    // Algorithm:
    //   1. Split leasable bbox into two strips at core centerline
    //   2. Compute unit widths from: unitWidth = targetArea / stripDepth
    //   3. Build a floor-wide unit deck
    //   4. Assign units to each strip by creating rectangles at calculated positions
    //   5. Intersect with leasable poly for clean edges
    
    const lBbox = turf.bbox(leasablePoly!);
    const [lMinX, lMinY, lMaxX, lMaxY] = lBbox;
    
    // Core center divides building into two strips   
    const coreCentroidPt = cores.length > 0 
        ? turf.centroid(cores[0].geometry) 
        : turf.centroid(workingPoly);
    const coreCenter = coreCentroidPt.geometry.coordinates;
    
    const isHorizontalBuilding = width > depth;
    
    // Degree-to-meter scale factors at this location
    const degPerMeterX = (lMaxX - lMinX) / width;
    const degPerMeterY = (lMaxY - lMinY) / depth;
    
    // Compute two strips
    let stripA: { minX: number, maxX: number, minY: number, maxY: number, depth: number, length: number };
    let stripB: { minX: number, maxX: number, minY: number, maxY: number, depth: number, length: number };
    
    if (isHorizontalBuilding) {
        // Horizontal building: core runs E-W, strips are N and S
        // Strip A = above core (north), Strip B = below core (south)
        const coreY = coreCenter[1];
        stripA = {
            minX: lMinX, maxX: lMaxX,
            minY: coreY, maxY: lMaxY,
            depth: (lMaxY - coreY) / degPerMeterY,
            length: width
        };
        stripB = {
            minX: lMinX, maxX: lMaxX,
            minY: lMinY, maxY: coreY,
            depth: (coreY - lMinY) / degPerMeterY,
            length: width
        };
    } else {
        // Vertical building: core runs N-S, strips are E and W
        const coreX = coreCenter[0];
        stripA = {
            minX: coreX, maxX: lMaxX,
            minY: lMinY, maxY: lMaxY,
            depth: (lMaxX - coreX) / degPerMeterX,
            length: depth
        };
        stripB = {
            minX: lMinX, maxX: coreX,
            minY: lMinY, maxY: lMaxY,
            depth: (coreX - lMinX) / degPerMeterX,
            length: depth
        };
    }
    
    console.log(`[Layout Generator] Strips: A depth=${stripA.depth.toFixed(1)}m len=${stripA.length.toFixed(1)}m, B depth=${stripB.depth.toFixed(1)}m len=${stripB.length.toFixed(1)}m`);
    
    // Calculate unit widths for each strip
    const computeUnitWidths = (stripDepth: number) => {
        if (stripDepth < 1) return useUnitMix.map(u => ({ ...u, unitWidth: u.area })); // degenerate
        return useUnitMix.map(u => ({
            ...u,
            unitWidth: u.area / stripDepth // meters wide along the building length
        }));
    };
    
    // Build ONE deck for the whole floor
    // Use the average strip depth for unit width calculation
    const avgStripDepth = (stripA.depth + stripB.depth) / 2;
    const unitWidths = computeUnitWidths(avgStripDepth);
    const avgUnitWidth = unitWidths.reduce((s, u) => s + u.unitWidth * u.mixRatio, 0);
    const totalLength = stripA.length; // both strips have same length
    
    // Total units that fit across both strips combined
    const totalUnitSlots = Math.max(1, Math.floor((totalLength * 2) / avgUnitWidth)); // ×2 for both strips
    
    // Distribute by mix ratio
    const unitCounts = unitWidths.map(u => ({
        ...u,
        count: Math.max(0, Math.round(totalUnitSlots * u.mixRatio))
    }));
    
    // Ensure at least 1 of each type
    unitCounts.forEach(u => {
        if (u.count === 0 && u.mixRatio > 0) u.count = 1;
    });
    
    // Trim if total width exceeds available (both strips combined)
    let totalWidthUsed = unitCounts.reduce((s, u) => s + u.count * u.unitWidth, 0);
    unitCounts.sort((a, b) => b.count - a.count);
    while (totalWidthUsed > totalLength * 2 && unitCounts[0].count > 1) {
        unitCounts[0].count--;
        totalWidthUsed -= unitCounts[0].unitWidth;
    }
    
    console.log(`[Layout Generator] Floor plan:`, 
        unitCounts.map(u => `${u.name}=${u.count}×${u.unitWidth.toFixed(1)}m`).join(', '),
        `total=${totalWidthUsed.toFixed(0)}m / ${(totalLength*2).toFixed(0)}m`);
    
    // Build interleaved deck
    let unitDeck: { type: string, color: string, targetArea: number, unitWidth: number }[] = [];
    const remaining = unitCounts.map(u => ({ ...u, left: u.count, colorIdx: 0 }));
    let left = remaining.reduce((s, u) => s + u.left, 0);
    while (left > 0) {
        for (const u of remaining) {
            if (u.left > 0) {
                const color = u.colorIdx % 2 === 0 
                    ? getColorForUnitType(u.name) 
                    : darkenColor(getColorForUnitType(u.name));
                unitDeck.push({ type: u.name, color, targetArea: u.area, unitWidth: u.unitWidth });
                u.left--;
                u.colorIdx++;
                left--;
            }
        }
    }
    
    // Shuffle the deck if user requested randomized order
    if (params.shuffleUnits) {
        // Create a basic seeded random function based on the building coordinates
        // This ensures each building gets a unique shuffle, but stable across re-renders
        const buildingSeed = Math.floor(coreCenter[0] * 100000 + coreCenter[1] * 100000);
        const seededRandom = (seed: number) => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };
        
        // Fisher-Yates shuffle with seeded random
        let currentSeed = buildingSeed;
        for (let i = unitDeck.length - 1; i > 0; i--) {
            const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
            [unitDeck[i], unitDeck[j]] = [unitDeck[j], unitDeck[i]];
        }
        console.log(`[Layout Generator] Deck shuffled randomly.`);
    }
    
    // Split deck between strips proportionally to their available length
    const aSlots = Math.round(unitDeck.length * 0.5); // Even split since both strips have same length
    const deckA = unitDeck.slice(0, aSlots);
    const deckB = unitDeck.slice(aSlots);
    
    // Create rectangular unit geometries by slicing the strip
    const createStripUnits = (
        strip: typeof stripA,
        deck: typeof unitDeck,
        unitStartIdx: number
    ): number => {
        if (deck.length === 0 || strip.depth < 1 || strip.length < 1) return unitStartIdx;
        
        // Compute total width needed by this deck
        const totalDeckWidth = deck.reduce((s, u) => s + u.unitWidth, 0);
        // Scale factor: stretch/compress to fill the strip exactly
        const scaleFactor = strip.length / totalDeckWidth;
        
        let currentPos = 0; // meters from start of strip
        
        for (let d = 0; d < deck.length; d++) {
            const assignment = deck[d];
            const scaledWidth = assignment.unitWidth * scaleFactor; // adjusted to fill strip perfectly
            const nextPos = (d === deck.length - 1) 
                ? strip.length  // Last unit takes all remaining space (avoids rounding gaps)
                : currentPos + scaledWidth;
            
            // Create rectangle in geographic coordinates
            let unitRect: Feature<Polygon>;
            if (isHorizontalBuilding) {
                const x1 = strip.minX + currentPos * degPerMeterX;
                const x2 = strip.minX + nextPos * degPerMeterX;
                unitRect = turf.bboxPolygon([x1, strip.minY, x2, strip.maxY]);
            } else {
                const y1 = strip.minY + currentPos * degPerMeterY;
                const y2 = strip.minY + nextPos * degPerMeterY;
                unitRect = turf.bboxPolygon([strip.minX, y1, strip.maxX, y2]);
            }
            
            // Intersect with leasable poly for clean edges
            let finalGeom: Feature<Polygon> | null = null;
            try {
                // @ts-ignore
                const clipped = turf.intersect(unitRect, leasablePoly);
                if (clipped) {
                    if (clipped.geometry.type === 'Polygon') {
                        finalGeom = clipped as Feature<Polygon>;
                    } else if (clipped.geometry.type === 'MultiPolygon') {
                        // Take the largest part
                        const parts = (clipped.geometry.coordinates as any[]).map((c: any) => turf.polygon(c));
                        parts.sort((a: any, b: any) => turf.area(b) - turf.area(a));
                        finalGeom = parts[0] as Feature<Polygon>;
                    }
                }
            } catch (e) {
                // If intersection fails, use the raw rectangle
                finalGeom = unitRect;
            }
            
            if (finalGeom && turf.area(finalGeom) > 5) {
                units.push({
                    id: `unit-${unitStartIdx + d}`,
                    type: assignment.type,
                    geometry: finalGeom,
                    color: assignment.color,
                    targetArea: assignment.targetArea
                });
            }
            
            currentPos = nextPos;
        }
        
        return unitStartIdx + deck.length;
    };
    
    const nextIdx = createStripUnits(stripA, deckA, 0);
    createStripUnits(stripB, deckB, nextIdx);
    
    console.log(`[Layout Generator] Final: ${units.length} units placed.`, 
        units.map(u => `${u.type}(${u.targetArea}sqm)`).join(', '));

    // 3. Generate Entrances (NEW)
    try {
        // Find best edge for entrance based on Vastu/Roads
        const buildingCenter = turf.centroid(workingPoly);
        // Explode polygon to gets points (edges are between points)
        // @ts-ignore
        const vertices = turf.explode(workingPoly).features;

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

    // --- MASTER ROTATION BLOCK ---
    // Rotate everything back to the actual building orientation!
    if (rotationAngle !== 0) {
        cores.forEach(c => {
            if (c.geometry) {
                // @ts-ignore
                c.geometry = turf.transformRotate(c.geometry, rotationAngle, { pivot: center });
            }
        });
        utilities.forEach(u => {
            if (u.geometry) {
                // @ts-ignore
                u.geometry = turf.transformRotate(u.geometry, rotationAngle, { pivot: center });
                u.centroid = turf.centroid(u.geometry);
            }
        });
        units.forEach(u => {
            if (u.geometry) {
                // @ts-ignore
                u.geometry = turf.transformRotate(u.geometry, rotationAngle, { pivot: center });
            }
        });
        entrances.forEach(e => {
            if (e.position && e.position.length >= 2) {
                const pt = turf.point([e.position[0], e.position[1]]);
                // @ts-ignore
                const rotatedPt = turf.transformRotate(pt, rotationAngle, { pivot: center });
                e.position = rotatedPt.geometry.coordinates as [number, number];
            }
        });
        console.log(`[Layout Gen] Master rotated all components back by ${rotationAngle}deg`);
    }

    // 4. Efficiency Validation
    const totalArea = turf.area(buildingPoly);
    let totalUnitArea = 0;
    units.forEach(u => { if (u.geometry) totalUnitArea += turf.area(u.geometry); });
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
    level?: number;
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
    obstacles: Feature<Polygon>[] = [], // Roads, Parking, etc.
    selectedUtilities?: string[],
    peripheralParkingZone?: Feature<Polygon | MultiPolygon> | null // Container for utilities (5m parking ring)
): { utilities: any[], buildings: any[] } {
    const utilities: any[] = [];
    // When parking zone is provided, use it as the placement container
    const containerPoly = (peripheralParkingZone || plotPoly) as Feature<Polygon>;
    const minX = turf.bbox(containerPoly)[0];
    const minY = turf.bbox(containerPoly)[1];
    const maxX = turf.bbox(containerPoly)[2];
    const maxY = turf.bbox(containerPoly)[3];

    // --- 1. CALCULATE DEMAND ---

    // Estimate population
    let totalUnits = 0;
    buildings.forEach(b => {
        // Case 1: GeoJSON Feature with units in properties (old algo path)
        if (b.properties && b.properties.units && Array.isArray(b.properties.units)) {
            totalUnits += b.properties.units.length;
        // Case 2: Plain Building object with units directly on it (store path)
        } else if (b.units && Array.isArray(b.units)) {
            totalUnits += b.units.length;
        } else {
            // Fallback: Estimate based on area if units not populated yet
            try {
                // Handle various input shapes (Feature or Geometry)
                let area = 0;
                if (b.type === 'Feature' || b.type === 'Polygon' || b.type === 'MultiPolygon') {
                    area = turf.area(b);
                } else if (b.geometry) {
                    area = turf.area(b.geometry);
                } else if (b.area) {
                    // Plain Building object area field
                    area = b.area;
                }

                if (area > 0) {
                    const floors = b.numFloors || (b.properties && b.properties.floors) || 5;
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
    // Formula: Capacity = Population * 120 LPCD * 1.2
    const stpCapacityKLD = (population * 120 * 1.2) / 1000;
    // Area conversion: Roughly 1.2 sqm per KLD as per reference doc
    const stpArea = Math.max(15, Math.ceil(stpCapacityKLD * 1.2)); 

    // UGT (Underground Water Tank)
    // Formula: Capacity = Population * 135 LPCD * 1.0 (Full Day Storage)
    const ugtVolume = (population * 135 * 1.0) / 1000; // m3
    // Assume 3.5m effective depth for large underground tanks to save surface footprint
    const ugtArea = Math.max(20, Math.ceil(ugtVolume / 3.5)); 

    // WTP (Water Treatment Plant)
    // Capacity = Pop * 135 * 1.2
    const wtpCapacityKLD = (population * 135 * 1.2) / 1000;
    // WTPs are generally more compact than STPs, but 0.45 was too low. Using 2.0 sqm/KLD.
    const wtpArea = Math.max(10, Math.ceil(wtpCapacityKLD * 2.0));

    // OWC (Organic Waste Converter)
    // Formula: Capacity = Population * 0.3 kg/day (Updated from per-unit to per-person)
    const owcCapacityKg = population * 0.3;
    const owcArea = Math.max(8, Math.ceil(owcCapacityKg / 30));

    // DG Set (Diesel Generator)
    // Formula: KVA = (Essential Load * 0.8) / (0.9 * 0.8)
    // Essential Load = 3kW * No of units
    // Space: 0.8-1.2 sqm per kVA (From Methodology)
    const essentialLoad = 3 * totalUnits;
    const dgKVA = (essentialLoad * 0.8) / (0.9 * 0.8);
    // Use 1.0 sqm per kVA as strictly requested by the rule document
    const dgArea = Math.max(15, Math.min(250, Math.ceil(dgKVA * 1.0)));

    // Transformer / HT Yard
    // Space: 500 kVA -> 25–35 sqm (~0.06 sqm/kVA)
    const transformerArea = Math.max(25, Math.min(150, Math.ceil(dgKVA * 0.06)));

    // Gas Bank (LPG Manifold)
    // Space: 15–40 sqm
    const gasArea = Math.max(15, Math.min(40, Math.ceil(population * 0.02)));

    // Fire Pump Room & Tank
    // Tank = High rise -> 200KL -> 200/3.5 = 57sqm.
    // Pump Room = Basement/Ground
    const fireTankVolume = 200; // 200KL standard for high rise
    const fireTankArea = Math.ceil(fireTankVolume / 3.5); // 3.5m depth
    const firePumpRoomArea = 30;

    // Admin / Security Office (SW)
    const adminBlockArea = Math.max(20, Math.ceil(population * 0.01));

    // Solar PV (Roof/Ground) - For Info/Capacity mainly
    const solarCapacityKW = population * 0.8 * 0.7 * 0.25;
    const solarAreaReq = solarCapacityKW * 10; // 10 sqm/kW

    // Rainwater Harvesting (RWH)
    // Formula: Harvest = Roof Area * Rainfall (e.g., 0.8m) * Runoff(0.85)
    // Storage = min(Harvest * 0.15, Pop * 30 * 30) (in Liters)
    let roofAreaSum = 0;
    buildings.forEach(b => {
        try {
            if (b.area && b.area > 0) {
                // Plain Building object from store — use the actual computed area
                roofAreaSum += b.area;
            } else if (b.properties?.area && b.properties.area > 0) {
                // GeoJSON Feature with area in properties
                roofAreaSum += b.properties.area;
            } else {
                // Last resort: compute from geometry
                roofAreaSum += turf.area(b.geometry || b);
            }
        } catch (e) {}
    });
    const annualHarvestVol = roofAreaSum * 0.8 * 0.85; // m3
    // Storage needed is 15% of annual harvest or 30 days of 30 LPCD
    const maxStorageVol = (population * 30 * 30) / 1000; // m3
    const rwhVolume = Math.min(annualHarvestVol * 0.15, maxStorageVol);
    // Area mapped to 2.5m depth
    const rwhArea = Math.max(15, Math.ceil(rwhVolume / 2.5));

    // EV Charging
    // Points = Units * 1.5 * 0.2 (30% of parking slots)
    const evPoints = Math.ceil(totalUnits * 1.5 * 0.2); 

    // console.groupCollapsed(`[Utility Math] Calculation Audit for Pop: ${population}`);
    console.log(`Units: ${totalUnits}, Pop: ${population}`);
    console.log(`STP -> Cap: ${stpCapacityKLD.toFixed(1)} KLD | Area: ${stpArea} sqm (@1.2 sqm/KLD)`);
    console.log(`WTP -> Cap: ${wtpCapacityKLD.toFixed(1)} KLD | Area: ${wtpArea} sqm (@2.0 sqm/KLD)`);
    console.log(`UGT (Water) -> Vol: ${ugtVolume.toFixed(1)} m3 | Area: ${ugtArea} sqm (3.5m depth)`);
    console.log(`RWH -> Roof Area: ${roofAreaSum.toFixed(1)} sqm | Annual Harvest: ${annualHarvestVol.toFixed(1)} m3 | Storage Vol: ${rwhVolume.toFixed(1)} m3 | Area: ${rwhArea} sqm (2.5m depth)`);
    console.log(`Electrical -> Essential Load: ${essentialLoad} kW | DG kVA: ${dgKVA.toFixed(1)}`);
    console.log(`DG Set Area -> ${dgArea} sqm (@1.0 sqm/kVA, max 250)`);
    console.log(`Transformer Area -> ${transformerArea} sqm (@0.06 sqm/kVA, max 150)`);
    console.log(`Fire Tank -> Vol: ${fireTankVolume} m3 | Area: ${fireTankArea} sqm (3.5m depth)`);
    console.log(`Gas Area -> ${gasArea} sqm | Admin Area -> ${adminBlockArea} sqm | OWC Area -> ${owcArea} sqm`);
    console.log(`Solar PV -> ${solarCapacityKW.toFixed(1)} kW req = ${solarAreaReq.toFixed(1)} sqm`);
    console.log(`EV Points -> ${evPoints} points`);
    console.groupEnd();

    // --- 3. GROUPING & PLACEMENT ZONES ---

    const groupNE: UtilityDef[] = [];
    const groupSE: UtilityDef[] = [];
    const groupNW: UtilityDef[] = [];
    const groupSW: UtilityDef[] = [];

    const plotOrientation = getPlotOrientation(plotPoly);

    const shouldInclude = (type: string) => !selectedUtilities || selectedUtilities.includes(type);

    // NE: Water Zone (Vastu: Water/Eshanya)
    if (shouldInclude(UtilityType.Water)) groupNE.push({ type: UtilityType.Water, name: 'UGT (Domestic)', area: ugtArea, color: '#4FC3F7', height: 2.5, level: -1 });
    // RWH often near Water
    if (shouldInclude(UtilityType.RainwaterHarvesting)) groupNE.push({ type: UtilityType.RainwaterHarvesting, name: 'RWH Tank', area: rwhArea, color: '#81D4FA', height: 2.5, level: -1 });

    // SE: Fire / Electrical (Vastu: Agni)
    if (shouldInclude(UtilityType.Electrical)) groupSE.push({ type: UtilityType.Electrical, name: 'Transformer Yard', area: transformerArea, color: '#FF9800', height: 2.5, level: 0 });
    if (shouldInclude(UtilityType.DGSet)) groupSE.push({ type: UtilityType.DGSet, name: 'DG Set', area: dgArea, color: '#FFB74D', height: 2.5, level: 0 });
    if (shouldInclude(UtilityType.Gas)) groupSE.push({ type: UtilityType.Gas, name: 'Gas Bank', area: gasArea, color: '#F48FB1', height: 2, level: 0 });
    // Fire Pump Room usually near clusters, SE is good or near entry
    if (shouldInclude(UtilityType.Fire)) groupSE.push({ type: UtilityType.Fire, name: 'Fire Pump Room', area: firePumpRoomArea, color: '#FF5722', height: 2.5, level: -1 });

    // NW: Waste / Air (Vastu: Vayu)
    if (shouldInclude(UtilityType.STP)) groupNW.push({ type: UtilityType.STP, name: 'STP Plant', area: stpArea, color: '#BA68C8', height: 2.5, level: -1 });
    if (shouldInclude(UtilityType.SolidWaste)) groupNW.push({ type: UtilityType.SolidWaste, name: 'OWC (Waste)', area: owcArea, color: '#8D6E63', height: 2, level: 0 });
    if (shouldInclude(UtilityType.WTP)) groupNW.push({ type: UtilityType.WTP, name: 'WTP Plant', area: wtpArea, color: '#29B6F6', height: 3, level: -1 });

    // SW: Earth / Heavy / Admin (Vastu: Nairitya)
    if (shouldInclude(UtilityType.Admin)) groupSW.push({ type: UtilityType.Admin, name: 'Admin / Security', area: adminBlockArea, color: '#FDD835', height: 3, level: 0 });
    // Separate Fire Tank (Underground) often in non-obtrusive area
    if (shouldInclude(UtilityType.Fire)) groupSW.push({ type: UtilityType.Fire, name: 'Fire Tank (UG)', area: fireTankArea, color: '#EF9A9A', height: 2.5, level: -1 });

    // --- 3. PLACEMENT ALGORITHM ---

    const placeGroupInCorner = (group: UtilityDef[], corner: 'NE' | 'SE' | 'SW' | 'NW'): UtilityDef[] => {
        const failedItems: UtilityDef[] = [];
        if (group.length === 0) return [];

        // Constants for placement
        const margin = 1.5; // Reduced from 3m for compact layout
        // Use a smaller gap in the parking ring to pack them tighter
        const gap = peripheralParkingZone ? 0.1 : 1.0;
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
        // Use containerPoly for the march — when placing in a ring, we must find
        // a point inside the ring, NOT inside the interior hole.
        const marchTarget = turf.centroid(containerPoly);
        let currentPoint = turf.point([cornerX, cornerY]);

        // Safety Break
        let steps = 0;
        const maxSteps = 1000; // 1000 meters max search inward (Increased for large plots)

        // March Inward Loop — check against containerPoly (ring when parking zone)
        // @ts-ignore
        while (!turf.booleanPointInPolygon(currentPoint, containerPoly) && steps < maxSteps) {
            // Move 1 meter towards centroid
            const bearing = turf.bearing(currentPoint, marchTarget);
            currentPoint = turf.destination(currentPoint, 1, bearing, { units: 'meters' });
            steps++;
        }

        if (steps >= maxSteps) {
            console.warn(`[Utility Debug] Could not find valid start point for corner ${corner}`);
            return group; // Skip this group if no valid point found
        }

        // Apply Margin inward (smaller for ring since it's only 5m wide)
        const effectiveMargin = peripheralParkingZone ? 0.5 : margin;
        const bearing = turf.bearing(currentPoint, marchTarget);
        currentPoint = turf.destination(currentPoint, effectiveMargin, bearing, { units: 'meters' });

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

            // Cap utility side at 3.5m when placing inside the 5m peripheral parking strip
            // (gives 1.5m clearance to prevent intersecting with adjacent road buffers)
            const maxSide = peripheralParkingZone ? 3.5 : Infinity;
            const side = Math.min(Math.sqrt(util.area), maxSide);
            const uW = side;
            const uH = side;
            const uWDeg = uW / wPerDeg;
            const uHDeg = uH / hPerDeg;

            // For the narrow parking ring, use smaller steps and more iterations
            const searchSteps = peripheralParkingZone ? 120 : 40;
            const stepM = peripheralParkingZone ? 0.5 : 3;

            // Precalculate and sort grid steps by distance from origin to spiral outward
            const gridPoints: {i: number, j: number, localX: number, localY: number, dist: number}[] = [];
            for (let i = 0; i < searchSteps; i++) {
                for (let j = 0; j < searchSteps; j++) {
                    const localX = (i - (searchSteps / 2)) * stepM;
                    const localY = (j - (searchSteps / 2)) * stepM;
                    gridPoints.push({
                        i, j, localX, localY, dist: Math.sqrt(localX * localX + localY * localY)
                    });
                }
            }
            gridPoints.sort((a,b) => a.dist - b.dist);

            for (const pt of gridPoints) {
                if (placed) break;

                const localX = pt.localX;
                const localY = pt.localY;
                    
                    // Rotate the local offsets by plotOrientation so the grid search 
                    // stays parallel to the plot edges (fixes narrow ring bounds)
                    const rad = -plotOrientation * Math.PI / 180;
                    const rotX = localX * Math.cos(rad) - localY * Math.sin(rad);
                    const rotY = localX * Math.sin(rad) + localY * Math.cos(rad);

                    const offsetX = rotX / wPerDeg;
                    const offsetY = rotY / hPerDeg;

                    // Define Candidate Poly (Top-Left anchor relative to scan)
                    // Original logic: x1 is Start, x2 is Start + Width
                    // We need to ensure we shift FROM the cursor

                    const originX = cursorX + offsetX;
                    const originY = cursorY + offsetY;

                    // Generate dynamic shapes based on utility type or random seed
                    // Use a seeded random based on utility name and type to keep it deterministic per layout
                    const uSeedStr = util.name + util.type + pt.i + pt.j;
                    let uSeed = 0;
                    for (let c = 0; c < uSeedStr.length; c++) uSeed += uSeedStr.charCodeAt(c);
                    
                    const shapeTypeInt = uSeed % 4; // 0=Rect, 1=Circle, 2=Hexagon, 3=Octagon
                    let poly: Feature<Polygon>;
                    
                    if (shapeTypeInt === 0) {
                        poly = createRotatedRect(turf.point([originX, originY]), uW, uH, plotOrientation);
                    } else {
                        // For circles, hexagons, octagons, we use turf.circle with different step counts
                        // uW is the max bounding box side, so radius is uW/2
                        const radius = uW / 2;
                        const steps = shapeTypeInt === 1 ? 32 : (shapeTypeInt === 2 ? 6 : 8);
                        poly = turf.circle(turf.point([originX, originY]), radius, { units: 'meters', steps: steps });
                    }

                    // 1. BOUNDARY CHECK — use containerPoly (=parking zone when available)
                    let inside = false;
                    try {
                        // For the narrow parking ring, skip buffer entirely to maximize placement chances
                        if (peripheralParkingZone) {
                            // @ts-ignore
                            inside = turf.booleanContains(containerPoly, poly);
                        } else {
                            // @ts-ignore
                            const safeContainer = turf.buffer(containerPoly, -1.0, { units: 'meters' }) || containerPoly;
                            // @ts-ignore
                            inside = turf.booleanContains(safeContainer, poly);
                        }
                    } catch (e) { }

                    if (!inside) continue;

                    // 2. PRE-CALCULATE BUFFERED POLY (Ensure Gap)
                    let bufferedPoly;
                    try {
                        // Use smaller gap (0.2m) when in parking ring to avoid hitting the adjacent road
                        const gapDistance = peripheralParkingZone ? 0.2 : 1.0;
                        // @ts-ignore
                        bufferedPoly = turf.buffer(poly, gapDistance, { units: 'meters' });
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
                    // Removed the artificial `isHighPriority` (i<=10 && j<=10) cap. The grid search iterates from (0,0) outwards,
                    // so the first time `inside === true` and `buildingOverlap === true` happens, it is mathematically the closest
                    // valid spot to the corner that fits inside the plot bounding geometry. We should always attempt resolution here.
                    if (buildingOverlap) {
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
                                    const scales = [0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]; // More granular steps
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
                        area: turf.area(poly), // Actual physical area on map
                        targetArea: util.area, // Theoretical target area from formula
                        centroid: turf.centroid(poly),
                        visible: util.level !== undefined && util.level < 0 ? false : true,
                        color: util.color,
                        level: util.level || 0,
                        height: util.height
                    });

                    console.log(`[Utility Debug] ✓ Placed ${util.name} in ${corner} (Grid ${pt.i},${pt.j})`);
                    placed = true;

                    // Update cursor for next utility in group? 
                    // No, for next utility we should check collisions with THIS utility, so we can restart scan.
                    // But we don't want to stack them exactly on top of the search path.
                    // The 'utilityOverlap' check handles this. We just continue loop.
                    break;
            }

            if (!placed) {
                console.warn(`[Utility] Could not place ${util.name} in ${corner} after grid search.`);
                failedItems.push(util);
            }
        });
        return failedItems;
    };

    // Execute Placement
    if (vastuCompliant) {
        // VASTU MODE: Place groups in their designated corners
        const failedNE = placeGroupInCorner(groupNE, 'NE');
        const failedSE = placeGroupInCorner(groupSE, 'SE');
        const failedNW = placeGroupInCorner(groupNW, 'NW');
        const failedSW = placeGroupInCorner(groupSW, 'SW');

        // --- FAILOVER LOGIC (Strict Vastu Compliance) ---
        // STP / WTP / OWC: Best = NW, Good = SE. Avoid = NE.
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
    } else {
        // NON-VASTU MODE: Pool all utilities and place them sequentially
        // Try each corner in order; any utility can go in any corner
        const allUtils = [...groupNE, ...groupSE, ...groupNW, ...groupSW];
        const corners: ('NE' | 'SE' | 'SW' | 'NW')[] = ['NE', 'SE', 'SW', 'NW'];
        let remaining = allUtils;

        for (const corner of corners) {
            if (remaining.length === 0) break;
            remaining = placeGroupInCorner(remaining, corner);
        }

        if (remaining.length > 0) {
            console.warn(`[Utility] ${remaining.length} utilities could not be placed in any corner:`, remaining.map(u => u.name).join(', '));
        }
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
