
import { useMemo } from 'react';
import { Project, RegulationData } from '@/lib/types';

export interface GreenCreditCheckResult {
    status: 'pending' | 'achieved' | 'failed';
    score: number;
    metrics?: {
        achieved: number;
        target: number;
        unit: string;
    };
}

export function useGreenStandardChecks(
    project: Project | null,
    simulationResults: Project['simulationResults']
) {
    return useMemo(() => {
        const checks: Record<string, GreenCreditCheckResult> = {};

        if (!project) return checks;

        // --- 1. GEOMETRY-BASED CHECKS (Real-time) ---
        const totalPlotArea = project.plots.reduce((sum, p) => sum + (p.area || 0), 0);

        if (totalPlotArea > 0) {
            // A. Green Cover Check
            const totalGreenArea = project.plots.reduce((sum, p) =>
                sum + (p.greenAreas?.reduce((gSum, g) => gSum + (g.area || 0), 0) || 0), 0);

            const greenPercentage = (totalGreenArea / totalPlotArea) * 100;

            // Logic: Typically > 15-20% for points
            if (greenPercentage >= 15) {
                checks['green_cover'] = {
                    status: 'achieved',
                    score: 4,
                    metrics: { achieved: greenPercentage, target: 15, unit: '%' }
                };
            } else {
                checks['green_cover'] = {
                    status: 'pending',
                    score: 0,
                    metrics: { achieved: greenPercentage, target: 15, unit: '%' }
                };
            }

            // B. Open Space Check
            const totalFootprint = project.plots.reduce((sum, p) =>
                sum + (p.buildings?.reduce((bSum, b) => bSum + (b.area || 0), 0) || 0), 0);

            const openSpacePercentage = ((totalPlotArea - totalFootprint) / totalPlotArea) * 100;

            if (openSpacePercentage >= 25) {
                checks['open_space'] = {
                    status: 'achieved',
                    score: 3,
                    metrics: { achieved: openSpacePercentage, target: 25, unit: '%' }
                };
            }
        }

        // --- 2. SIMULATION-BASED CHECKS ---
        if (simulationResults) {
            const windAnalysis = simulationResults.wind || { compliantArea: 0 };
            const sunAnalysis = simulationResults.sun || { compliantArea: 0 };

            // Natural Ventilation Check
            if (windAnalysis.compliantArea > 75) {
                checks['ventilation'] = {
                    status: 'achieved',
                    score: 2,
                    metrics: { achieved: windAnalysis.compliantArea, target: 75, unit: '%' }
                };
            } else if (windAnalysis.compliantArea > 0) {
                checks['ventilation'] = {
                    status: 'failed',
                    score: 0,
                    metrics: { achieved: windAnalysis.compliantArea, target: 75, unit: '%' }
                };
            }

            // Daylighting Check
            if (sunAnalysis.compliantArea > 50) {
                checks['daylighting'] = {
                    status: 'achieved',
                    score: 3,
                    metrics: { achieved: sunAnalysis.compliantArea, target: 50, unit: '%' }
                };
            } else if (sunAnalysis.compliantArea > 0) {
                checks['daylighting'] = {
                    status: 'failed',
                    score: 0,
                    metrics: { achieved: sunAnalysis.compliantArea, target: 50, unit: '%' }
                };
            }
        }

        // --- 3. LOCATION & AMENITY CHECKS ---
        if (project.locationData?.amenities) {
            const amenities = project.locationData.amenities;

            // Transit Access (Bus/Train within 800m)
            const transit = amenities.some((a: any) => a.category === 'transit' && a.distance <= 800);
            if (transit) {
                checks['transit_access'] = { status: 'achieved', score: 3 };
            }

            // Community Connectivity (at least 3 unique service types within 1000m)
            // Service types: school, hospital, park, shopping, restaurant
            const serviceTypes = new Set(
                amenities
                    .filter((a: any) => ['school', 'hospital', 'park', 'shopping', 'restaurant'].includes(a.category) && a.distance <= 1000)
                    .map((a: any) => a.category)
            );

            if (serviceTypes.size >= 3) {
                checks['amenity_proximity'] = { status: 'achieved', score: 3, metrics: { achieved: serviceTypes.size, target: 3, unit: 'types' } };
            }
        }

        return checks;
    }, [project, simulationResults]);
}
