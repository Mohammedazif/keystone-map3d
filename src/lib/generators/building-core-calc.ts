/**
 * Building Core Calculator based exactly on calculation_logic.md
 * Computes exact lift sizes, staircases, corridors, and shafts based on population/floors.
 */

export interface BuildingCoreInputs {
  footprintArea: number; // area of one floor
  numFloors: number;
  avgUnitArea: number;
  intendedUse: 'Residential' | 'Commercial' | 'Institutional';
}

export interface CoreBreakdown {
  totalFloorArea: number;
  
  // Lifts
  liftCount: number;
  liftArea: number;
  
  // Stairs
  stairCount: number;
  stairArea: number;
  
  // Circulation
  liftLobbyArea: number;
  corridorArea: number;
  
  // Shafts
  plumbingShaftArea: number;
  electricalShaftArea: number;
  fireRiserArea: number;
  garbageShaftArea: number;
  totalShaftArea: number;
  
  // Fire
  fireCheckLobbyArea: number;
  
  totalCoreAreaPerFloor: number;
  totalCirculationAreaPerFloor: number;
  efficiency: number; // BUA to Carpet (Net Usable / Total Floor Area)
  netUsableAreaPerFloor: number;
  estimatedUnitsPerFloor: number;
}

export function calculateBuildingCoreAndCirculation(inputs: BuildingCoreInputs): CoreBreakdown {
  const { footprintArea, numFloors, avgUnitArea, intendedUse } = inputs;
  
  // 1. Initial rough estimate of units/occupants per floor
  // Assume a default 75% efficiency to get a starting unit count (to drive stair/lift math)
  const initialNetArea = footprintArea * 0.75;
  const initialUnitsPerFloor = Math.floor(initialNetArea / avgUnitArea);
  
  // Population
  let popPerFloor = 0;
  if (intendedUse === 'Residential') popPerFloor = initialUnitsPerFloor * 5;
  else if (intendedUse === 'Commercial') popPerFloor = footprintArea / 10;
  else if (intendedUse === 'Institutional') popPerFloor = footprintArea / 6;

  // --- 5. Lifts ---
  let liftCount = 0;
  let areaPerLift = 0;
  const liftLobbyPerLift = intendedUse === 'Residential' ? 4 : intendedUse === 'Commercial' ? 7 : 7.5;
  
  if (intendedUse === 'Residential') {
    const totalUnits = initialUnitsPerFloor * numFloors;
    liftCount = Math.max(1, Math.ceil(totalUnits / 80));
    areaPerLift = 2.25; // passenger lift
  } else if (intendedUse === 'Commercial') {
    const totalPop = popPerFloor * numFloors;
    liftCount = Math.max(1, Math.ceil(totalPop / 275)); // roughly 1 per 250-300
    areaPerLift = 2.5;
  } else {
    liftCount = Math.max(2, Math.ceil((footprintArea * numFloors) / 2250)); // Includes min 1 stretcher
    areaPerLift = 3.0;
  }
  
  // Overrides for height (pseudo height: numFloors * 3.5m)
  const height = numFloors * 3.5;
  if (height > 30) { // ~9 floors
      liftCount += 1; // Service/fire lift
  }
  const liftArea = liftCount * areaPerLift;
  const liftLobbyArea = liftCount * liftLobbyPerLift;

  // --- 6. Stairs ---
  let stairCount = 2; // Standard for most mid-rise
  if (popPerFloor <= 30 && height <= 20) stairCount = 1;
  else if (popPerFloor > 500) stairCount = 3;
  
  let areaPerStair = 15; // default residential
  if (intendedUse === 'Commercial') areaPerStair = 21;
  else if (intendedUse === 'Institutional') areaPerStair = 28;
  
  const stairArea = stairCount * areaPerStair;

  // --- 7. Corridors ---
  let corridorArea = 0;
  if (intendedUse === 'Residential') {
      if (initialUnitsPerFloor <= 4) corridorArea = 8;
      else if (initialUnitsPerFloor <= 8) corridorArea = 16;
      else corridorArea = 28;
  } else if (intendedUse === 'Commercial') {
      corridorArea = footprintArea * 0.08;
  } else {
      corridorArea = footprintArea * 0.12;
  }

  // --- 8. Shafts ---
  let plumbingShaftCount = intendedUse === 'Residential' ? Math.max(1, Math.ceil(initialUnitsPerFloor / 4)) : 
                           intendedUse === 'Commercial' ? Math.max(1, Math.ceil(footprintArea / 750)) :
                           Math.max(1, Math.ceil(footprintArea / 500));
  const plumbingShaftArea = plumbingShaftCount * 0.85; // 0.7-1.0
  const electricalShaftArea = 0.6; // 1 per core, 0.5-0.7
  const fireRiserArea = 0.5; // 1 per core
  const garbageShaftArea = (intendedUse === 'Residential' && initialUnitsPerFloor >= 6) ? 0.7 : 0;
  const totalShaftArea = plumbingShaftArea + electricalShaftArea + fireRiserArea + garbageShaftArea;

  // --- 9. Fire Lobbies ---
  const fireCheckLobbyArea = height > 24 ? 10 : 0; // 8-12 sqm if > 24m

  // --- Final Floor Math ---
  const totalCoreAreaPerFloor = liftArea + stairArea + totalShaftArea + fireCheckLobbyArea;
  const totalCirculationAreaPerFloor = liftLobbyArea + corridorArea;
  
  const deductionArea = totalCoreAreaPerFloor + totalCirculationAreaPerFloor;
  const netUsableAreaPerFloor = Math.max(0, footprintArea - deductionArea);
  const efficiency = (netUsableAreaPerFloor / footprintArea) * 100;

  // Re-verify unit count based on precise net usable area
  const finalUnitsPerFloor = Math.floor(netUsableAreaPerFloor / avgUnitArea);

  return {
    totalFloorArea: footprintArea,
    liftCount,
    liftArea,
    stairCount,
    stairArea,
    liftLobbyArea,
    corridorArea,
    plumbingShaftArea,
    electricalShaftArea,
    fireRiserArea,
    garbageShaftArea,
    totalShaftArea,
    fireCheckLobbyArea,
    totalCoreAreaPerFloor,
    totalCirculationAreaPerFloor,
    efficiency,
    netUsableAreaPerFloor,
    estimatedUnitsPerFloor: finalUnitsPerFloor
  };
}
