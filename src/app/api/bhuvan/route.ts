import { NextRequest, NextResponse } from 'next/server';

/**
 * Converts EPSG:3857 (Web Mercator) meters to EPSG:4326 (WGS84) lat/lng.
 * Mapbox tile sources use EPSG:3857 internally, but Bhuvan WMS only supports EPSG:4326.
 */
function metersToLatLng(mx: number, my: number): [number, number] {
  const R = 6378137; // Earth radius in meters
  const lng = (mx / R) * (180 / Math.PI);
  const lat = (Math.PI / 2 - 2 * Math.atan(Math.exp(-my / R))) * (180 / Math.PI);
  return [lat, lng];
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = new URL('https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms');
  
  // Copy all params from incoming request to Bhuvan request
  searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  // If the request uses EPSG:3857 (Mapbox tiles), convert bbox and SRS to EPSG:4326
  // Bhuvan WMS does NOT support EPSG:3857 and returns XML errors instead of PNG tiles
  const srs = searchParams.get('srs') || searchParams.get('crs') || '';
  const bbox = searchParams.get('bbox') || '';
  
  if ((srs === 'EPSG:3857' || srs === 'EPSG:900913') && bbox) {
    const parts = bbox.split(',').map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      const [minLat, minLng] = metersToLatLng(parts[0], parts[1]);
      const [maxLat, maxLng] = metersToLatLng(parts[2], parts[3]);
      const newBbox = `${minLng},${minLat},${maxLng},${maxLat}`;
      targetUrl.searchParams.set('bbox', newBbox);
      targetUrl.searchParams.set('srs', 'EPSG:4326');
      targetUrl.searchParams.delete('crs');
    }
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'image/png,text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) {
      return NextResponse.json({ error: `Bhuvan responded with status ${response.status}` }, { status: response.status });
    }

    const contentType = response.headers.get('content-type') || 'image/png';
    
    // Return binary response for images (PNG tiles), text for GetFeatureInfo HTML
    if (contentType.includes('image/')) {
      const buffer = await response.arrayBuffer();
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=3600',
        },
      });
    } else {
      // GetFeatureInfo returns HTML/XML — return as text
      const data = await response.text();
      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
  } catch (error: any) {
    console.error('Bhuvan Proxy Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
