/**
 * US Parcel & Title Data Service
 *
 * Fetches parcel data using open ArcGIS Hub REST APIs:
 * 1. ArcGIS Hub Parcel Search — https://hub.arcgis.com/search
 * 2. Falls back to LLM-generated realistic parcel profiles
 *
 * ArcGIS Hub provides free access to many US county/city parcel datasets.
 * No API key required for public feature services.
 */

export interface USTitleOwnership {
    ownerName: string;
    ownerType: 'Corporate' | 'Individual' | 'Government' | 'Trust';
    lastSaleDate: string;
    lastSalePrice: number;
    assessedValue: number;
}

export interface USZoningInfo {
    zoningCode: string;
    zoningDescription: string;
    jurisdiction: string;
    floodZone: string; // FEMA designation: X, A, AE, V, etc.
}

export interface USEncumbrance {
    type: 'Lien' | 'Easement' | 'Deed Restriction' | 'Mortgage';
    description: string;
    amount?: number;
    status: 'Active' | 'Cleared';
}

export interface USDueDiligenceInfo {
    altaSurveyStatus: 'Available' | 'Required' | 'In Progress';
    relativePositionalPrecision: string;
    recognizedEnvironmentalConditions: string;
    titleCommitmentStatus: 'Issued' | 'Pending' | 'Exceptions Noted';
}

export interface USParcelData {
    parcelId: string; // APN (Assessor's Parcel Number)
    lotAreaSqFt: number;
    title: USTitleOwnership;
    zoning: USZoningInfo;
    encumbrances: USEncumbrance[];
    dueDiligence: USDueDiligenceInfo;
    source: 'arcgis' | 'llm' | 'fallback';
}

/**
 * Known ArcGIS Feature Service URLs for key US cities.
 * These are public, no-auth endpoints from ArcGIS Hub.
 */
const ARCGIS_PARCEL_SERVICES: Record<string, {
    url: string;
    fields: {
        parcelId?: string;
        owner?: string;
        zoning?: string;
        zoningDesc?: string;
        assessedValue?: string;
        landValue?: string;
        saleDate?: string;
        salePrice?: string;
        lotArea?: string;
    };
}> = {
    austin: {
        url: 'https://services.arcgis.com/0L95CJ0VTaxqcmED/arcgis/rest/services/TCAD_public/FeatureServer/0',
        fields: {
            parcelId: 'PROP_ID',
            owner: 'OWNER',
            zoning: 'ZONING',
            assessedValue: 'APPRAISED_VALUE',
            landValue: 'LAND_VALUE',
            lotArea: 'Shape__Area',
        },
    },
    phoenix: {
        url: 'https://services2.arcgis.com/2t1927381mhTgWNC/arcgis/rest/services/Parcels/FeatureServer/0',
        fields: {
            parcelId: 'APN',
            owner: 'OWNER_NAME',
            zoning: 'ZONING',
            assessedValue: 'FULL_CASH_VALUE',
            lotArea: 'Shape__Area',
        },
    },
    seattle: {
        url: 'https://gisdata.kingcounty.gov/arcgis/rest/services/OpenDataPortal/property__parcel_area/MapServer/0',
        fields: {
            parcelId: 'PIN',
            owner: 'TAXPAYER',
            assessedValue: 'APPRAISED_VALUE',
            lotArea: 'Shape_Area',
        },
    },
};

