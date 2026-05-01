/**
 * US Score Data Service
 *
 * Provides developability score inputs for US locations as substitutes for
 * India-specific services (DataGov, SEZ, FDI, PopulationMigration).
 *
 * Maps US federal data to the same score item interfaces used by the India pipeline.
 */

import { USDataGovService } from './us-data-gov-service';

export interface USScoreInputs {
  /** GP2 substitute: economic health score 0-60 */
  economicHealthScore: number;
  economicHealthValue: { unemploymentRate: number; medianIncome: number; laborForce: number };

  /** GP4 substitute: population growth score 0-40 */
  populationGrowthScore: number;
  populationGrowthValue: { population: number; medianAge: number; growthTier: string };

  /** GP5 substitute: building permit activity score 0-40 */
  permitActivityScore: number;
  permitActivityValue: { totalUnits: number; singleFamily: number; multiFamily: number; valuation: number };

  /** ME2 substitute: market economic zone (enterprise zone / opportunity zone proxy) */
  marketZoneScore: number;
  marketZoneValue: { tier: string; permitGrowthIndicator: string };

  /** ME3 substitute: absorption / permit rate */
  absorptionScore: number;
  absorptionValue: number;

  /** ME4 substitute: demand density */
  demandDensityScore: number;
  demandDensityValue: { population: number; medianIncome: number; tier: string };

  /** city + state for display */
  resolvedCity: string;
  resolvedState: string;
}

/**
 * Detect if coordinates are within the contiguous United States.
 */
export function isUSCoordinates(lng: number, lat: number): boolean {
  return lat >= 24.5 && lat <= 49.5 && lng >= -125 && lng <= -66;
}

/**
 * Parse city/state from a Mapbox place_name like "Austin, Texas, United States"
 */
function parseCityState(location: string): { city: string; state: string } {
  const parts = location.split(',').map((p) => p.trim());
  const city = parts[0] || location;
  // Look for US state name or abbreviation
  const usStateIndex = parts.findIndex((p) =>
    /united states|usa|u\.s\.a/i.test(p)
  );
  const state = usStateIndex > 1 ? parts[usStateIndex - 1] : parts[1] || city;
  return { city, state };
}

/**
 * Fetch and score all US-specific developability inputs in one call.
 */
