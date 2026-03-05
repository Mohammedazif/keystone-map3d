
import {
    Project,
    AdvancedKPIs,
    RegulationData,
    GreenRegulationData,
    VastuRegulationData,
    VASTU_ZONES_32
} from '../types';
import * as turf from '@turf/turf';
import { getVastuCenter } from '../vastu-utils';

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

        const netSaleable = areaMetrics.totalBuiltUpArea - areaMetrics.coreArea - areaMetrics.circulationArea - serviceMetrics.services.total - serviceMetrics.amenities.total;
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
        let consumedPlotArea = 0;
        let totalBuiltUpArea = 0;
        let groundCoverageArea = 0;

        // Plot Area
        this.project.plots.forEach(plot => {
            consumedPlotArea += plot.area;

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



        const totalPlotArea = this.project.totalPlotArea || consumedPlotArea;

        // Achieved FAR
        const achievedFAR = totalPlotArea > 0 ? (totalBuiltUpArea / totalPlotArea) : 0;
        const groundCoveragePct = totalPlotArea > 0 ? (groundCoverageArea / totalPlotArea) * 100 : 0;

        return {
            totalPlotArea,
            consumedPlotArea,
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
        if (this.project.intendedUse === 'Mixed-Use') servicePct = 0.08;

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

    private resolveLimit(
        regPath: (reg: RegulationData) => any,
        plotPaths: ((p: any) => any)[]
    ): number | undefined {
        if (this.regulations) {
            const val = regPath(this.regulations);
            if (val !== undefined && val !== null) return Number(val);
        }
        for (const plot of this.project.plots) {
            for (const accessor of plotPaths) {
                const val = accessor(plot);
                if (val !== undefined && val !== null) return Number(val);
            }
        }
        return undefined;
    }

    private getAzimuth(cx: number, cy: number, ux: number, uy: number): number {
        // Use turf.bearing for correct geographic bearing (handles lon/lat properly)
        const bearing = turf.bearing([cx, cy], [ux, uy]);
        return (bearing + 360) % 360; // Normalize to 0-360 compass bearing
    }

    private calcWeightedScore(items: any[]): number {
        let score = 0, totalWeight = 0;
        items.forEach((item: any) => {
            if (item.status === 'na' || item.weight === 0) return;
            totalWeight += item.weight;
            if (item.status === 'pass') score += item.weight;
            else if (item.status === 'warn') score += item.weight * 0.5;
        });
        return totalWeight > 0 ? Math.round((score / totalWeight) * 100) : 100;
    }

    private calculateCompliance(areaMetrics: any, greenMetrics: any) {
        const bylawItems: any[] = [];
        const greenItems: any[] = [];

        // ========== BYLAWS ==========

        // FAR (weight: 35)
        const maxFAR = this.resolveLimit(
            r => r.geometry?.floor_area_ratio?.value || r.geometry?.max_far?.value || r.geometry?.fsi?.value,
            [p => p.far, p => p.userFAR, p => p.regulation?.geometry?.floor_area_ratio?.value]
        ) || 2.5;
        bylawItems.push({
            label: `FAR (≤${maxFAR})`,
            status: areaMetrics.achievedFAR <= maxFAR ? 'pass' : 'fail',
            detail: `${areaMetrics.achievedFAR.toFixed(2)} / ${maxFAR}`,
            weight: 35
        });

        // Height (weight: 25)
        const maxHeight = this.resolveLimit(
            r => r.geometry?.max_height?.value,
            [p => p.maxBuildingHeight, p => p.regulation?.geometry?.max_height?.value]
        );
        let tallest = 0;
        this.project.plots.forEach(p => p.buildings.forEach(b => {
            if (b.visible !== false) { const h = b.height || (b.numFloors * 3.5); if (h > tallest) tallest = h; }
        }));
        bylawItems.push({
            label: maxHeight ? `Height (≤${maxHeight}m)` : 'Height',
            status: maxHeight ? (tallest <= maxHeight ? 'pass' : 'fail') : 'na',
            detail: maxHeight ? `${tallest.toFixed(1)}m / ${maxHeight}m` : `${tallest.toFixed(1)}m (no limit)`,
            weight: maxHeight ? 25 : 0
        });

        // Coverage (weight: 20)
        const maxCov = this.resolveLimit(
            r => r.geometry?.max_ground_coverage?.value,
            [p => p.maxCoverage, p => p.regulation?.geometry?.max_ground_coverage?.value]
        );
        if (maxCov) {
            bylawItems.push({
                label: `Coverage (≤${maxCov}%)`,
                status: areaMetrics.groundCoveragePct <= maxCov ? 'pass' : 'fail',
                detail: `${areaMetrics.groundCoveragePct.toFixed(1)}% / ${maxCov}%`,
                weight: 20
            });
        }

        // Setback (weight: 10)
        const reqSetback = this.resolveLimit(r => r.geometry?.setback?.value, [p => p.setback]) || 0;
        if (reqSetback > 0) {
            let setbackOk = true;
            this.project.plots.forEach(plot => {
                if (!plot.geometry) return;
                try {
                    const inner = turf.buffer(plot.geometry, -reqSetback / 1000, { units: 'kilometers' });
                    if (inner) {
                        plot.buildings.forEach((b: any) => {
                            if (b.visible !== false && b.centroid) {
                                if (!turf.booleanPointInPolygon(b.centroid, inner as any)) setbackOk = false;
                            }
                        });
                    }
                } catch { /* ignore */ }
            });
            bylawItems.push({
                label: `Setback (≥${reqSetback}m)`,
                status: setbackOk ? 'pass' : 'fail',
                detail: setbackOk ? 'Compliant' : 'Violation detected',
                weight: 10
            });
        }

        // Parking (weight: 10)
        const totalUnits = Math.floor(areaMetrics.totalBuiltUpArea / 100);
        let parkRatio = this.regulations?.facilities?.parking?.value || 1;
        const reqParking = Math.ceil(totalUnits * parkRatio);
        let provParking = 0;
        this.project.plots.forEach(p => {
            p.parkingAreas.forEach((pa: any) => { provParking += pa.capacity || Math.floor(pa.area / 30); });
            p.buildings.forEach((b: any) => {
                if (b.visible !== false) b.floors.forEach((f: any) => {
                    if (f.type === 'Parking') provParking += f.parkingCapacity || Math.floor(b.area / 30);
                });
            });
        });
        if (reqParking > 0) {
            bylawItems.push({
                label: `Parking (≥${reqParking})`,
                status: provParking >= reqParking ? 'pass' : provParking >= reqParking * 0.5 ? 'warn' : 'fail',
                detail: `${provParking} / ${reqParking} slots`,
                weight: 10
            });
        }

        // ========== GREEN ==========

        const tGreen = this.greenStandards?.constraints?.minGreenCover ? this.greenStandards.constraints.minGreenCover * 100 : 15;
        greenItems.push({
            label: `Green Cover (≥${tGreen.toFixed(0)}%)`,
            status: greenMetrics.greenArea.percentage >= tGreen ? 'pass' : greenMetrics.greenArea.percentage >= tGreen * 0.7 ? 'warn' : 'fail',
            detail: `${greenMetrics.greenArea.percentage.toFixed(1)}% / ${tGreen.toFixed(0)}%`,
            weight: 30
        });

        const tOpen = this.greenStandards?.constraints?.minOpenSpace ? this.greenStandards.constraints.minOpenSpace * 100 : 30;
        const openPct = areaMetrics.totalPlotArea > 0 ? (greenMetrics.openSpace / areaMetrics.totalPlotArea) * 100 : 0;
        greenItems.push({
            label: `Open Space (≥${tOpen.toFixed(0)}%)`,
            status: openPct >= tOpen ? 'pass' : openPct >= tOpen * 0.7 ? 'warn' : 'fail',
            detail: `${openPct.toFixed(1)}% / ${tOpen.toFixed(0)}%`,
            weight: 25
        });

        let hasRain = false, hasSolar = false, hasSTP = false;
        this.project.plots.forEach(p => {
            if (p.utilityAreas) {
                p.utilityAreas.forEach((u: any) => {
                    const t = (u.type || '').toLowerCase();
                    // Check existence in plan, not map visibility
                    if (t.includes('rainwater')) hasRain = true;
                    if (t.includes('solar') || t === 'solar pv') hasSolar = true;
                    if (t === 'stp' || t === 'wtp' || t.includes('sewage') || t.includes('water treatment')) hasSTP = true;
                });
            }
        });
        greenItems.push({ label: 'Rainwater Harvesting', status: hasRain ? 'pass' : 'fail', detail: hasRain ? 'Provided' : 'Not provided', weight: 15 });
        greenItems.push({ label: 'Solar PV', status: hasSolar ? 'pass' : 'fail', detail: hasSolar ? 'Provided' : 'Not provided', weight: 15 });
        greenItems.push({ label: 'Water Recycling (STP/WTP)', status: hasSTP ? 'pass' : 'fail', detail: hasSTP ? 'Provided' : 'Not provided', weight: 15 });

        // ========== VASTU ==========
        const vastuItems = this.calculateVastuItems();

        return {
            bylaws: Math.max(0, this.calcWeightedScore(bylawItems)),
            green: Math.max(0, this.calcWeightedScore(greenItems)),
            vastu: Math.max(0, this.calcWeightedScore(vastuItems)),
            bylawItems,
            greenItems,
            vastuItems,
        };
    }

    private calculateVastuItems(): any[] {
        const items: any[] = [];
        if (!this.project.vastuCompliant) {
            items.push({ label: 'Vastu not enabled', status: 'na', detail: 'Enable in project settings', weight: 0 });
            return items;
        }

        // Brahmasthan (weight: 25)
        let brahmFree = true;
        this.project.plots.forEach(plot => {
            const center = getVastuCenter(plot.geometry);
            const radius = Math.sqrt(turf.area(plot.geometry) * 0.05 / Math.PI);
            try {
                const zone = turf.buffer(center, radius / 1000, { units: 'kilometers' });
                if (zone) plot.buildings.forEach((b: any) => {
                    if (b.visible !== false && b.centroid) {
                        if (turf.booleanPointInPolygon(b.centroid, zone as any)) brahmFree = false;
                    }
                });
            } catch { /* */ }
        });
        items.push({ label: 'Brahmasthan (Center)', status: brahmFree ? 'pass' : 'fail', detail: brahmFree ? 'Center clear' : 'Building in center', weight: 25 });

        // Helper: find ALL utilities for a category
        const findUtilities = (
            typeFilter: (u: any) => boolean,
            idealMin: number,
            idealMax: number,
        ): { names: string[]; bearings: string[]; found: boolean; allInRange: boolean; someInRange: boolean } => {
            const matches: { name: string, az: number, inRange: boolean }[] = [];
            
            this.project.plots.forEach(plot => {
                const vastuCenter = getVastuCenter(plot.geometry);
                (plot.utilityAreas || []).forEach((u: any) => {
                    if (!typeFilter(u)) return;

                    const uCentroid = turf.centroid(u.geometry);
                    const bearing = turf.bearing(vastuCenter, uCentroid);
                    const az = (bearing + 360) % 360;
                    
                    matches.push({
                        name: u.name || u.type,
                        az,
                        inRange: az >= idealMin && az <= idealMax
                    });
                });
            });

            if (matches.length === 0) return { names: [], bearings: [], found: false, allInRange: false, someInRange: false };

            const allInRange = matches.every(m => m.inRange);
            const someInRange = matches.some(m => m.inRange);
            
            // Format for display
            const names = matches.map(m => m.name);
            const bearings = matches.map(m => `${m.az.toFixed(0)}°`);

            return { names, bearings, found: true, allInRange, someInRange };
        };

        // Water NE (weight: 20)
        const waterResult = findUtilities(
            u => {
                const t = (u.type || '').toLowerCase();
                if (t === 'wtp' || t === 'stp' || t.includes('treatment') || t.includes('sewage')) return false; // Waste/Treatment goes NW, not NE
                return t === 'water' || t.includes('water') || t.includes('rainwater');
            },
            22, 68
        );
        if (waterResult.found) {
            items.push({
                label: 'Water Source (NE)',
                status: waterResult.allInRange ? 'pass' : waterResult.someInRange ? 'warn' : 'fail',
                detail: `${waterResult.names.join(', ')}: ${waterResult.bearings.join(', ')} (need 22-68°)`,
                weight: 20
            });
        } else {
            items.push({ label: 'Water Source (NE)', status: 'na', detail: 'No water utility', weight: 0 });
        }

        // Fire SE (weight: 20)
        const fireResult = findUtilities(
            u => {
                const t = (u.type || '').toLowerCase();
                const name = (u.name || '').toLowerCase();
                if (name.includes('tank')) return false; // Exclude fire tanks as requested
                return t === 'fire' || t === 'hvac' || t === 'electrical' || t === 'dg set';
            },
            112, 158
        );
        if (fireResult.found) {
            items.push({
                label: 'Fire/Energy (SE)',
                status: fireResult.allInRange ? 'pass' : fireResult.someInRange ? 'warn' : 'fail',
                detail: `${fireResult.names.join(', ')}: ${fireResult.bearings.join(', ')} (need 112-158°)`,
                weight: 20
            });
        } else {
            items.push({ label: 'Fire/Energy (SE)', status: 'na', detail: 'No fire/HVAC utility', weight: 0 });
        }

        // Entry (weight: 15)
        let entryStatus: 'pass' | 'fail' | 'warn' | 'na' = 'na', entryDetail = 'No entries placed';
        this.project.plots.forEach(plot => {
            if (plot.entries?.length > 0) {
                const good = plot.entries.some((e: any) => /N|E|NE/i.test(e.name || ''));
                entryStatus = good ? 'pass' : 'warn';
                entryDetail = good ? 'Entry from N/E/NE ✓' : 'Entry not from N/E/NE';
            }
        });
        items.push({ label: 'Entry (N/E/NE)', status: entryStatus, detail: entryDetail, weight: entryStatus === 'na' ? 0 : 15 });

        // Service Placement (weight: 20)
        let svcGood = 0, svcTotal = 0;
        this.project.plots.forEach(plot => {
            const vastuCenter = getVastuCenter(plot.geometry);
            (plot.utilityAreas || []).filter((u: any) => u.visible).forEach((u: any) => {
                svcTotal++;
                const uCentroid = turf.centroid(u.geometry);
                const bearing = turf.bearing(vastuCenter, uCentroid);
                const az = (bearing + 360) % 360;
                const inNE = az >= 22 && az <= 68;
                const ut = (u.type || '').toLowerCase();
                // Water IN NE is great; Water elsewhere is ok-ish; Non-water outside NE is fine
                if (ut === 'water' || ut === 'wtp' || ut.includes('water')) {
                    if (inNE) svcGood++; // Ideal
                    else svcGood++; // Water anywhere is acceptable
                } else if (!inNE) {
                    svcGood++; // Non-water outside NE is correct
                }
            });
        });
        if (svcTotal > 0) {
            const pct = svcGood / svcTotal;
            items.push({ label: 'Service Placement', status: pct >= 0.8 ? 'pass' : pct >= 0.5 ? 'warn' : 'fail', detail: `${svcGood}/${svcTotal} correct`, weight: 20 });
        }

        return items;
    }
}
