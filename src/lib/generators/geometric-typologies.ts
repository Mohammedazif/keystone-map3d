import * as turf from '@turf/turf';
import { generateBuildingLayout } from './layout-generator';

import { Feature, Polygon, MultiPolygon, Point } from 'geojson';
import { UnitTypology } from '../types';

export interface GeometricTypologyParams {
    wingDepth?: number;       // Building wing depth (10-14m typically) - auto-calculated if not set
    orientation: number;      // Rotation angle in degrees
    setback: number;          // Boundary setback (meters)
    minFootprint?: number;    // Minimum footprint for generated buildings

    // L-shape specific
    wingLengthA?: number;     // Length of first wing
    wingLengthB?: number;     // Length of second wing

    // U/H-shape specific
    openingSide?: 'N' | 'S' | 'E' | 'W';  // Which side is open (for U)
    bridgePosition?: number;  // Position of bridge (0-1) for H-shape

    // Advanced Placement
    obstacles?: Feature<Polygon>[]; // Existing buildings to avoid
    targetPosition?: Feature<Point>; // Preferred center point for placement
    vastuCompliant?: boolean; // If true, avoid center placement

    // Unit Mix Configuration
    unitMix?: UnitTypology[]; // Admin panel unit mix configuration
}

// Helper: Check collision with obstacles
function checkCollision(poly: Feature<Polygon>, obstacles?: Feature<Polygon>[]): boolean {
    if (!obstacles || obstacles.length === 0) return false;
    for (const obs of obstacles) {
        // @ts-ignore
        if (turf.booleanOverlap(poly, obs) || turf.booleanContains(obs, poly) || turf.booleanContains(poly, obs)) return true;
        // @ts-ignore
        const intersect = turf.intersect(poly, obs);
        if (intersect) return true;
    }
    return false;
}

// Helper: Get Vastu Score for a point (0-100)
// Higher is better for heavy buildings (SW > S > W)
function getVastuScore(point: Feature<Point>, bbox: number[]): number {
    const [minX, minY, maxX, maxY] = bbox;
    const [x, y] = point.geometry.coordinates;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    // Normalize 0-1 (0,0 is usually SW in local calc, but let's check bbox)
    // Mapbox/Turf: Latitude increases NORTH (up), Longitude increases EAST (right)
    // SW = (minX, minY), NE = (maxX, maxY)

    const isWest = x < midX;
    const isSouth = y < midY;
    const isEast = x >= midX;
    const isNorth = y >= midY;

    // Center (Brahmasthan) - STRICT AVOID
    const xRange = maxX - minX;
    const yRange = maxY - minY;
    // Check if within middle 20%
    if (x > minX + xRange * 0.4 && x < minX + xRange * 0.6 &&
        y > minY + yRange * 0.4 && y < minY + yRange * 0.6) {
        return 0; // Absolute lowest score for center
    }

    if (isSouth && isWest) return 100; // SW - Best for Master
    if (isSouth && isEast) return 60;  // SE - Acceptable (Fire)
    if (isNorth && isWest) return 70;  // NW - Good (Air)
    if (isNorth && isEast) return 20;  // NE - Avoid heavy structures (Water/Light)

    return 50; // Fallback
}

