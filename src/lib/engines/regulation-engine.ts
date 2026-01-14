
import {
    Project,
    AdvancedKPIs,
    RegulationData,
    GreenRegulationData,
    VastuRegulationData,
    VASTU_ZONES_32
} from '../types';
import * as turf from '@turf/turf';

export class RegulationEngine {
    private project: Project;
    private regulations: RegulationData | null;
    private greenStandards: GreenRegulationData | null;
    private vastuRules: VastuRegulationData | null;

    constructor(
        project: Project,
        regulations: RegulationData | null = null,
        greenStandards: GreenRegulationData | null = null,
        vastuRules: VastuRegulationData | null = null
    ) {
        this.project = project;
        this.regulations = regulations;
        this.greenStandards = greenStandards;
        this.vastuRules = vastuRules;
    }

    public calculateMetrics(): AdvancedKPIs {
        // 1. Basic Area Metrics
        const areaMetrics = this.calculateAreaMetrics();

        // 2. Service & Amenities (Phase 3: Detailed Logic)
        const serviceMetrics = this.estimateServices(areaMetrics.totalBuiltUpArea);

        // 3. Green KPIs (Phase 3: Real Road Area)
        const greenMetrics = this.calculateGreenKPIs(areaMetrics.totalPlotArea);

        // 4. Housing & Parking
        const housingMetrics = this.calculateHousingMetrics(areaMetrics.totalBuiltUpArea);

        // 5. Compliance Scores
        const compliance = this.calculateCompliance(areaMetrics, greenMetrics);

        const netSaleable = areaMetrics.totalBuiltUpArea - serviceMetrics.services.total - serviceMetrics.amenities.total; // Rough estimate
        const efficiency = areaMetrics.totalBuiltUpArea > 0 ? netSaleable / areaMetrics.totalBuiltUpArea : 0;

        return {
            ...areaMetrics,
            ...serviceMetrics,
            ...greenMetrics,
            ...housingMetrics,
            compliance,
            efficiency,
        };
    }

    private calculateAreaMetrics() {
        let totalPlotArea = 0;
        let totalBuiltUpArea = 0;
        let groundCoverageArea = 0;

        // Plot Area
        this.project.plots.forEach(plot => {
            totalPlotArea += plot.area;

            // Building Areas
            plot.buildings.forEach(b => {
                if (b.visible === false) return;

                // Ground Coverage (Approximate by footprint area)
                groundCoverageArea += b.area;

                // Total Built-up (GFA) - Excluding parking floors if needed
                let fsiFloors = b.floors.filter(f => f.type !== 'Parking').length;
                if (fsiFloors === 0) fsiFloors = b.numFloors; // Fallback

                totalBuiltUpArea += (b.area * fsiFloors);
            });
        });



        // Achieved FAR
        const achievedFAR = totalPlotArea > 0 ? (totalBuiltUpArea / totalPlotArea) : 0;
        const groundCoveragePct = totalPlotArea > 0 ? (groundCoverageArea / totalPlotArea) * 100 : 0;

        return {
            totalPlotArea,
            totalBuiltUpArea,
            achievedFAR,
            groundCoveragePct,

            // Estimates (will be refined by detailed calculation)
            sellableArea: totalBuiltUpArea * 0.70,
            circulationArea: totalBuiltUpArea * 0.15,
            coreArea: totalBuiltUpArea * 0.10,
        };
    }

    private estimateServices(totalBuiltUpArea: number) {
        // 1. Calculate Services based on Project Intent & Building Types
        // Standards: width ratios or percentage of GFA
        // Residential: ~5-7%, Commercial: ~10-12% (AHUs, Server rooms)

        let servicePct = 0.05; // Default Residential
        if (this.project.intendedUse === 'Commercial') servicePct = 0.10;
        if (this.project.intendedUse === 'Mixed Use') servicePct = 0.08;

        const totalServices = totalBuiltUpArea * servicePct;

        return {
            services: {
                total: totalServices,
                electrical: totalServices * 0.35, // Substations, DG sets
                mech: totalServices * 0.40,      // HVAC, Pump rooms
                plumbing: totalServices * 0.25,  // STP/WTP internal parts
            },
            amenities: {
                total: totalBuiltUpArea * 0.03, // 3% for amenities (Clubhouse etc)
                definedList: {
                    'Gym': 100,
                    'Community Hall': 200,
                    'Swimming Pool': 80 // Equivalent built area
                }
            }
        };
    }

    private calculateGreenKPIs(totalPlotArea: number) {
        let greenAreaTotal = 0;

        // 1. Dedicated Green Zones
        this.project.plots.forEach(p => {
            p.greenAreas.forEach(g => {
                if (g.visible) greenAreaTotal += g.area;
            });
        });

        // 2. Road Area (Real calculation from 'Roads' utility zones)
        let roadArea = 0;
        this.project.plots.forEach(p => {
            // Look for UtilityAreas tagged as 'Roads'
            if (p.utilityAreas) {
                p.utilityAreas.forEach(u => {
                    if (u.type === 'Roads' && u.visible) roadArea += u.area;
                });
            }
        });

        // 3. Open Space
        // Open Space = Plot Area - Building Footprint of all Buildings
        let totalFootprint = 0;
        this.project.plots.forEach(p => {
            p.buildings.forEach(b => { if (b.visible) totalFootprint += b.area; });
        });

        const openSpace = Math.max(0, totalPlotArea - totalFootprint);

        return {
            greenArea: {
                total: greenAreaTotal,
                percentage: totalPlotArea > 0 ? (greenAreaTotal / totalPlotArea) * 100 : 0,
                perCapita: 5.5, // TODO: Link to Total Units * Avg Household Size
            },
            roadArea,
            openSpace
        };
    }

