import { Amenity, AmenityCategory } from './mapbox-places-service';

type GooglePlace = {
    id?: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
};

const CATEGORY_TYPES: Record<AmenityCategory, string[]> = {
    transit: ['bus_station', 'train_station', 'subway_station'],
    school: ['school', 'primary_school', 'secondary_school'],
    college: ['university'],
    hospital: ['hospital', 'pharmacy'],
    park: ['park'],
    restaurant: ['restaurant', 'cafe'],
    shopping: ['supermarket', 'store'],
    atm: ['atm', 'bank'],
    petrol_pump: ['gas_station'],
    mall: ['shopping_mall', 'department_store'],
};

export const GooglePlacesService = {
    async searchNearby(
        center: [number, number],
        categories: AmenityCategory | AmenityCategory[],
        radius: number = 2000,
        limit: number = 10
    ): Promise<Amenity[]> {
        const categoryList = Array.isArray(categories) ? categories : [categories];
        if (categoryList.length === 0) return [];

        const requests = categoryList.map(async (category) => {
            const includedTypes = CATEGORY_TYPES[category];
            if (!includedTypes?.length) return [] as Amenity[];

            const response = await fetch('/api/google-places', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    includedTypes,
                    maxResultCount: limit,
                    rankPreference: 'DISTANCE',
                    locationRestriction: {
                        circle: {
                            center: {
                                latitude: center[1],
                                longitude: center[0],
                            },
                            radius: Math.max(500, Math.min(radius, 50000)),
                        },
                    },
                }),
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

                console.error(
                    `[GooglePlaces] ${category} request failed (${response.status}): ${errorMessage}`,
                    errorBody
                );

                return [] as Amenity[];
            }

            const data = await response.json();
            const places = Array.isArray(data?.places) ? data.places as GooglePlace[] : [];

            return places
                .map((place) => mapPlaceToAmenity(place, category, center))
                .filter((amenity): amenity is Amenity => amenity !== null);
        });

        const results = (await Promise.all(requests)).flat();
        const seen = new Set<string>();

        return results
            .filter((item) => {
                if (seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            })
            .sort((a, b) => a.distance - b.distance);
    },
};

function mapPlaceToAmenity(
    place: GooglePlace,
    category: AmenityCategory,
    center: [number, number]
): Amenity | null {
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;

    if (typeof lat !== 'number' || typeof lng !== 'number') {
        return null;
    }

    return {
        id: `google-${place.id || `${category}-${lat}-${lng}`}`,
        name: place.displayName?.text || 'Unnamed place',
        category,
        distance: Math.round(calculateDistanceInMeters(center[1], center[0], lat, lng)),
        coordinates: [lng, lat],
        address: place.formattedAddress || '',
    };
}

function calculateDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
        Math.cos(phi1) * Math.cos(phi2) *
        Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}