// Helper: Generate Smart Candidates (Inner Corners) to avoid clipping and respect Vastu
function getSmartCandidates(
    validArea: Feature<Polygon | MultiPolygon>,
    bbox: number[],
    width: number, // Building Width
    length: number, // Building Length
    vastuCompliant: boolean,
    targetPosition?: Feature<Point>
): { point: Feature<Point>, score: number }[] {
    let candidates: { point: Feature<Point>, score: number }[] = [];
    const [minX, minY, maxX, maxY] = bbox;

    // Calculate margins to place building fully inside
    // Use slightly less than half to be safe but close to edge
    const marginX = width * 0.55;
    const marginY = length * 0.55;

    const pts = [
        turf.point([minX + marginX, minY + marginY]), // SW Inner
        turf.point([maxX - marginX, minY + marginY]), // SE Inner
        turf.point([maxX - marginX, maxY - marginY]), // NE Inner
        turf.point([minX + marginX, maxY - marginY])  // NW Inner
    ];

    // Also add midpoints for large plots
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;
    pts.push(turf.point([midX, minY + marginY])); // South Mid
    pts.push(turf.point([midX, maxY - marginY])); // North Mid
    pts.push(turf.point([minX + marginX, midY])); // West Mid
    pts.push(turf.point([maxX - marginX, midY])); // East Mid

    pts.forEach(pt => {
        // @ts-ignore
        if (turf.booleanPointInPolygon(pt, validArea)) {
            candidates.push({ point: pt, score: getVastuScore(pt, bbox) });
        }
    });

    // Target Override
    if (targetPosition) {
        // @ts-ignore
        if (turf.booleanPointInPolygon(targetPosition, validArea)) {
            candidates.push({ point: targetPosition, score: 999 });
        }
    }

    if (vastuCompliant) {
        candidates = candidates.filter(c => c.score > 25); // Strict Vastu: Reject NE (20) and Center (0)
        candidates.sort((a, b) => b.score - a.score);
    } else {
        // Standard: Add Centroid
        const centroid = turf.centroid(validArea);
        // @ts-ignore
        if (turf.booleanPointInPolygon(centroid, validArea)) {
            candidates.push({ point: centroid, score: 50 });
        }
        // Shuffle for variety
        candidates.sort(() => Math.random() - 0.5);
    }

    return candidates;
}

/**
 * Generates L-shaped buildings within a plot
 */
