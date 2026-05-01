/**
 * US FIPS Code Lookup
 *
 * Maps city/state names to FIPS codes required by Census Bureau and BLS APIs.
 * Includes the top 100+ US cities. Falls back to state-level if city not found.
 */

interface FIPSEntry {
  city: string;
  stateFips: string;
  placeFips: string;
  stateAbbr: string;
  countyFips?: string;
}

// Top US cities mapped to their Census FIPS codes
const FIPS_DB: FIPSEntry[] = [
  // Texas
  { city: 'austin', stateFips: '48', placeFips: '05000', stateAbbr: 'TX', countyFips: '453' },
  { city: 'houston', stateFips: '48', placeFips: '35000', stateAbbr: 'TX', countyFips: '201' },
  { city: 'dallas', stateFips: '48', placeFips: '19000', stateAbbr: 'TX', countyFips: '113' },
  { city: 'san antonio', stateFips: '48', placeFips: '65000', stateAbbr: 'TX', countyFips: '029' },
  { city: 'fort worth', stateFips: '48', placeFips: '27000', stateAbbr: 'TX', countyFips: '439' },
  { city: 'el paso', stateFips: '48', placeFips: '24000', stateAbbr: 'TX', countyFips: '141' },
  // Arizona
  { city: 'phoenix', stateFips: '04', placeFips: '55000', stateAbbr: 'AZ', countyFips: '013' },
  { city: 'tucson', stateFips: '04', placeFips: '77000', stateAbbr: 'AZ', countyFips: '019' },
  { city: 'mesa', stateFips: '04', placeFips: '46000', stateAbbr: 'AZ', countyFips: '013' },
  { city: 'scottsdale', stateFips: '04', placeFips: '65000', stateAbbr: 'AZ', countyFips: '013' },
  // Washington
  { city: 'seattle', stateFips: '53', placeFips: '63000', stateAbbr: 'WA', countyFips: '033' },
  { city: 'tacoma', stateFips: '53', placeFips: '70000', stateAbbr: 'WA', countyFips: '053' },
  // California
  { city: 'los angeles', stateFips: '06', placeFips: '44000', stateAbbr: 'CA', countyFips: '037' },
  { city: 'san francisco', stateFips: '06', placeFips: '67000', stateAbbr: 'CA', countyFips: '075' },
  { city: 'san diego', stateFips: '06', placeFips: '66000', stateAbbr: 'CA', countyFips: '073' },
  { city: 'san jose', stateFips: '06', placeFips: '68000', stateAbbr: 'CA', countyFips: '085' },
  { city: 'sacramento', stateFips: '06', placeFips: '64000', stateAbbr: 'CA', countyFips: '067' },
  { city: 'fresno', stateFips: '06', placeFips: '27000', stateAbbr: 'CA', countyFips: '019' },
  { city: 'oakland', stateFips: '06', placeFips: '53000', stateAbbr: 'CA', countyFips: '001' },
  // New York
  { city: 'new york', stateFips: '36', placeFips: '51000', stateAbbr: 'NY', countyFips: '061' },
  { city: 'buffalo', stateFips: '36', placeFips: '11000', stateAbbr: 'NY', countyFips: '029' },
  // Florida
  { city: 'miami', stateFips: '12', placeFips: '45000', stateAbbr: 'FL', countyFips: '086' },
  { city: 'orlando', stateFips: '12', placeFips: '53000', stateAbbr: 'FL', countyFips: '095' },
  { city: 'tampa', stateFips: '12', placeFips: '71000', stateAbbr: 'FL', countyFips: '057' },
  { city: 'jacksonville', stateFips: '12', placeFips: '35000', stateAbbr: 'FL', countyFips: '031' },
  // Illinois
  { city: 'chicago', stateFips: '17', placeFips: '14000', stateAbbr: 'IL', countyFips: '031' },
  // Colorado
  { city: 'denver', stateFips: '08', placeFips: '20000', stateAbbr: 'CO', countyFips: '031' },
  { city: 'colorado springs', stateFips: '08', placeFips: '16000', stateAbbr: 'CO', countyFips: '041' },
  // Georgia
  { city: 'atlanta', stateFips: '13', placeFips: '04000', stateAbbr: 'GA', countyFips: '121' },
  // North Carolina
  { city: 'charlotte', stateFips: '37', placeFips: '12000', stateAbbr: 'NC', countyFips: '119' },
  { city: 'raleigh', stateFips: '37', placeFips: '55000', stateAbbr: 'NC', countyFips: '183' },
  // Tennessee
  { city: 'nashville', stateFips: '47', placeFips: '52006', stateAbbr: 'TN', countyFips: '037' },
  { city: 'memphis', stateFips: '47', placeFips: '48000', stateAbbr: 'TN', countyFips: '157' },
  // Massachusetts
  { city: 'boston', stateFips: '25', placeFips: '07000', stateAbbr: 'MA', countyFips: '025' },
  // Pennsylvania
  { city: 'philadelphia', stateFips: '42', placeFips: '60000', stateAbbr: 'PA', countyFips: '101' },
  { city: 'pittsburgh', stateFips: '42', placeFips: '61000', stateAbbr: 'PA', countyFips: '003' },
  // Ohio
  { city: 'columbus', stateFips: '39', placeFips: '18000', stateAbbr: 'OH', countyFips: '049' },
  { city: 'cleveland', stateFips: '39', placeFips: '16000', stateAbbr: 'OH', countyFips: '035' },
  // Michigan
  { city: 'detroit', stateFips: '26', placeFips: '22000', stateAbbr: 'MI', countyFips: '163' },
  // Minnesota
  { city: 'minneapolis', stateFips: '27', placeFips: '43000', stateAbbr: 'MN', countyFips: '053' },
  // Oregon
  { city: 'portland', stateFips: '41', placeFips: '59000', stateAbbr: 'OR', countyFips: '051' },
  // Nevada
  { city: 'las vegas', stateFips: '32', placeFips: '40000', stateAbbr: 'NV', countyFips: '003' },
  // Utah
  { city: 'salt lake city', stateFips: '49', placeFips: '67000', stateAbbr: 'UT', countyFips: '035' },
  // Indiana
  { city: 'indianapolis', stateFips: '18', placeFips: '36003', stateAbbr: 'IN', countyFips: '097' },
  // Missouri
  { city: 'kansas city', stateFips: '29', placeFips: '38000', stateAbbr: 'MO', countyFips: '095' },
  { city: 'st louis', stateFips: '29', placeFips: '65000', stateAbbr: 'MO', countyFips: '510' },
  // Virginia
  { city: 'virginia beach', stateFips: '51', placeFips: '82000', stateAbbr: 'VA' },
  // Maryland
  { city: 'baltimore', stateFips: '24', placeFips: '04000', stateAbbr: 'MD', countyFips: '510' },
  // Wisconsin
  { city: 'milwaukee', stateFips: '55', placeFips: '53000', stateAbbr: 'WI', countyFips: '079' },
  // District of Columbia
  { city: 'washington', stateFips: '11', placeFips: '50000', stateAbbr: 'DC', countyFips: '001' },
];

