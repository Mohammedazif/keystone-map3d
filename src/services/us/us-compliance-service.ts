/**
 * US Compliance Service — IFC Fire Code + ADA Accessibility
 * 
 * Completely separate from India services.
 * Maps International Fire Code (IFC 2021) and ADA Standards to 
 * the Keystone regulation engine's compliance scoring system.
 * 
 * Sources:
 * - International Fire Code (IFC) 2021 Edition — ICC
 * - ADA Standards for Accessible Design 2010 — 28 CFR Part 36
 */

import ifcDefaults from '@/data/us-ifc-defaults.json';
import adaDefaults from '@/data/us-ada-defaults.json';
import type { RegulationData, ComplianceItem } from '@/lib/types';

// ── IFC Fire Code Compliance ──────────────────────────────────────────────────

export interface IFCComplianceInput {
  buildingHeight: number;          // meters
  numFloors: number;
  totalArea: number;               // sqm
  occupantLoad: number;
  isSprinklered: boolean;
  hasFireAccessRoad: boolean;
  fireAccessRoadWidth?: number;    // meters
  hasStandpipe: boolean;
  hasFireAlarm: boolean;
  hasFireCommandCenter: boolean;
  hasRefugeFloors: boolean;
  hasSmokePressurization: boolean;
  hasEmergencyPower: boolean;
  travelDistanceToExit?: number;   // meters
  totalParkingSpaces?: number;
  regulation?: RegulationData | null;
}

export interface ADAComplianceInput {
  numFloors: number;
  hasElevator: boolean;
  accessibleRouteWidth?: number;   // meters
  doorClearanceWidth?: number;     // meters
  rampSlope?: number;              // ratio (e.g. 0.083)
  totalParkingSpaces: number;
  accessibleParkingSpaces: number;
  hasAccessibleRestrooms: boolean;
  hasBrailleSignage: boolean;
  hasCommonAreaAccessibility: boolean;
}

// ── IFC Compliance Evaluation ─────────────────────────────────────────────────

export function evaluateIFCCompliance(input: IFCComplianceInput): {
  items: { label: string; status: 'pass' | 'fail' | 'warn'; detail: string; maxScore: number }[];
  isHighRise: boolean;
} {
  const ifc = ifcDefaults.defaults;
  const hr = ifcDefaults.highRise;
  const isHighRise = input.buildingHeight > hr.threshold_m;
  const items: { label: string; status: 'pass' | 'fail' | 'warn'; detail: string; maxScore: number }[] = [];

  // 1. Fire Access Road
  if (input.hasFireAccessRoad) {
    const roadOk = !input.fireAccessRoadWidth || input.fireAccessRoadWidth >= ifc.fire_access_road_width_m;
    items.push({
      label: `Fire Access Road (≥${ifc.fire_access_road_width_m}m / IFC 503)`,
      status: roadOk ? 'pass' : 'fail',
      detail: input.fireAccessRoadWidth 
        ? `${input.fireAccessRoadWidth.toFixed(1)}m provided` 
        : 'Fire access road present',
      maxScore: 60,
    });
  } else {
    items.push({
      label: `Fire Access Road (≥${ifc.fire_access_road_width_m}m / IFC 503)`,
      status: 'fail',
      detail: 'No fire access road detected',
      maxScore: 60,
    });
  }

  // 2. Automatic Sprinkler System
  const sprinklerRequired = input.totalArea > ifc.sprinkler_threshold_area_sqm || 
                            input.numFloors >= ifc.sprinkler_residential_threshold_stories;
  if (sprinklerRequired) {
    items.push({
      label: 'Automatic Sprinkler System (IFC 903)',
      status: input.isSprinklered ? 'pass' : 'fail',
      detail: input.isSprinklered ? 'NFPA 13 sprinkler installed' : `Required — area ${Math.round(input.totalArea)} sqm exceeds ${ifc.sprinkler_threshold_area_sqm} sqm threshold`,
      maxScore: 80,
    });
  }

  // 3. Standpipe System
  if (input.numFloors >= ifc.standpipe_threshold_stories) {
    items.push({
      label: `Standpipe System (IFC 905 — ≥${ifc.standpipe_threshold_stories} stories)`,
      status: input.hasStandpipe ? 'pass' : 'fail',
      detail: input.hasStandpipe ? 'Standpipe provided' : 'Required for multi-story building',
      maxScore: 40,
    });
  }

  // 4. Fire Alarm
  if (input.occupantLoad >= ifc.fire_alarm_threshold_occupants || input.numFloors >= 3) {
    items.push({
      label: 'Fire Alarm System (IFC 907)',
      status: input.hasFireAlarm ? 'pass' : 'warn',
      detail: input.hasFireAlarm ? 'Fire alarm installed' : `Required — occupant load ≥${ifc.fire_alarm_threshold_occupants}`,
      maxScore: 40,
    });
  }

  // 5. Travel Distance to Exit
  if (input.travelDistanceToExit !== undefined) {
    const maxTravel = input.isSprinklered ? ifc.travel_distance_sprinklered_m : ifc.travel_distance_unsprinklered_m;
    items.push({
      label: `Egress Travel Distance (≤${maxTravel}m / IFC 1017)`,
      status: input.travelDistanceToExit <= maxTravel ? 'pass' : 'fail',
      detail: `${input.travelDistanceToExit.toFixed(1)}m / ${maxTravel}m max`,
      maxScore: 50,
    });
  }

  // 6. High-Rise Specific Requirements
  if (isHighRise) {
    // Fire Command Center
    items.push({
      label: 'Fire Command Center (IFC 911 — High-Rise)',
      status: input.hasFireCommandCenter ? 'pass' : 'fail',
      detail: input.hasFireCommandCenter ? `≥${hr.fire_command_center_min_area_sqm} sqm provided` : 'Required for high-rise (≥22.9m)',
      maxScore: 40,
    });

    // Smoke Pressurization
    items.push({
      label: 'Stairway Pressurization (IFC 909 — High-Rise)',
      status: input.hasSmokePressurization ? 'pass' : 'warn',
      detail: input.hasSmokePressurization ? 'Pressurized stairways' : 'Required for high-rise',
      maxScore: 30,
    });

    // Emergency Power
    items.push({
      label: 'Standby/Emergency Power (IFC 604 — High-Rise)',
      status: input.hasEmergencyPower ? 'pass' : 'fail',
      detail: input.hasEmergencyPower ? 'Emergency power system installed' : 'Required for high-rise',
      maxScore: 30,
    });

    // Refuge Floors
    items.push({
      label: `Refuge Floors (every ${hr.refuge_floors_interval} floors / IFC 1009)`,
      status: input.hasRefugeFloors ? 'pass' : 'warn',
      detail: input.hasRefugeFloors ? 'Refuge floors provided' : 'Check refuge area requirements',
      maxScore: 20,
    });
  }

  return { items, isHighRise };
}

