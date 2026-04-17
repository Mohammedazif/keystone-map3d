import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_PLACES_API_URL = 'https://places.googleapis.com/v1/places:searchNearby';

export async function POST(req: NextRequest) {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;

        if (!apiKey) {
            return NextResponse.json(
                { error: 'Missing GOOGLE_MAPS_API_KEY' },
                { status: 500 }
            );
        }

        const body = await req.json();
        const response = await fetch(GOOGLE_PLACES_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': apiKey,
                'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.types',
            },
            body: JSON.stringify(body),
        });

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
                    error: data?.error?.message || data?.raw || 'Google Places request failed',
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
