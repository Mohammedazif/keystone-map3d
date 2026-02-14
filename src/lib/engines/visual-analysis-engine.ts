import { getSunPosition } from '@/lib/sun-utils';
import type { Building, GreenRegulationData } from '@/lib/types';
import * as turf from '@turf/turf';

export interface AggregateAnalysisResult {
    compliantArea: number; // Percentage 0-100
    avgValue: number;
}

/**
 * Helper to calculate aggregate statistics from analysis results
 */
export function calculateAggregateStats(
    results: Map<string, BuildingAnalysisResult>,
    mode: AnalysisMode,
    buildings: Building[],
    greenRegulations: GreenRegulationData[] = []
): AggregateAnalysisResult {
    if (results.size === 0) return { compliantArea: 0, avgValue: 0 };

    let totalArea = 0;
    let compliantArea = 0;
    let totalValueArea = 0;

    // Get thresholds
    const thresholds = greenRegulations.length > 0 ? greenRegulations.map(parseThresholdsFromRegulation)[0] : {};

    buildings.forEach(b => {
        const res = results.get(b.id);
        if (!res) return;

        // Weight by floor area (or just footprint area if simple)
        // Let's use total floor area for more accuracy
        const bArea = b.floors.length * b.area;
        totalArea += bArea;
        totalValueArea += res.value * bArea;

        // Check compliance
        let isCompliant = false;
        if (mode === 'wind') {
            // Wind: Target is ventilation. 
            // If wind speed > min (e.g. 0.6 m/s), it's ventilated.
            const minSpeed = thresholds?.windSpeedMin || 0.6;
            if (res.value >= minSpeed) isCompliant = true;
        } else if (mode === 'sun-hours') {
            // Sun: Target is direct sunlight.
            // If hours > min (e.g. 2 hours), it's compliant.
            const minHours = thresholds?.sunHoursMin || 2;
            if (res.value >= minHours) isCompliant = true;
        } else if (mode === 'daylight') {
            // Daylight: DF > min (e.g. 2%)
            // Value in runVisualAnalysis for daylight is 'daylightFactor' (0-1 approx).
            // So if minDF is 0.02, we check >= 0.02
            const minDF = thresholds?.daylightFactorMin || 0.02;
            if (res.value >= minDF) isCompliant = true;
        }

        if (isCompliant) {
            compliantArea += bArea;
        }
    });

    if (totalArea === 0) return { compliantArea: 0, avgValue: 0 };

    return {
        compliantArea: (compliantArea / totalArea) * 100,
        avgValue: totalValueArea / totalArea
    };
}

export type AnalysisMode = 'none' | 'sun-hours' | 'daylight' | 'wind';

// Parsed threshold values from certificate regulations
interface ParsedThresholds {
    sunHoursMin?: number;
    sunHoursTarget?: number;
    daylightFactorMin?: number;
    daylightFactorTarget?: number;
    windSpeedMin?: number;
    windSpeedTarget?: number;
}

/**
 * Parse numeric thresholds from green regulation requirements
 */