export function generateLShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { wingDepth, orientation, setback, obstacles } = params;

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];

    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;

    // Calculate plot dimensions in meters
    const plotWidth = turf.distance(turf.point([minX, minY]), turf.point([maxX, minY])) * 1000;
    const plotHeight = turf.distance(turf.point([minX, minY]), turf.point([minX, maxY])) * 1000;
    const plotArea = plotWidth * plotHeight;

    // REALISTIC SIZING: Scale to 30-35% to allow multiple shapes on plot
    const scaleFactor = plotArea < 2000 ? 0.38 : (plotArea < 4000 ? 0.35 : 0.30);

    // Calculate optimal wing depth: 10-14m for residential
    const optimalDepth = Math.min(14, Math.max(10, Math.min(plotWidth, plotHeight) * 0.12));
    const effectiveDepth = wingDepth || optimalDepth;

    let wingLengthA = Math.min(
        Math.max(params.wingLengthA || plotHeight * scaleFactor, effectiveDepth * 2.2),
        Math.min(plotHeight * 0.60, 150) // Increased max to 150m and 60% of plot
    );
    let wingLengthB = Math.min(
        Math.max(params.wingLengthB || plotWidth * scaleFactor, effectiveDepth * 2.2),
        Math.min(plotWidth * 0.60, 150)
    );

    console.log('L-shape dimensions:', { plotWidth, plotHeight, plotArea, wingLengthA, wingLengthB, effectiveDepth });

    // Helper: Generate Smart Candidates (Inner Corners) to avoid clipping and respect Vastu
    function getSmartCandidates(
        validArea: Feature<Polygon | MultiPolygon>,
        bbox: number[],
        width: number, // Building Width
        length: number, // Building Length
        vastuCompliant: boolean,
        targetPosition?: Feature<Point>
    ): { point: Feature<Point>, score: number }[] {
        let candidates: { point: Feature<Point>, score: number }[] = [];
        const [minX, minY, maxX, maxY] = bbox;

        // Calculate margins to place building fully inside
        // Use slightly less than half to be safe but close to edge
        const marginX = width * 0.55;
        const marginY = length * 0.55;

        const pts = [
            turf.point([minX + marginX, minY + marginY]), // SW Inner
            turf.point([maxX - marginX, minY + marginY]), // SE Inner
            turf.point([maxX - marginX, maxY - marginY]), // NE Inner
            turf.point([minX + marginX, maxY - marginY])  // NW Inner
        ];

        // Also add midpoints for large plots
        const midX = (minX + maxX) / 2;
        const midY = (minY + maxY) / 2;
        pts.push(turf.point([midX, minY + marginY])); // South Mid
        pts.push(turf.point([midX, maxY - marginY])); // North Mid
        pts.push(turf.point([minX + marginX, midY])); // West Mid
        pts.push(turf.point([maxX - marginX, midY])); // East Mid

        pts.forEach(pt => {
            // @ts-ignore
            if (turf.booleanPointInPolygon(pt, validArea)) {
                candidates.push({ point: pt, score: getVastuScore(pt, bbox) });
            }
        });

        // Target Override
        if (targetPosition) {
            // @ts-ignore
            if (turf.booleanPointInPolygon(targetPosition, validArea)) {
                candidates.push({ point: targetPosition, score: 999 });
            }
        }

        if (vastuCompliant) {
            candidates = candidates.filter(c => c.score > 25); // Strict Vastu: Reject NE (20) and Center (0)
            // Add slight randomness to score to allow variety in equal-goodness spots
            candidates.forEach(c => c.score += Math.random() * 5);
            candidates.sort((a, b) => b.score - a.score);
        } else {
            // Standard: Add Centroid
            const centroid = turf.centroid(validArea);
            // @ts-ignore
            if (turf.booleanPointInPolygon(centroid, validArea)) {
                candidates.push({ point: centroid, score: 50 });
            }
            // Shuffle for variety
            candidates.sort(() => Math.random() - 0.5);
        }

        return candidates;
    }

    // SMART PLACEMENT: Use inner candidates
    const candidates = getSmartCandidates(
        validArea, bbox, wingLengthB, wingLengthA, params.vastuCompliant || false, params.targetPosition
    );
    const candidatePoints = candidates.map(c => c.point);

    // Attempt placement
    for (const candidate of candidatePoints) {
        if (buildings.length > 0) break; // Only place one main shape per generator call for now

        const lShape = createLShape(candidate, wingLengthA, wingLengthB, effectiveDepth, orientation);

        if (lShape) {
            try {
                // @ts-ignore
                // @ts-ignore
                const intersected = turf.intersect(lShape, validArea);
                if (intersected) {
                    const clippedPoly = intersected as Feature<Polygon>;
                    const originalArea = turf.area(lShape);
                    const newArea = turf.area(clippedPoly);

                    // STRICTER VALIDATION: 85% area retention to avoid broken shapes
                    if (newArea > originalArea * 0.85 && !checkCollision(clippedPoly, obstacles)) {
                        const layout = generateBuildingLayout(clippedPoly, { subtype: 'lshaped', unitMix: params.unitMix });
                        clippedPoly.properties = {
                            type: 'generated',
                            subtype: 'lshaped',
                            wingDepth: effectiveDepth,
                            area: newArea,
                            cores: layout.cores,
                            units: layout.units,
                            entrances: layout.entrances
                        };
                        console.log('[L-Shape] Placed successfully');
                        buildings.push(clippedPoly);
                        break;
                    }
                }

                // If primary size failed, try smaller
                if (buildings.length === 0) {
                    let smallerLShape = createLShape(candidate, wingLengthA * 0.7, wingLengthB * 0.7, effectiveDepth, orientation);

                    if (smallerLShape) {
                        // @ts-ignore
                        const smallIntersect = turf.intersect(smallerLShape, validArea);
                        if (smallIntersect) {
                            const smallClipped = smallIntersect as Feature<Polygon>;
                            if (turf.area(smallClipped) > turf.area(smallerLShape) * 0.6 && !checkCollision(smallClipped, obstacles)) {
                                const layout = generateBuildingLayout(smallClipped, { subtype: 'lshaped', unitMix: params.unitMix });
                                smallClipped.properties = {
                                    type: 'generated',
                                    subtype: 'lshaped',
                                    wingDepth: effectiveDepth,
                                    area: turf.area(smallClipped),
                                    cores: layout.cores,
                                    units: layout.units,
                                    entrances: layout.entrances
                                };
                                buildings.push(smallClipped);
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('L-shape validation failed:', e);
            }
        }
    }

    return buildings;
}

/**
 * Generates U-shaped buildings within a plot
 */
/**
 * Generates U-shaped buildings within a plot
 */
export function generateUShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { wingDepth, orientation, setback, obstacles } = params;
    const length = params.wingLengthA || 40;
    const width = params.wingLengthB || 30;

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];

    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;

    // Calculate plot dimensions
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;
    const plotWidth = turf.distance(turf.point([minX, minY]), turf.point([maxX, minY])) * 1000;
    const plotHeight = turf.distance(turf.point([minX, minY]), turf.point([minX, maxY])) * 1000;
    const plotArea = plotWidth * plotHeight;

    // REALISTIC SIZING: Scale to 30-35% for multi-shape layouts
    const scaleFactor = plotArea < 2500 ? 0.38 : (plotArea < 5000 ? 0.35 : 0.30);

    // Optimal wing depth: 10-14m
    const optimalDepth = Math.min(14, Math.max(10, Math.min(plotWidth, plotHeight) * 0.12));
    const effectiveDepth = wingDepth || optimalDepth;

    // U-Shape: Adjusted for better generation success
    // CRITICAL: U-shape needs width > 2*depth and length > depth for valid geometry
    const minLength = effectiveDepth * 2.5; // At least 2.5x depth for usable wing
    const minWidth = effectiveDepth * 3.0;  // At least 3x depth (2 wings + courtyard)

    let scaledLength = Math.max(
        minLength,
        Math.min(
            Math.max(length, plotWidth * scaleFactor),
            Math.min(plotWidth * 0.60, 150)
        )
    );
    let scaledWidth = Math.max(
        minWidth,
        Math.min(
            Math.max(width, plotHeight * scaleFactor),
            Math.min(plotHeight * 0.60, 150)
        )
    );

    console.log('U-shape dimensions:', { plotWidth, plotHeight, plotArea, scaledLength, scaledWidth, effectiveDepth, minLength, minWidth });

    // SMART PLACEMENT: Use inner candidates
    const candidates = getSmartCandidates(
        validArea, bbox, scaledWidth, scaledLength, params.vastuCompliant || false, params.targetPosition
    );
    const candidatePoints = candidates.map(c => c.point);

    for (const candidate of candidatePoints) {
        if (buildings.length > 0) break;

        const uShape = createUShape(candidate, scaledLength, scaledWidth, effectiveDepth, orientation);

        if (uShape) {
            try {
                // @ts-ignore
                // @ts-ignore
                const intersected = turf.intersect(uShape, validArea);
                if (intersected) {
                    const clippedPoly = intersected as Feature<Polygon>;
                    const originalArea = turf.area(uShape);
                    const newArea = turf.area(clippedPoly);

                    // STRICTER VALIDATION: 85% area retention
                    if (newArea > originalArea * 0.85 && !checkCollision(clippedPoly, obstacles)) {
                        const layout = generateBuildingLayout(clippedPoly, { subtype: 'ushaped', unitMix: params.unitMix });
                        clippedPoly.properties = {
                            type: 'generated',
                            subtype: 'ushaped',
                            wingDepth: effectiveDepth,
                            area: newArea,
                            cores: layout.cores,
                            units: layout.units,
                            entrances: layout.entrances // Save entrances
                        };
                        buildings.push(clippedPoly);
                        break;
                    }
                }

                if (buildings.length === 0) {
                    // Fallback: Try smaller U-shape
                    let smallerUShape = createUShape(candidate, scaledLength * 0.7, scaledWidth * 0.7, effectiveDepth, orientation);

                    if (smallerUShape) {
                        // @ts-ignore
                        const smallIntersect = turf.intersect(smallerUShape, validArea);
                        if (smallIntersect) {
                            const smallClipped = smallIntersect as Feature<Polygon>;
                            if (turf.area(smallClipped) > turf.area(smallerUShape) * 0.6 && !checkCollision(smallClipped, obstacles)) {
                                const layout = generateBuildingLayout(smallClipped, { subtype: 'ushaped', unitMix: params.unitMix });
                                smallClipped.properties = {
                                    type: 'generated',
                                    subtype: 'ushaped',
                                    wingDepth: effectiveDepth,
                                    area: turf.area(smallClipped),
                                    cores: layout.cores,
                                    units: layout.units,
                                    entrances: layout.entrances,
                                };
                                buildings.push(smallClipped);
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('U-shape validation failed:', e);
            }
        }
    }

    return buildings;
}

/**
 * Generates T-shaped buildings within a plot
 */
export function generateTShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { wingDepth, orientation, setback, obstacles } = params;
    const stemLength = params.wingLengthA || 30;
    const capLength = params.wingLengthB || 40;

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];

    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;

    // Calculate plot dimensions
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;
    const plotWidth = turf.distance(turf.point([minX, minY]), turf.point([maxX, minY])) * 1000;
    const plotHeight = turf.distance(turf.point([minX, minY]), turf.point([minX, maxY])) * 1000;
    const plotArea = plotWidth * plotHeight;

    // REALISTIC SIZING: Scale to 30-35% for multi-shape layouts
    const scaleFactor = plotArea < 2000 ? 0.38 : (plotArea < 4000 ? 0.35 : 0.30);

    // Optimal wing depth: 10-14m
    const optimalDepth = Math.min(14, Math.max(10, Math.min(plotWidth, plotHeight) * 0.12));
    const effectiveDepth = wingDepth || optimalDepth;

    // T-Shape: Adjusted for better generation
    // CRITICAL: Cap needs to be at least 3x depth to look like a T (center stem + wings)
    const minCap = effectiveDepth * 3.0;
    const minStem = effectiveDepth * 2.5;

    let scaledStem = Math.max(
        minStem,
        Math.min(
            Math.max(stemLength, plotHeight * scaleFactor),
            Math.min(plotHeight * 0.60, 140)
        )
    );
    let scaledCap = Math.max(
        minCap,
        Math.min(
            Math.max(capLength, plotWidth * scaleFactor),
            Math.min(plotWidth * 0.60, 150)
        )
    );

    console.log('T-shape dimensions:', { plotWidth, plotHeight, plotArea, scaledStem, scaledCap, effectiveDepth, minCap, minStem });

    // SMART PLACEMENT: Use inner candidates
    const candidates = getSmartCandidates(
        validArea, bbox, scaledCap, scaledStem, params.vastuCompliant || false, params.targetPosition
    );
    const candidatePoints = candidates.map(c => c.point);

    for (const candidate of candidatePoints) {
        if (buildings.length > 0) break;

        const tShape = createTShape(candidate, scaledStem, scaledCap, effectiveDepth, orientation);

        if (tShape) {
            try {
                // @ts-ignore
                // @ts-ignore
                const intersected = turf.intersect(tShape, validArea);
                if (intersected) {
                    const clippedPoly = intersected as Feature<Polygon>;
                    const originalArea = turf.area(tShape);
                    const newArea = turf.area(clippedPoly);

                    // STRICTER VALIDATION: 85% area retention
                    if (newArea > originalArea * 0.85 && !checkCollision(clippedPoly, obstacles)) {
                        const layout = generateBuildingLayout(clippedPoly, { subtype: 'tshaped', unitMix: params.unitMix });
                        clippedPoly.properties = {
                            type: 'generated',
                            subtype: 'tshaped',
                            wingDepth: effectiveDepth,
                            area: newArea,
                            cores: layout.cores,
                            units: layout.units,
                            entrances: layout.entrances,
                        };
                        buildings.push(clippedPoly);
                        break;
                    }
                }

                if (buildings.length === 0) {
                    // Fallback: Try smaller T-shape
                    let smallerTShape = createTShape(candidate, scaledStem * 0.7, scaledCap * 0.7, effectiveDepth, orientation);

                    if (smallerTShape) {
                        // @ts-ignore
                        const smallIntersect = turf.intersect(smallerTShape, validArea);
                        if (smallIntersect) {
                            const smallClipped = smallIntersect as Feature<Polygon>;
                            if (turf.area(smallClipped) > turf.area(smallerTShape) * 0.6 && !checkCollision(smallClipped, obstacles)) {
                                const layout = generateBuildingLayout(smallClipped, { subtype: 'tshaped', unitMix: params.unitMix });
                                smallClipped.properties = {
                                    type: 'generated',
                                    subtype: 'tshaped',
                                    wingDepth: effectiveDepth,
                                    area: turf.area(smallClipped),
                                    cores: layout.cores,
                                    units: layout.units,
                                    entrances: layout.entrances,
                                };
                                buildings.push(smallClipped);
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('T-shape validation failed:', e);
            }
        }
    }

    return buildings;
}

/**
 * Generates H-shaped buildings within a plot
 */
export function generateHShapes(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    params: GeometricTypologyParams
): Feature<Polygon>[] {
    const buildings: Feature<Polygon>[] = [];
    const { wingDepth, orientation, setback, obstacles } = params;
    const barLength = params.wingLengthA || 30;
    const separation = params.wingLengthB || 20;

    // 1. Apply Setback
    // @ts-ignore
    const bufferedPlot = turf.buffer(plotGeometry, -setback, { units: 'meters' });
    if (!bufferedPlot) return [];

    // @ts-ignore
    const validArea = bufferedPlot as Feature<Polygon | MultiPolygon>;

    // Calculate plot dimensions
    const bbox = turf.bbox(validArea);
    const [minX, minY, maxX, maxY] = bbox;
    const plotWidth = turf.distance(turf.point([minX, minY]), turf.point([maxX, minY])) * 1000;
    const plotHeight = turf.distance(turf.point([minX, minY]), turf.point([minX, maxY])) * 1000;
    const plotArea = plotWidth * plotHeight;

    // REALISTIC SIZING: H-shape reduced to 30-35% to allow other shapes
    const scaleFactor = plotArea < 3000 ? 0.38 : (plotArea < 6000 ? 0.35 : 0.30);

    // Optimal wing depth: 10-14m
    const optimalDepth = Math.min(14, Math.max(10, Math.min(plotWidth, plotHeight) * 0.1));
    const effectiveDepth = wingDepth || optimalDepth;

    // H-Shape: Smaller bar and separation for realistic layouts
    // CRITICAL: Separation > depth is needed for bridge to exist
    const minBar = effectiveDepth * 2.5;
    const minSep = effectiveDepth * 1.5;

    let scaledBar = Math.max(
        minBar,
        Math.min(
            Math.max(barLength, plotHeight * scaleFactor),
            Math.min(plotHeight * 0.60, 140)
        )
    );
    // Separation for visible courtyard
    let scaledSep = Math.max(
        minSep,
        Math.min(
            Math.max(separation, plotWidth * 0.35),
            Math.min(plotWidth * 0.50, 100)
        )
    );

    // Ensure total width (sep + 2*depth) fits in plot
    const totalWidth = scaledSep + 2 * effectiveDepth;
    if (totalWidth > plotWidth * 0.55) {
        scaledSep = Math.max(effectiveDepth * 1.5, plotWidth * 0.55 - 2 * effectiveDepth);
    }

    console.log('H-shape dimensions:', { plotWidth, plotHeight, plotArea, scaledBar, scaledSep, effectiveDepth, minBar, minSep });

    // SMART PLACEMENT: Use inner candidates
    const w = scaledSep + 2 * effectiveDepth; // Approx width
    const candidates = getSmartCandidates(
        validArea, bbox, w, scaledBar, params.vastuCompliant || false, params.targetPosition
    );
    const candidatePoints = candidates.map(c => c.point);

    for (const candidate of candidatePoints) {
        if (buildings.length > 0) break;

        const hShape = createHShape(candidate, scaledBar, scaledSep, effectiveDepth, orientation);

        if (hShape) {
            try {
                // @ts-ignore
                // @ts-ignore
                const intersected = turf.intersect(hShape, validArea);
                if (intersected) {
                    const clippedPoly = intersected as Feature<Polygon>;
                    const originalArea = turf.area(hShape);
                    const newArea = turf.area(clippedPoly);

                    // STRICTER VALIDATION: 85% area retention
                    if (newArea > originalArea * 0.85 && !checkCollision(clippedPoly, obstacles)) {
                        const layout = generateBuildingLayout(clippedPoly, { subtype: 'hshaped', unitMix: params.unitMix });
                        clippedPoly.properties = {
                            type: 'generated',
                            subtype: 'hshaped',
                            wingDepth: effectiveDepth,
                            area: newArea,
                            cores: layout.cores,
                            units: layout.units,
                            entrances: layout.entrances,
                        };
                        buildings.push(clippedPoly);
                        break;
                    }
                }

                if (buildings.length === 0) {
                    // Fallback: Try smaller H-shape
                    let smallerHShape = createHShape(candidate, scaledBar * 0.7, scaledSep * 0.7, effectiveDepth, orientation);

                    if (smallerHShape) {
                        // @ts-ignore
                        const smallIntersect = turf.intersect(smallerHShape, validArea);
                        if (smallIntersect) {
                            const smallClipped = smallIntersect as Feature<Polygon>;
                            if (turf.area(smallClipped) > turf.area(smallerHShape) * 0.6 && !checkCollision(smallClipped, obstacles)) {
                                const layout = generateBuildingLayout(smallClipped, { subtype: 'hshaped', unitMix: params.unitMix });
                                smallClipped.properties = {
                                    type: 'generated',
                                    subtype: 'hshaped',
                                    wingDepth: effectiveDepth,
                                    area: turf.area(smallClipped),
                                    cores: layout.cores,
                                    units: layout.units,
                                    entrances: layout.entrances,
                                };
                                buildings.push(smallClipped);
                                break;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn('H-shape validation failed:', e);
            }
        }
    }

    return buildings;
}

// ============ Helper Functions for Creating Shapes ============

// Helper to get destination point
const getDest = (origin: any, dist: number, bear: number, turf: any) => {
    // @ts-ignore
    const fn = turf.rhumbDestination || turf.destination;
    // @ts-ignore
    return fn(origin, dist, bear, { units: 'meters' }).geometry.coordinates;
};

/**
 * Creates an L-shaped polygon centered at 'center'
 */
function createLShape(
    center: Feature<Point>,
    lengthA: number,
    lengthB: number,
    depth: number,
    angle: number
): Feature<Polygon> | null {
    // Add variance (±10%)
    const variance = 0.9 + Math.random() * 0.2;
    lengthA *= variance;
    lengthB *= variance;

    // @ts-ignore
    const fn = turf.rhumbDestination || turf.destination;

    // Move to P0 from Center
    // @ts-ignore
    const startX = fn(center, lengthB / 2, angle + 270, { units: 'meters' });
    // @ts-ignore
    const startP = fn(startX, lengthA / 2, angle + 180, { units: 'meters' });
    const p0 = startP.geometry.coordinates;

    // Trace L-Shape from P0 (Bottom-Left Corner)
    const p1 = getDest(startP, lengthA, angle, turf); // Up
    const p2 = getDest(turf.point(p1), depth, angle + 90, turf); // Right (Top Width)
    const p3 = getDest(turf.point(p2), lengthA - depth, angle + 180, turf); // Down (Inner Vert)
    const p4 = getDest(turf.point(p3), lengthB - depth, angle + 90, turf); // Right (Inner Horiz)
    const p5 = getDest(turf.point(p4), depth, angle + 180, turf); // Down (Right Wing Tip)
    const p6 = getDest(turf.point(p5), lengthB, angle + 270, turf); // Left (Bottom Edge) -> Back to P0

    return turf.polygon([[p0, p1, p2, p3, p4, p5, p6, p0]]);
}

/**
 * Creates a U-shaped polygon centered at 'center'
 */
function createUShape(
    center: Feature<Point>,
    length: number,
    width: number,
    depth: number,
    angle: number
): Feature<Polygon> | null {
    const variance = 0.9 + Math.random() * 0.2;
    length *= variance;
    width *= variance;

    // @ts-ignore
    const fn = turf.rhumbDestination || turf.destination;

    // P0 is Bottom-Left Outer Corner.
    // Center to P0: West by Width/2, South by Length/2.
    // @ts-ignore
    const startX = fn(center, width / 2, angle + 270, { units: 'meters' });
    // @ts-ignore
    const startP = fn(startX, length / 2, angle + 180, { units: 'meters' });
    const p0 = startP.geometry.coordinates;

    const p1 = getDest(startP, length, angle, turf); // Up Left Outer
    const p2 = getDest(turf.point(p1), width, angle + 90, turf); // Top Edge
    const p3 = getDest(turf.point(p2), length, angle + 180, turf); // Down Right Outer
    const p4 = getDest(turf.point(p3), depth, angle + 270, turf); // Left (Bottom Right Inner)
    const p5 = getDest(turf.point(p4), length - depth, angle, turf); // Up Inner Right
    const p6 = getDest(turf.point(p5), width - 2 * depth, angle + 270, turf); // Left Inner Top
    const p7 = getDest(turf.point(p6), length - depth, angle + 180, turf); // Down Inner Left

    return turf.polygon([[p0, p1, p2, p3, p4, p5, p6, p7, p0]]);
}

/**
 * Creates a T-shaped polygon centered at 'center'
 */
function createTShape(
    center: Feature<Point>,
    stemLength: number,
    capLength: number,
    depth: number,
    angle: number
): Feature<Polygon> | null {
    const variance = 0.9 + Math.random() * 0.2;
    stemLength *= variance;
    capLength *= variance;

    // @ts-ignore
    const fn = turf.rhumbDestination || turf.destination;

    // @ts-ignore
    const startX = fn(center, depth / 2, angle + 270, { units: 'meters' });
    // @ts-ignore
    const startP = fn(startX, (stemLength + depth) / 2, angle + 180, { units: 'meters' });
    const p0 = startP.geometry.coordinates;

    const p1 = getDest(startP, stemLength, angle, turf); // Up Stem
    const p2 = getDest(turf.point(p1), (capLength - depth) / 2, angle + 270, turf); // Left to Cap Start
    const p3 = getDest(turf.point(p2), depth, angle, turf); // Cap Height Up
    const p4 = getDest(turf.point(p3), capLength, angle + 90, turf); // Cap Width Right
    const p5 = getDest(turf.point(p4), depth, angle + 180, turf); // Cap Height Down
    const p6 = getDest(turf.point(p5), (capLength - depth) / 2, angle + 270, turf); // Left to Stem Join
    const p7 = getDest(turf.point(p6), stemLength, angle + 180, turf); // Stem Down

    return turf.polygon([[p0, p1, p2, p3, p4, p5, p6, p7, p0]]);
}

/**
 * Creates an H-shaped polygon centered at 'center'
 */
function createHShape(
    center: Feature<Point>,
    barLength: number,
    separation: number,
    depth: number,
    angle: number
): Feature<Polygon> | null {
    const variance = 0.9 + Math.random() * 0.2;
    barLength *= variance;
    separation *= variance;

    // @ts-ignore
    const fn = turf.rhumbDestination || turf.destination;

    const totalWidth = 2 * depth + separation;
    // @ts-ignore
    const startX = fn(center, totalWidth / 2, angle + 270, { units: 'meters' });
    // @ts-ignore
    const startP = fn(startX, barLength / 2, angle + 180, { units: 'meters' });
    const p0 = startP.geometry.coordinates;

    const bridgeHeight = depth;
    const bridgeY = (barLength - bridgeHeight) / 2;

    const p1 = getDest(startP, barLength, angle, turf); // Up Left Bar
    const p2 = getDest(turf.point(p1), depth, angle + 90, turf); // Right (Top)
    const p3 = getDest(turf.point(p2), barLength - bridgeY - bridgeHeight, angle + 180, turf); // Down inner
    const p4 = getDest(turf.point(p3), separation, angle + 90, turf); // Across Bridge
    const p5 = getDest(turf.point(p4), barLength - bridgeY - bridgeHeight, angle, turf); // Up Inner Right
    const p6 = getDest(turf.point(p5), depth, angle + 90, turf); // Right (Top Right)
    const p7 = getDest(turf.point(p6), barLength, angle + 180, turf); // Down Right Bar
    const p8 = getDest(turf.point(p7), depth, angle + 270, turf); // Left (Bottom Right Inner)
    const p9 = getDest(turf.point(p8), bridgeY, angle, turf); // Up Inner
    const p10 = getDest(turf.point(p9), separation, angle + 270, turf); // Left Across Bridge
    const p11 = getDest(turf.point(p10), bridgeY, angle + 180, turf); // Down Inner Left

    return turf.polygon([[p0, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p0]]);
}
