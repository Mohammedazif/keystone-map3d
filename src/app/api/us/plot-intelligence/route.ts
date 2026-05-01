import { NextRequest, NextResponse } from 'next/server';
import { USPlotIntelligenceService } from '@/services/us/us-plot-intelligence';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();

        const {
            location,
            plotAreaSqm,
            coordinates,
            buildingHeight,
            numFloors,
            totalBuiltUpArea,
            hasElevator,
            hasFireSystem,
            hasSprinkler,
        } = body;

        if (!location || !plotAreaSqm) {
            return NextResponse.json(
                { error: 'Missing required fields: location, plotAreaSqm' },
                { status: 400 }
            );
        }

        const result = await USPlotIntelligenceService.analyze({
            location,
            plotAreaSqm: Number(plotAreaSqm),
            coordinates,
            buildingHeight: buildingHeight ? Number(buildingHeight) : undefined,
            numFloors: numFloors ? Number(numFloors) : undefined,
            totalBuiltUpArea: totalBuiltUpArea ? Number(totalBuiltUpArea) : undefined,
            hasElevator: !!hasElevator,
            hasFireSystem: !!hasFireSystem,
            hasSprinkler: !!hasSprinkler,
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[US Plot Intelligence API] Error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
