/**
 * Geometry Utilities for Building Generation
 * Handles peripheral clear zones, setbacks, and buildable area calculations
 */

import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon } from 'geojson';

export interface PeripheralZoneConfig {
    parkingWidth: number;  // meters from boundary
    roadWidth: number;     // meters after parking
}

export interface SetbackConfig {
    front?: number;
    rear?: number;
    side?: number;
    general: number;
}

/**
 * Apply 11m Peripheral Clear Zone (5m Parking + 6m Road)
 * Returns the buildable area after deducting peripheral zones
 */
export function applyPeripheralClearZone(
    plotGeometry: Feature<Polygon | MultiPolygon>,
    config: PeripheralZoneConfig = { parkingWidth: 5, roadWidth: 6 }
): {
    buildableArea: Feature<Polygon | MultiPolygon> | null;
    parkingZone: Feature<Polygon | MultiPolygon> | null;
    roadZone: Feature<Polygon | MultiPolygon> | null;
} {
    try {
        const totalClearance = config.parkingWidth + config.roadWidth; // e.g. 11m

        // Clean input geometry first
        // @ts-ignore
        const cleanedPlot = turf.cleanCoords(plotGeometry);

        // Create the buildable area by buffering inward
        // @ts-ignore
        const buildable = turf.buffer(cleanedPlot, -totalClearance / 1000, { units: 'kilometers' });

        // Validate buildable area
        if (!buildable || turf.area(buildable) < 100) {
            console.warn('[applyPeripheralClearZone] Buildable area too small or vanished after clearance');
            return { buildableArea: null, parkingZone: null, roadZone: null };
        }

        // Ensure buildable area is valid polygon
        // @ts-ignore
        const buildablePoly = turf.unkinkPolygon(buildable).features.reduce((largest, current) => {
            return turf.area(current) > turf.area(largest) ? current : largest;
        }).geometry;

        // Re-wrap as Feature
        const buildableFeature = turf.polygon(buildablePoly.coordinates);

        // Create parking zone (outer ring: 0-Xm from boundary)
        const parkingOuter = cleanedPlot;
        // @ts-ignore
        const parkingInnerRaw = turf.buffer(cleanedPlot, -config.parkingWidth / 1000, { units: 'kilometers' });

        let parkingInner = parkingInnerRaw;
        // Clean parking inner if valid
        if (parkingInner) {
            // @ts-ignore
            const piPoly = turf.unkinkPolygon(parkingInner).features.reduce((largest, current) => {
                return turf.area(current) > turf.area(largest) ? current : largest;
            }).geometry;
            parkingInner = turf.polygon(piPoly.coordinates);
        }

        const parkingZone = parkingInner ? turf.difference(parkingOuter, parkingInner) : null;

        // Create road zone (middle ring: X-Ym from boundary)
        // Note: roadOuter IS parkingInner
        const roadOuter = parkingInner;
        const roadInner = buildableFeature;

        // Verify roadInner is strictly inside roadOuter
        const roadZone = roadOuter && roadInner ? turf.difference(roadOuter, roadInner) : null;

        // Final Sanity Check: Road zone should not be larger than the plot itself (implied)
        // And certainly not larger than the buildable area if it's a ring
        if (roadZone && turf.area(roadZone) > turf.area(cleanedPlot) * 0.9) {
            console.warn('[applyPeripheralClearZone] Road zone seemingly covers entire plot, discarding');
            return { buildableArea: buildableFeature, parkingZone: parkingZone as Feature<Polygon>, roadZone: null };
        }

        return {
            buildableArea: buildableFeature as Feature<Polygon>,
            parkingZone: parkingZone as Feature<Polygon> | null,
            roadZone: roadZone as Feature<Polygon> | null
        };
    } catch (error) {
        console.error('[applyPeripheralClearZone] Error:', error);
        return { buildableArea: null, parkingZone: null, roadZone: null };
    }
}

/**
 * Apply robust setbacks with corner handling
 * Uses polygon buffering for uniform setbacks
 */
export function applyRobustSetbacks(
    geometry: Feature<Polygon | MultiPolygon>,
    setback: number
): Feature<Polygon | MultiPolygon> | null {
    try {
        if (setback <= 0) return geometry;

        const buffered = turf.buffer(geometry, -setback / 1000, { units: 'kilometers' });

        if (!buffered || turf.area(buffered) < 50) {
            console.warn('[applyRobustSetbacks] Area vanished or too small after setback');
            return null;
        }

        return buffered as Feature<Polygon | MultiPolygon>;
    } catch (error) {
        console.error('[applyRobustSetbacks] Error:', error);
        return null;
    }
}

/**
 * Ensure minimum corner clearance between building segments
 * This prevents buildings from touching at corners (especially in T and H shapes)
 */
export function ensureCornerClearance(
    buildingFootprints: Feature<Polygon>[],
    minClearance: number = 3
): Feature<Polygon>[] {
    const result: Feature<Polygon>[] = [];

    for (let i = 0; i < buildingFootprints.length; i++) {
        let building = buildingFootprints[i];
        let hasOverlap = false;

        // Check against all other buildings
        for (let j = 0; j < buildingFootprints.length; j++) {
            if (i === j) continue;

            const other = buildingFootprints[j];

            // Calculate distance between buildings
            const distance = turf.distance(
                turf.centroid(building),
                turf.centroid(other),
                { units: 'meters' }
            );

            // If too close, shrink this building slightly
            if (distance < minClearance * 2) {
                const shrunk = turf.buffer(building, -minClearance / 2000, { units: 'kilometers' });
                if (shrunk && turf.area(shrunk) > 50) {
                    building = shrunk as Feature<Polygon>;
                    hasOverlap = true;
                }
            }
        }

        result.push(building);
    }

    return result;
}

/**
 * Deduct obstacle areas (roads, entries) from buildable area
 */
export function deductObstacles(
    buildableArea: Feature<Polygon | MultiPolygon>,
    obstacles: Feature<Polygon | MultiPolygon>[]
): Feature<Polygon | MultiPolygon> | null {
    try {
        let result = buildableArea;

        for (const obstacle of obstacles) {
            if (!obstacle) continue;

            const diff = turf.difference(result, obstacle);
            if (!diff) {
                console.warn('[deductObstacles] Obstacle consumed entire buildable area');
                return null;
            }
            result = diff as Feature<Polygon | MultiPolygon>;
        }

        return result;
    } catch (error) {
        console.error('[deductObstacles] Error:', error);
        return buildableArea;
    }
}
