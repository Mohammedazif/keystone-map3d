import { Feature, Polygon } from 'geojson';
import * as turf from '@turf/turf';

type CardinalSide = 'N' | 'S' | 'E' | 'W';

type RoadsApiPoint = {
    location?: {
        latitude?: number;
        longitude?: number;
    };
    originalIndex?: number;
    placeId?: string;
};

type SamplePoint = {
    index: number;
    side: CardinalSide;
    point: [number, number];
};

const SAMPLE_POSITIONS = [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.92];
const MATCH_DISTANCE_METERS = 30;

export const GoogleRoadsService = {
    async detectRoadAccessSides(plotGeometry: Feature<Polygon> | Feature<any>): Promise<CardinalSide[]> {
        const bbox = turf.bbox(plotGeometry);
        const samples = createEdgeSamples(bbox as [number, number, number, number]);
        const snappedPoints = await fetchNearestRoads(samples);

        const matchesBySide = new Map<CardinalSide, number>([
            ['N', 0],
            ['S', 0],
            ['E', 0],
            ['W', 0],
        ]);
        const closestBySide = new Map<CardinalSide, number>([
            ['N', Number.POSITIVE_INFINITY],
            ['S', Number.POSITIVE_INFINITY],
            ['E', Number.POSITIVE_INFINITY],
            ['W', Number.POSITIVE_INFINITY],
        ]);

        snappedPoints.forEach((snappedPoint) => {
            const originalIndex = snappedPoint.originalIndex;
            const lat = snappedPoint.location?.latitude;
            const lng = snappedPoint.location?.longitude;

            if (typeof originalIndex !== 'number' || typeof lat !== 'number' || typeof lng !== 'number') {
                return;
            }

            const sample = samples[originalIndex];
            if (!sample) return;

            const distance = turf.distance(
                turf.point(sample.point),
                turf.point([lng, lat]),
                { units: 'meters' }
            );

            if (distance < (closestBySide.get(sample.side) ?? Number.POSITIVE_INFINITY)) {
                closestBySide.set(sample.side, distance);
            }

            if (distance <= MATCH_DISTANCE_METERS) {
                matchesBySide.set(sample.side, (matchesBySide.get(sample.side) || 0) + 1);
            }
        });

        return (['N', 'E', 'S', 'W'] as CardinalSide[]).filter((side) => {
            const matchCount = matchesBySide.get(side) || 0;
            const closestDistance = closestBySide.get(side) ?? Number.POSITIVE_INFINITY;

            return matchCount >= 2 || (matchCount >= 1 && closestDistance <= 12);
        });
    },
};

function createEdgeSamples(bbox: [number, number, number, number]): SamplePoint[] {
    const [minX, minY, maxX, maxY] = bbox;
    const samples: SamplePoint[] = [];

    const pushSamples = (side: CardinalSide, start: [number, number], end: [number, number]) => {
        const line = turf.lineString([start, end]);
        const lineLength = turf.length(line, { units: 'kilometers' });

        SAMPLE_POSITIONS.forEach((position) => {
            const point = turf.along(line, lineLength * position, {
                units: 'kilometers',
            }).geometry.coordinates as [number, number];

            samples.push({
                index: samples.length,
                side,
                point,
            });
        });
    };

    pushSamples('N', [minX, maxY], [maxX, maxY]);
    pushSamples('S', [minX, minY], [maxX, minY]);
    pushSamples('E', [maxX, minY], [maxX, maxY]);
    pushSamples('W', [minX, minY], [minX, maxY]);

    return samples;
}

async function fetchNearestRoads(samples: SamplePoint[]): Promise<RoadsApiPoint[]> {
    const points = samples.map((sample) => ({
        lat: sample.point[1],
        lng: sample.point[0],
    }));

    const response = await fetch('/api/google-roads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points }),
    });

    if (!response.ok) {
        const errorText = await response.text();
        let errorBody: any = {};

        try {
            errorBody = errorText ? JSON.parse(errorText) : {};
        } catch {
            errorBody = { raw: errorText };
        }

        const errorMessage =
            errorBody?.error ||
            errorBody?.details?.error?.message ||
            errorBody?.raw ||
            `HTTP ${response.status}`;

        throw new Error(`Google Roads request failed (${response.status}): ${errorMessage}`);
    }

    const data = await response.json();
    return Array.isArray(data?.snappedPoints) ? data.snappedPoints as RoadsApiPoint[] : [];
}
