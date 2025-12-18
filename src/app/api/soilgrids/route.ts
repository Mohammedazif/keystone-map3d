import { type NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const lat = searchParams.get('lat');
  const lon = searchParams.get('lon');

  if (!lat || !lon) {
    return NextResponse.json({ error: 'Latitude and longitude are required' }, { status: 400 });
  }

  const soilGridsUrl = `https://rest.isric.org/soilgrids/v2.0/properties/query?lon=${lon}&lat=${lat}&depths=0-5cm&properties=phh2o,bdod`;

  try {
    const response = await fetch(soilGridsUrl);
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`SoilGrids API Error: ${response.status} ${errorText}`);
      return NextResponse.json({ error: `SoilGrids API failed with status ${response.status}` }, { status: response.status });
    }
    const data = await response.json();
    
    const phLayer = data.properties?.layers?.find((l: any) => l.name === 'phh2o');
    const bdLayer = data.properties?.layers?.find((l: any) => l.name === 'bdod');

    const phValue = phLayer?.depths[0]?.values?.mean;
    const bdValue = bdLayer?.depths[0]?.values?.mean;

    // SoilGrids values are scaled, so we convert them.
    // pH (phh2o) is scaled by 10.
    // Bulk Density (bdod) is in cg/cm³, scaled by 100. We convert to kg/dm³ (which is g/cm³).
    const result = {
      ph: phValue !== undefined ? phValue / 10 : null,
      bd: bdValue !== undefined ? bdValue / 100 : null,
    };

    return NextResponse.json(result);

  } catch (error) {
    console.error('Error fetching SoilGrids data:', error);
    return NextResponse.json({ error: 'Failed to fetch soil data' }, { status: 500 });
  }
}
