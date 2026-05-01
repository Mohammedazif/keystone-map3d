import { NextRequest, NextResponse } from 'next/server';

/**
 * US Parcel Search API
 * Searches ArcGIS Feature Services for parcels matching user criteria.
 *
 * Key insight: The TCAD external parcel layer has NULL for ZONING and LAND_VALUE
 * on most parcels. The ONLY reliable numeric field is `Shape__Area` (in sq ft).
 * So we filter exclusively by area + spatial envelope and vary results based on
 * the user's intent by adjusting area ranges and sort order.
 */

interface ParcelSearchParams {
    location: string;
    coordinates: [number, number];
    intendedUse?: string;
    zoningPreference?: string;
    plotType?: string;
    priceRange?: string;
    minAreaSqft?: number;
    maxAreaSqft?: number;
    targetAreaSqft?: number;
    minValue?: number;
    maxValue?: number;
    maxResults?: number;
}

const COUNTY_ENDPOINTS: Record<string, {
    queryUrl: string;
    areaField: string;
    /** Field(s) to check for vacancy: vacant parcels have no SITUS address */
    addressFields: string[];
    /** Optional: improvement value field. If 0 → vacant */
    improvementField?: string;
    label: string;
}> = {
    austin: {
        queryUrl: 'https://services.arcgis.com/0L95CJ0VTaxqcmED/ArcGIS/rest/services/EXTERNAL_tcad_parcel/FeatureServer/0/query',
        areaField: 'Shape__Area',
        addressFields: ['SITUS', 'SITUS_STREET'],
        label: 'Travis County (TCAD)',
    },
    phoenix: {
        queryUrl: 'https://gis.maricopa.gov/arcgis/rest/services/RED/Assessor/MapServer/1/query',
        areaField: 'Shape_Area',
        addressFields: ['PropertyFullStreetAddress'],
        label: 'Maricopa County',
    },
    seattle: {
        queryUrl: 'https://gisdata.kingcounty.gov/arcgis/rest/services/OpenDataPortal/property__parcel_area/FeatureServer/439/query',
        areaField: 'Shape__Area',
        addressFields: ['ADDR_FULL'],
        label: 'King County',
    },
};

function resolveCounty(location: string, lng: number, lat: number): string | null {
    const loc = location.toLowerCase();
    if (loc.includes('austin') || loc.includes('travis')) return 'austin';
    if (loc.includes('phoenix') || loc.includes('maricopa')) return 'phoenix';
    if (loc.includes('seattle') || loc.includes('king')) return 'seattle';
    if (lng >= -98.2 && lng <= -97.3 && lat >= 30.0 && lat <= 30.7) return 'austin';
    if (lng >= -113.3 && lng <= -111.0 && lat >= 32.5 && lat <= 34.0) return 'phoenix';
    if (lng >= -122.6 && lng <= -121.0 && lat >= 47.0 && lat <= 47.8) return 'seattle';
    return null;
}

/**
 * Determine parcel area range, sort order, and search radius based on ALL user inputs:
 *   - plotType: Vacant → smaller undeveloped lots; Redevelopment → larger built parcels
 *   - intendedUse: Residential → small–medium; Commercial → medium–large; Industrial → very large
 *   - zoningPreference: Agricultural → rural/large; Built-up → urban/dense; Mixed-use → medium
 *
 * Priority: explicit sqft range > combined intent signals > defaults
 */
