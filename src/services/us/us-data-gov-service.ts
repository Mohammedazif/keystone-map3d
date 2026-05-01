/**
 * US Federal Data Service
 *
 * Fetches demographic, economic, and building permit data from real US Federal APIs:
 * 1. US Census Bureau ACS API (Demographics: Population, Median Income, Median Age)
 * 2. Bureau of Labor Statistics API (Economy: Unemployment Rate, Labor Force)
 * 3. US Census Building Permits Survey (BPS)
 *
 * Falls back to LLM-generated data if API keys are missing or calls fail.
 *
 * Required env vars:
 *   US_CENSUS_API_KEY – free key from https://api.census.gov/data/key_signup.html
 *   US_BLS_API_KEY    – (optional) from https://www.bls.gov/developers/
 */

import { lookupFIPS, type FIPSResult } from './us-fips-lookup';

interface USDemographics {
    population: number;
    medianIncome: number;
    medianAge?: number;
    povertyRate?: number;
    source: 'census-api' | 'llm' | 'fallback';
}

interface USEconomy {
    unemploymentRate: number;
    laborForce: number;
    source: 'bls-api' | 'llm' | 'fallback';
}

interface USPermits {
    totalUnits: number;
    singleFamily: number;
    multiFamily: number;
    valuation: number;
    source: 'census-bps' | 'llm' | 'fallback';
}

interface USDataGovResponse {
    demographics: USDemographics | null;
    economy: USEconomy | null;
    permits: USPermits | null;
}

