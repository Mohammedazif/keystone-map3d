import { NextRequest, NextResponse } from "next/server";

import { TransportationService } from "@/services/land-intelligence/transportation-service";
import type {
  BuildingIntendedUse,
  CountryCode,
  GeographyMarket,
} from "@/lib/types";

/**
 * Generic transportation-screening query route.
 *
 * POST /api/land-intelligence/transportation
 * Body: {
 *   coordinates: [lng, lat],
 *   location?: string,
 *   market?: "India" | "USA" | "UAE",
 *   countryCode?: "IN" | "US" | "AE",
 *   roadAccessSides?: string[],
 *   landSizeSqm?: number,
 *   intendedUse?: string,
 *   nearestTransitDistanceMeters?: number,
 *   transitCountWithin5Km?: number,
 *   transitSampleNames?: string[],
 *   centroidRoadDistanceMeters?: number,
 *   boundaryRoadCoverageRatio?: number,
 *   roadWidthMeters?: number,
 *   frontageWidthMeters?: number
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const {
      coordinates,
      location,
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
    } = await request.json();

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return NextResponse.json(
        { error: "coordinates [lng, lat] required" },
        { status: 400 },
      );
    }

    const report = await TransportationService.getTransportationScreening({
      coordinates: coordinates as [number, number],
      location: typeof location === "string" ? location : "",
      market: market as GeographyMarket | undefined,
      countryCode: countryCode as CountryCode | undefined,
      roadAccessSides: Array.isArray(roadAccessSides)
        ? roadAccessSides.filter((side): side is string => typeof side === "string")
        : undefined,
      landSizeSqm: Number.isFinite(Number(landSizeSqm))
        ? Number(landSizeSqm)
        : undefined,
      intendedUse: intendedUse as BuildingIntendedUse | undefined,
      nearestTransitDistanceMeters: Number.isFinite(Number(nearestTransitDistanceMeters))
        ? Number(nearestTransitDistanceMeters)
        : undefined,
      transitCountWithin5Km: Number.isFinite(Number(transitCountWithin5Km))
        ? Number(transitCountWithin5Km)
        : undefined,
      transitSampleNames: Array.isArray(transitSampleNames)
        ? transitSampleNames.filter((name): name is string => typeof name === "string")
        : undefined,
      centroidRoadDistanceMeters: Number.isFinite(Number(centroidRoadDistanceMeters))
        ? Number(centroidRoadDistanceMeters)
        : undefined,
      boundaryRoadCoverageRatio: Number.isFinite(Number(boundaryRoadCoverageRatio))
        ? Number(boundaryRoadCoverageRatio)
        : undefined,
      roadWidthMeters: Number.isFinite(Number(roadWidthMeters))
        ? Number(roadWidthMeters)
        : undefined,
      frontageWidthMeters: Number.isFinite(Number(frontageWidthMeters))
        ? Number(frontageWidthMeters)
        : undefined,
    });

    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    console.error("[Transportation Screening] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch transportation screening" },
      { status: 500 },
    );
  }
}
