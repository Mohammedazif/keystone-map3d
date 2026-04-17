import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_NEAREST_ROADS_API_URL = 'https://roads.googleapis.com/v1/nearestRoads';

export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;

        if (!apiKey) {
            return NextResponse.json(
                { error: 'Missing GOOGLE_MAPS_API_KEY' },
                { status: 500 }
            );
        }

        const { points } = await req.json();
        if (!Array.isArray(points) || points.length === 0) {
            return NextResponse.json(
                { error: 'Missing "points" array' },
                { status: 400 }
            );
        }

        const sanitizedPoints = points
            .slice(0, 100)
            .map((point: any) => ({
                lat: Number(point?.lat),
                lng: Number(point?.lng),
            }))
            .filter((point: { lat: number; lng: number }) =>
                Number.isFinite(point.lat) && Number.isFinite(point.lng)
            );

        if (sanitizedPoints.length === 0) {
            return NextResponse.json(
                { error: 'No valid coordinates supplied' },
                { status: 400 }
            );
        }

        const encodedPoints = sanitizedPoints
            .map((point: { lat: number; lng: number }) => `${point.lat},${point.lng}`)
            .join('|');

        const url = `${GOOGLE_NEAREST_ROADS_API_URL}?points=${encodeURIComponent(encodedPoints)}&key=${encodeURIComponent(apiKey)}`;
        const response = await fetch(url, { method: 'GET' });
        const text = await response.text();

        let data: any = {};
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            data = { raw: text };
        }

        if (!response.ok) {
            return NextResponse.json(
                {
                    error: data?.error?.message || data?.raw || 'Google Roads request failed',
                    details: data,
                },
                { status: response.status }
            );
        }

        return NextResponse.json(data);
    } catch (err: any) {
        return NextResponse.json({ error: err.message }, { status: 500 });
    }
}
