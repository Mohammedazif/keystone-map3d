import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon, Point } from 'geojson';

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
    const bufferedPlot = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' });
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

    // Wing lengths scale with plot, with smaller max bounds for realistic layouts
    let wingLengthA = Math.min(
        Math.max(params.wingLengthA || plotHeight * scaleFactor, effectiveDepth * 2.2),
        Math.min(plotHeight * 0.45, 35) // Max: 45% of height or 35m
    );
    let wingLengthB = Math.min(
        Math.max(params.wingLengthB || plotWidth * scaleFactor, effectiveDepth * 2.2),
        Math.min(plotWidth * 0.45, 35)
    );

    console.log('L-shape dimensions:', { plotWidth, plotHeight, plotArea, wingLengthA, wingLengthB, effectiveDepth });

    // PERIPHERAL PLACEMENT: Use edges/corners, NOT center
    let candidates: Feature<Point>[] = [];
    const centroid = turf.centroid(validArea);

    // Target position from Vastu zoning (if provided)
    if (params.targetPosition) {
        // @ts-ignore
        if (turf.booleanPointInPolygon(params.targetPosition, validArea)) {
            candidates.push(params.targetPosition);
        }
    }

    // Add edge/corner points (NO CENTROID for realistic peripheral layouts)
    // @ts-ignore
    const corners = turf.explode(validArea).features;
    if (corners.length >= 4) {
        candidates.push(...corners.slice(0, 4) as Feature<Point>[]);
    }

    // Fallback: Add centroid as LAST option (if no Vastu OR if single shape)
    // This ensures at least one placement option exists
    if (!params.vastuCompliant) {
        candidates.push(centroid);
    }

    // Attempt placement
    for (const candidate of candidates) {
        if (buildings.length > 0) break; // Only place one main shape per generator call for now

        const lShape = createLShape(candidate, wingLengthA, wingLengthB, effectiveDepth, orientation);

        if (lShape) {
            try {
                // @ts-ignore
                if (turf.booleanWithin(lShape, validArea) && !checkCollision(lShape, obstacles)) {
                    lShape.properties = {
                        type: 'generated',
                        subtype: 'lshaped',
                        wingDepth: effectiveDepth,
                        area: turf.area(lShape)
                    };
                    buildings.push(lShape);
                    break;
                }

                // If primary size failed, try smaller
                if (buildings.length === 0) {
                    let smallerLShape = createLShape(candidate, wingLengthA * 0.7, wingLengthB * 0.7, effectiveDepth, orientation);
                    // @ts-ignore
                    if (smallerLShape && turf.booleanWithin(smallerLShape, validArea) && !checkCollision(smallerLShape, obstacles)) {
                        smallerLShape.properties = {
                            type: 'generated',
                            subtype: 'lshaped',
                            wingDepth: effectiveDepth,
                            area: turf.area(smallerLShape)
                        };
                        buildings.push(smallerLShape);
                        break;
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
    const bufferedPlot = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' });
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
            Math.min(plotWidth * 0.50, 45)
        )
    );
    let scaledWidth = Math.max(
        minWidth,
        Math.min(
            Math.max(width, plotHeight * scaleFactor),
            Math.min(plotHeight * 0.50, 45)
        )
    );

    console.log('U-shape dimensions:', { plotWidth, plotHeight, plotArea, scaledLength, scaledWidth, effectiveDepth, minLength, minWidth });

    // PERIPHERAL PLACEMENT: Use edges/corners, NOT center
    let candidates: Feature<Point>[] = [];
    const centroid = turf.centroid(validArea);

    if (params.targetPosition) {
        // @ts-ignore
        if (turf.booleanPointInPolygon(params.targetPosition, validArea)) {
            candidates.push(params.targetPosition);
        }
    }

    // @ts-ignore
    const corners = turf.explode(validArea).features;
    if (corners.length >= 4) {
        candidates.push(...corners.slice(0, 4) as Feature<Point>[]);
    }

    // Fallback: centroid as LAST option
    if (!params.vastuCompliant) {
        candidates.push(centroid);
    }

    for (const candidate of candidates) {
        if (buildings.length > 0) break;

        const uShape = createUShape(candidate, scaledLength, scaledWidth, effectiveDepth, orientation);

        if (uShape) {
            try {
                // @ts-ignore
                if (turf.booleanWithin(uShape, validArea) && !checkCollision(uShape, obstacles)) {
                    uShape.properties = {
                        type: 'generated',
                        subtype: 'ushaped',
                        wingDepth: effectiveDepth,
                        area: turf.area(uShape)
                    };
                    buildings.push(uShape);
                    break;
                }

                if (buildings.length === 0) {
                    // Fallback: Try smaller U-shape
                    let smallerUShape = createUShape(candidate, scaledLength * 0.7, scaledWidth * 0.7, effectiveDepth, orientation);
                    // @ts-ignore
                    if (smallerUShape && turf.booleanWithin(smallerUShape, validArea) && !checkCollision(smallerUShape, obstacles)) {
                        smallerUShape.properties = {
                            type: 'generated',
                            subtype: 'ushaped',
                            wingDepth: effectiveDepth,
                            area: turf.area(smallerUShape)
                        };
                        buildings.push(smallerUShape);
                        break;
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
    const bufferedPlot = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' });
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
            Math.min(plotHeight * 0.50, 40)
        )
    );
    let scaledCap = Math.max(
        minCap,
        Math.min(
            Math.max(capLength, plotWidth * scaleFactor),
            Math.min(plotWidth * 0.50, 45)
        )
    );

    console.log('T-shape dimensions:', { plotWidth, plotHeight, plotArea, scaledStem, scaledCap, effectiveDepth, minCap, minStem });

    // PERIPHERAL PLACEMENT: Use edges/corners, NOT center
    let candidates: Feature<Point>[] = [];
    const centroid = turf.centroid(validArea);

    if (params.targetPosition) {
        // @ts-ignore
        if (turf.booleanPointInPolygon(params.targetPosition, validArea)) {
            candidates.push(params.targetPosition);
        }
    }

    // @ts-ignore
    const corners = turf.explode(validArea).features;
    if (corners.length >= 4) {
        candidates.push(...corners.slice(0, 4) as Feature<Point>[]);
    }

    // Fallback: centroid as LAST option
    if (!params.vastuCompliant) {
        candidates.push(centroid);
    }

    for (const candidate of candidates) {
        if (buildings.length > 0) break;

        const tShape = createTShape(candidate, scaledStem, scaledCap, effectiveDepth, orientation);

        if (tShape) {
            try {
                // @ts-ignore
                if (turf.booleanWithin(tShape, validArea) && !checkCollision(tShape, obstacles)) {
                    tShape.properties = {
                        type: 'generated',
                        subtype: 'tshaped',
                        wingDepth: effectiveDepth,
                        area: turf.area(tShape)
                    };
                    buildings.push(tShape);
                    break;
                }

                if (buildings.length === 0) {
                    // Fallback: Try smaller T-shape
                    let smallerTShape = createTShape(candidate, scaledStem * 0.7, scaledCap * 0.7, effectiveDepth, orientation);
                    // @ts-ignore
                    if (smallerTShape && turf.booleanWithin(smallerTShape, validArea) && !checkCollision(smallerTShape, obstacles)) {
                        smallerTShape.properties = {
                            type: 'generated',
                            subtype: 'tshaped',
                            wingDepth: effectiveDepth,
                            area: turf.area(smallerTShape)
                        };
                        buildings.push(smallerTShape);
                        break;
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
    const bufferedPlot = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' });
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
            Math.min(plotHeight * 0.45, 40)
        )
    );
    // Separation for visible courtyard
    let scaledSep = Math.max(
        minSep,
        Math.min(
            Math.max(separation, plotWidth * 0.25),
            Math.min(plotWidth * 0.35, 28)
        )
    );

    // Ensure total width (sep + 2*depth) fits in plot
    const totalWidth = scaledSep + 2 * effectiveDepth;
    if (totalWidth > plotWidth * 0.55) {
        scaledSep = Math.max(effectiveDepth * 1.5, plotWidth * 0.55 - 2 * effectiveDepth);
    }

    console.log('H-shape dimensions:', { plotWidth, plotHeight, plotArea, scaledBar, scaledSep, effectiveDepth, minBar, minSep });

    // PERIPHERAL PLACEMENT: Use edges/corners, NOT center
    let candidates: Feature<Point>[] = [];
    const centroid = turf.centroid(validArea);

    if (params.targetPosition) {
        // @ts-ignore
        if (turf.booleanPointInPolygon(params.targetPosition, validArea)) {
            candidates.push(params.targetPosition);
        }
    }

    // @ts-ignore
    const corners = turf.explode(validArea).features;
    if (corners.length >= 4) {
        candidates.push(...corners.slice(0, 4) as Feature<Point>[]);
    }

    // Fallback: centroid as LAST option
    if (!params.vastuCompliant) {
        candidates.push(centroid);
    }

    for (const candidate of candidates) {
        if (buildings.length > 0) break;

        const hShape = createHShape(candidate, scaledBar, scaledSep, effectiveDepth, orientation);

        if (hShape) {
            try {
                // @ts-ignore
                if (turf.booleanWithin(hShape, validArea) && !checkCollision(hShape, obstacles)) {
                    hShape.properties = {
                        type: 'generated',
                        subtype: 'hshaped',
                        wingDepth: effectiveDepth,
                        area: turf.area(hShape)
                    };
                    buildings.push(hShape);
                    break;
                }

                if (buildings.length === 0) {
                    // Fallback: Try smaller H-shape
                    let smallerHShape = createHShape(candidate, scaledBar * 0.7, scaledSep * 0.7, effectiveDepth, orientation);
                    // @ts-ignore
                    if (smallerHShape && turf.booleanWithin(smallerHShape, validArea) && !checkCollision(smallerHShape, obstacles)) {
                        smallerHShape.properties = {
                            type: 'generated',
                            subtype: 'hshaped',
                            wingDepth: effectiveDepth,
                            area: turf.area(smallerHShape)
                        };
                        buildings.push(smallerHShape);
                        break;
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
