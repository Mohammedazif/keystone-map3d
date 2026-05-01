import type { LandUseSummary } from "@/lib/land-intelligence/land-use";

const USGS_NLCD_WMS_URL =
  "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms";
const USGS_NLCD_LAYER = "Land-Cover-Native_conus_year_data";
const USGS_NLCD_SUPPORTED_YEARS = Array.from(
  { length: 2024 - 1985 + 1 },
  (_, index) => 1985 + index,
);

const GRS80_A = 6378137;
const GRS80_F = 1 / 298.257222101;
const GRS80_E2 = 2 * GRS80_F - GRS80_F * GRS80_F;
const GRS80_E = Math.sqrt(GRS80_E2);
const STANDARD_PARALLEL_1 = toRadians(29.5);
const STANDARD_PARALLEL_2 = toRadians(45.5);
const LATITUDE_OF_ORIGIN = toRadians(23);
const CENTRAL_MERIDIAN = toRadians(-96);

const M1 = computeM(STANDARD_PARALLEL_1);
const M2 = computeM(STANDARD_PARALLEL_2);
const Q1 = computeQ(STANDARD_PARALLEL_1);
const Q2 = computeQ(STANDARD_PARALLEL_2);
const Q0 = computeQ(LATITUDE_OF_ORIGIN);
const N = (M1 * M1 - M2 * M2) / (Q2 - Q1);
const C = M1 * M1 + N * Q1;
const RHO0 = computeRho(Q0);

const NLCD_CLASS_BY_CODE: Record<number, string> = {
  0: "No Data",
  11: "Open Water",
  12: "Perennial Ice/Snow",
  21: "Developed, Open Space",
  22: "Developed, Low Intensity",
  23: "Developed, Medium Intensity",
  24: "Developed, High Intensity",
  31: "Barren Land (Rock/Sand/Clay)",
  41: "Deciduous Forest",
  42: "Evergreen Forest",
  43: "Mixed Forest",
  52: "Shrub/Scrub",
  71: "Grasslands/Herbaceous",
  81: "Pasture/Hay",
  82: "Cultivated Crops",
  90: "Woody Wetlands",
  95: "Emergent Herbaceous Wetlands",
};

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function computeM(phi: number) {
  return Math.cos(phi) / Math.sqrt(1 - GRS80_E2 * Math.sin(phi) ** 2);
}

function computeQ(phi: number) {
  const sinPhi = Math.sin(phi);
  return (
    (1 - GRS80_E2) *
    ((sinPhi / (1 - GRS80_E2 * sinPhi * sinPhi)) -
      Math.log((1 - GRS80_E * sinPhi) / (1 + GRS80_E * sinPhi)) /
        (2 * GRS80_E))
  );
}

function computeRho(q: number) {
  return (GRS80_A * Math.sqrt(C - N * q)) / N;
}

function projectLonLatToEpsg5070(lng: number, lat: number) {
  const phi = toRadians(lat);
  const lambda = toRadians(lng);
  const theta = N * (lambda - CENTRAL_MERIDIAN);
  const rho = computeRho(computeQ(phi));

  return {
    x: rho * Math.sin(theta),
    y: RHO0 - rho * Math.cos(theta),
  };
}

function getLatestSupportedYear(requestedYear?: number) {
  if (!requestedYear) {
    return USGS_NLCD_SUPPORTED_YEARS[USGS_NLCD_SUPPORTED_YEARS.length - 1];
  }

  if (USGS_NLCD_SUPPORTED_YEARS.includes(requestedYear)) {
    return requestedYear;
  }

  return USGS_NLCD_SUPPORTED_YEARS.reduce((closest, year) => {
    return Math.abs(year - requestedYear) < Math.abs(closest - requestedYear)
      ? year
      : closest;
  }, USGS_NLCD_SUPPORTED_YEARS[0]);
}

async function queryNlcdClassAtPoint(
  coordinates: [number, number],
  year: number,
): Promise<number | null> {
  const [lng, lat] = coordinates;
  const { x, y } = projectLonLatToEpsg5070(lng, lat);
  const halfWindowMeters = 30;
  const bbox = [
    x - halfWindowMeters,
    y - halfWindowMeters,
    x + halfWindowMeters,
    y + halfWindowMeters,
  ].join(",");

  const params = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetFeatureInfo",
    LAYERS: USGS_NLCD_LAYER,
    QUERY_LAYERS: USGS_NLCD_LAYER,
    STYLES: "",
    SRS: "EPSG:5070",
    BBOX: bbox,
    WIDTH: "101",
    HEIGHT: "101",
    X: "50",
    Y: "50",
    INFO_FORMAT: "application/json",
    TIME: `${year}-01-01T00:00:00.000Z`,
  });

  const response = await fetch(`${USGS_NLCD_WMS_URL}?${params.toString()}`, {
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(`USGS NLCD request failed with ${response.status}`);
  }

  const payload = (await response.json()) as {
    features?: Array<{
      properties?: {
        PALETTE_INDEX?: number | string;
      };
    }>;
  };

  const rawCode = payload.features?.[0]?.properties?.PALETTE_INDEX;
  const numericCode = Number(rawCode);
  return Number.isFinite(numericCode) ? numericCode : null;
}

function formatChangeSummary(
  previousType: string | null,
  previousYear: number,
  latestType: string | null,
  latestYear: number,
) {
  if (!previousType || !latestType || previousType === latestType) {
    return undefined;
  }

  return `Changed from "${previousType}" (${previousYear}) to "${latestType}" (${latestYear})`;
}

export const UsgsNlcdService = {
  async getLandUse(
    coordinates: [number, number],
    location: string = "",
    year?: number,
  ): Promise<LandUseSummary> {
    const latestYear = getLatestSupportedYear(year);
    const previousYear = getLatestSupportedYear(Math.max(1985, latestYear - 5));
    const yearsToQuery = Array.from(new Set([latestYear, previousYear]));

    const queriedLayers = await Promise.all(
      yearsToQuery.map(async (snapshotYear) => {
        const code = await queryNlcdClassAtPoint(coordinates, snapshotYear);
        return {
          year: snapshotYear,
          code,
          label:
            code != null
              ? NLCD_CLASS_BY_CODE[code] || `Unknown NLCD Class (${code})`
              : "Unavailable",
        };
      }),
    );

    const latestSnapshot =
      queriedLayers.find((layer) => layer.year === latestYear) || queriedLayers[0];
    const previousSnapshot =
      queriedLayers.find((layer) => layer.year === previousYear) || null;

    return {
      primaryLandUse: latestSnapshot?.label || "Unknown",
      historicLandUseChange: previousSnapshot
        ? formatChangeSummary(
            previousSnapshot.label,
            previousSnapshot.year,
            latestSnapshot?.label || null,
            latestSnapshot?.year || latestYear,
          )
        : undefined,
      countryCode: "US",
      market: "USA",
      stateCode: "CONUS",
      source: "USGS MRLC Annual NLCD (WMS GetFeatureInfo)",
      sourceLabel: "USGS NLCD",
      latestYear,
      layers: queriedLayers.map((layer) => ({
        layerLabel: `Annual NLCD Land Cover (${layer.year})`,
        landUseType: layer.label,
        landUseCode: layer.code != null ? String(layer.code) : undefined,
        year: layer.year,
      })),
    };
  },
};

export default UsgsNlcdService;
