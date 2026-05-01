import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { location, marketData, parcelData, isParcelAware } = body;

    if (!location || !marketData) {
      return NextResponse.json({ error: 'location and marketData are required' }, { status: 400 });
    }

    const { generateWithFallback } = await import('@/ai/model-fallback');

    const parcelContext = parcelData ? `

## Parcel Data
- **APN:** ${parcelData.parcelId}
- **Zoning:** ${parcelData.zoning?.zoningCode} — ${parcelData.zoning?.zoningDescription}
- **Jurisdiction:** ${parcelData.zoning?.jurisdiction}
- **Owner:** ${parcelData.title?.ownerName} (${parcelData.title?.ownerType})
- **Assessed Value:** $${parcelData.title?.assessedValue?.toLocaleString()}
- **Last Sale:** $${parcelData.title?.lastSalePrice?.toLocaleString()} on ${parcelData.title?.lastSaleDate}
- **Flood Zone:** ${parcelData.zoning?.floodZone}
- **Encumbrances:** ${parcelData.encumbrances?.length || 0} on record
- **ALTA/NSPS Survey:** ${parcelData.dueDiligence?.altaSurveyStatus || 'Not Available'}
- **Environmental (RECs):** ${parcelData.dueDiligence?.recognizedEnvironmentalConditions || 'Unknown'}
- **Title Commitment:** ${parcelData.dueDiligence?.titleCommitmentStatus || 'Pending'}` : '';

    const prompt = `You are a senior real estate investment analyst preparing a professional site intelligence report for **${location}**. Write a structured, concise markdown summary using the market data below.

## Market Context
- **Unemployment Rate:** ${marketData.economy?.unemploymentRate}%
- **Median Household Income:** $${marketData.economy?.medianIncome?.toLocaleString()}
- **Population:** ${marketData.population?.population?.toLocaleString()} (${marketData.population?.growthTier})
- **Median Age:** ${marketData.population?.medianAge}
- **Building Permits:** ${marketData.permits?.totalUnits?.toLocaleString()} units/yr
- **Permit Valuation:** $${((marketData.permits?.valuation || 0) / 1e9).toFixed(1)}B
- **Market Tier:** ${marketData.marketZone?.tier} — ${marketData.marketZone?.permitGrowthIndicator}${parcelContext}

Write your response in this EXACT structure:

## Market Overview
2-3 sentences on the economic climate and why this market is or isn't attractive for development.

## Key Strengths
- Strength backed by the data
- Strength backed by the data
- Strength backed by the data

## Risk Factors
- Risk specific to this market or parcel
- Risk specific to this market or parcel${isParcelAware ? `

## Parcel Assessment
2-3 sentences evaluating this specific parcel's development viability — cover zoning compatibility, title status, and any encumbrances or flood risk.` : ''}

## Investment Outlook
2-3 sentence conclusion with a clear investment recommendation.`;

    const summary = await generateWithFallback(prompt, 'gemini');
    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('[AI Summary] Error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
