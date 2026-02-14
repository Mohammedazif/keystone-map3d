
import { Amenity, AmenityCategory } from './mapbox-places-service';

/**
 * Service to interact with OpenStreetMap (Overpass API) to find nearby amenities.
 * This is often more accurate for specific building names (Schools, Hospitals) than generic geocoders.
 */
export const OverpassPlacesService = {

    /**
     * Search for amenities around a central point using Overpass API.
     * Can accept a single category or an array of categories.
     * @param center [lng, lat]
     * @param categories Single category or array of categories
     * @param radius Search radius in meters (default 5000m)
     */
    async searchNearby(
        center: [number, number],
        categories: AmenityCategory | AmenityCategory[],
        radius: number = 5000
    ): Promise<Amenity[]> {

        const categoryList = Array.isArray(categories) ? categories : [categories];
        if (categoryList.length === 0) return [];

        const [lng, lat] = center;

        // Build the query parts for each category
        const queryParts = categoryList.map(cat => {
            let osmFilter = '';
            switch (cat) {
                case 'school': osmFilter = `["amenity"~"school|college|university|kindergarten"]`; break;
                case 'hospital': osmFilter = `["amenity"~"hospital|clinic|doctors|pharmacy"]`; break;
                case 'transit': osmFilter = `["public_transport"]`; break;
                case 'park': osmFilter = `["leisure"~"park|garden|playground"]`; break;
                case 'restaurant': osmFilter = `["amenity"~"restaurant|cafe|fast_food"]`; break;
                case 'shopping': osmFilter = `["shop"~"supermarket|mall|convenience|department_store"]`; break;
                default: return '';
            }
            if (!osmFilter) return '';

            // We tag the output so we know which part of the union matched, 
            // but Overpass JSON doesn't easily separate them in a single union block unless we use separate statements.
            // However, a simple union (node[...]...; way[...]...;) is fastest.
            // We will deduce the category from the tags later during parsing.
            return `
              node${osmFilter}(around:${radius},${lat},${lng});
              way${osmFilter}(around:${radius},${lat},${lng});
              relation${osmFilter}(around:${radius},${lat},${lng});
            `;
        }).join('\n');

        const query = `
            [out:json][timeout:25];
            (
              ${queryParts}
            );
            out center;
        `;

        const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;
        console.log(`[OverpassService] Fetching amenities nearby...`);

        try {
            const response = await fetch(url);
            if (!response.ok) {
                if (response.status === 429) {
                    console.warn("[OverpassService] Rate limit hit. Waiting...");
                    // Simple wait and retry logic could fly here, but better to just fail gracefully or let user retry.
                    throw new Error("Overpass API Rate Limit (429). Please try again in top a minute.");
                }
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const data = await response.json();
            const elements = data.elements || [];
            console.log(`[OverpassService] Found ${elements.length} elements total.`);

            return elements.map((el: any) => {
                const elLat = el.lat || el.center?.lat;
                const elLng = el.lon || el.center?.lon;
                if (!elLat || !elLng) return null;

                // Deduce Category from tags
                let category: AmenityCategory = 'school'; // Default/Fallback
                const tags = el.tags || {};

                if (tags.amenity?.match(/school|college|university|kindergarten/)) category = 'school';
                else if (tags.amenity?.match(/hospital|clinic|doctors|pharmacy/)) category = 'hospital';
                else if (tags.public_transport || tags.amenity === 'bus_station' || tags.highway === 'bus_stop') category = 'transit';
                else if (tags.leisure?.match(/park|garden|playground/)) category = 'park';
                else if (tags.amenity?.match(/restaurant|cafe|fast_food/)) category = 'restaurant';
                else if (tags.shop?.match(/supermarket|mall|convenience|department_store/)) category = 'shopping';

                // If we specifically requested only certain categories, double check? 
                // The query only asked for them, so it should be fine, but overlap is possible.

                // Name Extraction
                let name = tags.name || tags['name:en'] || tags.operator || tags.brand;
                if (!name) {
                    const subtype = tags.amenity || tags.leisure || tags.shop || category;
                    name = `${subtype.charAt(0).toUpperCase() + subtype.slice(1)} (Unnamed)`;
                }

                // Address Construction
                const addressParts = [
                    tags['addr:housenumber'],
                    tags['addr:street'],
                    tags['addr:city'],
                    tags['addr:postcode']
                ].filter(Boolean);
                let address = addressParts.join(', ');
                if (!address) address = tags['addr:full'] || '';
                if (!address) address = 'Address not available';
                if (name === address) address = '';

                const distance = calculateDistanceInMeters(lat, lng, elLat, elLng);

                return {
                    id: `osm-${el.id}`,
                    name,
                    category,
                    distance: Math.round(distance),
                    coordinates: [elLng, elLat] as [number, number],
                    address
                };
            })
                .filter((a: Amenity | null) => a !== null)
                .filter((a: Amenity) => a.distance < 10000)
                .sort((a: Amenity, b: Amenity) => a.distance - b.distance);

        } catch (error) {
            console.error(`[OverpassService] Search failed:`, error);
            throw error; // Re-throw to let UI handle it
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