export function parseThresholdsFromRegulation(
    regulation: GreenRegulationData
): ParsedThresholds {
    const thresholds: ParsedThresholds = {};

    // PRIORITY 1: Check explicit analysisThresholds field
    if (regulation.analysisThresholds) {
        if (regulation.analysisThresholds.sunHours) {
            thresholds.sunHoursMin = regulation.analysisThresholds.sunHours.min;
            thresholds.sunHoursTarget = regulation.analysisThresholds.sunHours.target;
        }
        if (regulation.analysisThresholds.daylightFactor) {
            thresholds.daylightFactorMin = regulation.analysisThresholds.daylightFactor.min;
            thresholds.daylightFactorTarget = regulation.analysisThresholds.daylightFactor.target;
        }
        if (regulation.analysisThresholds.windSpeed) {
            thresholds.windSpeedMin = regulation.analysisThresholds.windSpeed.min;
            thresholds.windSpeedTarget = regulation.analysisThresholds.windSpeed.target;
        }

        // If explicit thresholds are provided, return early
        if (thresholds.sunHoursMin || thresholds.daylightFactorMin || thresholds.windSpeedMin) {
            return thresholds;
        }
    }

    // FALLBACK: Parse from credit requirements (legacy behavior)
    const daylightCredits = regulation.categories
        ?.flatMap(cat => cat.credits)
        .filter(credit =>
            credit.name.toLowerCase().includes('daylight') ||
            credit.name.toLowerCase().includes('sun') ||
            credit.name.toLowerCase().includes('natural light') ||
            credit.code?.includes('EQ')
        ) || [];

    for (const credit of daylightCredits) {
        for (const req of credit.requirements || []) {
            const hoursMatch = req.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);
            if (hoursMatch) {
                const hours = parseFloat(hoursMatch[1]);
                if (!thresholds.sunHoursMin || hours < thresholds.sunHoursMin) {
                    thresholds.sunHoursMin = hours;
                }
            }

            const dfMatch = req.match(/(\d+(?:\.\d+)?)\s*%\s*(?:daylight\s*factor|DF)/i);
            if (dfMatch) {
                const df = parseFloat(dfMatch[1]) / 100;
                if (!thresholds.daylightFactorMin || df < thresholds.daylightFactorMin) {
                    thresholds.daylightFactorMin = df;
                }
            }
        }
    }

    if (thresholds.sunHoursMin) {
        thresholds.sunHoursTarget = thresholds.sunHoursMin * 1.5;
    }
    if (thresholds.daylightFactorMin) {
        thresholds.daylightFactorTarget = thresholds.daylightFactorMin * 1.5;
    }

    return thresholds;
}

const DEFAULT_THRESHOLDS: ParsedThresholds = {
    sunHoursMin: 2,
    sunHoursTarget: 4,
    daylightFactorMin: 0.02,
    daylightFactorTarget: 0.04,
    windSpeedMin: 0.6,
    windSpeedTarget: 1.2
};

/**
 * Results from visual analysis for a single building
 */
export interface BuildingAnalysisResult {
    buildingId: string;
    value: number;
    color: string; // Hex color #RRGGBB
}

// Helper to calculate edge normal
function getEdgeNormal(p1: number[], p2: number[]): number[] {
    const dx = p2[0] - p1[0];
    const dy = p2[1] - p1[1];
    // Normal is (-dy, dx) for counter-clockwise winding, or (dy, -dx)
    // Turf polygons are usually CCW. P1->P2 vector is (dx, dy).
    // Normal facing OUTWARD: (dy, -dx) checks out? 
    // If P1=(0,0), P2=(1,0) (East edge), Normal should be (0, -1) (South)? No.
    // Let's assume standard math: Normal = (dy, -dx) normalized.
    const len = Math.sqrt(dx * dx + dy * dy);
    return [dy / len, -dx / len];
}

/**
 * Calculate solar exposure by summing up exposure of all polygon edges
 * accounts for orientation of every face
 */
function calculatePolygonSolarExposure(
    building: Building,
    sunAzimuth: number,
    sunAltitude: number
): number {
    if (sunAltitude <= 0) return 0;

    // Ensure consistent winding (CCW) for correct Normal calculation
    const safePoly = turf.rewind(building.geometry as any, { reverse: false });
    const coords = safePoly.geometry.coordinates[0];

    // Ensure we have a valid polygon
    if (!coords || coords.length < 3) return 0;

    // Sun Vector (XY plane projection)
    // Azimuth 0 = North, PI = South.
    // x = sin(az), y = cos(az) 
    const sunVecX = Math.sin(sunAzimuth);
    const sunVecY = Math.cos(sunAzimuth);

    let totalExposure = 0;
    let totalPerimeter = 0;

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];

        // Edge vector
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.sqrt(dx * dx + dy * dy);

        // Edge Normal (Outward facing)
        // Assuming CCW winding: (dy, -dx)
        const nx = dy / len;
        const ny = -dx / len;

        // Dot product with sun vector
        const dot = nx * sunVecX + ny * sunVecY;

        // Only faces pointing TOWARDS sum (dot > 0) receive direct light
        if (dot > 0) {
            totalExposure += dot * len;
        }
        totalPerimeter += len;
    }

    if (totalPerimeter === 0) return 0;

    // Normalize exposure 0-1
    // Max possible exposure is when normal aligns perfectly with sun (dot=1)
    // But for a closed 2D shape, max aggregate projection is less < 0.5 perimeter?
    // A flat plate facing sun: exposure = 1*L. Perimeter = 2L. Ratio = 0.5.
    // A circle: integral...
    // Let's normalize by Projected Width? Or just return raw value normalized by Perimeter/2?
    // For visualization 0-1 range:
    const exposureFactor = totalExposure / (totalPerimeter / 2); // Roughly 0-1

    return exposureFactor * Math.sin(sunAltitude);
}


