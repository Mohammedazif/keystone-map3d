
import type { Feature, Polygon, Point } from 'geojson';
import { z } from 'zod';

export interface SoilData {
  ph: number | null | undefined;
  bd: number | null | undefined; // bulk density
}

export enum BuildingIntendedUse {
  Residential = 'Residential',
  Commercial = 'Commercial',
  MixedUse = 'Mixed-Use',
  Industrial = 'Industrial',
  Public = 'Public',
  Utility = 'Utility',
}


export interface Core {
  id: string;
  type: 'Lift' | 'Stair' | 'Service' | 'Lobby';
  geometry: Feature<Polygon>;
}

export interface Unit {
  id: string;
  type: string; // e.g. "2BHK", "Studio"
  geometry: Feature<Polygon>;
  color?: string; // e.g. "#ADD8E6"
}

export interface Floor {
  id: string;
  height: number;
  color: string;
  type?: 'General' | 'Utility' | 'Parking';
  utilityType?: UtilityType;
  parkingType?: ParkingType;
  parkingCapacity?: number;
  level?: number;  // For basement: -1 = B1, -2 = B2, etc.
}

export interface Building {
  id: string;
  name: string;
  isPolygonClosed: boolean;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  height: number;
  opacity: number;
  extrusion: boolean;
  soilData: SoilData | null;
  intendedUse: BuildingIntendedUse;
  floors: Floor[];
  // Internal Layout
  cores?: Core[];
  units?: Unit[];
  entrances?: EntryPoint[];
  area: number;
  numFloors: number;
  typicalFloorHeight: number;
  visible: boolean;
  baseHeight?: number;
  utilities?: UtilityType[]; // Utilities contained within this building
}

export interface GreenArea {
  id: string;
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  visible: boolean;
}

export interface BuildableArea {
  id: string;
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  visible: boolean;
  intendedUse: BuildingIntendedUse;
}

export interface ParkingArea {
  id: string;
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  visible: boolean;
  type?: ParkingType;                                    // Type of parking
  capacity?: number;                                     // Number of parking spaces
  spaceSize?: number;                                    // Area per space (m²)
  efficiency?: number;                                   // Usable area ratio (0-1)
  level?: number;                                        // For basement: -1 = B1, -2 = B2, etc.
}

export enum ParkingType {
  Surface = 'Surface',
  Basement = 'Basement',
  Stilt = 'Stilt',
  Podium = 'Podium',
}

export enum UtilityType {
  STP = 'STP',
  WTP = 'WTP',
  HVAC = 'HVAC',
  Electrical = 'Electrical',
  Water = 'Water',
  Fire = 'Fire',
  Gas = 'Gas',
  Roads = 'Roads',
}

export interface UtilityArea {
  id: string;
  name: string;
  type: UtilityType;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  visible: boolean;
}

export interface Label {
  id: string;
  text: string;
  position: [number, number];
}

export interface EntryPoint {
  id: string;
  type: 'Entry' | 'Exit' | 'Both';
  position: [number, number]; // [lng, lat]
  name?: string;
}

export interface Plot {
  id: string;
  name: string;
  geometry: Feature<Polygon>;
  centroid: Feature<Point>;
  area: number;
  setback: number; // Default inner setback
  buildings: Building[];
  greenAreas: GreenArea[];
  parkingAreas: ParkingArea[];
  buildableAreas: BuildableArea[];
  utilityAreas: UtilityArea[];
  entries: EntryPoint[];
  labels: Label[];
  visible: boolean;
  location: string | null;
  availableRegulations: RegulationData[] | null;
  selectedRegulationType: string | null;
  regulation: RegulationData | null;
  // Regulation-derived constraints
  maxBuildingHeight?: number; // Maximum building height in meters (from regulations)
  far?: number; // Floor Area Ratio (from regulations)
  maxCoverage?: number; // Maximum ground coverage percentage (from regulations)
  developmentStats?: DevelopmentStats;
  roadAccessSides?: string[]; // Detected road directions (N, S, E, W)
}