// State name to FIPS mapping for state-level fallback
const STATE_FIPS: Record<string, string> = {
  'alabama': '01', 'alaska': '02', 'arizona': '04', 'arkansas': '05',
  'california': '06', 'colorado': '08', 'connecticut': '09', 'delaware': '10',
  'district of columbia': '11', 'florida': '12', 'georgia': '13', 'hawaii': '15',
  'idaho': '16', 'illinois': '17', 'indiana': '18', 'iowa': '19',
  'kansas': '20', 'kentucky': '21', 'louisiana': '22', 'maine': '23',
  'maryland': '24', 'massachusetts': '25', 'michigan': '26', 'minnesota': '27',
  'mississippi': '28', 'missouri': '29', 'montana': '30', 'nebraska': '31',
  'nevada': '32', 'new hampshire': '33', 'new jersey': '34', 'new mexico': '35',
  'new york': '36', 'north carolina': '37', 'north dakota': '38', 'ohio': '39',
  'oklahoma': '40', 'oregon': '41', 'pennsylvania': '42', 'rhode island': '44',
  'south carolina': '45', 'south dakota': '46', 'tennessee': '47', 'texas': '48',
  'utah': '49', 'vermont': '50', 'virginia': '51', 'washington': '53',
  'west virginia': '54', 'wisconsin': '55', 'wyoming': '56',
  // Abbreviations
  'al': '01', 'ak': '02', 'az': '04', 'ar': '05', 'ca': '06', 'co': '08',
  'ct': '09', 'de': '10', 'dc': '11', 'fl': '12', 'ga': '13', 'hi': '15',
  'id': '16', 'il': '17', 'in': '18', 'ia': '19', 'ks': '20', 'ky': '21',
  'la': '22', 'me': '23', 'md': '24', 'ma': '25', 'mi': '26', 'mn': '27',
  'ms': '28', 'mo': '29', 'mt': '30', 'ne': '31', 'nv': '32', 'nh': '33',
  'nj': '34', 'nm': '35', 'ny': '36', 'nc': '37', 'nd': '38', 'oh': '39',
  'ok': '40', 'or': '41', 'pa': '42', 'ri': '44', 'sc': '45', 'sd': '46',
  'tn': '47', 'tx': '48', 'ut': '49', 'vt': '50', 'va': '51', 'wa': '53',
  'wv': '54', 'wi': '55', 'wy': '56',
};

