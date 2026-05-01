import { NextRequest, NextResponse } from 'next/server';
import { fetchParcelsInBounds } from '@/services/us/us-parcel-fetcher';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const west = parseFloat(searchParams.get('west') || '');
    const south = parseFloat(searchParams.get('south') || '');
    const east = parseFloat(searchParams.get('east') || '');
    const north = parseFloat(searchParams.get('north') || '');
    const location = searchParams.get('location') || undefined;

    if (isNaN(west) || isNaN(south) || isNaN(east) || isNaN(north)) {
        return NextResponse.json(
            { error: 'Missing or invalid bounds parameters: west, south, east, north' },
            { status: 400 },
        );
    }

    try {
        const parcels = await fetchParcelsInBounds(
            { west, south, east, north },
            location,
        );
        return NextResponse.json(parcels);
    } catch (error: any) {
        console.error('[US Parcels API] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch parcels' },
            { status: 500 },
        );
    }
}