export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Project {
  id: string;
  userId: string;
  name: string;
  plots: Plot[];
  lastModified: string;
  totalPlotArea?: number | null;
  designOptions?: string | DesignOption[]; // JSON string for Firestore storage, or parsed object in app
  intendedUse?: 'Residential' | 'Commercial' | 'Mixed Use' | 'Public' | 'Industrial';
  location?: string | { lat: number; lng: number }; // e.g. "Delhi", "Maharashtra" or geocoded coordinates
  regulationId?: string; // Specific regulation document ID (e.g. "Delhi-Residential Group Housing")
  greenCertification?: ('IGBC' | 'GRIHA' | 'LEED' | 'Green Building')[];
  vastuCompliant?: boolean;
  feasibilityParams?: FeasibilityParams;
}

export interface UnitTypology {
  name: string; // e.g., '2BHK', '3BHK', '4BHK'
  area: number; // sqm
  mixRatio: number; // 0-1 (percentage of total units)
}

export interface FeasibilityParams {
  coreFactor: number; // 0.15 - 0.25 (15-25%)
  circulationFactor: number; // 0.10 - 0.15 (10-15%)
  unitMix: UnitTypology[];
  efficiencyTarget: number; // e.g., 0.70
}

export interface DevelopmentStats {
  totalBuiltUpArea: number; // Max based on FAR
  maxBuildableArea: number; // based on geometry/coverage
  achievedFAR: number;
  efficiency: number; // Net Saleable / Total Built-up
  areas: {
    core: number;
    circulation: number;
    saleable: number;
    services: number;
  };
  units: {
    total: number;
    breakdown: Record<string, number>; // "2BHK": 10
  };
  vastuScore?: {
    overall: number;
    rating: 'High' | 'Medium' | 'Low';
    breakdown: { category: string; score: number; feedback: string }[];
  };
  greenAnalysis?: {
    overall: number;
    rating: 'Excellent' | 'Good' | 'Fair' | 'Poor';
    breakdown: { category: string; score: number; feedback: string }[];
  };
}

export interface GreenRegulationData {
  id?: string;
  name: string; // e.g., "IGBC Green Homes v3.0"
  certificationType: 'IGBC' | 'GRIHA' | 'LEED' | 'Green Building';
  // Legacy constraints for backward compatibility & easy access
  constraints: {
    minOpenSpace?: number; // 0.30 for 30%
    maxGroundCoverage?: number;
    minGreenCover?: number;
  };
  // Comprehensive data structure
  categories?: CertificationCategory[];
  confidence?: number;
  lastModified?: number;
}

export interface CertificationCategory {
  name: string; // e.g. "Sustainable Design"
  credits: CertificationCredit[];
}

export interface CertificationCredit {
  code?: string; // e.g. "SD Credit 1"
  name: string; // e.g. "Natural Topography & Vegetation"
  points?: number;
  type?: 'mandatory' | 'credit' | 'prerequisite';
  requirements?: string[]; // Extracted text requirements
  intent?: string;
}

export interface VastuRegulationData {
  id?: string;
  name: string; // e.g. "Standard Vastu Guidelines"
  source?: string; // e.g. "Vastu Shastra PDF"
  recommendations: VastuRecommendation[];
  complianceScore?: number;
  lastModified?: number;
}

export interface VastuRecommendation {
  category: 'Entrance' | 'Kitchen' | 'MasterBedroom' | 'Water' | 'Living' | 'General';
  idealDirections: string[]; // e.g. ["NE", "E"]
  avoidDirections: string[]; // e.g. ["SW"]
  description?: string;
  weight?: number; // Importance (1-10)
}

// 32-Zone Shakti Chakra Directions
export const VASTU_ZONES_32 = [
  'N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8',
  'E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8',
  'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8',
  'W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'
] as const;
export type VastuZone32 = typeof VASTU_ZONES_32[number];