// ── ADA Accessibility Compliance Evaluation ───────────────────────────────────

export function evaluateADACompliance(input: ADAComplianceInput): {
  items: { label: string; status: 'pass' | 'fail' | 'warn'; detail: string; maxScore: number }[];
} {
  const ada = adaDefaults.defaults;
  const items: { label: string; status: 'pass' | 'fail' | 'warn'; detail: string; maxScore: number }[] = [];

  // 1. Elevator (multi-story)
  if (input.numFloors > ada.elevator_required_above_stories) {
    items.push({
      label: 'Elevator Access (ADA 206.2.3)',
      status: input.hasElevator ? 'pass' : 'fail',
      detail: input.hasElevator 
        ? 'Elevator provided for multi-story access' 
        : `Required — building has ${input.numFloors} floors`,
      maxScore: 60,
    });
  }

  // 2. Accessible Route Width
  if (input.accessibleRouteWidth !== undefined) {
    items.push({
      label: `Accessible Route Width (≥${ada.accessible_route_width_m}m / ADA 403)`,
      status: input.accessibleRouteWidth >= ada.accessible_route_width_m ? 'pass' : 'fail',
      detail: `${input.accessibleRouteWidth.toFixed(2)}m / ${ada.accessible_route_width_m}m required`,
      maxScore: 40,
    });
  } else {
    items.push({
      label: `Accessible Route Width (≥${ada.accessible_route_width_m}m / ADA 403)`,
      status: 'warn',
      detail: 'Not verified — check accessible route compliance',
      maxScore: 40,
    });
  }

  // 3. Door Clearance
  if (input.doorClearanceWidth !== undefined) {
    items.push({
      label: `Door Clearance (≥${ada.door_clearance_width_m}m / ADA 404)`,
      status: input.doorClearanceWidth >= ada.door_clearance_width_m ? 'pass' : 'fail',
      detail: `${input.doorClearanceWidth.toFixed(2)}m provided`,
      maxScore: 30,
    });
  } else {
    items.push({
      label: `Door Clearance (≥${ada.door_clearance_width_m}m / ADA 404)`,
      status: 'warn',
      detail: 'Not verified',
      maxScore: 30,
    });
  }

  // 4. Ramp Slope
  if (input.rampSlope !== undefined) {
    items.push({
      label: `Ramp Slope (≤1:12 / ${ada.ramp_max_slope_ratio} / ADA 405)`,
      status: input.rampSlope <= ada.ramp_max_slope_ratio ? 'pass' : 'fail',
      detail: `Slope ${input.rampSlope.toFixed(4)} ${input.rampSlope <= ada.ramp_max_slope_ratio ? '✓' : '✗'}`,
      maxScore: 30,
    });
  }

  // 5. Accessible Parking
  if (input.totalParkingSpaces > 0) {
    const requiredAccessible = getRequiredAccessibleSpaces(input.totalParkingSpaces);
    items.push({
      label: `Accessible Parking (ADA 208 — ≥${requiredAccessible} spaces)`,
      status: input.accessibleParkingSpaces >= requiredAccessible ? 'pass' : 'fail',
      detail: `${input.accessibleParkingSpaces} / ${requiredAccessible} required for ${input.totalParkingSpaces} total spaces`,
      maxScore: 40,
    });
  }

  // 6. Accessible Restrooms
  items.push({
    label: 'Accessible Restrooms (ADA 213)',
    status: input.hasAccessibleRestrooms ? 'pass' : 'warn',
    detail: input.hasAccessibleRestrooms ? 'Accessible restrooms provided' : 'Verify ADA-compliant restrooms on each floor',
    maxScore: 30,
  });

  // 7. Signage
  items.push({
    label: 'Accessible Signage (Braille + Tactile / ADA 703)',
    status: input.hasBrailleSignage ? 'pass' : 'warn',
    detail: input.hasBrailleSignage ? 'Braille and tactile signage installed' : 'Not verified',
    maxScore: 20,
  });

  // 8. Common Area Accessibility
  items.push({
    label: 'Common Area Accessibility (ADA 206)',
    status: input.hasCommonAreaAccessibility ? 'pass' : 'warn',
    detail: input.hasCommonAreaAccessibility ? 'All common areas accessible' : 'Not verified',
    maxScore: 20,
  });

  return { items };
}

