import type {
  CensusData,
  FDIData,
  PopulationMigrationAnalysis,
  SatelliteChangeData,
  SEZData,
} from '@/lib/types';

interface ProposedInfrastructureSignal {
  available: boolean;
  count: number;
  source: string;
  snippets: string[];
}

interface PopulationMigrationInput {
  state: string;
  district?: string;
  censusRecords: CensusData[];
  satellite: SatelliteChangeData | null;
  fdi: FDIData[];
  sez: SEZData[];
  nearestOperationalSezDistanceMeters?: number | null;
  proposedInfrastructure?: ProposedInfrastructureSignal | null;
}

const SATELLITE_TOWN_KEYWORDS = [
  'noida',
  'greater noida',
  'gurugram',
  'gurgaon',
  'faridabad',
  'ghaziabad',
  'narela',
  'dwarka',
  'rohini',
  'sonipat',
  'bahadurgarh',
  'panipat',
];

const URBAN_CORE_KEYWORDS = [
  'new delhi',
  'delhi',
  'mumbai',
  'bangalore',
  'bengaluru',
  'hyderabad',
  'chennai',
  'kolkata',
  'pune',
];

function round(value: number, decimals = 1) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPopulation(value: number) {
  return Math.round(value).toLocaleString('en-IN');
}

function normalizeText(value: string | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferGrowthPattern(locationText: string, annualGrowthRate: number, hasIndustrialSignal: boolean) {
  if (SATELLITE_TOWN_KEYWORDS.some((keyword) => locationText.includes(keyword))) {
    return 'satellite-corridor' as const;
  }
  if (annualGrowthRate < 0 || locationText.includes('new delhi')) {
    return 'declining-pocket' as const;
  }
  if (hasIndustrialSignal) {
    return 'industrial-growth' as const;
  }
  if (URBAN_CORE_KEYWORDS.some((keyword) => locationText.includes(keyword))) {
    return 'urban-core' as const;
  }
  return 'steady-district' as const;
}

function labelGrowthPattern(growthPattern: PopulationMigrationAnalysis['growthPattern']) {
  switch (growthPattern) {
    case 'satellite-corridor':
      return 'satellite growth corridor';
    case 'urban-core':
      return 'mature urban core';
    case 'industrial-growth':
      return 'industrial / employment-led growth node';
    case 'declining-pocket':
      return 'mature or declining pocket';
    default:
      return 'steady district growth market';
  }
}

export const PopulationMigrationService = {
  analyze({
    state,
    district,
    censusRecords,
    satellite,
    fdi,
    sez,
    nearestOperationalSezDistanceMeters,
    proposedInfrastructure,
  }: PopulationMigrationInput): PopulationMigrationAnalysis | null {
    if (!censusRecords.length) return null;

    const census = censusRecords[0];
    const location = district || census.district || state;
    const locationText = normalizeText(`${location} ${state}`);
    const population2011 = census.totalPopulation;
    const decadalGrowthFraction = census.decadalGrowthRate / 100;
    const population2001Raw =
      decadalGrowthFraction <= -0.99
        ? population2011
        : population2011 / Math.max(0.01, 1 + decadalGrowthFraction);
    const population2001 = Math.max(1, Math.round(population2001Raw));
    const annualGrowthRate2001To2011 =
      population2001 > 0
        ? Math.pow(population2011 / population2001, 1 / 10) - 1
        : 0;

    const totalFdiUsdMillions = fdi.reduce((sum, record) => sum + record.amountUsdMillions, 0);
    const hasStrongFdiSignal = totalFdiUsdMillions >= 1500;
    const hasStrongSatelliteSignal =
      (satellite?.urbanGrowthIndex ?? 0) >= 80 || (satellite?.builtUpChange5yr ?? 0) >= 18;
    const hasProposedInfraSignal = (proposedInfrastructure?.count ?? 0) >= 2;
    const hasSezSignal =
      (nearestOperationalSezDistanceMeters != null && nearestOperationalSezDistanceMeters <= 30000) ||
      sez.some((entry) => entry.status === 'Operational');

    let projectionAdjustment = 0;
    if (hasStrongSatelliteSignal) projectionAdjustment += 0.0035;
    if (hasStrongFdiSignal) projectionAdjustment += 0.0025;
    if (hasProposedInfraSignal) projectionAdjustment += 0.002;
    if (hasSezSignal) projectionAdjustment += 0.0015;
    if (SATELLITE_TOWN_KEYWORDS.some((keyword) => locationText.includes(keyword))) projectionAdjustment += 0.002;
    if (census.urbanPopulationPct >= 98 && annualGrowthRate2001To2011 < 0.012) projectionAdjustment -= 0.002;
    if (census.decadalGrowthRate < 0) projectionAdjustment -= 0.006;

    const projectedAnnualGrowthRate2011To2025 = clamp(
      annualGrowthRate2001To2011 + projectionAdjustment,
      -0.02,
      0.06,
    );
    const projectedPopulation2025 = Math.max(
      0,
      Math.round(population2011 * Math.pow(1 + projectedAnnualGrowthRate2011To2025, 14)),
    );

    const density2011 = census.populationDensity;
    const projectedDensity2025 =
      population2011 > 0 ? round((density2011 * projectedPopulation2025) / population2011, 0) : density2011;
    const projectedUrbanPopulationPct2025 = clamp(
      census.urbanPopulationPct +
        (projectedAnnualGrowthRate2011To2025 > annualGrowthRate2001To2011 ? 4 : 2) +
        (hasStrongSatelliteSignal ? 2 : 0),
      census.urbanPopulationPct,
      100,
    );

    const growthPattern = inferGrowthPattern(locationText, annualGrowthRate2001To2011, hasStrongFdiSignal || hasSezSignal);
    const growthScore =
      projectedAnnualGrowthRate2011To2025 * 100 +
      (hasStrongSatelliteSignal ? 0.8 : 0) +
      (hasStrongFdiSignal ? 0.7 : 0) +
      (hasProposedInfraSignal ? 0.5 : 0);

    const migrationDirection: PopulationMigrationAnalysis['migrationDirection'] =
      growthScore >= 1.8
        ? 'inward'
        : growthScore <= 0.2 || projectedAnnualGrowthRate2011To2025 < 0
          ? 'outward'
          : 'balanced';

    const migrationIntensity: PopulationMigrationAnalysis['migrationIntensity'] =
      growthScore >= 2.8
        ? 'high'
        : growthScore >= 1.2
          ? 'moderate'
          : 'low';

    const drivers = [
      `Population estimated at ${formatPopulation(population2001)} in 2001 and ${formatPopulation(population2011)} in 2011.`,
      `${round(census.decadalGrowthRate, 1)}% decadal growth implies ${round(annualGrowthRate2001To2011 * 100, 2)}% annualized growth through 2011.`,
      `2025 projection reaches about ${formatPopulation(projectedPopulation2025)} using the 2001-2011 trend with market-signal adjustments.`,
    ];
    if (hasStrongSatelliteSignal && satellite) {
      drivers.push(
        `Satellite expansion is supportive: urban growth index ${satellite.urbanGrowthIndex}/100 and built-up change ${round(satellite.builtUpChange5yr, 1)}% over 5 years.`,
      );
    }
    if (hasStrongFdiSignal) {
      drivers.push(`FDI signals are strong at roughly USD ${Math.round(totalFdiUsdMillions).toLocaleString('en-IN')}M in the available state dataset.`);
    }
    if (hasProposedInfraSignal) {
      drivers.push(`${proposedInfrastructure?.count ?? 0} proposed infrastructure signals support future inward movement.`);
    }
    if (hasSezSignal) {
      drivers.push('Employment nodes and SEZ activity add to migration pull for nearby housing and mixed-use demand.');
    }

    const caveats = [
      '2001 population is back-calculated from the official 2011 base and decadal growth rate where direct 2001 tables are not stored in the app yet.',
      '2025 is a projection, not an official census figure, and should be treated as a directional demand signal.',
    ];
    if (!district) {
      caveats.push('The analysis is using the broadest matched geography available, so micro-market migration can differ materially.');
    }
    if (!satellite) {
      caveats.push('Satellite growth adjustments were unavailable for this run, so the projection leans more heavily on census growth.');
    }

    let confidence = 0.62;
    if (district && district.toLowerCase() !== state.toLowerCase()) confidence += 0.08;
    if (satellite) confidence += 0.1;
    if (hasStrongFdiSignal || hasSezSignal) confidence += 0.06;
    if (hasProposedInfraSignal) confidence += 0.05;
    confidence = clamp(confidence, 0.45, 0.9);

    const trendLabel =
      migrationDirection === 'inward'
        ? `${migrationIntensity} inward migration`
        : migrationDirection === 'outward'
          ? `${migrationIntensity} outward migration / stagnation`
          : `${migrationIntensity} balanced migration`;

    return {
      location,
      state: census.state || state,
      district: census.district || district || state,
      timeSeries: [
        { year: 2001, population: population2001, kind: 'estimated' },
        { year: 2011, population: population2011, kind: 'official' },
        { year: 2025, population: projectedPopulation2025, kind: 'projected' },
      ],
      population2001,
      population2011,
      projectedPopulation2025,
      populationDelta2001To2011: population2011 - population2001,
      populationDelta2011To2025: projectedPopulation2025 - population2011,
      decadalGrowth2001To2011: round(census.decadalGrowthRate, 1),
      annualGrowthRate2001To2011: round(annualGrowthRate2001To2011 * 100, 2),
      projectedAnnualGrowthRate2011To2025: round(projectedAnnualGrowthRate2011To2025 * 100, 2),
      density2011,
      projectedDensity2025,
      urbanPopulationPct2011: round(census.urbanPopulationPct, 1),
      projectedUrbanPopulationPct2025: round(projectedUrbanPopulationPct2025, 1),
      migrationDirection,
      migrationIntensity,
      growthPattern,
      confidence: round(confidence, 2),
      summary: `${location} reads as a ${labelGrowthPattern(growthPattern)} with ${trendLabel}.`,
      implications:
        migrationDirection === 'inward'
          ? 'This supports stronger future demand for residential, retail, and mixed-use absorption if pricing stays aligned with the target buyer segment.'
          : migrationDirection === 'outward'
            ? 'Demand may underperform unless the project is positioned around a very specific employment or affordability niche.'
            : 'Demand is likely to be steady rather than explosive, so execution quality and pricing discipline matter more than pure location momentum.',
      drivers,
      caveats,
      source: 'Census 2011 base + derived 2001 estimate + 2025 projection using satellite, infra, FDI, and SEZ signals',
    };
  },
};

export default PopulationMigrationService;