    private calculateHousingMetrics(totalBuiltUpArea: number) {
        // Approx 100 sqm per unit (Could also be dynamic based on unit mix)
        const totalUnits = Math.floor(totalBuiltUpArea / 100);

        // Parking Norms: Defaults to 1 per unit if no regulations found
        let parkingRatio = 1;
        if (this.regulations && this.regulations.facilities && this.regulations.facilities.parking) {
            parkingRatio = this.regulations.facilities.parking.value;
        }

        const requiredParking = Math.ceil(totalUnits * parkingRatio);

        // Calculate Provided Parking
        let providedParking = 0;
        const breakdown = { stilt: 0, basement: 0, surface: 0, podium: 0 };

        this.project.plots.forEach(p => {
            // 1. Parking Areas
            p.parkingAreas.forEach(pa => {
                const cap = pa.capacity || Math.floor(pa.area / 30);
                providedParking += cap;
                if (pa.type === 'Basement') breakdown.basement += cap;
                else if (pa.type === 'Stilt') breakdown.stilt += cap;
                else if (pa.type === 'Podium') breakdown.podium += cap;
                else breakdown.surface += cap;
            });

            // 2. Building Floors (Stilt/Podium/Basement)
            p.buildings.forEach(b => {
                if (b.visible === false) return;
                b.floors.forEach(f => {
                    if (f.type === 'Parking') {
                        const cap = f.parkingCapacity || Math.floor(b.area / 30);
                        providedParking += cap;

                        // Categorize
                        if (f.parkingType === 'Basement') breakdown.basement += cap;
                        else if (f.parkingType === 'Stilt') breakdown.stilt += cap;
                        else if (f.parkingType === 'Podium') breakdown.podium += cap;
                        else breakdown.podium += cap; // Default to podium for structured parking
                    }
                });
            });
        });

        return {
            totalUnits,
            parking: {
                required: requiredParking,
                provided: providedParking,
                breakdown
            }
        };
    }

    private calculateCompliance(areaMetrics: any, greenMetrics: any) {
        // 1. Bylaws
        let bylawScore = 100;
        if (this.regulations) {
            // dynamic FAR Check
            const maxFAR = this.regulations.geometry.floor_area_ratio.value;
            if (areaMetrics.achievedFAR > maxFAR) {
                // Penalize for exceeding FAR
                const excess = areaMetrics.achievedFAR - maxFAR;
                bylawScore -= (excess * 50); // Heavily penalize
            }

            // Height Check
            // const maxHeight = this.regulations.geometry.max_height.value;
            // ... (Height check logic requires building height aggregation)
        }

        // 2. Green
        let greenScore = 100;
        if (this.greenStandards) {
            const TARGET_GREEN = this.greenStandards.constraints.minGreenCover || 15;
            if (greenMetrics.greenArea.percentage < TARGET_GREEN) {
                greenScore -= (TARGET_GREEN - greenMetrics.greenArea.percentage) * 2;
            }
        } else {
            // Fallback default
            if (greenMetrics.greenArea.percentage < 15) greenScore -= 20;
        }

        // 3. Vastu
        let vastuScore = this.calculateVastuScore();

        return {
            bylaws: Math.max(0, Math.round(bylawScore)),
            green: Math.max(0, Math.round(greenScore)),
            vastu: Math.max(0, Math.round(vastuScore)),
        };
    }

    private calculateVastuScore(): number {
        // If no Vastu Data is enabled or provided, return neutral
        if (!this.project.vastuCompliant) return 50;

        let score = 100;
        let checks = 0;

        // If we have dynamic Vastu rules from Admin Panel, use them!
        const rules = this.vastuRules?.recommendations || [];
        // Map common categories to our simplified logic if possible
        // For now, we stick to the hardcoded geometric checks but we could enhance this later to parse the rules.

        // Use a base logic for now, but potentially modify weightings if we had them
        // ... (Existing geometric logic follows)

        this.project.plots.forEach(plot => {
            const center = turf.centroid(plot.geometry); // Brahmasthan
            const [cx, cy] = center.geometry.coordinates;

            // Check Utility Areas (Water, Fire)
            if (plot.utilityAreas) {
                plot.utilityAreas.forEach(u => {
                    const uCenter = turf.centroid(u.geometry);
                    const [ux, uy] = uCenter.geometry.coordinates;

                    // Angle relative to Plot Center
                    const dy = uy - cy;
                    const dx = ux - cx;
                    let theta = Math.atan2(dy, dx) * (180 / Math.PI);

                    // Convert to Compass Bearing (0=N, 90=E, 180=S, 270=W)
                    const angleStandard = (theta < 0) ? theta + 360 : theta; // 0=E, 90=N
                    const azimuth = (450 - angleStandard) % 360;

                    if (u.type === 'Water') {
                        // Best: NE (30-60 deg). Bad: SE, SW.
                        checks++;
                        // NE is roughly 30-60 degrees azimugh
                        if (azimuth > 30 && azimuth < 60) { /* Good */ }
                        else if (azimuth > 120 && azimuth < 240) { score -= 15; } // South/West bad
                    }

                    if (u.type === 'Fire' || u.type === 'HVAC') {
                        // Best: SE (120-150). Bad: NE.
                        checks++;
                        if (azimuth > 120 && azimuth < 160) { /* Good */ }
                        else if (azimuth > 30 && azimuth < 60) { score -= 15; } // NE bad for fire
                    }
                });
            }
        });

        if (checks === 0 && rules.length > 0) return 85; // Default good score if rules exist but no bad placements found
        if (checks === 0) return 50;

        return Math.max(0, score);
    }
}
