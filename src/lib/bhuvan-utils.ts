/**
 * Bhuvan Thematic Services Utilities
 *
 * Each layer can use a different WMS server/path. The API proxy
 * forwards requests to the correct Bhuvan endpoint based on
 * `wmsHost` and `wmsPath` stored on each theme.
 *
 * Layer naming patterns (from Bhuvan OGC docs):
 * ─────────────────────────────────────────────
 *  LULC  50K  →  lulc:{state}_LULC50K_{year}        (vec2 /bhuvan/wms)
 *  LD    50K  →  ld:{state}_LD50K_1516               (vec2 /bhuvan/wms)
 *  WL    50K  →  wasteland:{state}_WL50K_{year}      (vec2 /bhuvan/wms)
 *  GM    50K  →  geomorphology:{state}_GM50K_0506     (vec2 /bhuvan/wms)
 *  LN    50K  →  lineament:{state}_LN50K_0506        (vec2 /bhuvan/wms)
 *  SISDP Ph2  →  sisdp_phase2:SISDP_P2_LULC_10K_2016_2019_{state}  (vec2)
 *  AMRUT 4K   →  amrut_ph1:{state}_{city}_amrutph1_4k  (vec3, city-level)
 *  SIS-DP 10K →  sisdpv2:{state}_{district}_lulc_v2   (vec2 /bhuvan/sisdpv2/wms)
 *  NUIS  10K  →  {state}_{districtCode}_UL10K        (vec1 /bhuvan/nuis/ows)
 */

import bhuvanIndex from '@/data/bhuvan-index.json';
import bhuvanExtents from '@/data/bhuvan-extents.json';

export interface BhuvanLayerInfo {
  id: string;
  categoryId?: string;
  categoryName?: string;
  /** UI display group: 'ulu' = Urban Land Use, 'lulc' = Land Use Land Cover, 'other' */
  uiGroup?: 'ulu' | 'lulc' | 'other';
  fixedLayerName?: string;
  name: string;
  description: string;
  themeCode: string;
  yearCode: string;
  /** Which Bhuvan host to use: 'vec1' | 'vec2' | 'vec3'. Default: 'vec2' */
  wmsHost?: string;
  /** Custom WMS path on the host. Default: '/bhuvan/wms' */
  wmsPath?: string;
  /** If true, this layer needs district-level naming (limited availability) */
  usesDistrict?: boolean;
  /** Technical Geoserver/WMS workspace name (e.g. 'sisdp_phase2'). If missing, uses categoryId or id. */
  wmsWorkspace?: string;
  legend: { label: string; color: string }[];
}

// ─── Default WMS configuration ───
export const BHUVAN_DEFAULT_WMS_HOST = 'vec2';
export const BHUVAN_DEFAULT_WMS_PATH = '/bhuvan/wms';

/**
 * Builds the full Bhuvan WMS base URL for a given theme.
 */
export function getBhuvanWmsUrl(theme: BhuvanLayerInfo): string {
  const host = theme.wmsHost || BHUVAN_DEFAULT_WMS_HOST;
  const path = theme.wmsPath || BHUVAN_DEFAULT_WMS_PATH;
  return `https://bhuvan-${host}.nrsc.gov.in${path}`;
}

