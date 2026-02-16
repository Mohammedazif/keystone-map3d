import { Plot, FeasibilityParams, DevelopmentStats, UnitTypology } from './types';

export const DEFAULT_FEASIBILITY_PARAMS: FeasibilityParams = {
    coreFactor: 0.15, // 15% (Low-rise default)
    circulationFactor: 0.12, // 12% (Mid-range default)
    unitMix: [
        { name: '2BHK', area: 140, mixRatio: 0.5 },
        { name: '3BHK', area: 185, mixRatio: 0.5 }
    ],
    efficiencyTarget: 0.70
};

/**
 * Calculates development statistics based on the "Maxi" logic/methodology.
 * 
 * Logic Flow:
 * 1. Determine Maximum Permissible Built-Up Area (Plot Area * FAR)
 * 2. Identify deductions (Core + Circulation + Services)
 * 3. Calculate Net Residential/Saleable Area
 * 4. Fit Unit Typologies based on mix
 * 5. Generate validation stats
 */
export function calculateDevelopmentStats(
    plot: Plot,
    params: FeasibilityParams = DEFAULT_FEASIBILITY_PARAMS
): DevelopmentStats {

    // 1. Max Permissible Built-Up Area
    // Fetch FAR from plot.far (user override) or regulation
    const far = plot.far || plot.regulation?.geometry?.floor_area_ratio?.value;

    if (!far) {
        console.warn('[calculateDevelopmentStats] No FAR found in plot or regulation. Using minimal default of 1.0');
    }

    const effectiveFAR = far || 1.0; // Minimal fallback only if truly missing
    const maxBuiltUpArea = plot.area * effectiveFAR;

    // 2. Classify Areas & Deductions
    // Core Area: Mandatory non-negotiable (Lifts, Stairs, Shafts)
    const coreArea = maxBuiltUpArea * params.coreFactor;

    // Circulation Area: Corridors, Lobbies
    const circulationArea = maxBuiltUpArea * params.circulationFactor;

    // Services Area: (Optional/Ancillary - e.g. Electrical rooms, Garbage rooms)
    // For this calculation model, we can assume a small standard percentage or include it in Core.
    // Let's assume ~2% for dedicated service rooms if not covered in Core.
    const serviceFactor = 0.02;
    const servicesArea = maxBuiltUpArea * serviceFactor;

    // 3. Efficiency & Net Saleable Area
    // Efficiency = (Net Saleable / Total Built-up)
    const totalDeductions = coreArea + circulationArea + servicesArea;
    const netSaleableArea = maxBuiltUpArea - totalDeductions;

    const efficiency = netSaleableArea / maxBuiltUpArea;

    // 4. Unit Typology Fitment
    const unitMix = params.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;

    // Calculate Weighted Average Unit Size
    // e.g. (140 * 0.5) + (185 * 0.5) = 162.5 sqm
    const weightedAvgUnitSize = unitMix.reduce((acc, unit) => {
        return acc + (unit.area * unit.mixRatio);
    }, 0);

    // Total Units derived from Net Saleable Area
    // We floor this because we can't have partial units
    const totalUnits = Math.floor(netSaleableArea / weightedAvgUnitSize);

    // 5. Unit Breakdown
    const unitBreakdown: Record<string, number> = {};
    unitMix.forEach(unit => {
        unitBreakdown[unit.name] = Math.round(totalUnits * unit.mixRatio);
    });

    // 6. Max Buildable Area (Footprint limit)
    // This is purely geometric: Plot Area * Max Coverage
    const maxCoverage = plot.maxCoverage || plot.regulation?.geometry?.max_ground_coverage?.value || 50; // percent
    const maxBuildableFootprint = plot.area * (maxCoverage / 100);

    return {
        totalBuiltUpArea: Math.round(maxBuiltUpArea),
        maxBuildableArea: Math.round(maxBuildableFootprint),
        achievedFAR: far, // For this theoretical max calc, we assume full FAR usage
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
