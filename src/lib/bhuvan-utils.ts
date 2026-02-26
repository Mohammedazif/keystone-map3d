/**
 * Bhuvan Thematic Services Utilities
 */

export interface BhuvanLayerInfo {
  id: string;
  categoryId?: string;
  categoryName?: string;
  fixedLayerName?: string;
  name: string;
  description: string;
  themeCode: string;
  yearCode: string;
  legend: { label: string; color: string }[];
}

export const BHUVAN_THEMES: BhuvanLayerInfo[] = [
  {
    id: 'lulc',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    name: 'Land Use Land Cover',
    description: '1:50,000 scale classification of land surface into various classes like Built-up, Agriculture, Forest, etc.',
    themeCode: 'LULC50K',
    yearCode: '1516',
    legend: [
      { label: 'Built-up', color: '#ff0000' },
      { label: 'Agriculture', color: '#ffff00' },
      { label: 'Forest', color: '#006400' },
      { label: 'Grassland', color: '#90ee90' },
      { label: 'Barren/Unculturable', color: '#bdb76b' },
      { label: 'Wetlands', color: '#00ced1' },
      { label: 'Water bodies', color: '#0000ff' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },
  {
    id: 'lulc_1112',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    name: 'Land Use Land Cover (2011-12)',
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
      { label: 'Water bodies', color: '#0000ff' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },
  {
    id: 'lulc_0506',
    categoryId: 'lulc',
    categoryName: 'Land Use Land Cover',
    name: 'Land Use Land Cover (2005-06)',
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
      { label: 'Water bodies', color: '#0000ff' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },
  {
    id: 'geomorphology',
    categoryId: 'geomorphology',
    categoryName: 'Geomorphology',
    name: 'Geomorphology',
    description: '1:50,000 scale mapping of landforms and surface processes.',
    themeCode: 'GM50K',
    yearCode: '0506',
    legend: [
      { label: 'Structural Landforms', color: '#a52a2a' },
      { label: 'Fluvial Landforms', color: '#4169e1' },
      { label: 'Denudational Landforms', color: '#d2b48c' },
      { label: 'Aeolian Landforms', color: '#f0e68c' },
      { label: 'Coastal Landforms', color: '#20b2aa' },
      { label: 'Anthropogenic', color: '#808080' }
    ]
  },
  {
    id: 'wasteland',
    categoryId: 'wasteland',
    categoryName: 'Wasteland',
    name: 'Wasteland',
    description: '1:50,000 scale identification of degraded land which can be brought under vegetative cover with reasonable effort.',
    themeCode: 'WL50K',
    yearCode: '1516',
    legend: [
      { label: 'Gullied/Ravinous', color: '#D600FF' },
      { label: 'Scrub land', color: '#F1BFBD' },
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
    name: 'Wasteland (2008-09)',
    description: '1:50,000 scale identification of degraded land (Historic: 2008-09).',
    themeCode: 'WL50K',
    yearCode: '0809',
    legend: [
      { label: 'Gullies/Ravinous', color: '#ffcc99' },
      { label: 'Scrub land', color: '#ffff99' },
      { label: 'Waterlogged', color: '#99ccff' },
      { label: 'Degraded Forest', color: '#99cc00' },
      { label: 'Un-culturable', color: '#cccccc' },
      { label: 'Snow/Glacial', color: '#ffffff' }
    ]
  },
  {
    id: 'lineament',
    categoryId: 'lineament',
    categoryName: 'Lineament',
    name: 'Lineament',
    description: '1:50,000 scale mapping of linear features of geological significance.',
    themeCode: 'LN50K',
    yearCode: '0506',
    legend: [
      { label: 'Major Lineament', color: '#000000' },
      { label: 'Minor Lineament', color: '#696969' }
    ]
  },
  /*
  {
    id: 'waterbodies',
    name: 'Water Bodies',
    description: 'National water bodies layer showing rivers, lakes, reservoirs and ponds.',
    fixedLayerName: 'forest:GIM_waterbodies',
    themeCode: '',
    yearCode: '',
    legend: [
      { label: 'River', color: '#1E90FF' },
      { label: 'Lake/Reservoir', color: '#4169E1' },
      { label: 'Pond/Tank', color: '#87CEEB' },
      { label: 'Canal', color: '#00BFFF' }
    ]
  },
  {
    id: 'flood_hazard',
    name: 'Flood Hazard Zone',
    description: 'Flood hazard zones mapped across India for disaster management.',
    fixedLayerName: 'school:school_flood_hazard_zone',
    themeCode: '',
    yearCode: '',
    legend: [
      { label: 'High Hazard', color: '#FF0000' },
      { label: 'Medium Hazard', color: '#FFA500' },
      { label: 'Low Hazard', color: '#FFFF00' },
      { label: 'Safe Zone', color: '#00FF00' }
    ]
  },
  {
    id: 'urban_grid',
    name: 'Urban Sprawl',
    description: 'Urban fraction grid showing extent and density of urbanization across India.',
    fixedLayerName: 'urban_grid:urban_fraction_grid',
    themeCode: '',
    yearCode: '',
    legend: [
      { label: 'Dense Urban', color: '#8B0000' },
      { label: 'Moderate Urban', color: '#FF4500' },
      { label: 'Sparse Urban', color: '#FFA07A' },
      { label: 'Peri-urban', color: '#FFE4B5' }
    ]
  }
  */
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

export function buildBhuvanLayerName(themeId: string, stateCode: string): string {
  const theme = BHUVAN_THEMES.find(t => t.id === themeId);
  if (!theme) return themeId;
  
  if (theme.fixedLayerName) return theme.fixedLayerName;
  
  const workspacePrefix = theme.categoryId || theme.id;
  return `${workspacePrefix}:${stateCode}_${theme.themeCode}_${theme.yearCode}`;
}
