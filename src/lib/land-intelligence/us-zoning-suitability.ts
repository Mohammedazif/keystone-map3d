/**
 * US Zoning Suitability Checker
 *
 * Validates whether a parcel's zoning code is compatible with the user's
 * intended use and checks minimum area requirements per use type.
 *
 * References: General US municipal zoning standards (IBC/IFC Table 302.1 occupancy groups)
 */

export type IntendedUseCategory =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'mixed_use'
  | 'retail'
  | 'office'
  | 'hospitality'
  | 'institutional';

export type SuitabilityLevel = 'suitable' | 'conditional' | 'unsuitable';

export interface SuitabilityWarning {
  level: 'error' | 'warning' | 'info';
  code: string;
  message: string;
}

export interface ZoningSuitabilityResult {
  suitability: SuitabilityLevel;
  score: number; // 0-100
  warnings: SuitabilityWarning[];
  recommendedMinArea: number; // in sqm
  recommendedZoning: string[];
}

/**
 * Minimum area requirements by intended use (in sqm).
 * Based on general US municipal planning best practices.
 */
const MIN_AREA_REQUIREMENTS: Record<string, { minSqm: number; idealSqm: number; label: string }> = {
  residential:   { minSqm: 400,   idealSqm: 2000,  label: 'Residential' },
  commercial:    { minSqm: 500,   idealSqm: 4000,  label: 'Commercial' },
  industrial:    { minSqm: 4000,  idealSqm: 20000, label: 'Industrial' },
  mixed_use:     { minSqm: 1000,  idealSqm: 5000,  label: 'Mixed Use' },
  retail:        { minSqm: 200,   idealSqm: 2000,  label: 'Retail' },
  office:        { minSqm: 300,   idealSqm: 3000,  label: 'Office' },
  hospitality:   { minSqm: 2000,  idealSqm: 10000, label: 'Hospitality' },
  institutional: { minSqm: 1500,  idealSqm: 8000,  label: 'Institutional' },
};

/**
 * Zoning code to allowed use mapping.
 * Maps common US zoning code prefixes to what they typically permit.
 */
const ZONING_ALLOWS: Record<string, string[]> = {
  // Residential codes
  'R':   ['residential'],
  'SF':  ['residential'],
  'RS':  ['residential'],
  'MF':  ['residential'],
  'RM':  ['residential'],
  // Commercial codes
  'C':   ['commercial', 'retail', 'office', 'hospitality'],
  'CS':  ['commercial', 'retail', 'office'],
  'CBD': ['commercial', 'retail', 'office', 'mixed_use'],
  'GC':  ['commercial', 'retail', 'office'],
  'GR':  ['commercial', 'retail'],
  // Mixed Use codes
  'MU':  ['residential', 'commercial', 'retail', 'office', 'mixed_use'],
  'MX':  ['residential', 'commercial', 'retail', 'office', 'mixed_use'],
  'DMU': ['residential', 'commercial', 'retail', 'office', 'mixed_use', 'hospitality'],
  'V':   ['residential', 'commercial', 'retail', 'office', 'mixed_use'], // Vertical Mixed Use
  // Industrial codes
  'I':   ['industrial'],
  'LI':  ['industrial', 'commercial'],
  'HI':  ['industrial'],
  'IP':  ['industrial', 'office'],
  'W':   ['industrial'],
  // Office codes
  'O':   ['office', 'institutional'],
  'LO':  ['office'],
  // Planned Development
  'PD':  ['residential', 'commercial', 'mixed_use', 'retail', 'office'],
  'PUD': ['residential', 'commercial', 'mixed_use', 'retail', 'office'],
  // Agricultural
  'A':   ['residential'],
  'AG':  ['residential'],
  // Public/Institutional
  'P':   ['institutional'],
  'GO':  ['institutional', 'office'],
};

/**
 * Normalizes user intent to our category system.
 */
