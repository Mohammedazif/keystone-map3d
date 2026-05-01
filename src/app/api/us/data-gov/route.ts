import { NextRequest, NextResponse } from 'next/server';
import { USDataGovService } from '@/services/us/us-data-gov-service';

export async function GET(request: NextRequest) {
    const searchParams = request.nextUrl.searchParams;
    const location = searchParams.get('location');

    if (!location) {
        return NextResponse.json({ error: 'Missing location parameter' }, { status: 400 });
    }

    try {
        const data = await USDataGovService.getAggregateData(location);
        return NextResponse.json(data);
    } catch (error) {
        console.error('Error fetching US data:', error);
        return NextResponse.json({ error: 'Failed to fetch US Data.gov datasets' }, { status: 500 });
    }
}
