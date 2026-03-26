import { NextRequest, NextResponse } from 'next/server';
import { BhuvanLandUseService } from '@/services/land-intelligence/bhuvan-landuse-service';

/**
 * Bhuvan Land Use Query
 * 
 * POST /api/land-intelligence/bhuvan-landuse
 * Body: { coordinates: [lng, lat], location?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const { coordinates, location } = await request.json();
    if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
      return NextResponse.json({ error: 'coordinates [lng, lat] required' }, { status: 400 });
    }
    const report = await BhuvanLandUseService.getLandUse(
      coordinates as [number, number],
      location || ''
    );
    return NextResponse.json({ success: true, report });
  } catch (error: any) {
    console.error('[Bhuvan LandUse] Error:', error);
    return NextResponse.json({ error: error.message || 'Failed' }, { status: 500 });
  }
}