export interface AdvancedKPIs {
  // 1. Area Metrics
  totalPlotArea: number;
  totalBuiltUpArea: number;
  achievedFAR: number;
  groundCoveragePct: number;

  // 2. Specialized Areas
  sellableArea: number;
  circulationArea: number;
  coreArea: number;

  // 3. Service & Amenity Breakdown
  services: {
    total: number;
    electrical: number;
    mech: number;
    plumbing: number;
  };
  amenities: {
    total: number;
    definedList: Record<string, number>; // e.g. "Gym": 100
  };

  // 4. External Areas
  greenArea: {
    total: number;
    percentage: number;
    perCapita: number; // Green area per person
  };
  roadArea: number;
  openSpace: number; // Vacant + Green - Roads

  // 5. Efficiency
  efficiency: number; // Net / Gross

  // 6. Housing
  totalUnits: number;
  parking: {
    required: number;
    provided: number;
    breakdown: { stilt: number; basement: number; surface: number; podium: number; }
  };

  // 7. Compliance Scores (0-100)
  compliance: {
    bylaws: number;
    green: number;
    vastu: number;
  };
}


export type LandUseType = 'residential' | 'commercial' | 'mixed' | 'institutional';

// AI Generation Payloads
export const AiGeneratedObjectSchema = z.object({
  name: z.string().describe('The name of the object (e.g., "Residential Tower A", "Main Park").'),
  type: z.enum(['Building', 'GreenArea', 'ParkingArea', 'UtilityArea']).describe('The type of the object.'),
  utilityType: z.nativeEnum(UtilityType).optional().describe('Specific type if this is a UtilityArea.'),
  placement: z.string().describe("A simple description of where to place this object within the plot (e.g., 'north side', 'center', 'south-west corner')."),
  intendedUse: z.nativeEnum(BuildingIntendedUse).optional().describe('The intended use of the building.'),
  numFloors: z.number().optional().describe('The number of floors for the building.'),
  massing: z.enum(['Simple', 'PodiumTower']).optional().describe('The massing strategy for the building. Use "PodiumTower" for tall buildings to create a more realistic look.'),
}).describe('A single object within the plot, like a building or a park.');
export type AiGeneratedObject = z.infer<typeof AiGeneratedObjectSchema>;

export const AiScenarioSchema = z.object({
  name: z.string().describe("A short, catchy name for this scenario (e.g., 'Balanced Urbanism', 'Green-First Approach')."),
  description: z.string().describe("A brief (1-2 sentence) description of this scenario's overall design philosophy."),
  objects: z.array(AiGeneratedObjectSchema).describe('An array of planned objects (buildings, green areas, etc.) for this specific scenario.'),
});
export type AiScenario = z.infer<typeof AiScenarioSchema>;


export const GenerateSiteLayoutInputSchema = z.object({
  plotGeometry: z.string().describe('A JSON string of the GeoJSON Feature<Polygon> for the parent plot. This is for context only.'),
  userDefinedAreas: z.string().describe('A JSON string of an array of user-defined areas within the plot. Each area has a geometry and an intendedUse (e.g., Residential, GreenArea). The AI should respect these zones.'),
  prompt: z.string().describe("The user's text prompt describing the desired layout, which can be used to refine the plan for the user-defined areas."),
  regulations: z.string().describe('A JSON string of the applicable development regulations for this plot\'s location. The AI MUST adhere to these rules.'),
});
export type GenerateSiteLayoutInput = z.infer<typeof GenerateSiteLayoutInputSchema>;

export const GenerateSiteLayoutOutputSchema = z.object({
  scenarios: z.array(AiScenarioSchema).min(2).max(2).describe('An array containing exactly two distinct layout scenarios for the user to choose from.'),
});
export type AiSiteLayout = z.infer<typeof GenerateSiteLayoutOutputSchema>;
export type GenerateSiteLayoutOutput = z.infer<typeof GenerateSiteLayoutOutputSchema>;


