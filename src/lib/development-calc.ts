import { Plot, FeasibilityParams, DevelopmentStats, UnitTypology } from './types';

export const CORE_CIRCULATION_STANDARDS: Record<string, { min: number; max: number; default: number }> = {
    'Residential':   { min: 0.15, max: 0.25, default: 0.20 },
    'Commercial':    { min: 0.25, max: 0.35, default: 0.30 },
    'Office':        { min: 0.25, max: 0.35, default: 0.30 },
    'Retail':        { min: 0.35, max: 0.50, default: 0.40 },
    'Hospitality':   { min: 0.25, max: 0.40, default: 0.30 },
    'Institutional': { min: 0.30, max: 0.40, default: 0.35 },
    'Public':        { min: 0.30, max: 0.40, default: 0.35 },
    'Industrial':    { min: 0.25, max: 0.35, default: 0.30 },
    'MixedUse':      { min: 0.25, max: 0.35, default: 0.30 },
};

export const DEFAULT_FEASIBILITY_PARAMS: FeasibilityParams = {
    coreFactor: 0.15, // Core only (lifts, stairs, shafts)
    circulationFactor: 0.12, // Corridors, lobbies
    // Combined = 0.27 — Residential default
    unitMix: [
        { name: '2BHK', area: 140, mixRatio: 0.30 },
        { name: '3BHK', area: 185, mixRatio: 0.35 },
        { name: '4BHK', area: 245, mixRatio: 0.35 }
    ],
    efficiencyTarget: 0.70
};

/**
 * Returns the core+circulation combined factor for a given development type.
 * Uses the industry standard default for the type.
 */
export function getCoreCirculationFactor(intendedUse?: string): number {
    if (!intendedUse) return CORE_CIRCULATION_STANDARDS['Residential'].default;
    const standard = CORE_CIRCULATION_STANDARDS[intendedUse];
    return standard ? standard.default : CORE_CIRCULATION_STANDARDS['Residential'].default;
}

/**
 * Calculates development statistics based on the "Maxi" logic/methodology.
 * 
 * Logic Flow:
 * 1. Determine Maximum Permissible Built-Up Area (Plot Area * FAR)
 * 2. Identify deductions (Core + Circulation + Services) using type-aware standards
 * 3. Calculate Net Residential/Saleable Area
 * 4. Fit Unit Typologies based on mix
 * 5. Generate validation stats
 */
export function calculateDevelopmentStats(
    plot: Plot,
    params: FeasibilityParams = DEFAULT_FEASIBILITY_PARAMS
): DevelopmentStats {

    // 1. Max Permissible Built-Up Area
    const far = plot.far || plot.regulation?.geometry?.floor_area_ratio?.value;

    if (!far) {
        console.warn('[calculateDevelopmentStats] No FAR found in plot or regulation. Using minimal default of 1.0');
    }

    const effectiveFAR = far || 1.0;
    const maxBuiltUpArea = plot.area * effectiveFAR;

    // 2. Classify Areas & Deductions
    const intendedUse = (plot as any).intendedUse || 'Residential';
    const combinedFactor = getCoreCirculationFactor(intendedUse);
    
    const coreFactor = params.coreFactor || (combinedFactor * 0.55);
    const circulationFactor = params.circulationFactor || (combinedFactor * 0.45);

    const coreArea = maxBuiltUpArea * coreFactor;
    const circulationArea = maxBuiltUpArea * circulationFactor;

    const serviceFactor = 0.02;
    const servicesArea = maxBuiltUpArea * serviceFactor;

    // 3. Efficiency & Net Saleable Area
    const totalDeductions = coreArea + circulationArea + servicesArea;
    const netSaleableArea = maxBuiltUpArea - totalDeductions;

    const efficiency = netSaleableArea / maxBuiltUpArea;

    // 4. Unit Typology Fitment
    const unitMix = params.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;

    const weightedAvgUnitSize = unitMix.reduce((acc, unit) => {
        return acc + (unit.area * unit.mixRatio);
    }, 0);

    const totalUnits = Math.floor(netSaleableArea / weightedAvgUnitSize);

    // 5. Unit Breakdown
    const unitBreakdown: Record<string, number> = {};
    unitMix.forEach(unit => {
        unitBreakdown[unit.name] = Math.round(totalUnits * unit.mixRatio);
    });

    // 6. Max Buildable Area (Footprint limit)
    const maxCoverage = plot.maxCoverage || plot.regulation?.geometry?.max_ground_coverage?.value || 50;
    const maxBuildableFootprint = plot.area * (maxCoverage / 100);

    return {
        totalBuiltUpArea: Math.round(maxBuiltUpArea),
        maxBuildableArea: Math.round(maxBuildableFootprint),
        achievedFAR: far,
        efficiency: parseFloat(efficiency.toFixed(2)),
        areas: {
            core: Math.round(coreArea),
            circulation: Math.round(circulationArea),
            saleable: Math.round(netSaleableArea),
            services: Math.round(servicesArea)
        },
        units: {
            total: totalUnits,
            breakdown: unitBreakdown
        }
    };
}

