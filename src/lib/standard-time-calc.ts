import type { BuildingStandardTime, StandardTimeEstimation, StandardTimePhase } from './types';

// Median Productivity Rates (from standard time table)
// Expressed in square meters completed per day
export const StandardProductivityRates = {
  // Substructure
  EarthworkAndExcavation: 300, // 100-500 m²/day (based on footprint/basement)
  Foundation: 2.5,             // 1.67-4.00 m²/day (based on total GFA proxy)
  BasementPerLevel: 1.15,      // 0.93-1.37 m²/day (based on footprint area)
  
  // Superstructure
  StructurePerFloor: 24.3,     // 20-28.6 m²/day (based on typical floor plate)
  
  // Finishes & MEP
  Plastering: 2.08,            // 1.67-2.50 m²/day (based on GFA)
  Flooring: 3.52,              // 2.70-4.35 m²/day (based on GFA)
  Painting: 1.66,              // 1.33-2.00 m²/day (based on GFA)
  FalseCeiling: 2.45,          // 1.96-2.94 m²/day (based on GFA)
  MEPComplete: 0.94,           // 0.77-1.11 m²/day (based on GFA)
  
  // External
  ExternalDevelopment: 53.3,   // 40-66.7 m²/day (based on site area)
} as const;

export interface BuildingTimeInput {
  buildingId: string;
  buildingName: string;
  gfaSqm: number;
  footprintSqm: number;
  floors: number;
  basements: number;
}

const DAYS_PER_MONTH = 26; // Standard 26 working days in a month

/**
 * Calculates deterministic construction timelines based on area/productivity rates.
 */