export const AiMassingGeneratedObjectSchema = z.object({
  name: z.string().describe('The name of the object (e.g., "Residential Tower A", "Main Park").'),
  type: z.enum(['Building']).describe('The type of the object.'),
  placement: z.string().describe("This should be the name of the user-defined zone it belongs to."),
  intendedUse: z.nativeEnum(BuildingIntendedUse).optional().describe('The intended use of the building.'),
  numFloors: z.number().optional().describe('The number of floors for the building.'),
  massing: z.enum(['Simple', 'PodiumTower']).optional().describe('The massing strategy for the building.'),
}).describe('A single building to be placed within the buildable area.');
export type AiMassingGeneratedObject = z.infer<typeof AiMassingGeneratedObjectSchema>;

export const AiMassingScenarioSchema = z.object({
  name: z.string().describe("A short, catchy name for this massing option (e.g., 'Maximum FAR Tower', 'Twin Towers', 'Courtyard Block')."),
  description: z.string().describe("A brief (1-2 sentence) description of this massing option's design philosophy."),
  objects: z.array(AiMassingGeneratedObjectSchema).describe('An array of planned buildings for this specific scenario.'),
});
export type AiMassingScenario = z.infer<typeof AiMassingScenarioSchema>;

export const GenerateMassingInputSchema = z.object({
  plot: z.string().describe('A JSON string of the plot. It has a geometry, name, and area. The AI should place new buildings inside this area, respecting the setback.'),
  regulations: z.string().describe('A JSON string of the applicable development regulations for this plot\'s location. The AI MUST adhere to these rules.'),
});
export type GenerateMassingInput = z.infer<typeof GenerateMassingInputSchema>;

export const GenerateMassingOutputSchema = z.object({
  scenarios: z.array(AiMassingScenarioSchema).min(2).max(2).describe('An array containing exactly two distinct massing scenarios for the user to choose from.'),
});
export type GenerateMassingOutput = z.infer<typeof GenerateMassingOutputSchema>;


export const AiZoneSchema = z.object({
  name: z.string().describe("A descriptive name for the zone (e.g., 'Residential Block A', 'Community Park', 'Visitor Parking', 'STP Zone')."),
  type: z.enum(['BuildableArea', 'GreenArea', 'ParkingArea', 'UtilityArea']).describe("The classification of the zone."),
  utilityType: z.nativeEnum(UtilityType).optional().describe("Required if type is 'UtilityArea'."),
  intendedUse: z.nativeEnum(BuildingIntendedUse).optional().describe("If the zone is a 'BuildableArea', what is its primary purpose?"),
});
export type AiZone = z.infer<typeof AiZoneSchema>;

export const GenerateZonesInputSchema = z.object({
  plotGeometry: z.string().describe("A JSON string of the plot's GeoJSON geometry."),
  prompt: z.string().describe("The user's prompt describing the desired zones and layout."),
  regulations: z.string().describe("A JSON string of applicable development regulations."),
});
export type GenerateZonesInput = z.infer<typeof GenerateZonesInputSchema>;

export const GenerateZonesOutputSchema = z.object({
  zones: z.array(AiZoneSchema).describe("An array of generated zones that subdivide the plot."),
});
export type GenerateZonesOutput = z.infer<typeof GenerateZonesOutputSchema>;


export type DrawingObjectType = 'Plot' | 'Zone' | 'Building' | 'Road';

export type SelectableObjectType = 'Plot' | 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'UtilityArea' | 'Label';


// Admin Panel Types
export interface RegulationValue {
  desc: string;
  unit: string;
  value: number | any;
  min?: number | any;
  max?: number | any;
}

export interface RegulationData {
  id?: string;
  location: string;
  type: string;
  geometry: { [key: string]: RegulationValue };
  facilities: { [key: string]: RegulationValue };
  sustainability: { [key: string]: RegulationValue };
  safety_and_services: { [key: string]: RegulationValue };
  administration: { [key: string]: RegulationValue };
}