// ── Helper: ADA Parking Table (208.2) ─────────────────────────────────────────

function getRequiredAccessibleSpaces(totalSpaces: number): number {
  if (totalSpaces <= 25) return 1;
  if (totalSpaces <= 50) return 2;
  if (totalSpaces <= 75) return 3;
  if (totalSpaces <= 100) return 4;
  if (totalSpaces <= 150) return 5;
  if (totalSpaces <= 200) return 6;
  if (totalSpaces <= 300) return 7;
  if (totalSpaces <= 400) return 8;
  if (totalSpaces <= 500) return 9;
  if (totalSpaces <= 1000) return Math.ceil(totalSpaces * 0.02);
  return 20 + Math.ceil((totalSpaces - 1000) / 100);
}

// ── Extract IFC/ADA data from regulation fields ──────────────────────────────

export function getIFCInputFromRegulation(
  regulation: RegulationData | null,
  buildingHeight: number,
  numFloors: number,
  totalArea: number,
  occupantLoad: number,
  hasFireAccessRoad: boolean,
  fireAccessRoadWidth?: number,
): IFCComplianceInput {
  const safety = regulation?.safety_and_services || {};
  const accessibility = (regulation as any)?.accessibility || {};

  return {
    buildingHeight,
    numFloors,
    totalArea,
    occupantLoad,
    isSprinklered: !!(safety?.fire_fighting_systems?.value),
    hasFireAccessRoad,
    fireAccessRoadWidth: fireAccessRoadWidth || Number(safety?.fire_tender_access?.value) || undefined,
    hasStandpipe: !!(accessibility?.standpipe_required?.value),
    hasFireAlarm: !!(safety?.fire_fighting_systems?.value),
    hasFireCommandCenter: !!(safety?.fire_command_center?.value),
    hasRefugeFloors: !!(safety?.refuge_floors?.value),
    hasSmokePressurization: false, // Would need explicit field
    hasEmergencyPower: !!(safety?.backup_power_norms?.value),
    travelDistanceToExit: Number(safety?.fire_exits_travel_distance?.value) || undefined,
    regulation,
  };
}

export function getADAInputFromRegulation(
  regulation: RegulationData | null,
  numFloors: number,
  hasElevator: boolean,
  totalParkingSpaces: number,
): ADAComplianceInput {
  const accessibility = (regulation as any)?.accessibility || {};
  const facilities = regulation?.facilities || {};

  return {
    numFloors,
    hasElevator: hasElevator || !!(facilities?.lift_requirements?.value),
    accessibleRouteWidth: Number(accessibility?.accessible_route_width?.value) || undefined,
    doorClearanceWidth: Number(accessibility?.door_clearance_width?.value) || undefined,
    rampSlope: Number(accessibility?.ramp_max_slope?.value) || undefined,
    totalParkingSpaces,
    accessibleParkingSpaces: Number(accessibility?.accessible_parking_pct?.value) 
      ? Math.ceil(totalParkingSpaces * Number(accessibility.accessible_parking_pct.value) / 100) 
      : 0,
    hasAccessibleRestrooms: !!(accessibility?.accessible_restrooms?.value),
    hasBrailleSignage: !!(accessibility?.signage_compliance?.value),
    hasCommonAreaAccessibility: !!(accessibility?.common_area_accessible?.value),
  };
}

export default {
  evaluateIFCCompliance,
  evaluateADACompliance,
  getIFCInputFromRegulation,
  getADAInputFromRegulation,
  getRequiredAccessibleSpaces,
};