export const USDataGovService = {
    /**
     * Gets aggregate data for a US location.
     * Priority: Real API → LLM → Hardcoded fallback
     */
    async getAggregateData(location: string): Promise<USDataGovResponse> {
        const fips = lookupFIPS(location);
        console.log(`[USDataGovService] FIPS lookup for "${location}": ${fips.matchType} match → state=${fips.stateFips}, place=${fips.placeFips}`);

        // Run all three data fetches in parallel
        const [demographics, economy, permits] = await Promise.allSettled([
            this.fetchDemographics(fips, location),
            this.fetchEconomy(fips, location),
            this.fetchPermits(fips, location),
        ]);

        return {
            demographics: demographics.status === 'fulfilled' ? demographics.value : this.getFallbackDemographics(location),
            economy: economy.status === 'fulfilled' ? economy.value : this.getFallbackEconomy(location),
            permits: permits.status === 'fulfilled' ? permits.value : this.getFallbackPermits(location),
        };
    },

    /**
     * Fetches demographics from US Census Bureau ACS 5-Year API.
     * Variables: B01003_001E (Population), B19013_001E (Median Income), B01002_001E (Median Age)
     * Docs: https://www.census.gov/data/developers/data-sets/acs-5year.html
     */
    async fetchDemographics(fips: FIPSResult, location: string): Promise<USDemographics> {
        const apiKey = process.env.US_CENSUS_API_KEY;
        if (!apiKey) {
            console.warn('[USDataGovService] US_CENSUS_API_KEY not set — using LLM fallback for demographics');
            return this.fetchDemographicsViaLLM(location);
        }

        const variables = 'B01003_001E,B19013_001E,B01002_001E';

        // Try place-level first, then state-level
        const urls: string[] = [];
        if (fips.placeFips) {
            urls.push(
                `https://api.census.gov/data/2022/acs/acs5?get=${variables}&for=place:${fips.placeFips}&in=state:${fips.stateFips}&key=${apiKey}`
            );
        }
        // State-level fallback
        urls.push(
            `https://api.census.gov/data/2022/acs/acs5?get=${variables}&for=state:${fips.stateFips}&key=${apiKey}`
        );

        for (const url of urls) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) continue;
                const data = await res.json();

                // Census API returns: [ [header...], [values...] ]
                if (Array.isArray(data) && data.length > 1) {
                    const pop = parseInt(data[1][0]);
                    const income = parseInt(data[1][1]);
                    const age = parseFloat(data[1][2]);
                    if (pop > 0) {
                        console.log(`[USDataGovService] Census API success: pop=${pop}, income=${income}, age=${age}`);
                        return {
                            population: pop,
                            medianIncome: income > 0 ? income : 70000,
                            medianAge: age > 0 ? age : undefined,
                            source: 'census-api',
                        };
                    }
                }
            } catch (err) {
                console.warn(`[USDataGovService] Census API call failed:`, err);
            }
        }

        console.warn('[USDataGovService] Census API failed for all URLs — using LLM fallback');
        return this.fetchDemographicsViaLLM(location);
    },

    /**
     * Fetches unemployment from Bureau of Labor Statistics LAUS API.
     * Docs: https://www.bls.gov/developers/
     */
    async fetchEconomy(fips: FIPSResult, location: string): Promise<USEconomy> {
        const apiKey = process.env.US_BLS_API_KEY;

        if (!apiKey) {
            // BLS allows unauthenticated v1 requests (25/day limit)
            // Try the v1 endpoint with a known MSA series
            try {
                return await this.fetchEconomyV1(fips, location);
            } catch {
                console.warn('[USDataGovService] BLS v1 failed — using LLM fallback');
                return this.fetchEconomyViaLLM(location);
            }
        }

        // BLS LAUS series ID: LAUCT + state(2) + county(3) + 0000003 (unemployment rate)
        // For places: LAUCT + stateFips + placeFips + 0000003
        const currentYear = new Date().getFullYear();
        const seriesIds: string[] = [];

        if (fips.placeFips) {
            seriesIds.push(`LAUCT${fips.stateFips}${fips.placeFips}00000003`);
        }
        if (fips.countyFips) {
            seriesIds.push(`LAUCN${fips.stateFips}${fips.countyFips}0000000003`);
        }
        // State level
        seriesIds.push(`LASST${fips.stateFips}0000000000003`);

        for (const seriesId of seriesIds) {
            try {
                const res = await fetch('https://api.bls.gov/publicAPI/v2/timeseries/data/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        seriesid: [seriesId],
                        startyear: String(currentYear - 1),
                        endyear: String(currentYear),
                        registrationkey: apiKey,
                    }),
                    signal: AbortSignal.timeout(8000),
                });
                const data = await res.json();

                if (data.status === 'REQUEST_SUCCEEDED' && data.Results?.series?.[0]?.data?.length > 0) {
                    const rate = parseFloat(data.Results.series[0].data[0].value);
                    console.log(`[USDataGovService] BLS API success: unemployment=${rate}%`);
                    return {
                        unemploymentRate: rate,
                        laborForce: this.getFallbackEconomy(location).laborForce,
                        source: 'bls-api',
                    };
                }
            } catch (err) {
                console.warn(`[USDataGovService] BLS series ${seriesId} failed:`, err);
            }
        }

        return this.fetchEconomyViaLLM(location);
    },

    /**
     * BLS v1 (unauthenticated) — limited to 25 requests/day, no key needed
     */
    async fetchEconomyV1(fips: FIPSResult, location: string): Promise<USEconomy> {
        const currentYear = new Date().getFullYear();
        const seriesId = `LASST${fips.stateFips}0000000000003`;
        const url = `https://api.bls.gov/publicAPI/v1/timeseries/data/${seriesId}?startyear=${currentYear - 1}&endyear=${currentYear}`;

        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();

        if (data.status === 'REQUEST_SUCCEEDED' && data.Results?.series?.[0]?.data?.length > 0) {
            const rate = parseFloat(data.Results.series[0].data[0].value);
            console.log(`[USDataGovService] BLS v1 success: unemployment=${rate}%`);
            return {
                unemploymentRate: rate,
                laborForce: this.getFallbackEconomy(location).laborForce,
                source: 'bls-api',
            };
        }
        throw new Error('BLS v1 no data');
    },

    /**
     * Fetches building permit data from Census BPS API.
     */
    async fetchPermits(fips: FIPSResult, location: string): Promise<USPermits> {
        const apiKey = process.env.US_CENSUS_API_KEY;
        if (!apiKey) {
            return this.fetchPermitsViaLLM(location);
        }

        // Census Building Permits Survey (BPS) — correct endpoint
        // Variables: BLDGS (buildings), UNITS (total units), VALUATION (total valuation $1000s)
        // Data includes single-family and multi-family breakdowns
        const urls: string[] = [];

        // Try place-level BPS data first (if we have a place FIPS)
        if (fips.placeFips) {
            urls.push(
                `https://api.census.gov/data/2022/bps/place?get=BLDGS,UNITS,VALUATION&for=place:${fips.placeFips}&in=state:${fips.stateFips}&key=${apiKey}`
            );
        }
        // State-level BPS fallback (aggregated across all places in the state)
        urls.push(
            `https://api.census.gov/data/2022/bps/state?get=BLDGS,UNITS,VALUATION&for=state:${fips.stateFips}&key=${apiKey}`
        );

        for (const url of urls) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) continue;
                const data = await res.json();

                // Census BPS returns: [ [header...], [values...], ... ]
                if (Array.isArray(data) && data.length > 1) {
                    // Sum across all rows (there may be multiple rows for different building sizes)
                    let totalBldgs = 0, totalUnits = 0, totalVal = 0;
                    for (let i = 1; i < data.length; i++) {
                        totalBldgs += parseInt(data[i][0]) || 0;
                        totalUnits += parseInt(data[i][1]) || 0;
                        totalVal += parseInt(data[i][2]) || 0;
                    }

                    if (totalUnits > 0) {
                        // Estimate SF/MF split — BPS place-level doesn't always separate,
                        // so we use a 60/40 heuristic if not available
                        const singleFamily = Math.round(totalUnits * 0.6);
                        const multiFamily = totalUnits - singleFamily;

                        console.log(`[USDataGovService] Census BPS success: ${totalUnits} units, $${totalVal}K valuation`);
                        return {
                            totalUnits,
                            singleFamily,
                            multiFamily,
                            valuation: totalVal * 1000, // BPS reports in $1000s
                            source: 'census-bps',
                        };
                    }
                }
            } catch (err) {
                console.warn(`[USDataGovService] Census BPS call failed:`, err);
            }
        }

        console.warn('[USDataGovService] Census BPS failed for all URLs — using LLM fallback');
        return this.fetchPermitsViaLLM(location);
    },

    // ── LLM Fallback Methods ────────────────────────────────────────────────

    async fetchDemographicsViaLLM(location: string): Promise<USDemographics> {
        try {
            const { generateWithFallback } = await import('@/ai/model-fallback');
            const prompt = `You are a US Census data specialist. Provide accurate, real-world demographic data for ${location}, United States. Return ONLY valid JSON (no markdown, no explanation):
{"population": number, "medianIncome": number, "medianAge": number}
Use the latest available Census Bureau ACS estimates.`;
            const response = await generateWithFallback(prompt, 'gemini');
            const match = response.match(/\{[\s\S]*?\}/);
            if (match) {
                const data = JSON.parse(match[0]);
                return { ...data, source: 'llm' as const };
            }
        } catch (e) {
            console.warn('[USDataGovService] LLM demographics fallback failed:', e);
        }
        return { ...this.getFallbackDemographics(location), source: 'fallback' as const };
    },

    async fetchEconomyViaLLM(location: string): Promise<USEconomy> {
        try {
            const { generateWithFallback } = await import('@/ai/model-fallback');
            const prompt = `You are a US Bureau of Labor Statistics expert. Provide the latest unemployment rate and labor force size for ${location}, United States. Return ONLY valid JSON (no markdown, no explanation):
{"unemploymentRate": number, "laborForce": number}
Use the latest BLS LAUS data.`;
            const response = await generateWithFallback(prompt, 'gemini');
            const match = response.match(/\{[\s\S]*?\}/);
            if (match) {
                const data = JSON.parse(match[0]);
                return { ...data, source: 'llm' as const };
            }
        } catch (e) {
            console.warn('[USDataGovService] LLM economy fallback failed:', e);
        }
        return { ...this.getFallbackEconomy(location), source: 'fallback' as const };
    },

    async fetchPermitsViaLLM(location: string): Promise<USPermits> {
        try {
            const { generateWithFallback } = await import('@/ai/model-fallback');
            const prompt = `You are a US Census Building Permits Survey expert. Provide the latest annual building permit data for ${location}, United States. Return ONLY valid JSON (no markdown, no explanation):
{"totalUnits": number, "singleFamily": number, "multiFamily": number, "valuation": number}
Use the most recent Census Bureau BPS data. Valuation should be in US dollars.`;
            const response = await generateWithFallback(prompt, 'gemini');
            const match = response.match(/\{[\s\S]*?\}/);
            if (match) {
                const data = JSON.parse(match[0]);
                return { ...data, source: 'llm' as const };
            }
        } catch (e) {
            console.warn('[USDataGovService] LLM permits fallback failed:', e);
        }
        return { ...this.getFallbackPermits(location), source: 'fallback' as const };
    },

    // ── Hardcoded Fallbacks (last resort) ────────────────────────────────────

    getFallbackDemographics(location: string): USDemographics {
        const loc = location.toLowerCase();
        if (loc.includes('austin')) return { population: 974447, medianIncome: 86556, medianAge: 34.3, source: 'fallback' };
        if (loc.includes('phoenix')) return { population: 1644409, medianIncome: 72092, medianAge: 34.4, source: 'fallback' };
        if (loc.includes('seattle')) return { population: 749256, medianIncome: 116068, medianAge: 35.2, source: 'fallback' };
        if (loc.includes('dallas')) return { population: 1304379, medianIncome: 63812, medianAge: 33.5, source: 'fallback' };
        if (loc.includes('houston')) return { population: 2304580, medianIncome: 56019, medianAge: 33.9, source: 'fallback' };
        if (loc.includes('los angeles')) return { population: 3898747, medianIncome: 74226, medianAge: 36.2, source: 'fallback' };
        if (loc.includes('chicago')) return { population: 2696555, medianIncome: 65781, medianAge: 35.1, source: 'fallback' };
        if (loc.includes('miami')) return { population: 442241, medianIncome: 48143, medianAge: 40.2, source: 'fallback' };
        if (loc.includes('denver')) return { population: 715522, medianIncome: 85853, medianAge: 35.0, source: 'fallback' };
        if (loc.includes('atlanta')) return { population: 498715, medianIncome: 73195, medianAge: 33.8, source: 'fallback' };
        if (loc.includes('nashville')) return { population: 683622, medianIncome: 67180, medianAge: 34.4, source: 'fallback' };
        return { population: 500000, medianIncome: 75000, medianAge: 35.0, source: 'fallback' };
    },

    getFallbackEconomy(location: string): USEconomy {
        const loc = location.toLowerCase();
        if (loc.includes('austin')) return { unemploymentRate: 3.3, laborForce: 785000, source: 'fallback' };
        if (loc.includes('phoenix')) return { unemploymentRate: 3.5, laborForce: 1200000, source: 'fallback' };
        if (loc.includes('seattle')) return { unemploymentRate: 3.8, laborForce: 530000, source: 'fallback' };
        if (loc.includes('dallas')) return { unemploymentRate: 3.6, laborForce: 920000, source: 'fallback' };
        if (loc.includes('houston')) return { unemploymentRate: 4.1, laborForce: 1500000, source: 'fallback' };
        if (loc.includes('los angeles')) return { unemploymentRate: 4.8, laborForce: 2100000, source: 'fallback' };
        if (loc.includes('chicago')) return { unemploymentRate: 4.3, laborForce: 1400000, source: 'fallback' };
        if (loc.includes('miami')) return { unemploymentRate: 3.2, laborForce: 350000, source: 'fallback' };
        if (loc.includes('denver')) return { unemploymentRate: 3.4, laborForce: 480000, source: 'fallback' };
        return { unemploymentRate: 3.8, laborForce: 300000, source: 'fallback' };
    },

    getFallbackPermits(location: string): USPermits {
        const loc = location.toLowerCase();
        if (loc.includes('austin')) return { totalUnits: 24500, singleFamily: 12000, multiFamily: 12500, valuation: 4.2e9, source: 'fallback' };
        if (loc.includes('phoenix')) return { totalUnits: 32000, singleFamily: 22000, multiFamily: 10000, valuation: 5.8e9, source: 'fallback' };
        if (loc.includes('seattle')) return { totalUnits: 18000, singleFamily: 4000, multiFamily: 14000, valuation: 3.9e9, source: 'fallback' };
        if (loc.includes('dallas')) return { totalUnits: 28000, singleFamily: 16000, multiFamily: 12000, valuation: 4.8e9, source: 'fallback' };
        if (loc.includes('houston')) return { totalUnits: 35000, singleFamily: 24000, multiFamily: 11000, valuation: 5.2e9, source: 'fallback' };
        return { totalUnits: 10000, singleFamily: 6000, multiFamily: 4000, valuation: 2e9, source: 'fallback' };
    },
};

export default USDataGovService;