/**
 * Calculate wind exposure based on dominant wind direction
 */
function calculatePolygonWindExposure(
    building: Building,
    windDirectionDeg: number = 45 // Default NE
): number {
    // Ensure consistent winding (CCW)
    const safePoly = turf.rewind(building.geometry as any, { reverse: false });
    const coords = safePoly.geometry.coordinates[0];

    if (!coords || coords.length < 3) return 0;

    const windRad = windDirectionDeg * (Math.PI / 180);
    // Wind vector (pointing TO source)
    const windVecX = Math.sin(windRad);
    const windVecY = Math.cos(windRad);

    let totalExposure = 0;
    let totalPerimeter = 0;

    for (let i = 0; i < coords.length - 1; i++) {
        const p1 = coords[i];
        const p2 = coords[i + 1];
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const len = Math.sqrt(dx * dx + dy * dy);

        // Normal (dy, -dx)
        const nx = dy / len;
        const ny = -dx / len;

        // Dot product with wind vector
        const dot = nx * windVecX + ny * windVecY;

        if (dot > 0) {
            totalExposure += dot * len;
        }
        totalPerimeter += len;
    }

    // Normalize (0-1)
    return totalPerimeter > 0 ? totalExposure / (totalPerimeter / 2) : 0;
}

/**
 * Get hex color for analysis value
 */
function getColorForValue(
    actualValue: number,
    mode: AnalysisMode,
    regulations: GreenRegulationData[]
): string {
    const thresholds = regulations.length > 0
        ? regulations.map(parseThresholdsFromRegulation).reduce((acc, t) => ({
            sunHoursMin: Math.min(acc.sunHoursMin || Infinity, t.sunHoursMin || Infinity),
            sunHoursTarget: Math.max(acc.sunHoursTarget || 0, t.sunHoursTarget || 0),
            daylightFactorMin: Math.min(acc.daylightFactorMin || Infinity, t.daylightFactorMin || Infinity),
            daylightFactorTarget: Math.max(acc.daylightFactorTarget || 0, t.daylightFactorTarget || 0),
            windSpeedMin: Math.min(acc.windSpeedMin || Infinity, t.windSpeedMin || Infinity),
            windSpeedTarget: Math.max(acc.windSpeedTarget || 0, t.windSpeedTarget || 0),
        }), {} as ParsedThresholds)
        : DEFAULT_THRESHOLDS;

    // Green -> Yellow -> Red scale function
    const getComplianceColor = (val: number, min: number, target: number) => {
        if (val >= target) return '#00cc00'; // Green (Excellent)
        if (val >= min) return '#ffcc00';    // Yellow (Fair/Pass)
        return '#ff0000';                   // Red (Fail)
    };

    if (mode === 'sun-hours') {
        const min = thresholds.sunHoursMin || 2;
        const target = thresholds.sunHoursTarget || 4;
        return getComplianceColor(actualValue, min, target);
    }

    if (mode === 'daylight') {
        // actualValue is raw factor 0-1, convert to % for threshold check if needed, 
        // BUT check if input actualValue is already % or factor.
        // In logic below, we store it as raw number.
        // Thresholds are typically 0.02 (2%).
        const min = thresholds.daylightFactorMin || 0.02;
        const target = thresholds.daylightFactorTarget || 0.04;
        return getComplianceColor(actualValue, min, target);
    }

    if (mode === 'wind') {
        // Check if we are in strict Compliance Mode (regulations active)
        // AND if the regulation actually has wind thresholds defined
        const hasWindThresholds = thresholds.windSpeedMin !== undefined && thresholds.windSpeedMin !== Infinity;
        const isComplianceMode = regulations.length > 0 && hasWindThresholds;

        if (isComplianceMode) {
            // Wind speed checks (Compliance: Green = Good, Red = Bad)
            const min = thresholds.windSpeedMin || 1;
            const target = thresholds.windSpeedTarget || 3;
            return getComplianceColor(actualValue, min, target);
        } else {
            // Flow Mode (Visual: Blue = Low, Red = High)
            // Scale: 0 - 5 m/s
            // Blue(0) -> Cyan(1) -> Green(2) -> Yellow(3) -> Red(4+)
            if (actualValue < 1.0) return '#3b82f6'; // Blue
            if (actualValue < 2.0) return '#06b6d4'; // Cyan
            if (actualValue < 3.0) return '#10b981'; // Green
            if (actualValue < 4.0) return '#f59e0b'; // Amber
            return '#ef4444';                        // Red
        }
    }

    return '#cccccc';
}