function normalizeIntendedUse(intendedUse: string): string {
  const lower = intendedUse.toLowerCase().replace(/[_-]/g, ' ').trim();

  if (/industrial|warehouse|factory|manufactur|logistics/.test(lower)) return 'industrial';
  if (/mixed\s*use|mixed/.test(lower)) return 'mixed_use';
  if (/retail|shop|store/.test(lower)) return 'retail';
  if (/office|co.?working/.test(lower)) return 'office';
  if (/hotel|hospitality|resort/.test(lower)) return 'hospitality';
  if (/hospital|school|institution|public/.test(lower)) return 'institutional';
  if (/commercial|business/.test(lower)) return 'commercial';
  if (/residential|apartment|housing|villa/.test(lower)) return 'residential';

  return lower;
}

/**
 * Extracts the base zoning prefix from a complex code like "CS-MU-V-NP".
 */
function extractZoningPrefixes(zoningCode: string): string[] {
  if (!zoningCode) return [];
  const upper = zoningCode.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const parts = upper.split('-').filter(Boolean);

  // Remove numeric suffixes (R-1 → R, C-3 → C)
  return parts.map(p => p.replace(/\d+$/, '')).filter(Boolean);
}

/**
 * Main suitability checker.
 */
export function checkZoningSuitability(
  zoningCode: string,
  zoningDescription: string,
  intendedUse: string,
  areaSqm: number,
): ZoningSuitabilityResult {
  const warnings: SuitabilityWarning[] = [];
  const normalizedUse = normalizeIntendedUse(intendedUse);
  const areaReq = MIN_AREA_REQUIREMENTS[normalizedUse] || MIN_AREA_REQUIREMENTS['commercial'];
  const prefixes = extractZoningPrefixes(zoningCode);

  let score = 50; // start neutral

  // ── 1. Check zoning compatibility ──────────────────────────────────────────
  const allowedUses = new Set<string>();
  for (const prefix of prefixes) {
    const uses = ZONING_ALLOWS[prefix];
    if (uses) uses.forEach(u => allowedUses.add(u));
  }

  // Also check the description for keywords
  const descLower = (zoningDescription || '').toLowerCase();
  if (/industrial/.test(descLower)) allowedUses.add('industrial');
  if (/commercial/.test(descLower)) { allowedUses.add('commercial'); allowedUses.add('retail'); allowedUses.add('office'); }
  if (/mixed[\s-]?use/.test(descLower)) { allowedUses.add('mixed_use'); allowedUses.add('residential'); allowedUses.add('commercial'); }
  if (/residential/.test(descLower)) allowedUses.add('residential');
  if (/office/.test(descLower)) allowedUses.add('office');

  const isZoningCompatible = allowedUses.has(normalizedUse);

  if (!isZoningCompatible && allowedUses.size > 0) {
    score -= 30;
    const allowedList = Array.from(allowedUses).map(u => {
      const req = MIN_AREA_REQUIREMENTS[u];
      return req ? req.label : u;
    }).join(', ');

    warnings.push({
      level: 'error',
      code: 'ZONING_MISMATCH',
      message: `This parcel is zoned "${zoningCode}" (${zoningDescription || 'N/A'}), which typically allows: ${allowedList}. Your intended use "${areaReq.label}" may require a zoning variance or special use permit.`,
    });
  } else if (isZoningCompatible) {
    score += 25;
    warnings.push({
      level: 'info',
      code: 'ZONING_MATCH',
      message: `Zoning "${zoningCode}" is compatible with ${areaReq.label} use.`,
    });
  } else if (allowedUses.size === 0) {
    // Unknown zoning code — can't determine
    warnings.push({
      level: 'warning',
      code: 'ZONING_UNKNOWN',
      message: `Zoning code "${zoningCode}" is not in our database. Verify with the local jurisdiction that ${areaReq.label} use is permitted.`,
    });
  }

  // ── 2. Check minimum area requirements ─────────────────────────────────────
  if (areaSqm < areaReq.minSqm) {
    score -= 25;
    warnings.push({
      level: 'error',
      code: 'AREA_TOO_SMALL',
      message: `${areaReq.label} developments typically require a minimum of ${areaReq.minSqm.toLocaleString()} sqm (${Math.round(areaReq.minSqm * 10.7639).toLocaleString()} sqft). This parcel is ${areaSqm.toLocaleString()} sqm — ${Math.round(((areaReq.minSqm - areaSqm) / areaReq.minSqm) * 100)}% below minimum.`,
    });
  } else if (areaSqm < areaReq.idealSqm) {
    score -= 5;
    warnings.push({
      level: 'warning',
      code: 'AREA_BELOW_IDEAL',
      message: `This parcel (${areaSqm.toLocaleString()} sqm) meets the minimum for ${areaReq.label}, but the ideal size is ${areaReq.idealSqm.toLocaleString()} sqm+ for optimal ${areaReq.label} operations.`,
    });
  } else {
    score += 15;
  }

  // ── 3. Special industrial warnings ─────────────────────────────────────────
  if (normalizedUse === 'industrial') {
    if (!allowedUses.has('industrial')) {
      warnings.push({
        level: 'error',
        code: 'INDUSTRIAL_ZONE_REQUIRED',
        message: `Industrial use requires I-1 (Light Industrial), I-2 (General Industrial), or LI/HI zoning. This parcel is zoned "${zoningCode}". Converting commercial or residential zones to industrial is extremely difficult and rarely approved.`,
      });
    }
    if (areaSqm < 4000) {
      warnings.push({
        level: 'warning',
        code: 'INDUSTRIAL_MIN_AREA',
        message: `Industrial facilities (warehouses, manufacturing) typically need 4,000+ sqm for efficient operations including loading docks, truck turning radius, and buffer zones. Consider parcels of 10,000+ sqm for industrial development.`,
      });
    }
  }

  // ── 4. Recommend suitable zoning codes ─────────────────────────────────────
  const recommendedZoning: string[] = [];
  for (const [code, uses] of Object.entries(ZONING_ALLOWS)) {
    if (uses.includes(normalizedUse)) {
      recommendedZoning.push(code);
    }
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine overall suitability
  let suitability: SuitabilityLevel = 'suitable';
  if (warnings.some(w => w.level === 'error')) {
    suitability = score < 25 ? 'unsuitable' : 'conditional';
  }

  return {
    suitability,
    score,
    warnings,
    recommendedMinArea: areaReq.minSqm,
    recommendedZoning,
  };
}

/**
 * Checks only if the area meets the minimum/ideal requirements for the intended use.
 */
export function checkAreaSuitability(intendedUse: string, areaSqm: number): SuitabilityWarning[] {
  const warnings: SuitabilityWarning[] = [];
  if (!intendedUse || !areaSqm) return warnings;

  const normalizedUse = normalizeIntendedUse(intendedUse);
  const areaReq = MIN_AREA_REQUIREMENTS[normalizedUse] || MIN_AREA_REQUIREMENTS['commercial'];

  if (areaSqm < areaReq.minSqm) {
    warnings.push({
      level: 'error',
      code: 'AREA_TOO_SMALL',
      message: `${areaReq.label} developments typically require a minimum of ${areaReq.minSqm.toLocaleString()} sqm (${Math.round(areaReq.minSqm * 10.7639).toLocaleString()} sqft). Your input of ${areaSqm.toLocaleString()} sqm is ${Math.round(((areaReq.minSqm - areaSqm) / areaReq.minSqm) * 100)}% below minimum.`,
    });
  } else if (areaSqm < areaReq.idealSqm) {
    warnings.push({
      level: 'warning',
      code: 'AREA_BELOW_IDEAL',
      message: `Your size of ${areaSqm.toLocaleString()} sqm meets the minimum for ${areaReq.label}, but the ideal size is ${areaReq.idealSqm.toLocaleString()} sqm+ for optimal operations.`,
    });
  }

  if (normalizedUse === 'industrial' && areaSqm < 4000) {
    warnings.push({
      level: 'warning',
      code: 'INDUSTRIAL_MIN_AREA',
      message: `Industrial facilities (warehouses, manufacturing) typically need 4,000+ sqm for efficient operations including loading docks and truck turning radius. Consider 10,000+ sqm.`,
    });
  }

  return warnings;
}
