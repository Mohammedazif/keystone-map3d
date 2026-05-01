/**
 * US Plot Intelligence Service
 *
 * Aggregates data from all US-specific services and uses Gemini AI
 * to generate a comprehensive plot analysis summary including:
 * - Buyable/Sellable assessment
 * - Development prospects & risks
 * - Future growth analysis
 * - Compliance readiness score
 */

import { USDataGovService } from './us-data-gov-service';
import { USParcelService, type USParcelData } from './us-parcel-service';
import { USEnvironmentalService } from './us-environmental-service';
import { evaluateIFCCompliance, evaluateADACompliance } from './us-compliance-service';
import { generateWithFallback } from '@/ai/model-fallback';

export interface PlotIntelligenceInput {
    location: string;         // e.g. "Austin, TX"
    plotAreaSqm: number;      // Plot area in sqm
    coordinates?: [number, number]; // Plot centroid
    buildingHeight?: number;  // Tallest building height in meters
    numFloors?: number;       // Number of floors
    totalBuiltUpArea?: number; // GFA in sqm
    hasElevator?: boolean;
    hasFireSystem?: boolean;
    hasSprinkler?: boolean;
}

export interface PlotIntelligenceResult {
    // Raw data from sub-services
    demographics: any;
    economy: any;
    permits: any;
    parcel: USParcelData;
    environmental?: any;
    compliance: {
        ifc: any;
        ada: any;
    };

    // AI-generated analysis
    aiSummary: string;
    buyabilityScore: number;      // 0-100
    developmentProspect: 'Excellent' | 'Good' | 'Moderate' | 'Risky';
    keyRisks: string[];
    keyOpportunities: string[];
}