/**
 * Main analysis function - Mapbox-native version
 */
export async function runVisualAnalysis(
    targetBuildings: Building[],
    contextBuildings: Building[],
    mode: AnalysisMode,
    date: Date,
    greenRegulations: GreenRegulationData[] = []
): Promise<Map<string, BuildingAnalysisResult>> {
    console.log('[ANALYSIS ENGINE] Starting runVisualAnalysis', {
        mode,
        targetCount: targetBuildings.length
    });

    const results = new Map<string, BuildingAnalysisResult>();

    if (mode === 'none' || targetBuildings.length === 0) {
        return results;
    }

    console.time('Analysis');

    const firstCentroid = turf.centroid(targetBuildings[0].geometry);
    const [lng, lat] = firstCentroid.geometry.coordinates;

    if (mode === 'sun-hours') {
        const hourSamples = 12;
        const totalWeight = hourSamples;
        const baseDate = new Date(date);

        for (const building of targetBuildings) {
            let directHours = 0;

            // Integrate over day
            for (let i = 0; i < hourSamples; i++) {
                const hour = 6 + (i * 12 / hourSamples);
                const sampleDate = new Date(baseDate);
                sampleDate.setHours(Math.floor(hour), (hour % 1) * 60, 0, 0);

                const pos = getSunPosition(sampleDate, lat, lng);
                if (pos.altitude > 0) {
                    const exposure = calculatePolygonSolarExposure(building, pos.azimuth, pos.altitude);
                    // If exposure (aggregate dot) > threshold, count as sun hour
                    if (exposure > 0.2) directHours += (12 / hourSamples);
                }
            }

            const color = getColorForValue(directHours, mode, greenRegulations);
            results.set(building.id, {
                buildingId: building.id,
                value: directHours,
                color
            });
        }
    } else if (mode === 'daylight') {
        const { azimuth, altitude } = getSunPosition(date, lat, lng);
        for (const building of targetBuildings) {
            const exposure = calculatePolygonSolarExposure(building, azimuth, altitude);
            // Rough DF proxy: exposure * sky_factor (constant)
            const daylightFactor = exposure * 0.05;
            const color = getColorForValue(daylightFactor, mode, greenRegulations);

            results.set(building.id, {
                buildingId: building.id,
                value: daylightFactor,
                color
            });
        }
    } else if (mode === 'wind') {
        // Use default wind direction (e.g. 45 deg)
        // In future, could come from weather data
        const windDir = 45;

        for (const building of targetBuildings) {
            const exposure = calculatePolygonWindExposure(building, windDir);

            // Convert exposure (0-1) to m/s proxy.
            // Assume Average Wind Speed at site = 3.5 m/s
            // Height factor: taller buildings get more wind
            const height = building.height || (building.floors?.reduce((sum, f) => sum + f.height, 0)) || 10;
            const heightFactor = Math.min(Math.max(height / 10, 0.5), 1.5);

            const estimatedWindSpeed = exposure * 3.5 * heightFactor;

            const color = getColorForValue(estimatedWindSpeed, mode, greenRegulations);

            results.set(building.id, {
                buildingId: building.id,
                value: estimatedWindSpeed,
                color
            });
        }
    }

    console.timeEnd('Analysis');
    console.log('[ANALYSIS ENGINE] Complete, processed', results.size, 'buildings');

    return results;
}

