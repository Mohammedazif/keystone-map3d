import * as THREE from 'three';
import { getSunPosition } from '@/lib/sun-utils';
import type { GreenRegulationData } from '@/lib/types';

export type AnalysisMode = 'none' | 'sun-hours' | 'daylight' | 'wind';

// Parsed threshold values from certificate regulations
interface ParsedThresholds {
    sunHoursMin?: number;
    sunHoursTarget?: number;
    daylightFactorMin?: number;
    daylightFactorTarget?: number;
}

/**
 * Parse numeric thresholds from green regulation requirements
 * Extracts values like "2 hours" or "2.5% daylight factor"
 */
export function parseThresholdsFromRegulation(
    regulation: GreenRegulationData
): ParsedThresholds {
    const thresholds: ParsedThresholds = {};

    // Find daylight/sun-related credits
    const daylightCredits = regulation.categories
        ?.flatMap(cat => cat.credits)
        .filter(credit =>
            credit.name.toLowerCase().includes('daylight') ||
            credit.name.toLowerCase().includes('sun') ||
            credit.name.toLowerCase().includes('natural light') ||
            credit.code?.includes('EQ') // LEED Environmental Quality
        ) || [];

    // Parse requirements for numeric values
    for (const credit of daylightCredits) {
        for (const req of credit.requirements || []) {
            // Extract "2" or "2.5" from patterns like:
            // - "Minimum 2 hours direct sunlight"
            // - "At least 2.5 hours of sun exposure"
            // - "2 hours sunlight required"
            const hoursMatch = req.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/i);
            if (hoursMatch) {
                const hours = parseFloat(hoursMatch[1]);
                if (!thresholds.sunHoursMin || hours < thresholds.sunHoursMin) {
                    thresholds.sunHoursMin = hours;
                }
            }

            // Extract "2%" or "2.5%" from patterns like:
            // - "Minimum 2% daylight factor"
            // - "2.5% DF required"
            // - "Daylight factor of 2%"
            const dfMatch = req.match(/(\d+(?:\.\d+)?)\s*%\s*(?:daylight\s*factor|DF)/i);
            if (dfMatch) {
                const df = parseFloat(dfMatch[1]) / 100;
                if (!thresholds.daylightFactorMin || df < thresholds.daylightFactorMin) {
                    thresholds.daylightFactorMin = df;
                }
            }
        }
    }

    // Set targets (50% higher than minimum for "exceeds" threshold)
    if (thresholds.sunHoursMin) {
        thresholds.sunHoursTarget = thresholds.sunHoursMin * 1.5;
    }
    if (thresholds.daylightFactorMin) {
        thresholds.daylightFactorTarget = thresholds.daylightFactorMin * 1.5;
    }

    return thresholds;
}

/**
 * Default thresholds used when no certificate is selected or parsing fails
 */
const DEFAULT_THRESHOLDS: ParsedThresholds = {
    sunHoursMin: 2,
    sunHoursTarget: 4,
    daylightFactorMin: 0.02,
    daylightFactorTarget: 0.04
};

// Color Gradients
const HEATMAP_ALGORITHM = {
    // Blue -> Cyan -> Green -> Yellow -> Red
    getColor: (value: number) => {
        // Value 0 to 1
        const h = (1.0 - value) * 240 / 360; // 240 (Blue) -> 0 (Red)
        return new THREE.Color().setHSL(h, 1.0, 0.5);
    }
};

/**
 * Get color for a value based on certificate compliance or relative gradient
 * @param actualHours Actual calculated hours (for sun-hours mode)
 * @param mode Analysis mode
 * @param regulations Green building regulations (if any)
 * @returns THREE.Color for the overlay
 */