export function calculateStandardTimeEstimates(
  buildings: BuildingTimeInput[],
  plotAreaSqm: number
): StandardTimeEstimation {
  const buildingEstimates: BuildingStandardTime[] = buildings.map(b => {
    const phases: StandardTimePhase[] = [];
    const typicalFloorPlate = b.gfaSqm / (b.floors || 1);

    // Adjust for simultaneous work crews. 
    // Small buildings (e.g. 500 sqm footprint) might have 1 crew. 
    // Large buildings parallelize work across floors and zones.
    // A standard rule of thumb: 1 crew per 1000 sqm of typical floor plate, minimum 1.
    // Plus we assume floors can overlap (staggered by 2-3 weeks).
    const parallelCrews = Math.max(1, Math.ceil(typicalFloorPlate / 600));

    // 1. Earthwork & Excavation
    // Based on footprint area + extra for depth if basements exist
    const totalExcavationArea = b.footprintSqm * (1 + (b.basements * 0.5));
    const excDays = Math.max(7, Math.ceil((totalExcavationArea / StandardProductivityRates.EarthworkAndExcavation) / (parallelCrews * 1.5)));
    phases.push({ name: 'Earthwork & Excavation', durationDays: excDays, durationMonths: excDays / DAYS_PER_MONTH });

    // 2. Foundation
    // Based on total GFA as proxy for structural load
    const fndDays = Math.max(15, Math.ceil((b.gfaSqm / StandardProductivityRates.Foundation) / (parallelCrews * 1.5)));
    phases.push({ name: 'Foundation', durationDays: fndDays, durationMonths: fndDays / DAYS_PER_MONTH });

    // 3. Basements (if any)
    let bsmntDays = 0;
    if (b.basements > 0) {
        bsmntDays = Math.ceil((b.footprintSqm * b.basements / StandardProductivityRates.BasementPerLevel) / parallelCrews);
        phases.push({ name: 'Basement Levels', durationDays: bsmntDays, durationMonths: bsmntDays / DAYS_PER_MONTH });
    }

    // 4. Superstructure
    // Staggering floor by floor: Time = (Days per floor) * (Number of floors)
    // Structure per floor is already a rate based on typical floor plate, so we just calculate days per floor and multiply.
    // However, the rule given was m2/day. So days per floor = typicalFloor / rate.
    const daysPerFloor = Math.max(4, Math.ceil(typicalFloorPlate / (StandardProductivityRates.StructurePerFloor * parallelCrews)));
    const strDays = Math.max(15, daysPerFloor * (b.floors || 1));
    phases.push({ name: 'Superstructure', durationDays: strDays, durationMonths: strDays / DAYS_PER_MONTH });

    // 5. Finishes & MEP
    // Instead of summing the entire finishes duration at the end of the building, 
    // chart "Finishes" as the *tail end* that extends beyond superstructure.
    // Total Finishes typically takes 1.2x to 1.5x structure time, starting 30% into structure.
    // So the visible critical path phase specifically for finishes at the tail end is about ~50% of strDays.
    const finishesDays = Math.max(45, Math.ceil(strDays * 0.5));
    
    phases.push({ name: 'Finishes & MEP', durationDays: finishesDays, durationMonths: finishesDays / DAYS_PER_MONTH });

    const totalDaysRaw = excDays + fndDays + bsmntDays + strDays + finishesDays;

    // ─── STANDARD TIME DELAYS ───
    // Based on reference doc: Monsoon(-25-40%), Summer(-10-20%), Festival(-10-15%), Winter(-5-15%), Rework(10-20%).
    // Using medians weighted heavily by annualized impact (e.g. 3 months monsoon = ~7.5% annual loss)
    // Avg delay factor ~ 28.85% (0.2885):
    // Monsoon(7.5%) + Summer(3.75%) + Winter(1.66%) + Festival(1.0%) + Rework(15.0%)
    const bufferDays = Math.ceil(totalDaysRaw * 0.2885);
    phases.push({ name: 'Risk & Weather Buffer', durationDays: bufferDays, durationMonths: bufferDays / DAYS_PER_MONTH });

    const totalDays = totalDaysRaw + bufferDays;

    return {
      buildingId: b.buildingId,
      buildingName: b.buildingName,
      totalDurationDays: totalDays,
      totalDurationMonths: totalDays / DAYS_PER_MONTH,
      phases,
    };
  });

  // Add external development. Multiple landscaping crews work concurrently.
  // Cap external development to max ~120 days to reflect scaling crews for huge plots.
  const totalFootprint = buildings.reduce((sum, b) => sum + b.footprintSqm, 0);
  const externalArea = Math.max(0, plotAreaSqm - totalFootprint);
  let extDays = 0;
  if (externalArea > 0) {
      extDays = Math.max(30, Math.min(120, Math.ceil(externalArea / StandardProductivityRates.ExternalDevelopment)));
  }

  // Delivery Phasing Logic (The user explicitly requested "make phases to this")
  // Group buildings into 3 project phases to avoid a massive 30-year linear timeline.
  const numProjectPhases = Math.min(3, Math.max(1, Math.ceil(buildingEstimates.length / 3)));
  const buildingsPerPhase = Math.ceil(buildingEstimates.length / numProjectPhases);
  
  let maxCompletionDay = 0;

  buildingEstimates.forEach((b, idx) => {
      const phaseIndex = Math.floor(idx / buildingsPerPhase);
      const indexInPhase = idx % buildingsPerPhase;
      
      // Base start time for the phase:
      // Phase 1 : Day 0
      // Phase 2 : Starts when Phase 1 superstructure is well underway (e.g. 180 days offset)
      // Phase 3 : Starts when Phase 2 starts + 180 days
      const phaseStartDay = phaseIndex * 180; 

      // Staggering within the same phase: e.g. 1 month apart between buildings in the same phase
      const intraPhaseStartDay = indexInPhase * DAYS_PER_MONTH;
      
      const currentStartDay = phaseStartDay + intraPhaseStartDay;
      
      b.offsetMonths = currentStartDay / DAYS_PER_MONTH;

      const bCompletionEndDay = currentStartDay + b.totalDurationDays;
      if (bCompletionEndDay > maxCompletionDay) {
          maxCompletionDay = bCompletionEndDay;
      }
  });

  // Add external development at the end of the critical path
  const totalProjectDays = maxCompletionDay + extDays;

  return {
    buildings: buildingEstimates,
    totalProjectDurationDays: totalProjectDays,
    totalProjectDurationMonths: totalProjectDays / DAYS_PER_MONTH
  };
}