// --- GROUND ANALYSIS & SHADOWS ---

/**
 * Calculate the shadow polygon for a building at a given sun position
 * Shadow is the union of the base polygon and the projected top polygon (extrusion shadow)
 */
export function calculateBuildingShadow(
    building: Building,
    azimuth: number,
    altitude: number
): any { // Returns turf.Feature<turf.Polygon> | null
    if (altitude <= 0) return null; // Sun is below horizon

    const height = building.height || (building.floors?.reduce((sum, f) => sum + f.height, 0)) || 10;

    // Shadow length = h / tan(altitude)
    const tanAlt = Math.tan(altitude);
    // Cap shadow length to avoid infinite/huge shadows at sunset
    const shadowLen = tanAlt > 0.1 ? height / tanAlt : height * 20;

    // Shadow direction is opposite to sun azimuth
    // Sun Azimuth (from sun-utils): 0 = South, PI/2 = West.
    // Vector TO Sun: x = sin(az), y = -cos(az) 
    // Shadow is FROM building: vector = -sunVec
    const sunVecX = Math.sin(azimuth);
    const sunVecY = -Math.cos(azimuth);

    const shadowX = -sunVecX * shadowLen;
    const shadowY = -sunVecY * shadowLen;

    // Project the building base polygon
    const basePoly = building.geometry;
    if (!basePoly || !basePoly.geometry) return null;

    // Handle MultiPolygon (simplified: take first polygon)
    // Ensure consistent winding
    const safePoly = turf.rewind(basePoly as any, { reverse: false });
    const coords = (safePoly.geometry.type === 'Polygon')
        ? safePoly.geometry.coordinates[0]
        : (safePoly.geometry as any).coordinates[0][0];

    // Shift coords to get the projected top
    // Approximate meters to degrees conversion
    // 1 deg Lat ~= 111320m
    const centroid = turf.centroid(basePoly);
    const lat = centroid.geometry.coordinates[1];
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);

    const shiftLng = shadowX / metersPerDegLng;
    const shiftLat = shadowY / metersPerDegLat;

    const shiftedCoords = coords.map((c: any) => [c[0] + shiftLng, c[1] + shiftLat]);

    // Create a collection of points from base and projected top
    // Computing convex hull of these points gives the shadow volume footprint
    // (This ignores the 'hole' if the building is hollow, but acceptable for shadow casting)
    const allPoints = [...coords, ...shiftedCoords].map(c => turf.point(c));
    const collection = turf.featureCollection(allPoints);

    return turf.convex(collection);
}

/**
 * Run analysis on the ground (plot) to generate a heatmap
 */
