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
  uiGroup?: 'ulu' | 'lulc' | 'other';
  fixedLayerName?: string;
  name: string;
  description: string;
  themeCode: string;
  yearCode: string;
  wmsHost?: string;
  wmsPath?: string;
  usesDistrict?: boolean;
  wmsWorkspace?: string;
  legend: { label: string; color: string }[];
}

// ─── Default WMS configuration ───
export const BHUVAN_DEFAULT_WMS_HOST = 'vec2';
export const BHUVAN_DEFAULT_WMS_PATH = '/bhuvan/wms';

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

const BHUVAN_DISTRICT_INDEX = bhuvanIndex as Record<string, Record<string, string[]>>;

export const BHUVAN_EXTENTS = bhuvanExtents as unknown as Record<string, [number, number, number, number]>;

// ── Known Locality Overrides ──
const KNOWN_LOCALITY_OVERRIDES: Record<string, string> = {
  'vasant kunj': 'South West',
  'dwarka': 'South West',
  'najafgarh': 'South West',
  'saket': 'South',
  'hauz khas': 'South',
  'kalkaji': 'South East',
  'okhla': 'South East',
  'lajpat nagar': 'South East',
  'rohini': 'North West',
  'karol bagh': 'Central',
  'paharganj': 'Central',
  'connaught place': 'New Delhi',
  'chanakyapuri': 'New Delhi',
  'vasant vihar': 'New Delhi',
  // Add more Indian locality overrides here as needed
};

function expandHintsWithOverrides(hintsStr: string): string[] {
  const hints = hintsStr.split('|').map(h => h.trim()).filter(h => h.length > 0);
  const expanded = [...hints];
  
  for (const hint of hints) {
    const lower = hint.toLowerCase();
    for (const [locality, overrideDist] of Object.entries(KNOWN_LOCALITY_OVERRIDES)) {
      if (lower.includes(locality) && !expanded.includes(overrideDist)) {
        expanded.unshift(overrideDist); 
      }
    }
  }
  return expanded;
}