export const USParcelService = {
    /**
     * Gets parcel data for a US location.
     * Priority: ArcGIS Feature Service → LLM → Hardcoded fallback
     */
    async getParcelData(location: string, areaSqm: number, coordinates?: [number, number]): Promise<USParcelData> {
        const loc = location.toLowerCase();
        
        // Try ArcGIS first if we have coordinates
        if (coordinates) {
            for (const [city, config] of Object.entries(ARCGIS_PARCEL_SERVICES)) {
                if (loc.includes(city)) {
                    try {
                        const result = await this.queryArcGISParcel(config.url, config.fields, coordinates);
                        if (result) {
                            console.log(`[USParcelService] ArcGIS parcel data retrieved for ${city}`);
                            return result;
                        }
                    } catch (err) {
                        console.warn(`[USParcelService] ArcGIS query failed for ${city}:`, err);
                    }
                }
            }

            // Try generic ArcGIS Hub search for unknown cities
            try {
                const hubResult = await this.queryArcGISHub(location, coordinates);
                if (hubResult) return hubResult;
            } catch (err) {
                console.warn('[USParcelService] ArcGIS Hub search failed:', err);
            }
        }

        // LLM fallback
        return this.getParcelDataViaLLM(location, areaSqm);
    },

    /**
     * Query a specific ArcGIS Feature Service for parcel data at given coordinates.
     */
    async queryArcGISParcel(
        serviceUrl: string,
        fieldMap: Record<string, string | undefined>,
        coordinates: [number, number],
    ): Promise<USParcelData | null> {
        const [lng, lat] = coordinates;
        const params = new URLSearchParams({
            geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
            geometryType: 'esriGeometryPoint',
            spatialRel: 'esriSpatialRelIntersects',
            outFields: '*',
            returnGeometry: 'false',
            f: 'json',
        });

        const url = `${serviceUrl}/query?${params.toString()}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

        if (!res.ok) return null;
        const data = await res.json();

        if (!data.features || data.features.length === 0) return null;

        const attrs = data.features[0].attributes;
        const get = (key?: string) => (key && attrs[key] != null ? String(attrs[key]).trim() : '');
        const getNum = (key?: string) => {
            if (!key || attrs[key] == null) return 0;
            const n = Number(attrs[key]);
            return isFinite(n) ? n : 0;
        };

        const parcelId = get(fieldMap.parcelId) || `APN-${Math.floor(Math.random() * 10000000)}`;
        const ownerName = get(fieldMap.owner) || 'Owner on Record';
        const zoningCode = get(fieldMap.zoning) || 'Unknown';
        const assessedValue = getNum(fieldMap.assessedValue) || getNum(fieldMap.landValue);
        const salePrice = getNum(fieldMap.salePrice);
        const saleDate = get(fieldMap.saleDate) || 'N/A';
        const lotArea = getNum(fieldMap.lotArea);

        // Infer owner type from name
        let ownerType: USTitleOwnership['ownerType'] = 'Individual';
        const upperOwner = ownerName.toUpperCase();
        if (/LLC|INC|CORP|LTD|COMPANY|LP\b|PARTNERS|HOLDINGS/.test(upperOwner)) ownerType = 'Corporate';
        else if (/TRUST|ESTATE|TRUSTEE/.test(upperOwner)) ownerType = 'Trust';
        else if (/CITY|COUNTY|STATE|GOVERNMENT|MUNICIPAL|SCHOOL|PUBLIC/.test(upperOwner)) ownerType = 'Government';

        // Fetch real FEMA flood zone data
        let floodZone = 'X';
        try {
            const { USEnvironmentalService } = await import('./us-environmental-service');
            const femaData = await USEnvironmentalService.fetchFEMAFloodZone(coordinates[0], coordinates[1]);
            if (femaData) {
                floodZone = femaData.zone;
                console.log(`[USParcelService] FEMA flood zone: ${floodZone} (${femaData.zoneDescription})`);
            }
        } catch {
            // FEMA fetch failed, keep default 'X'
        }

        return {
            parcelId,
            lotAreaSqFt: lotArea > 0 ? Math.round(lotArea) : 0,
            title: {
                ownerName,
                ownerType,
                lastSaleDate: saleDate,
                lastSalePrice: salePrice || Math.round(assessedValue * 0.85),
                assessedValue,
            },
            zoning: {
                zoningCode,
                zoningDescription: this.inferZoningDescription(zoningCode),
                jurisdiction: 'County',
                floodZone,
            },
            encumbrances: [],
            dueDiligence: {
                altaSurveyStatus: assessedValue > 0 ? 'In Progress' : 'Required',
                relativePositionalPrecision: '0.07 feet + 50 ppm (Urban standard)',
                recognizedEnvironmentalConditions: 'Phase I ESA Recommended',
                titleCommitmentStatus: 'Pending',
            },
            source: 'arcgis',
        };
    },

    /**
     * Search ArcGIS Hub for parcel feature services for any US city.
     */
    async queryArcGISHub(location: string, coordinates: [number, number]): Promise<USParcelData | null> {
        const city = location.split(',')[0].trim();

        // Search ArcGIS Hub for parcel layers
        const searchUrl = `https://hub.arcgis.com/api/v3/datasets?filter[type]=Feature%20Service&filter[keyword]=parcel%20${encodeURIComponent(city)}&page[size]=3`;

        try {
            const res = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
            if (!res.ok) return null;
            const data = await res.json();

            if (data.data && data.data.length > 0) {
                const serviceUrl = data.data[0].attributes?.url;
                if (serviceUrl) {
                    return this.queryArcGISParcel(
                        serviceUrl,
                        { parcelId: 'APN', owner: 'OWNER', zoning: 'ZONING', assessedValue: 'ASSESSED_VALUE' },
                        coordinates,
                    );
                }
            }
        } catch {
            // Hub search failed
        }

        return null;
    },

    /**
     * LLM-based parcel data generation (fallback when no ArcGIS data available).
     */
    async getParcelDataViaLLM(location: string, areaSqm: number): Promise<USParcelData> {
        try {
            const { generateWithFallback } = await import('@/ai/model-fallback');
            const areaSqFt = Math.round(areaSqm * 10.7639);

            const prompt = `You are a commercial real estate county assessor dataset emulator. Generate a highly realistic, plausible parcel profile for a ${areaSqm} sqm (${areaSqFt} sqft) commercial/mixed-use plot located in or around ${location}, US.
Return ONLY valid JSON matching this exact schema:
{
  "parcelId": "A realistic APN format for the county (e.g., TCAD-xxxx for Austin)",
  "lotAreaSqFt": ${areaSqFt},
  "title": {
    "ownerName": "A realistic corporate/trust owner name",
    "ownerType": "Corporate or Trust",
    "lastSaleDate": "YYYY-MM-DD",
    "lastSalePrice": number (realistic for the area),
    "assessedValue": number (realistic for the area)
  },
  "zoning": {
    "zoningCode": "Realistic local zoning code (e.g. CBD, C-3, SM-SLU)",
    "zoningDescription": "Description of that zoning code",
    "jurisdiction": "City or County name",
    "floodZone": "X, A, AE, etc."
  },
  "encumbrances": [
    { "type": "Easement or Lien", "description": "Realistic description", "status": "Active" }
  ],
  "dueDiligence": {
    "altaSurveyStatus": "Required",
    "relativePositionalPrecision": "0.07 feet + 50 ppm",
    "recognizedEnvironmentalConditions": "Phase I ESA Required",
    "titleCommitmentStatus": "Pending"
  }
}
Do not include markdown or extra text.`;

            const response = await generateWithFallback(prompt, 'gemini');

            // Extract JSON from potential markdown/text wrapper
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) throw new Error('No JSON found in LLM response');

            const cleanJson = jsonMatch[0];
            const data = JSON.parse(cleanJson);

            console.log(`[USParcelService] LLM parcel data generated for ${location}`);
            return { ...data, source: 'llm' };
        } catch (error) {
            console.error('[USParcelService] LLM parcel fallback failed:', error);
            return this.getHardcodedFallback(location, areaSqm);
        }
    },

    /**
     * Hardcoded fallback (last resort).
     */
    getHardcodedFallback(location: string, areaSqm: number): USParcelData {
        const areaSqFt = Math.round(areaSqm * 10.7639);
        return {
            parcelId: `APN-${Math.floor(Math.random() * 10000000)}`,
            lotAreaSqFt: areaSqFt,
            title: {
                ownerName: 'National Holdings LLC',
                ownerType: 'Corporate',
                lastSaleDate: '2018-05-12',
                lastSalePrice: 1500000,
                assessedValue: 1850000,
            },
            zoning: {
                zoningCode: 'C-2',
                zoningDescription: 'General Commercial',
                jurisdiction: 'County',
                floodZone: 'X',
            },
            encumbrances: [],
            dueDiligence: {
                altaSurveyStatus: 'Available',
                relativePositionalPrecision: '0.05 feet + 50 ppm',
                recognizedEnvironmentalConditions: 'Clear',
                titleCommitmentStatus: 'Issued',
            },
            source: 'fallback',
        };
    },

    /**
     * Infer a human-readable zoning description from a code.
     */
    inferZoningDescription(code: string): string {
        const upper = code.toUpperCase();
        if (/^R-?[1-5]|^SF|^RS|RESIDENTIAL/.test(upper)) return 'Single/Multi-Family Residential';
        if (/^C-?[1-5]|^CBD|^GC|COMMERCIAL|^CS/.test(upper)) return 'General Commercial';
        if (/^MU|^MX|MIXED/.test(upper)) return 'Mixed Use';
        if (/^I-?[1-3]|^LI|^HI|INDUSTRIAL/.test(upper)) return 'Industrial';
        if (/^O-?[1-3]|OFFICE/.test(upper)) return 'Office';
        if (/^PD|PLANNED/.test(upper)) return 'Planned Development';
        if (/^A-?[1-3]|^AG|AGRICULTURAL/.test(upper)) return 'Agricultural';
        if (/^P-?[1-3]|PUBLIC|INSTITUTIONAL/.test(upper)) return 'Public/Institutional';
        return code;
    },
};

export default USParcelService;
