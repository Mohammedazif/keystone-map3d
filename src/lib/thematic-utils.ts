import type { CountryCode, GeographyMarket } from "@/lib/types";
import {
  BHUVAN_THEMES,
  buildBhuvanLayerName,
  getBestBhuvanDistrict,
  getBhuvanWmsUrl,
  getIndianStateCode,
  isLayerAvailableInIndex,
  type BhuvanLayerInfo,
} from "@/lib/bhuvan-utils";

export type ThematicSourceType = "bhuvan" | "usgs-nlcd";

export interface ThematicContext {
  market?: GeographyMarket;
  countryCode?: CountryCode;
  stateCode?: string;
  districtNameHint?: string;
  plotLat?: number;
  plotLng?: number;
}

export interface ThematicLayerInfo {
  id: string;
  categoryId?: string;
  categoryName?: string;
  name: string;
  description: string;
  legend: { label: string; color: string }[];
  sourceType: ThematicSourceType;
  market: GeographyMarket;
  countryCode: CountryCode;
  fixedLayerName?: string;
  time?: string;
  usesDistrict?: boolean;
  wmsUrl?: string;
  wmsVersion?: string;
  layerNameBuilder?: (context: ThematicContext) => string;
}

export const NLCD_CLASS_LABEL_BY_CODE: Record<number, string> = {
  11: "Open Water",
  12: "Perennial Ice/Snow",
  21: "Developed, Open Space",
  22: "Developed, Low Intensity",
  23: "Developed, Medium Intensity",
  24: "Developed, High Intensity",
  31: "Barren Land",
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

const NLCD_LEGEND = [
  { label: "Open Water", color: "#466b9f" },
  { label: "Perennial Ice/Snow", color: "#d1def8" },
  { label: "Developed, Open Space", color: "#dec5c5" },
  { label: "Developed, Low Intensity", color: "#d99282" },
  { label: "Developed, Medium Intensity", color: "#eb0000" },
  { label: "Developed, High Intensity", color: "#ab0000" },
  { label: "Barren Land", color: "#b3ac9f" },
  { label: "Deciduous Forest", color: "#68ab5f" },
  { label: "Evergreen Forest", color: "#1c5f2c" },
  { label: "Mixed Forest", color: "#b5c58f" },
  { label: "Shrub/Scrub", color: "#ccb879" },
  { label: "Grasslands/Herbaceous", color: "#dfdfc2" },
  { label: "Pasture/Hay", color: "#d1d182" },
  { label: "Cultivated Crops", color: "#a3cc51" },
  { label: "Woody Wetlands", color: "#82ba9e" },
  { label: "Emergent Herbaceous Wetlands", color: "#dcd939" },
];

const USA_THEMATIC_THEMES: ThematicLayerInfo[] = [
  {
    id: "usgs_nlcd_2024",
    categoryId: "usgs_nlcd",
    categoryName: "USGS NLCD Annual Land Cover",
    name: "USGS NLCD Annual Land Cover : 2024",
    description:
      "30m annual land cover from the USGS MRLC NLCD service. Latest CONUS-wide release.",
    legend: NLCD_LEGEND,
    sourceType: "usgs-nlcd",
    market: "USA",
    countryCode: "US",
    fixedLayerName: "Land-Cover-Native_conus_year_data",
    time: "2024-01-01T00:00:00.000Z",
    wmsUrl:
      "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms",
    wmsVersion: "1.1.1",
  },
  {
    id: "usgs_nlcd_2019",
    categoryId: "usgs_nlcd",
    categoryName: "USGS NLCD Annual Land Cover",
    name: "USGS NLCD Annual Land Cover : 2019",
    description:
      "30m annual land cover from the USGS MRLC NLCD service. Useful for recent historical comparison.",
    legend: NLCD_LEGEND,
    sourceType: "usgs-nlcd",
    market: "USA",
    countryCode: "US",
    fixedLayerName: "Land-Cover-Native_conus_year_data",
    time: "2019-01-01T00:00:00.000Z",
    wmsUrl:
      "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms",
    wmsVersion: "1.1.1",
  },
  {
    id: "usgs_nlcd_2014",
    categoryId: "usgs_nlcd",
    categoryName: "USGS NLCD Annual Land Cover",
    name: "USGS NLCD Annual Land Cover : 2014",
    description:
      "30m annual land cover from the USGS MRLC NLCD service. Mid-period historical view.",
    legend: NLCD_LEGEND,
    sourceType: "usgs-nlcd",
    market: "USA",
    countryCode: "US",
    fixedLayerName: "Land-Cover-Native_conus_year_data",
    time: "2014-01-01T00:00:00.000Z",
    wmsUrl:
      "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms",
    wmsVersion: "1.1.1",
  },
];

function toThematicBhuvanTheme(theme: BhuvanLayerInfo): ThematicLayerInfo {
  return {
    id: theme.id,
    categoryId: theme.categoryId,
    categoryName: theme.categoryName,
    name: theme.name,
    description: theme.description,
    legend: theme.legend,
    sourceType: "bhuvan",
    market: "India",
    countryCode: "IN",
    usesDistrict: theme.usesDistrict,
    wmsUrl: getBhuvanWmsUrl(theme),
    wmsVersion: "1.1.1",
    layerNameBuilder: (context) =>
      buildBhuvanLayerName(
        theme.id,
        context.stateCode || "IN",
        context.districtNameHint,
        context.plotLat,
        context.plotLng,
      ),
  };
}

export const THEMATIC_THEMES: ThematicLayerInfo[] = [
  ...BHUVAN_THEMES.map(toThematicBhuvanTheme),
  ...USA_THEMATIC_THEMES,
];

export function inferThematicContextFromCoordinates(
  coordinates?: [number, number] | null,
): Pick<ThematicContext, "stateCode" | "plotLat" | "plotLng"> {
  if (!coordinates) {
    return { stateCode: "IN" };
  }

  const [plotLng, plotLat] = coordinates;
  return {
    stateCode: getIndianStateCode(plotLat, plotLng),
    plotLat,
    plotLng,
  };
}

export function getThematicThemesForMarket(
  market?: GeographyMarket,
  countryCode?: CountryCode,
) {
  const effectiveCountryCode =
    countryCode || (market === "USA" ? "US" : market === "India" ? "IN" : undefined);

  return THEMATIC_THEMES.filter((theme) => {
    if (effectiveCountryCode) return theme.countryCode === effectiveCountryCode;
    if (market) return theme.market === market;
    return theme.market === "India";
  });
}

export function getThematicThemeById(themeId: string | null | undefined) {
  if (!themeId) return null;
  return THEMATIC_THEMES.find((theme) => theme.id === themeId) || null;
}

export function buildThematicLayerName(
  theme: ThematicLayerInfo,
  context: ThematicContext,
) {
  if (theme.layerNameBuilder) {
    return theme.layerNameBuilder(context);
  }

  return theme.fixedLayerName || theme.id;
}

export function getThematicWmsUrl(theme: ThematicLayerInfo) {
  return theme.wmsUrl || "";
}

function getBhuvanIndexType(themeId: string): "amrut" | "nuis" | "sisdp" | undefined {
  if (themeId === "ulu_4k_amrut") return "amrut";
  if (themeId === "ulu_10k_nuis") return "nuis";
  if (themeId === "lulc_10k_sisdp") return "sisdp";
  return undefined;
}

export function checkThematicAvailability(theme: ThematicLayerInfo, context: ThematicContext) {
  if (theme.sourceType === "usgs-nlcd") {
    if (!context.plotLat || !context.plotLng) {
      return {
        status: "unknown" as const,
        message: "Set a plot location to check NLCD coverage.",
      };
    }

    const inConus =
      context.plotLat >= 24 &&
      context.plotLat <= 50 &&
      context.plotLng >= -125 &&
      context.plotLng <= -66;

    if (!inConus) {
      return {
        status: "unavailable" as const,
        message: "USGS NLCD coverage is limited to the CONUS service in this first pass.",
      };
    }

    return { status: "available" as const, message: null };
  }

  const stateCode = context.stateCode || "IN";
  if (stateCode === "IN" || stateCode === "") {
    return {
      status: "unknown" as const,
      message: "Set a plot location to check availability.",
    };
  }

  const indexType = getBhuvanIndexType(theme.id);
  if (indexType) {
    const district = getBestBhuvanDistrict(
      indexType,
      stateCode,
      context.districtNameHint,
    );
    if (district) {
      return { status: "available" as const, message: null };
    }
    return {
      status: "unavailable" as const,
      message: `${theme.categoryName || theme.name} is not available for ${stateCode} state.`,
    };
  }

  const layerName = buildThematicLayerName(theme, context);
  if (isLayerAvailableInIndex(layerName)) {
    return { status: "available" as const, message: null };
  }

  return {
    status: "unavailable" as const,
    message: `${theme.categoryName || theme.name} data not found for this region.`,
  };
}
