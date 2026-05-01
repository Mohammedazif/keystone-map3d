/**
 * US Environmental & Topography Service
 * 
 * Fetches free, open-source environmental data from federal APIs.
 * 1. USGS National Map API for Elevation/Topography.
 * 
 * Future expansions: FEMA Flood API, EPA Environmental Justice API.
 */

export interface USEnvironmentalData {
    elevationMeters: number | null;
    source: 'usgs-api' | 'llm' | 'fallback';
}

export const USEnvironmentalService = {
    /**
     * Get environmental data including elevation from USGS.
     */
    async getEnvironmentalData(coordinates: [number, number]): Promise<USEnvironmentalData> {
        const [lng, lat] = coordinates;
        const elevation = await this.fetchUSGSElevation(lng, lat);
        
        return {
            elevationMeters: elevation,
            source: elevation !== null ? 'usgs-api' : 'fallback',
        };
    },

    /**
     * Query USGS Elevation Point Query Service (EPQS)
     * https://epqs.nationalmap.gov/v1/json
     */
    async fetchUSGSElevation(lng: number, lat: number): Promise<number | null> {
        try {
            const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&units=Meters&output=json`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (!res.ok) return null;
            
            const data = await res.json();
            const value = parseFloat(data.value);
            
            if (isNaN(value)) return null;
            return value;
        } catch (error) {
            console.warn('[USEnvironmentalService] USGS Elevation fetch failed:', error);
            return null;
        }
    }
};
