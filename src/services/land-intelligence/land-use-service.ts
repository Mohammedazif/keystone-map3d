import { inferRegulationGeography } from "@/lib/geography";
import type { CountryCode, GeographyMarket } from "@/lib/types";
import type { LandUseSummary } from "@/lib/land-intelligence/land-use";
import { BhuvanLandUseService } from "@/services/land-intelligence/bhuvan-landuse-service";
import { UsgsNlcdService } from "@/services/land-intelligence/usgs-nlcd-service";

function resolveGeography({
  market,
  countryCode,
  location,
}: {
  market?: GeographyMarket;
  countryCode?: CountryCode;
  location?: string;
}) {
  if (market || countryCode) {
    return { market, countryCode };
  }

  const inferred = inferRegulationGeography(location || "");
  return {
    market: inferred.market,
    countryCode: inferred.countryCode,
  };
}

export const LandUseService = {
  async getLandUse({
    coordinates,
    location = "",
    market,
    countryCode,
    year,
  }: {
    coordinates: [number, number];
    location?: string;
    market?: GeographyMarket;
    countryCode?: CountryCode;
    year?: number;
  }): Promise<LandUseSummary> {
    const geography = resolveGeography({ market, countryCode, location });

    if (geography.market === "USA" || geography.countryCode === "US") {
      return UsgsNlcdService.getLandUse(coordinates, location, year);
    }

    if (
      (geography.market && geography.market !== "India") ||
      (geography.countryCode && geography.countryCode !== "IN")
    ) {
      throw new Error(
        `Land-use integration is not supported yet for ${geography.market || geography.countryCode}.`,
      );
    }

    return BhuvanLandUseService.getLandUse(coordinates, location);
  },
};

export default LandUseService;