export interface DesignOption {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  data: {
    plots: Plot[];
    generationParams: any;
  };
}

// Unit Type Template for Admin Configuration
export interface UnitTemplate {
  id: string;
  name: string; // "Luxury 3BHK", "Compact 2BHK"
  bhk_type: '1BHK' | '2BHK' | '3BHK' | '4BHK' | '5BHK';
  location?: string; // Optional: "Delhi", "Mumbai", or undefined for generic/all locations
  carpet_area_sqm: number; // Net usable area
  builtup_area_sqm: number; // Including walls, balconies
  balcony_area_sqm: number;
  efficiency_ratio: number; // carpet / builtup (0.60 - 0.80)
  min_width_m: number; // Minimum unit width
  min_depth_m: number; // Minimum unit depth
  description?: string;
  created_at: string;
  updated_at: string;
}

// Cost & Revenue Parameters for Admin Configuration
export interface CostRevenueParameters {
  id: string;
  location: string; // "Delhi", "Mumbai", etc.
  building_type: 'Residential' | 'Commercial' | 'Mixed Use' | 'Industrial' | 'Public';

  // Cost Parameters (per sqm in local currency)
  earthwork_cost_per_sqm: number;
  structure_cost_per_sqm: number;
  finishing_cost_per_sqm: number;
  services_cost_per_sqm: number; // MEP
  total_cost_per_sqm: number; // Calculated field

  // Revenue Parameters
  market_rate_per_sqm: number; // Selling price per sqm
  sellable_ratio: number; // 0.70 - 0.85 (carpet/builtup)

  // Metadata
  currency: string; // "INR", "USD"
  last_updated: string;
  notes?: string;
}

// Time Estimation Parameter for Admin Configuration
export interface TimeEstimationParameter {
  id: string;
  building_type: 'Residential' | 'Commercial' | 'Mixed Use' | 'Industrial' | 'Public';
  height_category: 'Low-Rise (<15m)' | 'Mid-Rise (15-45m)' | 'High-Rise (>45m)';

  // Durations (in months unless specified)
  excavation_timeline_months: number;
  foundation_timeline_months: number;
  structure_per_floor_days: number;
  finishing_per_floor_days: number;
  services_overlap_factor: number; // 0.0 - 1.0 (overlap with structure)
  contingency_buffer_months: number;

  last_updated: string;
}

// Planning Parameter for Admin Configuration
export interface PlanningParameter {
  id: string;
  category_name: string; // e.g., "Grade A Office", "Luxury Residential"
  building_type: 'Residential' | 'Commercial' | 'Mixed Use' | 'Industrial' | 'Public';
  height_category: 'Low-Rise (<15m)' | 'Mid-Rise (15-45m)' | 'High-Rise (>45m)';

  // Efficiency Targets
  core_to_gfa_ratio_min: number;
  core_to_gfa_ratio_max: number;
  circulation_to_gfa_ratio: number;
  efficiency_target: number; // Usage / GFA

  // Vertical Transport
  passenger_lifts_per_unit?: number; // Residential: lifts per unit
  passenger_lifts_per_sqm?: number; // Commercial: lifts per 1000sqm
  service_lifts_per_tower: number;

  description?: string;
  last_updated: string;
}

export interface ProjectEstimates {
  isPotential?: boolean;
  total_construction_cost: number;
  cost_breakdown: {
    earthwork: number;
    structure: number;
    finishing: number;
    services: number;
    contingency: number;
  };

  total_revenue: number;
  potential_profit: number;
  roi_percentage: number;

  timeline: {
    total_months: number;
    phases: {
      excavation: number;
      foundation: number;
      structure: number;
      finishing: number;
    }
  };

  efficiency_metrics: {
    achieved: number; // calculated from design
    target: number; // from planning params
    status: 'Optimal' | 'Inefficient' | 'Aggressive';
  };
}