function getAreaStrategy(
    params: ParcelSearchParams,
): { minArea: number; maxArea: number; orderDir: 'ASC' | 'DESC'; radiusDeg: number; criteria: string } {
    const use = (params.intendedUse || '').toLowerCase();
    const pref = (params.zoningPreference || '').toLowerCase();
    const plot = (params.plotType || '').toLowerCase();

    // If user gave explicit sqft range from their land size input, use it as primary filter
    if (params.minAreaSqft && params.minAreaSqft > 0 && params.maxAreaSqft && params.maxAreaSqft < Infinity) {
        // Adjust radius based on zoning preference
        let radius = 0.06;
        if (pref.includes('agricultural') || pref.includes('waste')) radius = 0.15;
        else if (pref.includes('industrial')) radius = 0.12;
        else if (pref.includes('built') || pref.includes('mixed')) radius = 0.06;

        // Adjust sort order based on plot type
        const orderDir = plot.includes('redevelopment') ? 'DESC' as const : 'ASC' as const;

        const criteria = `Size: ${Math.round(params.minAreaSqft).toLocaleString()}–${Math.round(params.maxAreaSqft).toLocaleString()} sqft | ${params.intendedUse || 'Any'} | ${params.zoningPreference || 'Any'} | ${params.plotType || 'Any'}`;
        return { minArea: params.minAreaSqft, maxArea: params.maxAreaSqft, orderDir, radiusDeg: radius, criteria };
    }

    // Combined intent-based defaults
    // Industrial zoning/use → very large parcels, wide search
    if (pref.includes('industrial') || use.includes('industrial')) {
        return { minArea: 100000, maxArea: 10000000, orderDir: 'DESC', radiusDeg: 0.15, criteria: 'Industrial large lots' };
    }
    // Agricultural/Waste land → rural large plots
    if (pref.includes('agricultural') || pref.includes('waste')) {
        return { minArea: 50000, maxArea: 5000000, orderDir: 'DESC', radiusDeg: 0.12, criteria: 'Agricultural/rural large plots' };
    }
    // Commercial + Built-up → medium–large urban parcels
    if ((use.includes('commercial') || use.includes('mixed') || use.includes('retail') || use.includes('office')) && pref.includes('built')) {
        return { minArea: 8000, maxArea: 500000, orderDir: 'DESC', radiusDeg: 0.06, criteria: 'Commercial built-up urban parcels' };
    }
    // Commercial + Vacant → medium development-ready plots
    if ((use.includes('commercial') || use.includes('mixed')) && plot.includes('vacant')) {
        return { minArea: 10000, maxArea: 300000, orderDir: 'ASC', radiusDeg: 0.08, criteria: 'Vacant commercial development plots' };
    }
    // Residential + Built-up → redevelopment targets in dense areas
    if (use.includes('residential') && pref.includes('built')) {
        return { minArea: 5000, maxArea: 80000, orderDir: 'DESC', radiusDeg: 0.04, criteria: 'Residential built-up redevelopment' };
    }
    // Residential + Vacant → small undeveloped residential lots
    if (use.includes('residential') && (plot.includes('vacant') || pref.includes('vacant'))) {
        return { minArea: 2000, maxArea: 40000, orderDir: 'ASC', radiusDeg: 0.05, criteria: 'Vacant residential lots' };
    }
    // Mixed-use zoning → medium parcels
    if (pref.includes('mixed')) {
        return { minArea: 5000, maxArea: 200000, orderDir: 'ASC', radiusDeg: 0.06, criteria: 'Mixed-use parcels' };
    }
    // Redevelopment plot type → larger existing parcels
    if (plot.includes('redevelopment') || plot.includes('both')) {
        return { minArea: 8000, maxArea: 300000, orderDir: 'DESC', radiusDeg: 0.06, criteria: 'Redevelopment candidate parcels' };
    }

    // Default: medium lots
    return { minArea: 3000, maxArea: 200000, orderDir: 'ASC', radiusDeg: 0.07, criteria: 'General medium parcels' };
}