function getColorForValue(
    actualHours: number,
    mode: AnalysisMode,
    regulations: GreenRegulationData[]
): THREE.Color {
    console.log('[getColorForValue] actualHours:', actualHours, 'mode:', mode, 'regulations count:', regulations.length);

    // If no regulations, use relative gradient (0-8 hours normalized to 0-1)
    if (regulations.length === 0) {
        const normalized = Math.min(actualHours / 8, 1);
        console.log('[getColorForValue] No regulations - using relative gradient. Normalized:', normalized);
        return HEATMAP_ALGORITHM.getColor(normalized);
    }

    // Parse thresholds from all regulations
    const allThresholds = regulations.map(parseThresholdsFromRegulation);
    console.log('[getColorForValue] Parsed thresholds:', allThresholds);

    // Use strictest (highest minimum) requirement
    const strictest = allThresholds.reduce((max, curr) => ({
        sunHoursMin: Math.max(max.sunHoursMin || 0, curr.sunHoursMin || 0),
        sunHoursTarget: Math.max(max.sunHoursTarget || 0, curr.sunHoursTarget || 0)
    }), {} as ParsedThresholds);

    // Apply defaults if parsing failed
    const minThreshold = strictest.sunHoursMin || DEFAULT_THRESHOLDS.sunHoursMin!;
    const targetThreshold = strictest.sunHoursTarget || DEFAULT_THRESHOLDS.sunHoursTarget!;

    console.log('[getColorForValue] Using thresholds - min:', minThreshold, 'target:', targetThreshold);

    if (mode === 'sun-hours') {
        if (actualHours >= targetThreshold) {
            // Exceeds target: Green
            console.log('[getColorForValue] Exceeds target - returning GREEN');
            return new THREE.Color(0x00cc00);
        } else if (actualHours >= minThreshold) {
            // Meets minimum: Yellow
            console.log('[getColorForValue] Meets minimum - returning YELLOW');
            return new THREE.Color(0xffcc00);
        } else {
            // Below minimum: Red
            console.log('[getColorForValue] Below minimum - returning RED');
            return new THREE.Color(0xff0000);
        }
    }

    // --- DAYLIGHT COMPLIANCE ---
    if (mode === 'daylight') {
        const minDF = strictest.daylightFactorMin || DEFAULT_THRESHOLDS.daylightFactorMin!;

        // Value 0-1 represents roughly 0-5% DF (heuristic)
        // So actual DF approx = value * 0.05
        const estimatedDF = actualHours * 0.05; // actualHours passed is 0-1 scale usually, but let's normalize check

        // If passed raw 0-1 value
        if (actualHours >= minDF) { // If using raw normalized value
            return new THREE.Color(0x00cc00); // Green
        } else if (actualHours >= minDF * 0.5) {
            return new THREE.Color(0xffcc00); // Yellow
        } else {
            return new THREE.Color(0xff0000); // Red
        }
    }

    // --- WIND COMPLIANCE ---
    if (mode === 'wind') {
        // Wind is usually about ventilation. 
        // 0 = Leeward (Bad), 0.5 = Neutral, 1 = Windward (Good)
        // Threshold: > 0.3 for minimal breeze?
        const minExposure = 0.3;

        if (actualHours >= minExposure) { // 'actualHours' is 0-1 exposure here
            return new THREE.Color(0x00cc00);
        } else if (actualHours >= 0.1) {
            return new THREE.Color(0xffcc00);
        } else {
            return new THREE.Color(0xff0000);
        }
    }

    // Fallback
    const normalized = Math.min(actualHours / 8, 1);
    return HEATMAP_ALGORITHM.getColor(normalized);
}

/**
 * Main function to run analysis on a set of building meshes
 * @param buildings Array of THREE.Mesh objects to analyze
 * @param otherColliders Array of THREE.Mesh objects that can occlude (Context)
 * @param mode Analysis Type
 * @param date Current Date (for Sun calc)
 * @param greenRegulations Optional array of green building regulations to determine compliance thresholds
 */
