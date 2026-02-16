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
        const totalClearance = config.parkingWidth + config.roadWidth; // 11m total

        // Create the buildable area by buffering inward
        const buildable = turf.buffer(plotGeometry, -totalClearance / 1000, { units: 'kilometers' });

        if (!buildable || turf.area(buildable) < 100) {
            console.warn('[applyPeripheralClearZone] Buildable area too small or vanished after 11m clearance');
            return { buildableArea: null, parkingZone: null, roadZone: null };
        }

        // Create parking zone (outer ring: 0-5m from boundary)
        const parkingOuter = plotGeometry;
        const parkingInner = turf.buffer(plotGeometry, -config.parkingWidth / 1000, { units: 'kilometers' });
        const parkingZone = parkingInner ? turf.difference(parkingOuter, parkingInner) : null;

        // Create road zone (middle ring: 5-11m from boundary)
        const roadOuter = parkingInner;
        const roadInner = buildable;
        const roadZone = roadOuter && roadInner ? turf.difference(roadOuter, roadInner) : null;

        return {
            buildableArea: buildable as Feature<Polygon | MultiPolygon>,
            parkingZone: parkingZone as Feature<Polygon | MultiPolygon> | null,
            roadZone: roadZone as Feature<Polygon | MultiPolygon> | null
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
