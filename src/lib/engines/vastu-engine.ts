import { Plot, Building, VastuRegulationData, VastuRecommendation } from '@/lib/types';
import * as turf from '@turf/turf';

interface VastuScore {
    overallScore: number;
    rating: 'High' | 'Medium' | 'Low';
    breakdown: {
        category: string;
        score: number;
        feedback: string;
    }[];
}

/**
 * Calculates Vastu Compliance Score for a given Plot and its Buildings
 */
export function calculateVastuScore(
    plot: Plot,
    buildings: Building[],
    regulation: VastuRegulationData | null
): VastuScore {
    // Default empty result
    const result: VastuScore = {
        overallScore: 0,
        rating: 'Low',
        breakdown: []
    };

    if (!regulation || buildings.length === 0) {
        return result;
    }

    let totalWeight = 0;
    let totalWeightedScore = 0;

    // Helper: Get cardinal direction of a point relative to plot centroid
    const getDirection = (target: any, center: any): string => {
        const bearing = turf.bearing(center, target);
        // Normalize bearing to 0-360
        const b = (bearing + 360) % 360;

        if (b >= 337.5 || b < 22.5) return 'N';
        if (b >= 22.5 && b < 67.5) return 'NE';
        if (b >= 67.5 && b < 112.5) return 'E';
        if (b >= 112.5 && b < 157.5) return 'SE';
        if (b >= 157.5 && b < 202.5) return 'S';
        if (b >= 202.5 && b < 247.5) return 'SW';
        if (b >= 247.5 && b < 292.5) return 'W';
        if (b >= 292.5 && b < 337.5) return 'NW';
        return 'N';
    };

    const plotCentroid = plot.centroid.geometry.coordinates;

    regulation.recommendations.forEach((rec) => {
        const weight = rec.weight || 5;
        let score = 0; // 0-100
        let feedback = '';

        switch (rec.category) {
            case 'Entrance':
                // For simplicity, assume Entrance is the side of the plot facing the road (closest to road)
                // Or if we have a specific 'Entrance' object. 
                // Currently, let's assume valid 'Roads' infrastructure defines entrance, or default to East/North for testing.
                // TODO: Implement actual entrance detection. For now, simulate favorable Check.
                // IF we don't have explicit entrance data, we skip or assume neutral (50).
                score = 50;
                feedback = "Entrance location not explicitly defined.";
                break;

            case 'MasterBedroom':
            case 'General': // Treat 'General' as Main Building Placement
                // Ideally Master Bedroom is SW. Main Building Mass should be SW/South/West.
                // Let's check the largest building's centroid.
                const mainBldg = buildings.reduce((prev, current) => (prev.area > current.area) ? prev : current);
                if (mainBldg) {
                    const bldgCentroid = mainBldg.centroid.geometry.coordinates;
                    const dir = getDirection(bldgCentroid, plotCentroid);

                    if (rec.idealDirections.includes(dir)) {
                        score = 100;
                        feedback = `Main mass in ${dir} (Recommended).`;
                    } else if (rec.avoidDirections.includes(dir)) {
                        score = 0;
                        feedback = `Main mass in ${dir} (Avoid).`;
                    } else {
                        score = 50;
                        feedback = `Main mass in ${dir} (Neutral).`;
                    }
                }
                break;

            case 'Water':
                // Check for 'Water' or 'WTP' utility blocks.
                // Ideally NE / North / East.
                const waterUtil = buildings.find(b => b.name.includes('Water') || b.name.includes('WTP'));
                if (waterUtil) {
                    const waterCentroid = waterUtil.centroid.geometry.coordinates;
                    const dir = getDirection(waterCentroid, plotCentroid);

                    if (rec.idealDirections.includes(dir)) {
                        score = 100;
                        feedback = `Water body in ${dir} (Excellent).`;
                    } else if (rec.avoidDirections.includes(dir)) {
                        score = 0;
                        feedback = `Water body in ${dir} (Avoid).`;
                    } else {
                        score = 50;
                        feedback = `Water body in ${dir} (Neutral).`;
                    }
                } else {
                    score = 50; // Neutral if no water body
                    feedback = "No water infrastructure found.";
                }
                break;

            default:
                score = 50;
                feedback = "Criterion not evaluated.";
        }

        totalWeightedScore += score * weight;
        totalWeight += weight;

        result.breakdown.push({
            category: rec.category,
            score,
            feedback
        });
    });

    if (totalWeight > 0) {
        result.overallScore = Math.round(totalWeightedScore / totalWeight);
    }

    if (result.overallScore >= 80) result.rating = 'High';
    else if (result.overallScore >= 50) result.rating = 'Medium';
    else result.rating = 'Low';

    return result;
}
