import { NextRequest, NextResponse } from 'next/server';
import { LandUseService } from "@/services/land-intelligence/land-use-service";

/**
 * Backward-compatible land use query.
 * 
 * POST /api/land-intelligence/bhuvan-landuse
 * Body: { coordinates: [lng, lat], location?: string, market?: string, countryCode?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { coordinates, location, market, countryCode, year } = await request.json();
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return NextResponse.json({ error: 'coordinates [lng, lat] required' }, { status: 400 });
    }
    const report = await LandUseService.getLandUse({
      coordinates: coordinates as [number, number],
      location: location || "",
      market,
      countryCode,
      year,
    });
    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    console.error('[Land Use] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
