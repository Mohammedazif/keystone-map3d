import type { CountryCode, GeographyMarket } from "@/lib/types";

export interface LandUseLayerSummary {
  layerLabel: string;
  landUseType: string;
  landUseCode?: string;
  year?: number;
}

export interface LandUseSummary {
  primaryLandUse: string;
  historicLandUseChange?: string;
  stateCode?: string;
  countryCode?: CountryCode;
  market?: GeographyMarket;
  source: string;
  sourceLabel?: string;
  latestYear?: number;
  layers: LandUseLayerSummary[];
}
