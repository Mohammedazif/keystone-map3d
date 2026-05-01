import { NextRequest, NextResponse } from "next/server";

import { LandUseService } from "@/services/land-intelligence/land-use-service";
import type { CountryCode, GeographyMarket } from "@/lib/types";

/**
 * Generic land-use query route.
 *
 * POST /api/land-intelligence/land-use
 * Body: {
 *   coordinates: [lng, lat],
 *   location?: string,
 *   market?: "India" | "USA" | "UAE",
 *   countryCode?: "IN" | "US" | "AE",
 *   year?: number
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { coordinates, location, market, countryCode, year } =
      await request.json();

    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return NextResponse.json(
        { error: "coordinates [lng, lat] required" },
        { status: 400 },
      );
    }

    const report = await LandUseService.getLandUse({
      coordinates: coordinates as [number, number],
      location: typeof location === "string" ? location : "",
      market: market as GeographyMarket | undefined,
      countryCode: countryCode as CountryCode | undefined,
      year: Number.isFinite(Number(year)) ? Number(year) : undefined,
    });

    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    console.error("[Land Use] Error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to fetch land use" },
      { status: 500 },
    );
  }
}