export function findBhuvanLayerByCoord(
  themeId: string,
  stateCode: string,
  lat: number,
  lng: number,
  districtNameHint?: string
): string | undefined {
  let suffix = '';
  if (themeId === 'lulc_10k_sisdp') suffix = '_lulc_v2';
  else if (themeId === 'ulu_4k_amrut') suffix = '_amrutph1_4k';
  else if (themeId === 'ulu_10k_nuis') suffix = '_UL10K';
  else if (themeId === 'wasteland' || themeId === 'wasteland_0809') suffix = '_WL50K';
  else if (themeId === 'ld_50k_1516') suffix = '_LD50K';
  else if (themeId === 'lulc' || themeId === 'lulc_1112' || themeId === 'lulc_0506') suffix = '_LULC50K';
  else if (themeId === 'geomorphology') suffix = '_GM50K';
  else if (themeId === 'lineament') suffix = '_LN50K';
  
  if (!suffix && themeId !== 'lulc_10k_sisdp2') return undefined;

  let candidates: [string, [number, number, number, number]][] = [];
  
  if (themeId === 'lulc_10k_sisdp2') {
    const baseName = `SISDP_P2_LULC_10K_2016_2019_${stateCode}_`;
    candidates = Object.entries(BHUVAN_EXTENTS).filter(([name]) => 
      name.includes(`_${stateCode}_`) && name.includes('SISDP_P2_LULC') && !name.endsWith(`_${stateCode}`)
    );
  } else {
    candidates = Object.entries(BHUVAN_EXTENTS).filter(([name]) =>
      name.includes(`${stateCode}_`) && name.endsWith(suffix)
    );
  }

  const containing = candidates
    .filter(([, box]) => lng >= box[0] && lat >= box[1] && lng <= box[2] && lat <= box[3])
    .sort(([, a], [, b]) => {
      const normAx = (a[2] - a[0]) > 0 ? (lng - a[0]) / (a[2] - a[0]) : 0.5;
      const normAy = (a[3] - a[1]) > 0 ? (lat - a[1]) / (a[3] - a[1]) : 0.5;
      const normBx = (b[2] - b[0]) > 0 ? (lng - b[0]) / (b[2] - b[0]) : 0.5;
      const normBy = (b[3] - b[1]) > 0 ? (lat - b[1]) / (b[3] - b[1]) : 0.5;
      const centralA = Math.min(normAx, 1 - normAx, normAy, 1 - normAy);
      const centralB = Math.min(normBx, 1 - normBx, normBy, 1 - normBy);
      return centralB - centralA; 
    });

  const getDistrictPart = (layerName: string) => {
    const colonParts = layerName.split(':');
    const namePart = colonParts.length > 1 ? colonParts[1] : colonParts[0];
    if (themeId === 'lulc_10k_sisdp2') {
      const match = namePart.match(new RegExp(`_${stateCode}_(.+)$`));
      return match ? match[1] : undefined;
    } else {
      const withoutSuffix = namePart.slice(0, namePart.length - suffix.length);
      const withoutState = withoutSuffix.startsWith(`${stateCode}_`)
        ? withoutSuffix.slice(stateCode.length + 1)
        : withoutSuffix;
      return withoutState;
    }
  };

  if (containing.length > 0) {
    let bestMatch = containing[0];

    if (districtNameHint && containing.length > 1) {
      const hints = expandHintsWithOverrides(districtNameHint);
      
      for (const hint of hints) {
        const cleanHint = hint.toLowerCase()
          .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
          .replace(/[^a-z0-9]/g, '');
        
        const exactMatches = containing.filter(([name]) => {
           const distPart = getDistrictPart(name);
           if (!distPart) return false;
           const distNorm = distPart.toLowerCase()
             .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
             .replace(/[^a-z0-9]/g, '');
             
           return (distNorm.length > 2 && cleanHint.length > 2) && 
                  (distNorm === cleanHint || distNorm.includes(cleanHint) || cleanHint.includes(distNorm));
        }).sort(([nameA], [nameB]) => {
          const distPartA = getDistrictPart(nameA) || '';
          const distPartB = getDistrictPart(nameB) || '';
          const normA = distPartA.toLowerCase().replace(/\b(delhi|district|city|urban|rural|town)\b/g, '').replace(/[^a-z0-9]/g, '');
          const normB = distPartB.toLowerCase().replace(/\b(delhi|district|city|urban|rural|town)\b/g, '').replace(/[^a-z0-9]/g, '');
          if (normA === cleanHint && normB !== cleanHint) return -1;
          if (normB === cleanHint && normA !== cleanHint) return 1;
          return normB.length - normA.length;
        });
        if (exactMatches.length > 0) {
          bestMatch = exactMatches[0];
          break;
        }
      }
    }

    return getDistrictPart(bestMatch[0]);
  }
  if (candidates.length > 0) {
    const nearest = candidates.sort(([, a], [, b]) => {
      const centerALng = (a[0] + a[2]) / 2;
      const centerALat = (a[1] + a[3]) / 2;
      const centerBLng = (b[0] + b[2]) / 2;
      const centerBLat = (b[1] + b[3]) / 2;
      const distA = Math.hypot(lng - centerALng, lat - centerALat);
      const distB = Math.hypot(lng - centerBLng, lat - centerBLat);
      return distA - distB;
    });

    let bestMatch = nearest[0];

    if (districtNameHint) {
      const hints = expandHintsWithOverrides(districtNameHint);
      for (const hint of hints) {
        const cleanHint = hint.toLowerCase()
          .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
          .replace(/[^a-z0-9]/g, '');
        
        const exactMatches = nearest.filter(([name]) => {
           const distPart = getDistrictPart(name);
           if (!distPart) return false;
           const distNorm = distPart.toLowerCase()
             .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
             .replace(/[^a-z0-9]/g, '');
             
           return (distNorm.length > 2 && cleanHint.length > 2) && 
                  (distNorm === cleanHint || distNorm.includes(cleanHint) || cleanHint.includes(distNorm));
        }).sort(([nameA], [nameB]) => {
          const distPartA = getDistrictPart(nameA) || '';
          const distPartB = getDistrictPart(nameB) || '';
          const normA = distPartA.toLowerCase().replace(/\b(delhi|district|city|urban|rural|town)\b/g, '').replace(/[^a-z0-9]/g, '');
          const normB = distPartB.toLowerCase().replace(/\b(delhi|district|city|urban|rural|town)\b/g, '').replace(/[^a-z0-9]/g, '');
          if (normA === cleanHint && normB !== cleanHint) return -1;
          if (normB === cleanHint && normA !== cleanHint) return 1;
          return normB.length - normA.length;
        });
        
        if (exactMatches.length > 0) {
          bestMatch = exactMatches[0];
          break;
        }
      }
    }

    return getDistrictPart(bestMatch[0]);
  }

  return undefined;
}