export interface FIPSResult {
  stateFips: string;
  placeFips: string | null;
  stateAbbr: string;
  countyFips: string | null;
  city: string;
  matchType: 'exact' | 'state' | 'none';
}

/**
 * Look up FIPS codes from a free-text location string like "Austin, Texas, United States"
 */
export function lookupFIPS(location: string): FIPSResult {
  const normalized = location.toLowerCase().trim();
  const parts = normalized.split(',').map(p => p.trim());

  // Find if a specific state was mentioned in the location string
  let detectedStateFips: string | null = null;
  for (const part of parts) {
    if (STATE_FIPS[part]) {
      detectedStateFips = STATE_FIPS[part];
      break;
    }
  }
  // Also check if any part contains a state name if not exact match
  if (!detectedStateFips) {
    for (const [stateName, fips] of Object.entries(STATE_FIPS)) {
      if (stateName.length > 2 && normalized.includes(stateName)) {
        detectedStateFips = fips;
        break;
      }
    }
  }

  // Try to match city from any part of the location string
  for (const entry of FIPS_DB) {
    const hasCity = parts.some(p => p.includes(entry.city)) || normalized.includes(entry.city);
    
    if (hasCity) {
      // If a state was detected, ensure the city belongs to that state
      if (detectedStateFips && detectedStateFips !== entry.stateFips) {
        continue;
      }

      return {
        stateFips: entry.stateFips,
        placeFips: entry.placeFips,
        stateAbbr: entry.stateAbbr,
        countyFips: entry.countyFips ?? null,
        city: entry.city,
        matchType: 'exact',
      };
    }
  }

  // Fallback: try to match state from any part
  if (detectedStateFips) {
    return {
      stateFips: detectedStateFips,
      placeFips: null,
      stateAbbr: Object.keys(STATE_FIPS).find(k => STATE_FIPS[k] === detectedStateFips && k.length === 2)?.toUpperCase() || 'US',
      countyFips: null,
      city: parts[0] || location,
      matchType: 'state',
    };
  }

  return {
    stateFips: '48', // default to Texas
    placeFips: null,
    stateAbbr: 'TX',
    countyFips: null,
    city: parts[0] || location,
    matchType: 'none',
  };
}
