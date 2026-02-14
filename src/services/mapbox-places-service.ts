
import { FeatureCollection, Point, Feature } from 'geojson';

const MAPBOX_ACCESS_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

export interface Amenity {
    id: string;
    name: string;
    category: string;
    distance: number; // in meters
    coordinates: [number, number];
    address?: string;
}

export type AmenityCategory = "transit" | "school" | "hospital" | "park" | "restaurant" | "shopping";

// Map our categories to Mapbox Geocoding Types or Keywords
const CATEGORY_KEYWORDS: Record<AmenityCategory, string> = {
    transit: "station, bus stop, metro, transit",
    school: "school, college, university, education",
    hospital: "hospital, clinic, medical",
    park: "park, garden, playground",
    restaurant: "restaurant, cafe, food",
    shopping: "mall, market, supermarket, shopping"
};

/**
 * Service to interact with Mapbox Geocoding/Search API to find nearby amenities
 */
export const MapboxPlacesService = {

    /**
     * Search for amenities around a central point
     * @param center [lng, lat]
     * @param category Internal category type
     * @param limit Max results
     */
    async searchNearby(
        center: [number, number],
        category: AmenityCategory,
        limit: number = 10
    ): Promise<Amenity[]> {
        if (!MAPBOX_ACCESS_TOKEN) {
            console.error("Mapbox Access Token missing");
            return [];
        }

        const query = CATEGORY_KEYWORDS[category];
        // Using Mapbox Geocoding API for 'places' or 'poi'
        // Docs: https://docs.mapbox.com/api/search/geocoding/
        // Use a more specific search term for better results
        const searchTerm = category === 'transit' ? 'transit station' :
            category === 'school' ? 'school' :
                category === 'hospital' ? 'hospital' :
                    category === 'park' ? 'park' :
                        category === 'restaurant' ? 'restaurant' :
                            'shopping';

        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchTerm)}.json?` +
            `proximity=${center[0]},${center[1]}&` +
            `types=poi&` +
            `limit=${limit}&` +
            `access_token=${MAPBOX_ACCESS_TOKEN}`;

        console.log(`[MapboxPlaces] Fetching ${category} from:`, url);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                const errorText = await response.text();
                console.error(`[MapboxPlaces] API Error: ${response.status} - ${errorText}`);
                throw new Error(`Mapbox API error: ${response.status}`);
            }

            const data = await response.json();
            console.log(`[MapboxPlaces] ${category} results found (poi):`, data.features?.length || 0);

            let features = data.features || [];

            // FALLBACK: If no POIs found, search without the 'poi' type restriction
            if (features.length === 0) {
                console.log(`[MapboxPlaces] No POIs found for ${category}, trying fallback broader search...`);
                const fallbackUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchTerm)}.json?` +
                    `proximity=${center[0]},${center[1]}&` +
                    `limit=${limit}&` +
                    `access_token=${MAPBOX_ACCESS_TOKEN}`;

                const fallbackResponse = await fetch(fallbackUrl);
                if (fallbackResponse.ok) {
                    const fallbackData = await fallbackResponse.json();
                    features = fallbackData.features || [];
                    console.log(`[MapboxPlaces] ${category} results found (fallback):`, features.length);
                }
            }

            if (features.length > 0) {
                console.log(`[MapboxPlaces] Sample result for ${category}:`, features[0].text, features[0].place_name);
            }

            return features.map((f: any) => {
                // Calculate rough distance (Haversine or simple Euclidean for close range)
                // For better accuracy, use Turf.js outside this service or simple math
                const distance = calculateDistanceInMeters(center[1], center[0], f.center[1], f.center[0]);

                // Clean up the name to be more specific (e.g. "Delhi Public School")
                // f.text is usually the specific name, f.place_name is full address
                const name = f.text || '';
                let address = f.place_name || '';

                // Remove the name from the address to avoid repetition (e.g. "School, School Road" -> "School Road")
                if (address.toLowerCase().startsWith(name.toLowerCase())) {
                    address = address.substring(name.length).replace(/^,/, '').trim();
                }

                return {
                    id: f.id,
                    name: name,
                    category,
                    distance: Math.round(distance),
                    coordinates: f.center,
                    address: address
                };
            })
                .filter((a: Amenity) => {
                    const nameLower = a.name.toLowerCase();
                    const addressLower = a.address?.toLowerCase() || '';

                    // Pattern 1: Exact matches of just category + road (e.g., "Hospital Marg", "School Road")
                    // These are almost always road names, not facilities
                    const isExactCategoryRoad =
                        /^(school|hospital|main)\s+(road|rd|marg|street|path|lane|pathway)$/i.test(nameLower);

                    // Pattern 2: Starts with "near" which indicates a location description
                    const startsWithNear = nameLower.startsWith('near ');

                    // Pattern 3: Very generic single-word names
                    const isTooGeneric = nameLower === 'hospital' || nameLower === 'school' ||
                        nameLower === 'clinic' || nameLower === 'park';

                    // Filter out only the most obvious non-facilities
                    if (a.category !== 'transit') {
                        if (isExactCategoryRoad || startsWithNear || isTooGeneric) {
                            return false;
                        }
                    }

                    return a.distance < 15000;
                })
                .sort((a: Amenity, b: Amenity) => a.distance - b.distance); // Sort by nearest

        } catch (error) {
            console.error(`[MapboxPlacesService] Error searching ${category}:`, error);
            return [];
        }
    }
};

// Helper: Haversine Distance
function calculateDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}
