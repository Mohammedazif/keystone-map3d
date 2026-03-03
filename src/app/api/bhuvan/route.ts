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

/**
 * Bhuvan WMS Proxy
 *
 * Accepts an optional `_bhuvanUrl` query parameter that specifies the full
 * Bhuvan WMS endpoint to proxy to. If omitted, defaults to the standard
 * vec2 endpoint: https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms
 *
 * Different Bhuvan thematic layers live on different servers:
 *   vec1 → NUIS (Urban Land Use 10K)
 *   vec2 → LULC 50K, SIS-DP Phase 2, Land Degradation, Wasteland, etc.
 *   vec3 → AMRUT (Urban Land Use 4K)
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  // Allow the client to specify a custom Bhuvan WMS endpoint
  const customUrl = searchParams.get('_bhuvanUrl');
  const baseUrl = customUrl || 'https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms';
  const targetUrl = new URL(baseUrl);
  
  // Copy all params from incoming request to Bhuvan request (except our internal param)
  searchParams.forEach((value, key) => {
    if (key === '_bhuvanUrl') return; // Don't forward our internal param
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

      // ── Guard: Bhuvan sometimes returns XML ServiceException with image/png content-type ──
      // This causes Mapbox "Could not load image because of The source image could not be decoded"
      // Detect this and return a 1x1 transparent PNG instead.
      const bytes = new Uint8Array(buffer);
      if (bytes.length > 0 && bytes.length < 2000) {
        // Check for XML header in what should be an image
        const headerStr = new TextDecoder().decode(bytes.slice(0, 100));
        if (headerStr.includes('<?xml') || headerStr.includes('ServiceException') || headerStr.includes('<ows:')) {
          console.warn('[Bhuvan Proxy] Got XML error disguised as image:', headerStr.slice(0, 200));
          // Return a 1x1 transparent PNG
          const transparentPng = Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            'base64'
          );
          return new NextResponse(transparentPng, {
            status: 200,
            headers: {
              'Content-Type': 'image/png',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=60', // Short cache for errors
            },
          });
        }
      }

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

    // For tile requests, return a transparent PNG instead of JSON error
    // to prevent Mapbox "Could not decode image" errors
    const requestType = searchParams.get('request') || '';
    if (requestType === 'GetMap') {
      const transparentPng = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      );
      return new NextResponse(transparentPng, {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'public, max-age=60',
        },
      });
    }

    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