export const BHUVAN_THEMES: BhuvanLayerInfo[] = [
  // ───────────────────────────────────────────────────────
  //  Urban Land Use (4K) : AMRUT
  //  Server: vec3, Workspace: amrut_ph1
  //  Layer pattern: {state}_{district}_amrutph1_4k  (district-level)
  // ───────────────────────────────────────────────────────
  {
    id: 'ulu_4k_amrut',
    categoryId: 'ulu',
    categoryName: 'Urban Land Use',
    uiGroup: 'ulu',
    name: 'Urban Land Use (4K) : AMRUT',
    description: '1:4,000 scale urban land use under AMRUT. District-level — available for select AMRUT cities only.',
    themeCode: 'amrutph1_4k',
    yearCode: '',
    wmsHost: 'vec3',
    wmsPath: '/bhuvan/wms',
    wmsWorkspace: 'amrut_ph1',
    usesDistrict: true,
    legend: [
      { label: 'Residential', color: '#ff0000' },
      { label: 'Commercial', color: '#0000ff' },
      { label: 'Industrial', color: '#a52a2a' },
      { label: 'Public/Semi-Public', color: '#ff00ff' },
      { label: 'Recreational', color: '#00ff00' },
      { label: 'Transport', color: '#808080' },
      { label: 'Agriculture', color: '#ffff00' },
      { label: 'Water Bodies', color: '#00ced1' },
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Land Use Land Cover (10K) : SIS-DP Phase 2 (2018-23)
  //  Server: vec2, Workspace: sisdp_phase2
  //  Layer pattern: SISDP_P2_LULC_10K_2016_2019_{state}  (state-level)
  // ───────────────────────────────────────────────────────
  {
    id: 'lulc_10k_sisdp2',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    uiGroup: 'lulc',
    name: 'Land Use Land Cover (10K) : SIS-DP Phase2:2018-23',
    description: '1:10,000 scale LULC under SIS-DP Phase 2 (2018-23). State-level coverage.',
    themeCode: 'SISDP_P2_LULC_10K_2016_2019',
    yearCode: '',
    wmsWorkspace: 'sisdp_phase2',
    legend: [
      { label: 'Built-up', color: '#ff0000' },
      { label: 'Agriculture', color: '#ffff00' },
      { label: 'Forest', color: '#006400' },
      { label: 'Wasteland', color: '#bdb76b' },
      { label: 'Wetlands', color: '#00ced1' },
      { label: 'Water Bodies', color: '#0000ff' }
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Land Use Land Cover (10K) : SIS-DP
  //  Server: vec2, Path: /bhuvan/sisdpv2/wms
  //  Layer pattern: {state}_{district}_lulc_v2  (district-level)
  // ───────────────────────────────────────────────────────
  {
    id: 'lulc_10k_sisdp',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    uiGroup: 'lulc',
    name: 'Land Use Land Cover (10K) : SIS-DP',
    description: '1:10,000 scale LULC under SIS-DP. District-level — available for mapped cities only.',
    themeCode: 'lulc_v2',
    yearCode: '',
    wmsPath: '/bhuvan/sisdpv2/wms',
    usesDistrict: true,
    legend: [
      { label: 'Built-up', color: '#ff0000' },
      { label: 'Agriculture', color: '#ffff00' },
      { label: 'Forest', color: '#006400' },
      { label: 'Wasteland', color: '#bdb76b' },
      { label: 'Wetlands', color: '#00ced1' },
      { label: 'Water Bodies', color: '#0000ff' }
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Urban Land Use (10K) : NUIS portal
  //  Server: vec1, Path: /bhuvan/nuis/ows
  //  Layer pattern: {state}_{districtCode}_UL10K  (district-level)
  // ───────────────────────────────────────────────────────
  {
    id: 'ulu_10k_nuis',
    categoryId: 'ulu',
    categoryName: 'Urban Land Use',
    uiGroup: 'ulu',
    name: 'Urban Land Use (10K) : NUIS portal',
    description: '1:10,000 scale urban land use from NUIS. District-level — available for mapped cities only.',
    themeCode: 'UL10K',
    yearCode: '',
    wmsHost: 'vec1',
    wmsPath: '/bhuvan/nuis/ows',
    wmsWorkspace: 'nuis',
    usesDistrict: true,
    legend: [
      { label: 'Residential', color: '#ff0000' },
      { label: 'Commercial', color: '#0000ff' },
      { label: 'Industrial', color: '#a52a2a' },
      { label: 'Public/Semi-Public', color: '#ff00ff' },
      { label: 'Recreational', color: '#00ff00' },
      { label: 'Transport', color: '#808080' },
      { label: 'Water Bodies', color: '#00ced1' },
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Land Use Land Cover (50K) : 2015-16  (and historic years)
  //  Server: vec2, Workspace: lulc
  //  Layer pattern: {state}_LULC50K_{year}
  // ───────────────────────────────────────────────────────
  {
    id: 'lulc',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    uiGroup: 'lulc',
    name: 'Land Use Land Cover (50K) : 2015-16',
    description: '1:50,000 scale classification of land surface into Built-up, Agriculture, Forest, etc.',
    themeCode: 'LULC50K',
    yearCode: '1516',
    wmsWorkspace: 'lulc',
    legend: [
      { label: 'Built-up', color: '#ff0000' },
      { label: 'Agriculture', color: '#ffff00' },
      { label: 'Forest', color: '#006400' },
      { label: 'Grassland', color: '#90ee90' },
      { label: 'Barren/Unculturable', color: '#bdb76b' },
      { label: 'Wetlands', color: '#00ced1' },
      { label: 'Water Bodies', color: '#0000ff' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },
  {
    id: 'lulc_1112',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    name: 'Land Use Land Cover (50K) : 2011-12',
    description: '1:50,000 scale classification of land surface (Historic: 2011-12).',
    themeCode: 'LULC50K',
    yearCode: '1112',
    legend: [
      { label: 'Built-up', color: '#ff0000' },
      { label: 'Agriculture', color: '#ffff00' },
      { label: 'Forest', color: '#006400' },
      { label: 'Grassland', color: '#90ee90' },
      { label: 'Barren/Unculturable', color: '#bdb76b' },
      { label: 'Wetlands', color: '#00ced1' },
      { label: 'Water Bodies', color: '#0000ff' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },
  {
    id: 'lulc_0506',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    name: 'Land Use Land Cover (50K) : 2005-06',
    description: '1:50,000 scale classification of land surface (Historic: 2005-06).',
    themeCode: 'LULC50K',
    yearCode: '0506',
    legend: [
      { label: 'Built-up', color: '#ff0000' },
      { label: 'Agriculture', color: '#ffff00' },
      { label: 'Forest', color: '#006400' },
      { label: 'Grassland', color: '#90ee90' },
      { label: 'Barren/Unculturable', color: '#bdb76b' },
      { label: 'Wetlands', color: '#00ced1' },
      { label: 'Water Bodies', color: '#0000ff' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Land Degradation (50K) : 2015-16
  //  Server: vec2, Workspace: ld
  //  Layer pattern: {state}_LD50K_1516
  // ───────────────────────────────────────────────────────
  {
    id: 'ld_50k_1516',
    categoryId: 'ld',
    categoryName: 'Land Degradation',
    name: 'Land Degradation (50K) : 2015-16',
    description: '1:50,000 scale mapping of land degradation (2015-16).',
    themeCode: 'LD50K',
    yearCode: '1516',
    wmsWorkspace: 'ld',
    legend: [
      { label: 'Water Erosion', color: '#ffcc00' },
      { label: 'Wind Erosion', color: '#ffaaaa' },
      { label: 'Salinity/Alkalinity', color: '#aaffaa' },
      { label: 'Waterlogging', color: '#aaaaff' },
      { label: 'Mass Movement', color: '#cc9966' },
      { label: 'Man Made', color: '#cccccc' }
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Wasteland (50K) : 2015-16 and historic
  //  Server: vec2, Workspace: wasteland
  //  Layer pattern: {state}_WL50K_{year}
  // ───────────────────────────────────────────────────────
  {
    id: 'wasteland',
    categoryId: 'wasteland',
    categoryName: 'Wasteland',
    name: 'Wasteland (50K) : 2015-16',
    description: '1:50,000 scale identification of degraded land which can be brought under vegetative cover.',
    themeCode: 'WL50K',
    yearCode: '1516',
    wmsWorkspace: 'wasteland',
    legend: [
      { label: 'Gullied/Ravinous', color: '#D600FF' },
      { label: 'Scrub Land', color: '#F1BFBD' },
      { label: 'Waterlogged', color: '#00CDF3' },
      { label: 'Salt Affected', color: '#FFFD76' },
      { label: 'Shifting Cultivation', color: '#D1F78A' },
      { label: 'Degraded Forest', color: '#6CA32B' },
      { label: 'Degraded Pastures', color: '#F9AB09' },
      { label: 'Degraded Plantation', color: '#A7008A' },
      { label: 'Sandy Area', color: '#FFEBAE' },
      { label: 'Mining Waste', color: '#BBD2FF' },
      { label: 'Barren Rocky', color: '#8E3F1E' },
      { label: 'Snow/Glacier', color: '#CCCCCC' }
    ]
  },
  {
    id: 'wasteland_0809',
    categoryId: 'wasteland',
    categoryName: 'Wasteland',
    name: 'Wasteland (50K) : 2008-09',
    description: '1:50,000 scale identification of degraded land (Historic: 2008-09).',
    themeCode: 'WL50K',
    yearCode: '0809',
    wmsWorkspace: 'wasteland',
    legend: [
      { label: 'Gullies/Ravinous', color: '#ffcc99' },
      { label: 'Scrub Land', color: '#ffff99' },
      { label: 'Waterlogged', color: '#99ccff' },
      { label: 'Degraded Forest', color: '#99cc00' },
      { label: 'Un-culturable', color: '#cccccc' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Geomorphology (50K)
  //  Server: vec2, Workspace: geomorphology
  // ───────────────────────────────────────────────────────
  {
    id: 'geomorphology',
    categoryId: 'geomorphology',
    categoryName: 'Geomorphology',
    name: 'Geomorphology',
    description: '1:50,000 scale mapping of landforms and surface processes.',
    themeCode: 'GM50K',
    yearCode: '0506',
    wmsWorkspace: 'geomorphology',
    legend: [
      { label: 'Structural Landforms', color: '#a52a2a' },
      { label: 'Fluvial Landforms', color: '#4169e1' },
      { label: 'Denudational Landforms', color: '#d2b48c' },
      { label: 'Aeolian Landforms', color: '#f0e68c' },
      { label: 'Coastal Landforms', color: '#20b2aa' },
      { label: 'Anthropogenic', color: '#808080' }
    ]
  },

  // ───────────────────────────────────────────────────────
  //  Lineament (50K)
  //  Server: vec2, Workspace: lineament
  // ───────────────────────────────────────────────────────
  {
    id: 'lineament',
    categoryId: 'lineament',
    categoryName: 'Lineament',
    name: 'Lineament',
    description: '1:50,000 scale mapping of linear features of geological significance.',
    themeCode: 'LN50K',
    yearCode: '0506',
    wmsWorkspace: 'lineament',
    legend: [
      { label: 'Major Lineament', color: '#000000' },
      { label: 'Minor Lineament', color: '#696969' }
    ]
  },
];

/**
 * Approximate Indian State Code detection based on Lat/Lng.
 */
export function getIndianStateCode(lat: number, lng: number): string {

  // --- UTs---
  if (lat >= 28.4 && lat <= 28.88 && lng >= 76.85 && lng <= 77.35) return 'DL'; // Delhi
  if (lat >= 15.2 && lat <= 15.8  && lng >= 73.65 && lng <= 74.2)  return 'GA'; // Goa
  if (lat >= 27.1 && lat <= 28.1  && lng >= 88.0  && lng <= 88.9)  return 'SK'; // Sikkim

  // --- Islands ---
  if (lat >= 6.7  && lat <= 13.6  && lng >= 92.1  && lng <= 93.9)  return 'AN'; // Andaman & Nicobar
  if (lat >= 8.0  && lat <= 12.3  && lng >= 71.8  && lng <= 74.0)  return 'LD'; // Lakshadweep

  // --- North ---
  if (lat >= 32.2 && lat <= 37.1  && lng >= 72.5  && lng <= 80.3)  return 'JK'; // J&K / Ladakh
  if (lat >= 30.3 && lat <= 33.3  && lng >= 75.5  && lng <= 79.0)  return 'HP'; // Himachal Pradesh
  if (lat >= 29.5 && lat <= 32.5  && lng >= 73.8  && lng <= 77.0)  return 'PB'; // Punjab
  if (lat >= 28.9 && lat <= 31.4  && lng >= 77.5  && lng <= 81.0)  return 'UK'; // Uttarakhand
  if (lat >= 27.6 && lat <= 30.9  && lng >= 74.4  && lng <= 77.6)  return 'HR'; // Haryana
  if (lat >= 23.8 && lat <= 30.4  && lng >= 77.0  && lng <= 84.6)  return 'UP'; // Uttar Pradesh
  if (lat >= 23.0 && lat <= 30.2  && lng >= 69.5  && lng <= 78.2)  return 'RJ'; // Rajasthan

  // --- Central & West ---
  if (lat >= 21.1 && lat <= 26.8  && lng >= 74.0  && lng <= 82.8)  return 'MP'; // Madhya Pradesh
  if (lat >= 17.7 && lat <= 24.1  && lng >= 80.2  && lng <= 84.4)  return 'CG'; // Chhattisgarh
  if (lat >= 20.1 && lat <= 24.7  && lng >= 68.1  && lng <= 74.4)  return 'GJ'; // Gujarat
  if (lat >= 15.6 && lat <= 22.0  && lng >= 72.6  && lng <= 80.9)  return 'MH'; // Maharashtra

  // --- East ---
  if (lat >= 24.3 && lat <= 27.5  && lng >= 83.3  && lng <= 88.3)  return 'BR'; // Bihar
  if (lat >= 21.9 && lat <= 25.3  && lng >= 83.3  && lng <= 87.9)  return 'JH'; // Jharkhand
  if (lat >= 21.5 && lat <= 27.2  && lng >= 85.8  && lng <= 89.8)  return 'WB'; // West Bengal
  if (lat >= 17.8 && lat <= 22.5  && lng >= 81.3  && lng <= 87.5)  return 'OR'; // Odisha

  // --- North-East (small states before the big Assam/Arunachal boxes) ---
  if (lat >= 25.0 && lat <= 26.1  && lng >= 89.8  && lng <= 92.8)  return 'ML'; // Meghalaya
  if (lat >= 25.5 && lat <= 27.0  && lng >= 93.3  && lng <= 95.2)  return 'NL'; // Nagaland
  if (lat >= 23.8 && lat <= 25.7  && lng >= 92.9  && lng <= 94.7)  return 'MN'; // Manipur
  if (lat >= 21.9 && lat <= 24.5  && lng >= 92.2  && lng <= 93.4)  return 'MZ'; // Mizoram
  if (lat >= 22.9 && lat <= 24.5  && lng >= 91.1  && lng <= 92.3)  return 'TR'; // Tripura
  if (lat >= 24.1 && lat <= 27.9  && lng >= 89.7  && lng <= 96.0)  return 'AS'; // Assam
  if (lat >= 26.6 && lat <= 29.5  && lng >= 91.5  && lng <= 97.4)  return 'AR'; // Arunachal Pradesh

  // --- South ---
  if (lat >= 15.8 && lat <= 19.9  && lng >= 77.2  && lng <= 81.3)  return 'TS'; // Telangana
  if (lat >= 12.6 && lat <= 19.1  && lng >= 76.7  && lng <= 84.8)  return 'AP'; // Andhra Pradesh
  if (lat >= 11.5 && lat <= 18.5  && lng >= 74.0  && lng <= 78.6)  return 'KA'; // Karnataka
  if (lat >= 8.2  && lat <= 12.8  && lng >= 74.8  && lng <= 77.5)  return 'KL'; // Kerala (before TN)
  if (lat >= 8.0  && lat <= 13.5  && lng >= 76.2  && lng <= 80.3)  return 'TN'; // Tamil Nadu

  return 'IN';
}

// ── Static district coverage index (scraped from Bhuvan WMS GetCapabilities) ──
// Keys: 'amrut' | 'nuis' | 'sisdp'
// Values: { [stateCode]: string[] }  (array of available district/city names)
const BHUVAN_DISTRICT_INDEX = bhuvanIndex as Record<string, Record<string, string[]>>;

// ── Bounding boxes scraped from Bhuvan WMS GetCapabilities ──
// Keys: full WMS layer name (e.g. 'sisdpv2:DL_New_Delhi_lulc_v2')
// Values: [minLng, minLat, maxLng, maxLat]
export const BHUVAN_EXTENTS = bhuvanExtents as unknown as Record<string, [number, number, number, number]>;

/**
 * Finds the best matching Bhuvan WMS layer name for district-level themes
 * by checking which bounding box contains the given lat/lng coordinate.
 *
 * Returns the layer name LOCAL part (no workspace prefix), or undefined.
 */
export function findBhuvanLayerByCoord(
  themeId: string,
  stateCode: string,
  lat: number,
  lng: number
): string | undefined {
  // Build suffix pattern based on theme
  let suffix = '';
  if (themeId === 'lulc_10k_sisdp') suffix = '_lulc_v2';
  else if (themeId === 'ulu_4k_amrut') suffix = '_amrutph1_4k';
  else if (themeId === 'ulu_10k_nuis') suffix = '_UL10K';
  else if (themeId === 'wasteland' || themeId === 'wasteland_0809') suffix = '_WL50K';
  else if (themeId === 'ld_50k_1516') suffix = '_LD50K';
  else if (themeId === 'lulc' || themeId === 'lulc_1112' || themeId === 'lulc_0506') suffix = '_LULC50K';
  else if (themeId === 'geomorphology') suffix = '_GM50K';
  else if (themeId === 'lineament') suffix = '_LN50K';

  if (!suffix) return undefined;

  // Find all WMS layer names for this state + theme, then check which bbox contains the point
  const candidates = Object.entries(BHUVAN_EXTENTS).filter(([name]) =>
    name.includes(`${stateCode}_`) && name.endsWith(suffix)
  );

  // 1. Find the smallest bbox that still contains the point (most precise district)
  const containing = candidates
    .filter(([, box]) => lng >= box[0] && lat >= box[1] && lng <= box[2] && lat <= box[3])
    .sort(([, a], [, b]) => {
      const areaA = (a[2] - a[0]) * (a[3] - a[1]);
      const areaB = (b[2] - b[0]) * (b[3] - b[1]);
      return areaA - areaB; // smallest bbox = most specific district
    });

  if (containing.length > 0) {
    // Extract the district part (e.g. 'sisdpv2:DL_New_Delhi_lulc_v2' -> 'New_Delhi')
    const layerName = containing[0][0];
    const colonParts = layerName.split(':');
    const namePart = colonParts.length > 1 ? colonParts[1] : colonParts[0];
    // Remove prefix like 'DL_' and suffix like '_lulc_v2'
    const withoutSuffix = namePart.slice(0, namePart.length - suffix.length);
    const withoutState = withoutSuffix.startsWith(`${stateCode}_`)
      ? withoutSuffix.slice(stateCode.length + 1)
      : withoutSuffix;
    return withoutState;
  }

  // 2. If no exact bbox match, return the nearest district centroid
  if (candidates.length > 0) {
    const nearest = candidates.sort(([, a], [, b]) => {
      const centerALng = (a[0] + a[2]) / 2;
      const centerALat = (a[1] + a[3]) / 2;
      const centerBLng = (b[0] + b[2]) / 2;
      const centerBLat = (b[1] + b[3]) / 2;
      const distA = Math.hypot(lng - centerALng, lat - centerALat);
      const distB = Math.hypot(lng - centerBLng, lat - centerBLat);
      return distA - distB;
    })[0];
    const layerName = nearest[0];
    const colonParts = layerName.split(':');
    const namePart = colonParts.length > 1 ? colonParts[1] : colonParts[0];
    const withoutSuffix = namePart.slice(0, namePart.length - suffix.length);
    const withoutState = withoutSuffix.startsWith(`${stateCode}_`)
      ? withoutSuffix.slice(stateCode.length + 1)
      : withoutSuffix;
    return withoutState;
  }

  return undefined;
}

/**
 * Checks if a specific full layer name exists in our scraped extents index.
 */
export function isLayerAvailableInIndex(layerName: string): boolean {
  // Check exact
  if (BHUVAN_EXTENTS[layerName]) return true;
  // Check with common workspace prefixes if missing
  const prefixes = ['wasteland:', 'lulc:', 'ld:', 'sisdpv2:', 'geomorphology:', 'lineament:', 'amrut_ph1:', 'sisdp_phase2:'];
  for (const p of prefixes) {
    if (BHUVAN_EXTENTS[p + layerName]) return true;
  }
  return false;
}

/**
 * Given a geocoded district/city name from Mapbox, find the best matching
 * district string in the Bhuvan WMS coverage index for the given theme and state.
 *
 * Uses case-insensitive fuzzy prefix matching.
 */
export function getBestBhuvanDistrict(
  themeType: 'amrut' | 'nuis' | 'sisdp',
  stateCode: string,
  geocodedDistrict?: string
): string | undefined {
  const stateData = BHUVAN_DISTRICT_INDEX[themeType]?.[stateCode];
  if (!stateData || stateData.length === 0) return undefined;

  if (!geocodedDistrict) return stateData[0]; // fallback: first available

  const needle = geocodedDistrict.toLowerCase().replace(/[\s-]/g, '_');

  // 1. Exact match
  const exact = stateData.find(d => d.toLowerCase() === needle);
  if (exact) return exact;

  // 2. Prefix match (needle starts with district or vice-versa)
  const prefix = stateData.find(d => {
    const d2 = d.toLowerCase();
    return d2.startsWith(needle.slice(0, 4)) || needle.startsWith(d2.slice(0, 4));
  });
  if (prefix) return prefix;

  // 3. Fallback: return first available for that state
  return stateData[0];
}

/**
 * Builds the WMS layer name for a given theme, state code, and optional coordinates.
 *
 * Different themes use different naming conventions on Bhuvan:
 *  - Standard 50K layers:          workspace:STATE_THEME_YEAR
 *  - SIS-DP Phase 2 (10K):         sisdp_phase2:SISDP_P2_LULC_10K_2016_2019_STATE
 *  - AMRUT (4K), SIS-DP, NUIS:     city/district-level: auto-detected from coordinates
 */
export function buildBhuvanLayerName(
  themeId: string,
  stateCode: string,
  districtNameHint?: string,
  lat?: number,
  lng?: number
): string {
  const theme = BHUVAN_THEMES.find(t => t.id === themeId);
  if (!theme) return themeId;

  if (theme.fixedLayerName) return theme.fixedLayerName;

  const workspace = theme.wmsWorkspace || theme.categoryId || theme.id;

  // ── SIS-DP Phase 2: workspace:themeCode_STATE (state-level, no district) ──
  if (theme.id === 'lulc_10k_sisdp2') {
    return `${workspace}:${theme.themeCode}_${stateCode}`;
  }

  // ── District-based layers: use coordinate lookup first, then fallback ──
  if (theme.usesDistrict) {
    if (theme.id === 'ulu_4k_amrut') {
      // AMRUT layers are on vec3 which is not in bhuvan-extents.json.
      // Always use bhuvan-index.json (getBestBhuvanDistrict) to find the city.
      const city = getBestBhuvanDistrict('amrut', stateCode, districtNameHint);
      return city
        ? `${workspace}:${stateCode}_${city}_amrutph1_4k`
        : `${workspace}:${stateCode}_amrutph1_4k`;
    }
    // SIS-DP: NO workspace prefix — using virtual service endpoint /bhuvan/sisdpv2/wms
    if (theme.id === 'lulc_10k_sisdp') {
      const district = (lat !== undefined && lng !== undefined)
        ? findBhuvanLayerByCoord('lulc_10k_sisdp', stateCode, lat, lng)
        : getBestBhuvanDistrict('sisdp', stateCode, districtNameHint);
      return district
        ? `${stateCode}_${district}_lulc_v2`
        : `${stateCode}_lulc_v2`;
    }
    // NUIS: no workspace prefix
    if (theme.id === 'ulu_10k_nuis') {
      const districtCode = (lat !== undefined && lng !== undefined)
        ? findBhuvanLayerByCoord('ulu_10k_nuis', stateCode, lat, lng)
        : getBestBhuvanDistrict('nuis', stateCode, districtNameHint);
      return districtCode
        ? `${stateCode}_${districtCode}_${theme.themeCode}`
        : `${stateCode}_${theme.themeCode}`;
    }
  }

  // ── Standard pattern: workspace:STATE_THEME_YEAR ──
  return `${workspace}:${stateCode}_${theme.themeCode}_${theme.yearCode}`;
}