async function queryArcGIS(queryUrl: string, params: URLSearchParams): Promise<any[]> {
    const url = `${queryUrl}?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) {
        console.warn('[ParcelSearch] ArcGIS error:', JSON.stringify(data.error));
        return [];
    }
    return Array.isArray(data.features) ? data.features : [];
}

/**
 * Parse a centroid from a GeoJSON polygon feature.
 * ArcGIS sometimes returns coords as strings: "-97.69 30.30".
 */
function computeCentroid(geometry: any): [number, number] | null {
    const coords = geometry?.coordinates?.[0];
    if (!Array.isArray(coords) || coords.length === 0) return null;

    let lngSum = 0, latSum = 0, count = 0;
    for (const c of coords) {
        if (typeof c === 'string') {
            const parts = c.split(' ').map(Number);
            if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                lngSum += parts[0]; latSum += parts[1]; count++;
            }
        } else if (Array.isArray(c) && c.length >= 2) {
            lngSum += Number(c[0]); latSum += Number(c[1]); count++;
        }
    }
    return count > 0 ? [lngSum / count, latSum / count] : null;
}

/**
 * Searches ArcGIS Hub for a public parcel layer for the given city,
 * fetches its metadata to identify the correct field names, and returns
 * a dynamic endpoint configuration.
 */
async function findArcGISHubEndpoint(location: string): Promise<{ queryUrl: string, areaField: string, addressFields: string[], label: string } | null> {
    try {
        const city = location.split(',')[0].trim();
        const searchUrl = `https://hub.arcgis.com/api/v3/datasets?filter[type]=Feature%20Service&filter[keyword]=parcel%20${encodeURIComponent(city)}&page[size]=3`;
        
        const res = await fetch(searchUrl, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) return null;
        const data = await res.json();

        if (data.data && data.data.length > 0) {
            let serviceUrl = data.data[0].attributes?.url;
            if (!serviceUrl) return null;
            
            // Remove any trailing query path just in case
            serviceUrl = serviceUrl.replace(/\/query\/?$/, '');
            
            // Fetch layer metadata to determine fields
            const metaRes = await fetch(`${serviceUrl}?f=json`, { signal: AbortSignal.timeout(5000) });
            if (!metaRes.ok) return null;
            const meta = await metaRes.json();
            
            if (!meta.fields || !Array.isArray(meta.fields)) return null;
            
            let areaField = 'Shape__Area';
            const addressFields: string[] = [];
            
            for (const f of meta.fields) {
                const name = f.name.toUpperCase();
                if (name.includes('AREA')) areaField = f.name;
                if (name.includes('SITUS') || name.includes('ADDR')) addressFields.push(f.name);
            }
            
            const label = data.data[0].attributes?.name || `${city} Parcels`;
            console.log(`[ParcelSearch] Found Hub service for ${city}: ${label} (Area: ${areaField})`);
            
            return {
                queryUrl: `${serviceUrl}/query`,
                areaField,
                addressFields,
                label,
            };
        }
    } catch (err) {
        console.warn('[ParcelSearch] ArcGIS Hub search failed:', err);
    }
    return null;
}