export async function getUSScoreInputs(location: string): Promise<USScoreInputs> {
  const { city, state } = parseCityState(location);
  const data = await USDataGovService.getAggregateData(location);

  const { demographics, economy, permits } = data;

  // ── GP2: Economic Health (substitute for FDI) ─────────────────────────────
  // Low unemployment + high income = strong economic signal
  const unemploymentRate = economy?.unemploymentRate ?? 4.5;
  const medianIncome = demographics?.medianIncome ?? 70000;
  const laborForce = economy?.laborForce ?? 300000;

  let economicHealthScore = 0;
  // Unemployment contribution (low = good)
  if (unemploymentRate < 3.0) economicHealthScore += 30;
  else if (unemploymentRate < 4.0) economicHealthScore += 24;
  else if (unemploymentRate < 5.5) economicHealthScore += 16;
  else economicHealthScore += 8;

  // Income contribution
  if (medianIncome > 100000) economicHealthScore += 30;
  else if (medianIncome > 80000) economicHealthScore += 24;
  else if (medianIncome > 60000) economicHealthScore += 16;
  else economicHealthScore += 8;

  economicHealthScore = Math.min(60, economicHealthScore);

  // ── GP4: Population Growth (substitute for Census 2011 migration) ──────────
  const population = demographics?.population ?? 500000;
  const medianAge = demographics?.medianAge ?? 35;

  // Population tiers for US cities
  let populationGrowthScore = 0;
  let growthTier = 'Emerging Market';
  if (population > 1_000_000) { populationGrowthScore = 38; growthTier = 'Major Metro'; }
  else if (population > 500_000) { populationGrowthScore = 32; growthTier = 'Large City'; }
  else if (population > 200_000) { populationGrowthScore = 26; growthTier = 'Mid-size City'; }
  else if (population > 100_000) { populationGrowthScore = 20; growthTier = 'Growing Market'; }
  else { populationGrowthScore = 14; growthTier = 'Emerging Market'; }

  // Younger median age = more demand for housing
  if (medianAge < 33) populationGrowthScore += 2;

  populationGrowthScore = Math.min(40, populationGrowthScore);

  // ── GP5: Permit Activity (substitute for MoSPI proposed infra) ────────────
  const totalUnits = permits?.totalUnits ?? 0;
  const singleFamily = permits?.singleFamily ?? 0;
  const multiFamily = permits?.multiFamily ?? 0;
  const valuation = permits?.valuation ?? 0;

  let permitActivityScore = 0;
  if (totalUnits > 25_000) permitActivityScore = 40;
  else if (totalUnits > 15_000) permitActivityScore = 32;
  else if (totalUnits > 8_000) permitActivityScore = 24;
  else if (totalUnits > 3_000) permitActivityScore = 16;
  else permitActivityScore = 8;

  // ── ME2: Market Zone (substitute for SEZ distance) ────────────────────────
  // High permit activity + strong economy = good market zone
  const combinedSignal = economicHealthScore + permitActivityScore;
  let marketZoneScore = 0;
  let permitGrowthIndicator = 'Low Activity';
  if (combinedSignal > 70) { marketZoneScore = 40; permitGrowthIndicator = 'High Growth Market'; }
  else if (combinedSignal > 50) { marketZoneScore = 30; permitGrowthIndicator = 'Active Market'; }
  else if (combinedSignal > 35) { marketZoneScore = 20; permitGrowthIndicator = 'Moderate Market'; }
  else { marketZoneScore = 10; permitGrowthIndicator = 'Low Activity'; }

  const marketZoneTier = combinedSignal > 70 ? 'Tier 1' : combinedSignal > 50 ? 'Tier 2' : 'Tier 3';

  // ── ME3: Absorption Rate (building permits as proxy) ─────────────────────
  // Convert annual permit units to a per-1000-population rate
  const absorptionRate = population > 0 ? (totalUnits / population) * 1000 : 0;
  let absorptionScore = 0;
  if (absorptionRate > 20) absorptionScore = 50;
  else if (absorptionRate > 12) absorptionScore = 38;
  else if (absorptionRate > 6) absorptionScore = 26;
  else absorptionScore = 14;

  // ── ME4: Demand Density ──────────────────────────────────────────────────
  let demandDensityScore = 0;
  let demandTier = 'Emerging';
  if (population > 1_000_000 && medianIncome > 80_000) { demandDensityScore = 50; demandTier = 'Prime'; }
  else if (population > 500_000 && medianIncome > 70_000) { demandDensityScore = 42; demandTier = 'Strong'; }
  else if (population > 200_000 && medianIncome > 60_000) { demandDensityScore = 32; demandTier = 'Moderate'; }
  else if (population > 100_000) { demandDensityScore = 22; demandTier = 'Developing'; }
  else { demandDensityScore = 12; demandTier = 'Emerging'; }

  return {
    economicHealthScore,
    economicHealthValue: { unemploymentRate, medianIncome, laborForce },

    populationGrowthScore,
    populationGrowthValue: { population, medianAge, growthTier },

    permitActivityScore,
    permitActivityValue: { totalUnits, singleFamily, multiFamily, valuation },

    marketZoneScore,
    marketZoneValue: { tier: marketZoneTier, permitGrowthIndicator },

    absorptionScore,
    absorptionValue: Math.round(absorptionRate * 10) / 10,

    demandDensityScore,
    demandDensityValue: { population, medianIncome, tier: demandTier },

    resolvedCity: city,
    resolvedState: state,
  };
}