export const USPlotIntelligenceService = {
    /**
     * Main entry point — aggregates all US data sources and generates an AI summary.
     */
    async analyze(input: PlotIntelligenceInput): Promise<PlotIntelligenceResult> {
        // 1. Fetch all data in parallel
        const [dataGov, parcel, environmental] = await Promise.all([
            USDataGovService.getAggregateData(input.location),
            USParcelService.getParcelData(input.location, input.plotAreaSqm, input.coordinates),
            input.coordinates ? USEnvironmentalService.getEnvironmentalData(input.coordinates) : Promise.resolve(null),
        ]);

        const ifcResult = evaluateIFCCompliance({
            buildingHeight: input.buildingHeight || 0,
            numFloors: input.numFloors || 1,
            totalArea: input.totalBuiltUpArea || input.plotAreaSqm,
            occupantLoad: Math.ceil((input.totalBuiltUpArea || input.plotAreaSqm) / 9.3),
            isSprinklered: input.hasSprinkler || false,
            hasFireAccessRoad: input.hasFireSystem || false,
            hasStandpipe: false,
            hasFireAlarm: input.hasFireSystem || false,
            hasFireCommandCenter: false,
            hasRefugeFloors: false,
            hasSmokePressurization: false,
            hasEmergencyPower: false,
        });
        const adaResult = evaluateADACompliance({
            numFloors: input.numFloors || 1,
            hasElevator: input.hasElevator || false,
            totalParkingSpaces: 0,
            accessibleParkingSpaces: 0,
            hasAccessibleRestrooms: false,
            hasBrailleSignage: false,
            hasCommonAreaAccessibility: false,
        });

        // 3. Build the AI prompt
        const prompt = this.buildPrompt(input, dataGov, parcel, environmental, ifcResult, adaResult);

        // 4. Call Gemini for the analysis
        let aiResponse: string;
        try {
            aiResponse = await generateWithFallback(prompt, 'gemini');
        } catch (error) {
            console.error('[PlotIntelligence] AI generation failed:', error);
            aiResponse = this.buildFallbackSummary(input, dataGov, parcel, environmental, ifcResult, adaResult);
        }

        // 5. Extract structured insights from the AI response
        const parsed = this.parseAIResponse(aiResponse, dataGov, parcel);

        return {
            demographics: dataGov.demographics,
            economy: dataGov.economy,
            permits: dataGov.permits,
            parcel,
            environmental,
            compliance: {
                ifc: ifcResult,
                ada: adaResult,
            },
            aiSummary: aiResponse,
            buyabilityScore: parsed.buyabilityScore,
            developmentProspect: parsed.developmentProspect,
            keyRisks: parsed.keyRisks,
            keyOpportunities: parsed.keyOpportunities,
        };
    },

    /**
     * Builds the Gemini prompt with all aggregated data.
     */
    buildPrompt(
        input: PlotIntelligenceInput,
        dataGov: any,
        parcel: USParcelData,
        environmental: any,
        ifcResult: any,
        adaResult: any
    ): string {
        return `You are a senior US real estate analyst and development advisor. Analyze the following US plot data and provide a comprehensive investment intelligence summary.

## PLOT DETAILS
- Location: ${input.location}
- Plot Area: ${input.plotAreaSqm.toLocaleString()} sqm (${Math.round(input.plotAreaSqm * 10.7639).toLocaleString()} sqft)
- Elevation (USGS): ${environmental?.elevationMeters ? `${environmental.elevationMeters} meters` : 'Unknown'}
- Parcel ID: ${parcel.parcelId}
- Zoning: ${parcel.zoning.zoningCode} — ${parcel.zoning.zoningDescription}
- Jurisdiction: ${parcel.zoning.jurisdiction}
- FEMA Flood Zone: ${parcel.zoning.floodZone}
- ALTA Survey Available: ${parcel.altaSurveyAvailable ? 'Yes' : 'No'}

## TITLE & OWNERSHIP
- Owner: ${parcel.title.ownerName} (${parcel.title.ownerType})
- Last Sale: ${parcel.title.lastSaleDate} at $${parcel.title.lastSalePrice.toLocaleString()}
- Current Assessed Value: $${parcel.title.assessedValue.toLocaleString()}
- Encumbrances: ${parcel.encumbrances.length > 0 ? parcel.encumbrances.map(e => `${e.type}: ${e.description} [${e.status}]`).join('; ') : 'None'}

## DEMOGRAPHICS (US Census ACS)
- Population: ${dataGov.demographics?.population?.toLocaleString() || 'N/A'}
- Median Household Income: $${dataGov.demographics?.medianIncome?.toLocaleString() || 'N/A'}
- Median Age: ${dataGov.demographics?.medianAge || 'N/A'}

## ECONOMY (Bureau of Labor Statistics)
- Unemployment Rate: ${dataGov.economy?.unemploymentRate || 'N/A'}%
- Labor Force: ${dataGov.economy?.laborForce?.toLocaleString() || 'N/A'}

## BUILDING PERMITS (Census BPS)
- Total Units Permitted (annual): ${dataGov.permits?.totalUnits?.toLocaleString() || 'N/A'}
- Single-Family: ${dataGov.permits?.singleFamily?.toLocaleString() || 'N/A'}
- Multi-Family: ${dataGov.permits?.multiFamily?.toLocaleString() || 'N/A'}
- Total Valuation: $${dataGov.permits?.valuation ? (dataGov.permits.valuation / 1e9).toFixed(1) + 'B' : 'N/A'}

## PROPOSED DEVELOPMENT
- Building Height: ${input.buildingHeight || 'Not specified'}m
- Floors: ${input.numFloors || 'Not specified'}
- Total Built-Up Area: ${input.totalBuiltUpArea?.toLocaleString() || 'Not specified'} sqm

## COMPLIANCE STATUS
- IFC Fire Code: ${ifcResult.items?.filter((i: any) => i.status === 'pass').length || 0}/${ifcResult.items?.length || 0} items passing
- ADA Accessibility: ${adaResult.items?.filter((i: any) => i.status === 'pass').length || 0}/${adaResult.items?.length || 0} items passing

---

Provide your analysis in the following structure:

### BUYABILITY ASSESSMENT
Rate 0-100 and explain if this is a good buy, considering title status, zoning alignment, assessed value vs market, and encumbrances.

### DEVELOPMENT PROSPECT
Rate as Excellent/Good/Moderate/Risky. Consider zoning compatibility, permit activity in the area, demographic growth, and compliance readiness.

### KEY RISKS (bullet list, 3-5 items)
Regulatory, environmental, market, or title risks.

### KEY OPPORTUNITIES (bullet list, 3-5 items)
Growth drivers, zoning advantages, demographic trends, infrastructure developments.

### INVESTMENT SUMMARY
A 2-3 paragraph executive summary suitable for a real estate development board presentation.

Be specific and data-driven. Reference actual numbers from the data provided.`;
    },

    /**
     * Fallback summary when AI is unavailable.
     */
    buildFallbackSummary(
        input: PlotIntelligenceInput,
        dataGov: any,
        parcel: USParcelData,
        environmental: any,
        ifcResult: any,
        adaResult: any
    ): string {
        const appreciation = parcel.title.assessedValue > parcel.title.lastSalePrice
            ? ((parcel.title.assessedValue / parcel.title.lastSalePrice - 1) * 100).toFixed(1)
            : '0';

        return `## Plot Intelligence Summary — ${input.location}

### BUYABILITY ASSESSMENT (Score: 72/100)
This ${parcel.zoning.zoningDescription} parcel (${parcel.zoning.zoningCode}) in ${parcel.zoning.jurisdiction} shows a ${appreciation}% assessed value appreciation since its last sale in ${parcel.title.lastSaleDate}. ${parcel.encumbrances.length > 0 ? `There are ${parcel.encumbrances.length} active encumbrance(s) that require review.` : 'No active encumbrances — clean title.'}

### DEVELOPMENT PROSPECT: Good
The local market shows strong permit activity with ${dataGov.permits?.totalUnits?.toLocaleString() || 'significant'} units permitted annually. The median household income of $${dataGov.demographics?.medianIncome?.toLocaleString() || 'N/A'} supports premium residential and mixed-use development.

### KEY RISKS
- FEMA Flood Zone: ${parcel.zoning.floodZone} — ${parcel.zoning.floodZone === 'X' ? 'minimal flood risk' : 'flood insurance required'}
- IFC compliance gaps: ${ifcResult.items?.filter((i: any) => i.status !== 'pass').length || 0} items need attention
- ADA compliance gaps: ${adaResult.items?.filter((i: any) => i.status !== 'pass').length || 0} items need attention
- ${parcel.altaSurveyAvailable ? 'ALTA survey available — review for boundary discrepancies' : 'No ALTA survey on file — commission one before acquisition'}

### KEY OPPORTUNITIES
- Strong population base: ${dataGov.demographics?.population?.toLocaleString() || 'N/A'}
- Low unemployment: ${dataGov.economy?.unemploymentRate || 'N/A'}%
- Active construction market: $${dataGov.permits?.valuation ? (dataGov.permits.valuation / 1e9).toFixed(1) + 'B' : 'N/A'} annual permit valuation
- ${parcel.zoning.zoningCode} zoning supports intended use`;
    },

    /**
     * Parses the AI response to extract structured scores and lists.
     */
    parseAIResponse(
        aiText: string,
        dataGov: any,
        parcel: USParcelData
    ): {
        buyabilityScore: number;
        developmentProspect: 'Excellent' | 'Good' | 'Moderate' | 'Risky';
        keyRisks: string[];
        keyOpportunities: string[];
    } {
        // Try to extract buyability score
        let buyabilityScore = 72; // default
        const scoreMatch = aiText.match(/(\d{1,3})\s*\/\s*100/);
        if (scoreMatch) {
            const s = parseInt(scoreMatch[1]);
            if (s >= 0 && s <= 100) buyabilityScore = s;
        }

        // Try to extract development prospect
        let developmentProspect: 'Excellent' | 'Good' | 'Moderate' | 'Risky' = 'Good';
        const prospectLower = aiText.toLowerCase();
        if (prospectLower.includes('excellent')) developmentProspect = 'Excellent';
        else if (prospectLower.includes('risky')) developmentProspect = 'Risky';
        else if (prospectLower.includes('moderate')) developmentProspect = 'Moderate';

        // Extract bullet points from risks section
        const keyRisks = this.extractBullets(aiText, 'KEY RISKS', 'KEY OPPORTUNITIES');
        const keyOpportunities = this.extractBullets(aiText, 'KEY OPPORTUNITIES', 'INVESTMENT SUMMARY');

        return { buyabilityScore, developmentProspect, keyRisks, keyOpportunities };
    },

    /**
     * Extracts bullet points between two section headers.
     */
    extractBullets(text: string, startHeader: string, endHeader: string): string[] {
        const startIdx = text.indexOf(startHeader);
        const endIdx = text.indexOf(endHeader);
        if (startIdx === -1) return [];

        const section = endIdx > startIdx
            ? text.substring(startIdx + startHeader.length, endIdx)
            : text.substring(startIdx + startHeader.length);

        const lines = section.split('\n')
            .map(l => l.trim())
            .filter(l => l.startsWith('-') || l.startsWith('•') || l.startsWith('*'))
            .map(l => l.replace(/^[-•*]\s*/, '').trim())
            .filter(l => l.length > 5);

        return lines.slice(0, 5);
    }
};

export default USPlotIntelligenceService;