export function isLayerAvailableInIndex(layerName: string): boolean {
  if (BHUVAN_EXTENTS[layerName]) return true;
  const prefixes = ['wasteland:', 'lulc:', 'ld:', 'sisdpv2:', 'geomorphology:', 'lineament:', 'amrut_ph1:', 'sisdp_phase2:'];
  for (const p of prefixes) {
    if (BHUVAN_EXTENTS[p + layerName]) return true;
  }
  return false;
}
// District name matching
export function getBestBhuvanDistrict(
  themeType: 'amrut' | 'nuis' | 'sisdp',
  stateCode: string,
  geocodedDistrict?: string
): string | undefined {
  const stateData = BHUVAN_DISTRICT_INDEX[themeType]?.[stateCode];
  if (!stateData || stateData.length === 0) return undefined;

  if (!geocodedDistrict) return stateData[0];

  const hints = expandHintsWithOverrides(geocodedDistrict);

  for (const hint of hints) {
    const cleanHint = hint.toLowerCase()
      .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
      .replace(/[^a-z0-9]/g, '');

    const exact = stateData.find(d => {
      const cleanDbName = d.toLowerCase()
        .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
      return cleanDbName === cleanHint || 
             (cleanDbName.length > 2 && cleanHint.length > 2 && 
               (cleanDbName.includes(cleanHint) || cleanHint.includes(cleanDbName)));
    });

    if (exact) {
      return exact;
    }
  }

  for (const hint of hints) {
    const cleanHint = hint.toLowerCase()
      .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
      
    if (cleanHint.length < 3) continue;

    const prefix = stateData.find(d => {
      const cleanDbName = d.toLowerCase()
        .replace(/\b(delhi|district|city|urban|rural|town)\b/g, '')
        .replace(/[^a-z0-9]/g, '');
      return cleanDbName.startsWith(cleanHint.slice(0, 4)) || cleanHint.startsWith(cleanDbName.slice(0, 4));
    });
    
    if (prefix) {
      return prefix;
    }
  }

  return stateData[0];
}

// Layer name builder
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

  if (theme.id === 'lulc_10k_sisdp2') {
    if (lat !== undefined && lng !== undefined) {
      const sisdp2District = findBhuvanLayerByCoord('lulc_10k_sisdp2', stateCode, lat, lng, districtNameHint);
      if (sisdp2District) {
        const exactLayer = Object.keys(BHUVAN_EXTENTS).find(name => 
          name.includes(`_${stateCode}_${sisdp2District}`) && name.includes('SISDP_P2_LULC')
        );
        if (exactLayer) return exactLayer;
        return `${workspace}:${theme.themeCode}_${stateCode}_${sisdp2District}`;
      }
    }
    return `${workspace}:${theme.themeCode}_${stateCode}`;
  }

  if (theme.usesDistrict) {
    if (theme.id === 'ulu_4k_amrut') {
      const city = getBestBhuvanDistrict('amrut', stateCode, districtNameHint);
      return city
        ? `${workspace}:${stateCode}_${city}_amrutph1_4k`
        : `${workspace}:${stateCode}_amrutph1_4k`;
    }
    if (theme.id === 'lulc_10k_sisdp') {
      const district = (lat !== undefined && lng !== undefined)
        ? findBhuvanLayerByCoord('lulc_10k_sisdp', stateCode, lat, lng, districtNameHint)
        : getBestBhuvanDistrict('sisdp', stateCode, districtNameHint);
      return district
        ? `${stateCode}_${district}_lulc_v2`
        : `${stateCode}_lulc_v2`;
    }
    if (theme.id === 'ulu_10k_nuis') {
      const districtCode = (lat !== undefined && lng !== undefined)
        ? findBhuvanLayerByCoord('ulu_10k_nuis', stateCode, lat, lng, districtNameHint)
        : getBestBhuvanDistrict('nuis', stateCode, districtNameHint);
      return districtCode
        ? `${stateCode}_${districtCode}_${theme.themeCode}`
        : `${stateCode}_${theme.themeCode}`;
    }
  }

  return `${workspace}:${stateCode}_${theme.themeCode}_${theme.yearCode}`;
}
