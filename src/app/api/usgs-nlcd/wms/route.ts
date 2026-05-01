import { NextRequest, NextResponse } from "next/server";

const USGS_NLCD_WMS_URL =
  "https://dmsdata.cr.usgs.gov/geoserver/mrlc_Land-Cover-Native_conus_year_data/wms";

const GRS80_A = 6378137;
const GRS80_F = 1 / 298.257222101;
const GRS80_E2 = 2 * GRS80_F - GRS80_F * GRS80_F;
const GRS80_E = Math.sqrt(GRS80_E2);
const STANDARD_PARALLEL_1 = toRadians(29.5);
const STANDARD_PARALLEL_2 = toRadians(45.5);
const LATITUDE_OF_ORIGIN = toRadians(23);
const CENTRAL_MERIDIAN = toRadians(-96);

const M1 = computeM(STANDARD_PARALLEL_1);
const M2 = computeM(STANDARD_PARALLEL_2);
const Q1 = computeQ(STANDARD_PARALLEL_1);
const Q2 = computeQ(STANDARD_PARALLEL_2);
const Q0 = computeQ(LATITUDE_OF_ORIGIN);
const N = (M1 * M1 - M2 * M2) / (Q2 - Q1);
const C = M1 * M1 + N * Q1;
const RHO0 = computeRho(Q0);

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function computeM(phi: number) {
  return Math.cos(phi) / Math.sqrt(1 - GRS80_E2 * Math.sin(phi) ** 2);
}

function computeQ(phi: number) {
  const sinPhi = Math.sin(phi);
  return (
    (1 - GRS80_E2) *
    ((sinPhi / (1 - GRS80_E2 * sinPhi * sinPhi)) -
      Math.log((1 - GRS80_E * sinPhi) / (1 + GRS80_E * sinPhi)) /
        (2 * GRS80_E))
  );
}

function computeRho(q: number) {
  return (GRS80_A * Math.sqrt(C - N * q)) / N;
}

function projectLonLatToEpsg5070(lng: number, lat: number) {
  const phi = toRadians(lat);
  const lambda = toRadians(lng);
  const theta = N * (lambda - CENTRAL_MERIDIAN);
  const rho = computeRho(computeQ(phi));

  return {
    x: rho * Math.sin(theta),
    y: RHO0 - rho * Math.cos(theta),
  };
}

function metersToLatLng(mx: number, my: number): [number, number] {
  const R = 6378137;
  const lng = (mx / R) * (180 / Math.PI);
  const lat = (Math.PI / 2 - 2 * Math.atan(Math.exp(-my / R))) * (180 / Math.PI);
  return [lat, lng];
}

function projectBboxTo5070(bbox: string, srs: string) {
  const parts = bbox.split(",").map(Number);
  if (parts.length !== 4 || parts.some((value) => Number.isNaN(value))) {
    return null;
  }

  let corners: Array<[number, number]> = [];
  if (srs === "EPSG:3857" || srs === "EPSG:900913") {
    const [minLat, minLng] = metersToLatLng(parts[0], parts[1]);
    const [maxLat, maxLng] = metersToLatLng(parts[2], parts[3]);
    corners = [
      [minLng, minLat],
      [maxLng, minLat],
      [maxLng, maxLat],
      [minLng, maxLat],
    ];
  } else if (srs === "EPSG:4326") {
    corners = [
      [parts[0], parts[1]],
      [parts[2], parts[1]],
      [parts[2], parts[3]],
      [parts[0], parts[3]],
    ];
  } else {
    return null;
  }

  const projected = corners.map(([lng, lat]) => projectLonLatToEpsg5070(lng, lat));
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);

  return `${Math.min(...xs)},${Math.min(...ys)},${Math.max(...xs)},${Math.max(...ys)}`;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const targetUrl = new URL(USGS_NLCD_WMS_URL);

  searchParams.forEach((value, key) => {
    targetUrl.searchParams.set(key, value);
  });

  const srs = searchParams.get("srs") || searchParams.get("crs") || "";
  const bbox = searchParams.get("bbox") || "";
  const projectedBbox = projectBboxTo5070(bbox, srs);

  if (projectedBbox) {
    targetUrl.searchParams.set("bbox", projectedBbox);
    targetUrl.searchParams.set("srs", "EPSG:5070");
    targetUrl.searchParams.delete("crs");
  }

  try {
    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: {
        Accept: "image/png,application/json,application/xml,text/html;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `USGS NLCD responded with status ${response.status}` },
        { status: response.status },
      );
    }

    const contentType = response.headers.get("content-type") || "image/png";

    if (contentType.includes("image/")) {
      const buffer = await response.arrayBuffer();
      return new NextResponse(buffer, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    if (contentType.includes("application/json")) {
      const json = await response.text();
      return new NextResponse(json, {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    const text = await response.text();
    return new NextResponse(text, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error: any) {
    console.error("USGS NLCD WMS Proxy Error:", error);

    const requestType = searchParams.get("request") || "";
    if (requestType === "GetMap") {
      const transparentPng = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      );
      return new NextResponse(transparentPng, {
        status: 200,
        headers: {
          "Content-Type": "image/png",
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=60",
        },
      });
    }

    return NextResponse.json(
      { error: error.message || "Internal Server Error" },
      { status: 500 },
    );
  }
}
