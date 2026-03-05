
import { Amenity, AmenityCategory } from './mapbox-places-service';

/**
 * Service to interact with OpenStreetMap (Overpass API) to find nearby amenities.
 */
export const OverpassPlacesService = {

    /**
     * Search for amenities around a central point using Overpass API.
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

        // category
        const queryParts = categoryList.map(cat => {
            let osmFilter = '';
            switch (cat) {
                case 'school': osmFilter = `["amenity"~"school|kindergarten"]`; break; 
                case 'college': osmFilter = `["amenity"~"college|university"]`; break;
                case 'hospital': osmFilter = `["amenity"~"hospital|clinic|doctors|pharmacy"]`; break;
                case 'transit': osmFilter = `["public_transport"~"station"]`; break;
                case 'park': osmFilter = `["leisure"~"park|garden|playground"]`; break;
                case 'restaurant': osmFilter = `["amenity"~"restaurant|cafe|fast_food"]`; break;
                case 'shopping': osmFilter = `["shop"~"supermarket|convenience"]`; break;
                case 'mall': osmFilter = `["shop"~"mall|department_store"]`; break;
                case 'atm': osmFilter = `["amenity"~"^(atm|bank)$"]`; break; 
                case 'petrol_pump': osmFilter = `["amenity"="fuel"]`; break;
                default: return '';
            }

            if (cat === 'transit') {
                return `
                  node["railway"~"station|halt"](around:${radius},${lat},${lng});
                  way["railway"~"station|halt"](around:${radius},${lat},${lng});
                  node["station"~"subway|light_rail"](around:${radius},${lat},${lng});
                  node["aeroway"="aerodrome"](around:${radius},${lat},${lng}); 
                  way["aeroway"="aerodrome"](around:${radius},${lat},${lng});
                  node["amenity"="bus_station"](around:${radius},${lat},${lng});
                  // relation["public_transport"="stop_area"](around:${radius},${lat},${lng});
                `;
            }

            if (!osmFilter) return '';

            return `
              node${osmFilter}(around:${radius},${lat},${lng});
              way${osmFilter}(around:${radius},${lat},${lng});
              relation${osmFilter}(around:${radius},${lat},${lng});
            `;
        }).join('\n');

        const query = `
            [out:json][timeout:90];
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
                    throw new Error("Overpass API Rate Limit (429). Please try again in a minute.");
                }
                throw new Error(`Overpass API error: ${response.status}`);
            }

            const contentType = response.headers.get("content-type");
            let data: any;
            
            try {
                if (contentType && !contentType.includes("application/json")) {
                    const text = await response.text();
                    console.error(`[OverpassService] Expected JSON but received ${contentType}. Body starts with: ${text.substring(0, 100)}`);
                    throw new Error(`Overpass API returned non-JSON response (${contentType})`);
                }
                data = await response.json();
            } catch (e) {
                const text = await response.clone().text().catch(() => "Could not read body");
                console.error(`[OverpassService] Failed to parse JSON response. Body starts with: ${text.substring(0, 100)}`);
                throw new Error(`Failed to parse Overpass API response as JSON: ${e instanceof Error ? e.message : String(e)}`);
            }

            const elements = data.elements || [];
            console.log(`[OverpassService] Found ${elements.length} elements total.`);

            return elements.map((el: any) => {
                const elLat = el.lat || el.center?.lat;
                const elLng = el.lon || el.center?.lon;
                if (!elLat || !elLng) return null;

                let category: AmenityCategory = 'school'; 
                const tags = el.tags || {};

                if (tags.amenity?.match(/college|university/)) category = 'college';
                else if (tags.amenity?.match(/school|kindergarten/)) category = 'school';
                else if (tags.amenity?.match(/hospital|clinic|doctors|pharmacy/)) category = 'hospital';
                else if (tags.railway || tags.aeroway || tags.station || tags.amenity === 'bus_station' || tags.public_transport) category = 'transit';
                else if (tags.leisure?.match(/park|garden|playground/)) category = 'park';
                else if (tags.amenity?.match(/restaurant|cafe|fast_food/)) category = 'restaurant';
                else if (tags.shop?.match(/mall|department_store/)) category = 'mall';
                else if (tags.shop?.match(/supermarket|convenience/)) category = 'shopping';
                else if (tags.amenity?.match(/^(atm|bank)$/)) category = 'atm';
                else if (tags.amenity === 'fuel') category = 'petrol_pump';

                if (category === 'school' && !tags.amenity?.match(/school|kindergarten/) && !tags.amenity?.match(/college|university/)) {
                }

                if (tags.amenity === 'blood_bank') return null; 

                let name = tags.name || tags['name:en'] || tags.operator || tags.brand;
                if (!name) {
                    const subtype = tags.amenity || tags.leisure || tags.shop || tags.railway || tags.aeroway || category;
                    name = `${subtype.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}`;
                }

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
            throw error;
        }
    },

    /**
     * Fetch road geometries within a bounding box.
     * @param bbox [minX, minY, maxX, maxY] (SW, NE)
     */
    async fetchRoads(bbox: [number, number, number, number]): Promise<any[]> {
        const [minX, minY, maxX, maxY] = bbox;
        const query = `
            [out:json][timeout:25];
            way["highway"](${minY},${minX},${maxY},${maxX});
            out geom;
        `;

        const servers = [
            'https://overpass-api.de/api/interpreter',
            'https://lz4.overpass-api.de/api/interpreter',
            'https://overpass.kumi.systems/api/interpreter'
        ];

        console.log(`[OverpassService] Fetching roads in bbox...`);

        for (let i = 0; i < servers.length; i++) {
            const url = `${servers[i]}?data=${encodeURIComponent(query)}`;

            try {
                const response = await fetch(url);
                if (!response.ok) {
                    console.warn(`[OverpassService] Server ${i + 1} failed: ${response.status}`);
                    continue;
                }

                const contentType = response.headers.get("content-type");
                let data: any;

                try {
                    if (contentType && !contentType.includes("application/json")) {
                        const text = await response.text();
                        console.error(`[OverpassService] Server ${i + 1} expected JSON but received ${contentType}. Body starts with: ${text.substring(0, 100)}`);
                        continue;
                    }
                    data = await response.json();
                } catch (e) {
                    const text = await response.clone().text().catch(() => "Could not read body");
                    console.error(`[OverpassService] Server ${i + 1} failed to parse JSON. Body starts with: ${text.substring(0, 100)}`);
                    continue;
                }

                if (!data || !data.elements) {
                    console.warn(`[OverpassService] Server ${i + 1} returned empty or invalid data structure.`);
                    continue;
                }

                const ways = data.elements.filter((el: any) => el.type === 'way' && el.geometry);
                console.log(`[OverpassService] Found ${ways.length} roads.`);

                return ways.map((way: any) => ({
                    type: 'Feature',
                    geometry: {
                        type: 'LineString',
                        coordinates: way.geometry.map((g: any) => [g.lon, g.lat])
                    },
                    properties: way.tags || {}
                }));
            } catch (error) {
                console.warn(`[OverpassService] Server ${i + 1} error:`, error);
                if (i === servers.length - 1) {
                    console.error(`[OverpassService] All servers failed`);
                    return [];
                }
            }
        }

        return [];
    }
};

function calculateDistanceInMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
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
