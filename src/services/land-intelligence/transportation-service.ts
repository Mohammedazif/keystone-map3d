import { inferRegulationGeography } from "@/lib/geography";
import type {
  CountryCode,
  GeographyMarket,
  BuildingIntendedUse,
} from "@/lib/types";
import type {
  TransportationScreeningReport,
} from "@/lib/land-intelligence/transportation";
import { UsaTransportationService } from "@/services/land-intelligence/usa-transportation-service";

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

export const TransportationService = {
  async getTransportationScreening({
    coordinates,
    location = "",
    market,
    countryCode,
    roadAccessSides,
    landSizeSqm,
    intendedUse,
    nearestTransitDistanceMeters,
    transitCountWithin5Km,
    transitSampleNames,
    centroidRoadDistanceMeters,
    boundaryRoadCoverageRatio,
    roadWidthMeters,
    frontageWidthMeters,
  }: {
    coordinates: [number, number];
    location?: string;
    market?: GeographyMarket;
    countryCode?: CountryCode;
    roadAccessSides?: string[];
    landSizeSqm?: number;
    intendedUse?: BuildingIntendedUse | string;
    nearestTransitDistanceMeters?: number | null;
    transitCountWithin5Km?: number;
    transitSampleNames?: string[];
    centroidRoadDistanceMeters?: number | null;
    boundaryRoadCoverageRatio?: number | null;
    roadWidthMeters?: number | null;
    frontageWidthMeters?: number | null;
  }): Promise<TransportationScreeningReport> {
    const geography = resolveGeography({ market, countryCode, location });

    if (geography.market === "USA" || geography.countryCode === "US") {
      return UsaTransportationService.getTransportationScreening({
        coordinates,
        location,
        heuristicInput: {
          roadAccessSides,
          landSizeSqm,
          intendedUse,
          nearestTransitDistanceMeters,
          transitCountWithin5Km,
          transitSampleNames,
          centroidRoadDistanceMeters,
          boundaryRoadCoverageRatio,
          roadWidthMeters,
          frontageWidthMeters,
        },
      });
    }

    throw new Error(
      `Transportation screening is not supported yet for ${geography.market || geography.countryCode}.`,
    );
  },
};

export default TransportationService;