export async function POST(request: NextRequest) {
    try {
        const params: ParcelSearchParams = await request.json();
        const { location, coordinates } = params;

        if (!location || !coordinates) {
            return NextResponse.json({ error: 'location and coordinates are required' }, { status: 400 });
        }

        const [lng, lat] = coordinates;
        const county = resolveCounty(location, lng, lat);

        let endpoint = county ? COUNTY_ENDPOINTS[county] : null;

        if (!endpoint) {
            console.log(`[ParcelSearch] No hardcoded county for ${location}. Attempting ArcGIS Hub fallback...`);
            endpoint = await findArcGISHubEndpoint(location);
            
            if (!endpoint) {
                return NextResponse.json({
                    success: true, parcels: [],
                    message: 'No supported county ArcGIS service found for this location.',
                });
            }
        }
        const maxResults = params.maxResults || 10;
        const strategy = getAreaStrategy(params);

        // Build spatial envelope
        const envelope = JSON.stringify({
            xmin: lng - strategy.radiusDeg,
            ymin: lat - strategy.radiusDeg,
            xmax: lng + strategy.radiusDeg,
            ymax: lat + strategy.radiusDeg,
            spatialReference: { wkid: 4326 },
        });

        // Build WHERE clause using Shape__Area (the ONLY reliable field)
        let where = `${endpoint.areaField} >= ${strategy.minArea} AND ${endpoint.areaField} <= ${strategy.maxArea}`;
        
        // Add vacancy filtering if requested
        const isVacant = (params.plotType || '').toLowerCase().includes('vacant');
        const isRedevelopment = (params.plotType || '').toLowerCase().includes('redevelopment');
        
        if (isVacant) {
            // Vacant parcels typically have no address or a specific improvement state code
            if (endpoint.improvementField) {
                // In TCAD, IMPRV_STATE_CD might be null or 0 for vacant
                where += ` AND (${endpoint.improvementField} IS NULL OR ${endpoint.improvementField} = '0' OR ${endpoint.improvementField} = '')`;
            } else if (endpoint.addressFields && endpoint.addressFields.length > 0) {
                where += ` AND (${endpoint.addressFields[0]} IS NULL OR ${endpoint.addressFields[0]} = '')`;
            }
        } else if (isRedevelopment) {
            // Built parcels typically have an address
            if (endpoint.improvementField) {
                where += ` AND ${endpoint.improvementField} IS NOT NULL AND ${endpoint.improvementField} <> '0' AND ${endpoint.improvementField} <> ''`;
            } else if (endpoint.addressFields && endpoint.addressFields.length > 0) {
                where += ` AND ${endpoint.addressFields[0]} IS NOT NULL AND ${endpoint.addressFields[0]} <> ''`;
            }
        }

        console.log(`[ParcelSearch] Querying ${county}: ${where} | order: ${endpoint.areaField} ${strategy.orderDir} | radius: ${strategy.radiusDeg}° | criteria: ${strategy.criteria}`);

        const searchParams = new URLSearchParams({
            where,
            geometry: envelope,
            geometryType: 'esriGeometryEnvelope',
            spatialRel: 'esriSpatialRelIntersects',
            inSR: '4326',
            outSR: '4326',
            outFields: '*',
            returnGeometry: 'true',
            f: 'geojson',
            resultRecordCount: String(maxResults * 3),
            orderByFields: `${endpoint.areaField} ${strategy.orderDir}`,
        });

        let features = await queryArcGIS(endpoint.queryUrl, searchParams);
        console.log(`[ParcelSearch] L1 (area-filtered): ${features.length} features`);

        // Base vacancy condition string to append
        let vacancyCondition = '';
        if (isVacant) {
            if (endpoint.improvementField) vacancyCondition = ` AND (${endpoint.improvementField} IS NULL OR ${endpoint.improvementField} = '0' OR ${endpoint.improvementField} = '')`;
            else if (endpoint.addressFields && endpoint.addressFields.length > 0) vacancyCondition = ` AND (${endpoint.addressFields[0]} IS NULL OR ${endpoint.addressFields[0]} = '')`;
        } else if (isRedevelopment) {
            if (endpoint.improvementField) vacancyCondition = ` AND ${endpoint.improvementField} IS NOT NULL AND ${endpoint.improvementField} <> '0' AND ${endpoint.improvementField} <> ''`;
            else if (endpoint.addressFields && endpoint.addressFields.length > 0) vacancyCondition = ` AND ${endpoint.addressFields[0]} IS NOT NULL AND ${endpoint.addressFields[0]} <> ''`;
        }

        // Fallback: if nothing in that area range, broaden significantly
        if (features.length === 0) {
            searchParams.set('where', `${endpoint.areaField} > 1000` + vacancyCondition);
            features = await queryArcGIS(endpoint.queryUrl, searchParams);
            console.log(`[ParcelSearch] L2 (broadened): ${features.length} features`);
        }

        // Last resort: no filter (just vacancy)
        if (features.length === 0) {
            searchParams.set('where', '1=1' + vacancyCondition);
            features = await queryArcGIS(endpoint.queryUrl, searchParams);
            console.log(`[ParcelSearch] L3 (unfiltered): ${features.length} features`);
        }

        if (features.length === 0) {
            return NextResponse.json({
                success: true, parcels: [],
                message: 'No parcels found in this area.',
            });
        }

        // Log available fields once for debugging
        if (features[0]?.properties) {
            console.log(`[ParcelSearch] Fields: ${Object.keys(features[0].properties).join(', ')}`);
        }

        // Detect fields dynamically
        const firstProps = features[0]?.properties || {};
        const detect = (candidates: string[]): string => {
            for (const c of candidates) { if (c in firstProps) return c; }
            return '';
        };
        const apnKey = detect(['PROP_ID', 'APN', 'PIN', 'PARCEL_ID']);
        const addrKey = detect(['SITUS', 'SITUS_STREET', 'PropertyFullStreetAddress', 'ADDRESS']);
        const zoningKey = detect(['ZONING', 'ZONING_CODE', 'PropertyUseDescription']);
        const valueKey = detect(['LAND_VALUE', 'FullCashValue', 'ASSESSED_VALUE']);

        // Map features to parcels
        let parcels = features
            .filter((f: any) => f.geometry)
            .map((f: any) => {
                const p = f.properties || {};
                const areaSqft = Number(p[endpoint.areaField]) || 0;
                const centroid = computeCentroid(f.geometry);
                return {
                    geometry: f.geometry,  // full polygon for map overlay
                    centroid,
                    apn: apnKey ? String(p[apnKey] || '') : '',
                    address: addrKey ? String(p[addrKey] || '') : '',
                    zoning: zoningKey ? String(p[zoningKey] || '') : '',
                    assessedValue: valueKey ? Number(p[valueKey]) || 0 : 0,
                    areaSqft: areaSqft > 0 ? Math.round(areaSqft) : 0,
                    areaSqm: areaSqft > 0 ? Math.round(areaSqft / 10.7639) : 0,
                    county: endpoint.label,
                };
            })
            .filter((p: any) => p.centroid !== null);

        // Helper to score how well a zoning code matches the intended use
        const getZoningMatchScore = (zoning: string, intendedUse: string): number => {
            if (!zoning || !intendedUse) return 0;
            const z = zoning.toLowerCase();
            const use = intendedUse.toLowerCase();
            
            if (use.includes('industrial') && (z.match(/\b(i|li|mi|ip|ind)\b/) || z.includes('industrial'))) return 100;
            if (use.includes('commercial') && (z.match(/\b(c|cs|gr|b|com)\b/) || z.includes('commercial') || z.includes('retail'))) return 100;
            if (use.includes('residential') && (z.match(/\b(r|sf|mf|res)\b/) || z.includes('residential') || z.includes('housing'))) return 100;
            
            if ((z.includes('mu') || z.includes('mixed')) && (use.includes('commercial') || use.includes('residential'))) return 50;
            
            return 0;
        };

        // Sort by zoning match first, then by size proximity
        parcels.sort((a: any, b: any) => {
            const matchA = getZoningMatchScore(a.zoning, params.intendedUse || '');
            const matchB = getZoningMatchScore(b.zoning, params.intendedUse || '');
            
            if (matchA !== matchB) {
                return matchB - matchA; // Highest zoning match first
            }

            if (params.targetAreaSqft && params.targetAreaSqft > 0) {
                const diffA = Math.abs(a.areaSqft - params.targetAreaSqft!);
                const diffB = Math.abs(b.areaSqft - params.targetAreaSqft!);
                return diffA - diffB; // Closest size first
            }
            return 0;
        });

        parcels = parcels.slice(0, maxResults);

        console.log(`[ParcelSearch] Returning ${parcels.length} parcels for ${county}`);

        return NextResponse.json({
            success: true,
            parcels,
            county: endpoint.label,
            totalFound: features.length,
            searchCriteria: strategy.criteria,
            filters: {
                intendedUse: params.intendedUse || 'Any',
                zoningPreference: params.zoningPreference || 'Any',
                plotType: params.plotType || 'Any',
                priceRange: params.priceRange || 'Any',
                areaRange: `${Math.round(strategy.minArea).toLocaleString()}–${Math.round(strategy.maxArea).toLocaleString()} sqft`,
            },
        });

    } catch (error: any) {
        console.error('[ParcelSearch] Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
