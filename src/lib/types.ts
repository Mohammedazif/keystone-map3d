
import type { Feature, Polygon, Point } from '@turf/turf';
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
}


export interface Floor {
  id: string;
  height: number;
  color: string;
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
  area: number;
  numFloors: number;
  typicalFloorHeight: number;
  visible: boolean;
  baseHeight?: number;
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
}

export interface Label {
  id: string;
  text: string;
  position: [number, number];
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
  labels: Label[];
  visible: boolean;
  location: string | null;
  availableRegulations: RegulationData[] | null;
  selectedRegulationType: string | null;
  regulation: RegulationData | null;
}


export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface Project {
  id: string;
  name: string;
  plots: Plot[];
  lastModified: string;
  totalPlotArea?: number | null;
}

// AI Generation Payloads
export const AiGeneratedObjectSchema = z.object({
  name: z.string().describe('The name of the object (e.g., "Residential Tower A", "Main Park").'),
  type: z.enum(['Building', 'GreenArea', 'ParkingArea']).describe('The type of the object.'),
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
  name: z.string().describe("A descriptive name for the zone (e.g., 'Residential Block A', 'Community Park', 'Visitor Parking')."),
  type: z.enum(['BuildableArea', 'GreenArea', 'ParkingArea']).describe("The classification of the zone."),
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


export type DrawingObjectType = 'Plot' | 'Zone' | 'Building';

export type SelectableObjectType = 'Plot' | 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'Label';


// Admin Panel Types
export interface RegulationValue {
  desc: string;
  unit: string;
  value: number | any;
  min?: number | any;
  max?: number | any;
}

export interface RegulationData {
  location: string;
  type: string;
  geometry: { [key: string]: RegulationValue };
  facilities: { [key: string]: RegulationValue };
  sustainability: { [key: string]: RegulationValue };
  safety_and_services: { [key: string]: RegulationValue };
  administration: { [key: string]: RegulationValue };
}