export async function runVisualAnalysis(
    buildings: THREE.Mesh[],
    otherColliders: THREE.Mesh[],
    mode: AnalysisMode,
    date: Date,
    greenRegulations: GreenRegulationData[] = []
) {
    if (mode === 'none') {
        // Remove any existing heatmap overlays
        buildings.forEach(mesh => {
            const parent = mesh.parent;
            if (parent) {
                const overlay = parent.getObjectByName(`heatmap-overlay-${mesh.uuid}`);
                if (overlay) {
                    parent.remove(overlay);
                }
            }
        });

        if (window.tb) {
            window.tb.repaint();
        }
        return;
    }

    console.time('Analysis');

    // Prepare Raycaster
    const raycaster = new THREE.Raycaster();

    // Combine all occluders (buildings + context)
    const allMeshes = [...buildings, ...otherColliders];

    // Pre-calculate Sun Vectors if Sun Mode
    let sunVectors: THREE.Vector3[] = [];
    if (mode === 'sun-hours') {
        // Calculate 7am to 5pm
        const startHour = 7;
        const endHour = 17;
        // Use center of first building as lat/lon proxy (approx)
        // Or passed in. For now assuming simplified relative sun.
        // We need Lat/Lon. Let's assume passed or use default relative.
        // We'll use the 'sun-utils' but we need lat/lon. 
        // Hack: Assume generic 28N, 77E (Delhi) if not provided, or pass it.
        // Let's rely on passed date having correct local time.

        // Actually, we'll cast rays *Backwards* from vertex to Sun.
        // If hit nothing, it sees sun.

        // Create 5 samples for the day
        for (let h = 8; h <= 16; h += 2) {
            const sampleDate = new Date(date);
            sampleDate.setHours(h, 0, 0);

            // Calc Az/Alt (Simplified or imported)
            // Using logic from map-editor:
            // X=East, Y=North, Z=Up
            // Mock Lat/Lon if not available?
            const lat = 28.6;
            const lng = 77.2;
            const { azimuth, altitude } = getSunPosition(sampleDate, lat, lng);

            if (altitude > 0) {
                const x = Math.sin(azimuth) * Math.cos(altitude);
                const y = -1 * Math.cos(azimuth) * Math.cos(altitude);
                const z = Math.sin(altitude);
                sunVectors.push(new THREE.Vector3(x, y, z).normalize());
            }
        }
    }

    // Process each building - CREATE OVERLAY instead of modifying
    for (const mesh of buildings) {
        if (!mesh.geometry) continue;

        // Ensure geometry has color attribute
        const geom = mesh.geometry;
        if (!geom) continue;

        // Strict validation for required attributes
        if (!geom.attributes.position || !geom.attributes.normal) {
            console.warn(`[Analysis Warning] Skipping mesh ${mesh.uuid}: Missing attributes`);
            continue;
        }

        // if generic BufferGeometry
        const count = geom.attributes.position.count;

        // Create a CLONE of the geometry for the overlay
        const overlayGeom = geom.clone();

        // Add color attribute to the OVERLAY geometry
        if (!overlayGeom.attributes.color) {
            overlayGeom.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
        }

        const colors = overlayGeom.attributes.color;
        const positions = geom.attributes.position;
        const normals = geom.attributes.normal;

        // World Matrix for transformations
        mesh.updateMatrixWorld();
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

        // Iterate Vertices
        for (let i = 0; i < count; i++) {
            // Get Vertex Position in World Space
            const localPt = new THREE.Vector3().fromBufferAttribute(positions, i);
            const worldPt = localPt.clone().applyMatrix4(mesh.matrixWorld);

            // Nudge worldPt slightly out along normal to avoid self-intersection
            const localNorm = new THREE.Vector3().fromBufferAttribute(normals, i);
            const worldNorm = localNorm.clone().applyMatrix3(normalMatrix).normalize();

            const origin = worldPt.add(worldNorm.clone().multiplyScalar(0.1));

            let value = 0.5; // Default

            // --- SUN HOURS ---
            if (mode === 'sun-hours') {
                let hitCount = 0;
                let totalSamples = sunVectors.length;

                for (const vec of sunVectors) {
                    // Dot product check: does surface face sun?
                    if (worldNorm.dot(vec) <= 0) {
                        // Facing away
                        continue;
                    }

                    raycaster.set(origin, vec);
                    // Check intersection with all meshes EXCEPT itself (or even itself for self-shadowing?)
                    // For self-shadowing, we check allMeshes (raycaster will skip back-faces usually if culling)
                    // But we already nudged origin.
                    // Raycaster hits sorted by distance.
                    const hits = raycaster.intersectObjects(allMeshes, false);

                    // Filter out very close hits (self-intersect artifacts if nudge wasn't enough)
                    const realHits = hits.filter(h => h.distance > 0.2);

                    if (realHits.length === 0) {
                        hitCount++;
                    }
                }
                value = totalSamples > 0 ? hitCount / totalSamples : 0;
            }

            // --- DAYLIGHT (SKY VIEW) ---
            else if (mode === 'daylight') {
                // Simplified Vertical Sky View
                // Just check Up vector (+Z) and maybe 45 deg angles?
                // High cost. Let's do simple "Up" check + Normal 'Up-ness'.

                // Factor 1: Face orientation (Horizontal = sees sky better)
                const upness = Math.max(0, worldNorm.z);

                // Factor 2: Obstruction check straight up
                const upVec = new THREE.Vector3(0, 0, 1);
                raycaster.set(origin, upVec);
                const hits = raycaster.intersectObjects(allMeshes);
                const isOccluded = hits.some(h => h.distance > 0.5);

                // Value: 0 if occluded, else 'upness'
                value = isOccluded ? 0.0 : (0.2 + 0.8 * upness);
            }

            // --- WIND COMFORT ---
            else if (mode === 'wind') {
                // Heuristic: Prevailing Wind from South-West (+X, -Y) -> Vector (1, -1, 0)
                const windDir = new THREE.Vector3(1, -1, 0).normalize();

                // Dot product: 1 = Direct Hit (High Pressure), -1 = Leeward
                const dot = worldNorm.dot(windDir);

                // Map -1..1 to 0..1
                // 1 (Direct) -> Red (Bad comfort? Or just High Pressure?)
                // Usually High Velocity = Bad Comfort.
                // Let's visualize "Wind Exposure".
                value = (dot + 1) / 2; // 0..1
            }

            if (!Number.isFinite(value)) {
                value = 0.5;
            }

            // Apply Color
            // Calculate actual metric value (e.g. hours) for threshold comparison
            let actualMetricValue = value;
            if (mode === 'sun-hours') {
                actualMetricValue = value * 8; // Normalize 0-1 back to ~8 hours
            }

            const color = getColorForValue(actualMetricValue, mode, greenRegulations);
            colors.setXYZ(i, color.r, color.g, color.b);
        }

        console.log(`[Analysis Debug] Colored mesh ${mesh.uuid} with ${count} vertices.`);

        colors.needsUpdate = true;

        // Create overlay material - TRANSPARENT so original building shows through
        const overlayMaterial = new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.7, // Semi-transparent to blend with building
            depthTest: true,
            depthWrite: false, // Don't write to depth buffer
        });

        // Create the overlay mesh
        const overlayMesh = new THREE.Mesh(overlayGeom, overlayMaterial);
        overlayMesh.name = `heatmap-overlay-${mesh.uuid}`;

        // Position overlay slightly above original mesh to avoid z-fighting
        overlayMesh.position.copy(mesh.position);
        overlayMesh.position.z += 0.01;
        overlayMesh.rotation.copy(mesh.rotation);
        overlayMesh.scale.copy(mesh.scale);

        // Remove old overlay if exists
        const parent = mesh.parent;
        if (parent) {
            const oldOverlay = parent.getObjectByName(`heatmap-overlay-${mesh.uuid}`);
            if (oldOverlay) {
                parent.remove(oldOverlay);
            }
            // Add new overlay
            parent.add(overlayMesh);
        }
    }

    console.timeEnd('Analysis');

    // Force Threebox to repaint after analysis
    if (window.tb) {
        window.tb.repaint();
    }
}

// Simplified reset - just remove overlays
function resetColors(buildings: THREE.Mesh[]) {
    console.log('[Analysis] Removing overlays from', buildings.length, 'building meshes');

    buildings.forEach(mesh => {
        const parent = mesh.parent;
        if (parent) {
            const overlay = parent.getObjectByName(`heatmap-overlay-${mesh.uuid}`);
            if (overlay) {
                parent.remove(overlay);
            }
        }
    });

    if (window.tb) {
        window.tb.repaint();
    }
}