export async function runGroundAnalysis(
    plotGeometry: any,
    buildings: Building[],
    mode: AnalysisMode,
    date: Date,
    greenRegulations: GreenRegulationData[] = []
): Promise<any> { // Returns FeatureCollection

    if (mode === 'none' || !plotGeometry) return turf.featureCollection([]);

    console.time('GroundAnalysis');

    // 1. Generate Grid Points
    const bbox = turf.bbox(plotGeometry);
    const area = turf.area(plotGeometry); // sq meters

    // Target ~400-900 points. sqrt(area/500) = spacing in meters
    // Example: 10000sqm -> 100x100 -> spacing ~4m -> 625 points
    let cellSideKm = Math.max(0.002, Math.sqrt(area / 600) / 1000); // Minimum 2m spacing

    // console.log('[GroundAnalysis] Grid config', { area, cellSideKm });

    const grid = turf.pointGrid(bbox, cellSideKm, { units: 'kilometers', mask: plotGeometry });
    const points = grid.features;

    console.log(`[GroundAnalysis] Generated ${points.length} points for heatmap (spacing: ${(cellSideKm * 1000).toFixed(1)}m)`);

    const results: any[] = [];

    // 2. Calculate Analysis
    const center = turf.centroid(plotGeometry);
    const [lng, lat] = center.geometry.coordinates;

    if (mode === 'sun-hours') {
        const sampleCount = 12; // 6am to 6pm
        const hourStep = 12 / sampleCount;

        // Pre-calculate sun and shadows for each hour to avoid re-calc per point
        const hourlyData: any[] = [];
        const baseDate = new Date(date);

        for (let i = 0; i < sampleCount; i++) {
            const hour = 6 + i * hourStep;
            const sampleDate = new Date(baseDate);
            sampleDate.setHours(hour, 0, 0, 0);

            const { azimuth, altitude } = getSunPosition(sampleDate, lat, lng);

            if (altitude <= 0) {
                hourlyData.push(null);
                continue;
            }

            // Generate shadows for all buildings at this hour
            const shadows: any[] = [];
            buildings.forEach(b => {
                const s = calculateBuildingShadow(b, azimuth, altitude);
                if (s) shadows.push(s);
            });

            hourlyData.push({ shadows, altitude });
        }

        // Evaluate points
        points.forEach((pt: any) => {
            let exposureCount = 0;

            for (let i = 0; i < sampleCount; i++) {
                const data = hourlyData[i];
                if (!data) continue;

                // Check if point is inside any shadow
                // Optimization: check bounding box first? Turf might do it.
                const isInShadow = data.shadows.some((shadow: any) => turf.booleanPointInPolygon(pt, shadow));

                if (!isInShadow) {
                    exposureCount++;
                }
            }

            const sunHours = (exposureCount / sampleCount) * 12;

            // Normalize for Heatmap Weight (0-1)
            // Expect max ~12h. 
            const weight = Math.min(sunHours / 10, 1);

            pt.properties = {
                value: sunHours,
                weight: weight
            };
            results.push(pt);
        });

    } else if (mode === 'daylight') {
        // Simple Snapshot at current time
        const { azimuth, altitude } = getSunPosition(date, lat, lng);

        let shadows: any[] = [];
        if (altitude > 0) {
            buildings.forEach(b => {
                const s = calculateBuildingShadow(b, azimuth, altitude);
                if (s) shadows.push(s);
            });
        }

        points.forEach((pt: any) => {
            let exposed = 0;
            if (altitude > 0) {
                const isInShadow = shadows.some((shadow: any) => turf.booleanPointInPolygon(pt, shadow));
                if (!isInShadow) exposed = 1;
            }
            // Simple daylight factor proxy: Sunlight Intensity
            // Factor in Angle of Incidence? sunAltitude.
            const val = exposed * Math.sin(altitude);

            pt.properties = {
                value: val,
                weight: val // 0-1
            };
            results.push(pt);
        });

    } else if (mode === 'wind') {
        const windDirDeg = 45; // Default NE wind
        const windRad = windDirDeg * (Math.PI / 180);

        // Treat wind like "sun" coming from horizon (altitude 0) but "shadows" are wake zones
        // Wake length ~ 3-5x height?
        // Let's use the shadow casting logic but with fixed 'altitude' to simulate wake length.
        // tan(alt) = h / len. If len = 5h, tan(alt) = 0.2 -> alt ~ 11 deg.
        const wakeAngle = Math.atan(0.2); // ~11 deg altitude eq.

        // Wind FROM windDir. "Sun" Azimuth = Wind Dir.
        // Shadow is cast DOWNWIND (opposite to wind dir).
        // Our shadow calc expects 'azimuth' of the source.
        // Fix: If windDir is "Flow Direction" (NE), Source is SW. 
        // We need to invert the direction for shadow casting source.
        const windSourceAzimuth = (windRad + Math.PI) % (2 * Math.PI);

        const wakes: any[] = [];
        buildings.forEach(b => {
            const s = calculateBuildingShadow(b, windSourceAzimuth, wakeAngle);
            if (s) wakes.push(s);
        });

        points.forEach((pt: any) => {
            // Check if point is in wake (wind shadow)
            const isInWake = wakes.some((wake: any) => turf.booleanPointInPolygon(pt, wake));

            // In wake = Low Speed (0.2). In open = High Speed (1.0).
            const val = isInWake ? 0.2 : 1.0;

            // Direction: Mostly global windDirDeg, but could be null/turbulent in wake
            // For now, let's keep global direction for all points but lower magnitude in wake
            const angle = windDirDeg;

            pt.properties = {
                value: val,
                weight: val,
                angle: angle
            };
            results.push(pt);
        });
    }

    console.timeEnd('GroundAnalysis');
    return turf.featureCollection(results);
}

/**
 * Run per-face analysis to generate colored wall segments
 * This decomposes building polygons into individual edge extrusions
 */
export async function runWallAnalysis(
    targetBuildings: Building[],
    contextBuildings: Building[],
    mode: AnalysisMode,
    date: Date,
    greenRegulations: GreenRegulationData[] = []
): Promise<any> { // Returns FeatureCollection
    console.log('[ANALYSIS ENGINE] Starting runWallAnalysis', { mode });
    console.time('WallAnalysis');

    const walls: any[] = [];

    // Helper to get color
    const getColor = (val: number) => getColorForValue(val, mode, greenRegulations);

    // Pre-calc sun position if needed
    let sunVecX = 0, sunVecY = 0, sunAlt = 0;
    let hourlySunData: { vecX: number, vecY: number, alt: number }[] = [];

    const firstCentroid = targetBuildings.length > 0 ? turf.centroid(targetBuildings[0].geometry) : null;
    const [lng, lat] = firstCentroid ? firstCentroid.geometry.coordinates : [0, 0];

    if (mode === 'sun-hours') {
        const hourSamples = 12;
        const baseDate = new Date(date);
        for (let hour = 6; hour <= 18; hour += 12 / hourSamples) {
            const sampleDate = new Date(baseDate);
            sampleDate.setHours(hour, 0, 0, 0);
            const { azimuth, altitude } = getSunPosition(sampleDate, lat, lng);
            if (altitude > 0) {
                hourlySunData.push({
                    vecX: Math.sin(azimuth),
                    vecY: Math.cos(azimuth),
                    alt: altitude
                });
            }
        }
    } else if (mode === 'daylight') {
        const { azimuth, altitude } = getSunPosition(date, lat, lng);
        sunVecX = Math.sin(azimuth);
        sunVecY = Math.cos(azimuth);
        sunAlt = altitude;
    } else if (mode === 'wind') {
        const windDirDeg = 45; // Default NE
        const windRad = windDirDeg * (Math.PI / 180);
        // Wind Vector (pointing TO source): x = sin, y = cos
        sunVecX = Math.sin(windRad);
        sunVecY = Math.cos(windRad);
        sunAlt = 1; // Dummy
    }

    // Wall thickness in meters - use very small value for thin wall overlay
    // turf.buffer uses kilometers when units='kilometers'
    // 0.5 meters = 0.0005 km
    const BUFFER_AMT = 0.0005; // 0.5 meters

    // PARSE THRESHOLDS LOGGING
    const activeThresholds = greenRegulations.length > 0
        ? greenRegulations.map(parseThresholdsFromRegulation).reduce((acc, t) => ({
            sunHoursMin: Math.min(acc.sunHoursMin || Infinity, t.sunHoursMin || Infinity),
            sunHoursTarget: Math.max(acc.sunHoursTarget || 0, t.sunHoursTarget || 0),
            daylightFactorMin: Math.min(acc.daylightFactorMin || Infinity, t.daylightFactorMin || Infinity),
            daylightFactorTarget: Math.max(acc.daylightFactorTarget || 0, t.daylightFactorTarget || 0),
        }), {} as ParsedThresholds)
        : DEFAULT_THRESHOLDS;

    console.log(`[ANALYSIS ENGINE] Thresholds used for ${mode}:`, activeThresholds);
    if (mode === 'sun-hours') {
        console.log('[ANALYSIS ENGINE] Hourly Sun Data Points:', hourlySunData.length);
    }


    for (const building of targetBuildings) {
        // Ensure consistent winding (CCW) for correct Normal calculation
        const safePoly = turf.rewind(building.geometry as any, { reverse: false });
        const coords = safePoly.geometry.coordinates[0];

        if (!coords || coords.length < 3) continue;

        const height = building.height || (building.floors?.reduce((sum, f) => sum + f.height, 0)) || 10;
        const baseHeight = building.baseHeight || 0;

        for (let i = 0; i < coords.length - 1; i++) {
            const p1 = coords[i];
            const p2 = coords[i + 1];

            // 1. Calculate Normal
            const dx = p2[0] - p1[0];
            const dy = p2[1] - p1[1];
            const len = Math.sqrt(dx * dx + dy * dy);
            // Normal (Outward CCW): (dy, -dx)
            const nx = dy / len;
            const ny = -dx / len;

            let value = 0;

            // 2. Calculate Exposure based on Mode
            if (mode === 'sun-hours') {
                let directHours = 0;
                let totalWeight = 0;
                // Integrate over day
                for (const sun of hourlySunData) {
                    // Dot product
                    const dot = nx * sun.vecX + ny * sun.vecY;
                    if (dot > 0) {
                        // Face sees sun. 
                        // Shadows? Raycasting is expensive for every wall.
                        // For now, assume "self-shadowing" is covered by dot product.
                        // Context shadowing is too heavy for visual analysis of 1000s of walls in real-time without GPU.
                        directHours += 1; // Simple hour count if facing sun
                    }
                    totalWeight++;
                }
                // Normalize to 12h day
                if (totalWeight > 0) {
                    value = (directHours / totalWeight) * 12;
                }
            } else if (mode === 'daylight') {
                // Instantaneous
                const dot = nx * sunVecX + ny * sunVecY;
                const facingFactor = Math.max(0, dot);
                // Simple DF proxy
                value = facingFactor * 0.05 * Math.sin(sunAlt);
            } else if (mode === 'wind') {
                // Fix: Dot product of Normal . FlowVector is POSITIVE for Leeward (downwind) faces.
                // We want Windward (upwind) faces to be positive.
                // So we project Normal onto -FlowVector (Vector pointing TO source).
                const dot = nx * (-sunVecX) + ny * (-sunVecY);

                // Wind pressure proxy: Facing wind = High velocity.
                const exposure = Math.max(0, dot);

                // Scale factor consistent with runVisualAnalysis
                const heightFactor = Math.min(Math.max(height / 10, 0.5), 1.5);
                value = exposure * 3.5 * heightFactor; // m/s estimate
            }

            // 3. Create Wall Geometry (Thin Offset "Skin")
            // Create a very thin (5cm) polygon offset slightly OUTWARD (10cm) from the face
            // This prevents z-fighting and ensures it doesn't look like a thick block

            const thicknessMeters = 0.05; // 5cm thin skin
            const offsetMeters = 0.10;    // 10cm offset outward

            // Convert to degrees (approximate)
            const metersPerDegLat = 111320;
            const lat = firstCentroid ? firstCentroid.geometry.coordinates[1] : 0;
            const metersPerDegLng = 111320 * Math.cos(lat * Math.PI / 180);

            // Shift points outward by the normal
            const shiftLng = (offsetMeters / metersPerDegLng);
            const shiftLat = (offsetMeters / metersPerDegLat);

            const thicknessLng = (thicknessMeters / 2) / metersPerDegLng;
            const thicknessLat = (thicknessMeters / 2) / metersPerDegLat;

            // p1, p2 are edge endpoints
            // Shift them outward by 'offsetMeters'
            const p1_mid = [p1[0] + nx * shiftLng, p1[1] + ny * shiftLat];
            const p2_mid = [p2[0] + nx * shiftLng, p2[1] + ny * shiftLat];

            // Create 4 corners around the shifted edge
            const p1_outer = [p1_mid[0] + nx * thicknessLng, p1_mid[1] + ny * thicknessLat];
            const p2_outer = [p2_mid[0] + nx * thicknessLng, p2_mid[1] + ny * thicknessLat];
            const p1_inner = [p1_mid[0] - nx * thicknessLng, p1_mid[1] - ny * thicknessLat];
            const p2_inner = [p2_mid[0] - nx * thicknessLng, p2_mid[1] - ny * thicknessLat];

            // Create polygon
            const wallCoords = [
                p1_inner,
                p2_inner,
                p2_outer,
                p1_outer,
                p1_inner
            ];

            const wallPoly = turf.polygon([wallCoords]);

            if (wallPoly) {
                walls.push({
                    type: 'Feature',
                    geometry: wallPoly.geometry,
                    properties: {
                        color: getColor(value),
                        height: height,
                        base_height: baseHeight,
                        value: value,
                        wallId: `${building.id}-wall-${i}`
                    }
                });
            }
        }
    }

    console.timeEnd('WallAnalysis');
    return turf.featureCollection(walls);
}
