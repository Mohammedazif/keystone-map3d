import { ai } from '@/ai/genkit';
import { z } from 'genkit';

// Parse and sanitize the AI response
function parseAndSanitize(rawText: string): any[] {
  // Strip markdown code fences
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '');
    text = text.replace(/\n?```\s*$/, '');
    text = text.trim();
  }

  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');

  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    // Try truncated recovery
    return recoverTruncatedJson(text);
  }

  const jsonString = text.substring(firstBracket, lastBracket + 1);
  let parsed: any;
  
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    return recoverTruncatedJson(text);
  }

  if (!Array.isArray(parsed)) {
    parsed = [parsed];
  }

  // Sanitize string values to numbers
  parsed = parsed.map((item: any) => {
    for (const cat of ['geometry', 'highrise', 'facilities', 'sustainability', 'safety_and_services', 'administration']) {
      if (item[cat] && typeof item[cat] === 'object') {
        for (const key of Object.keys(item[cat])) {
          const obj = item[cat][key];
          if (obj && typeof obj === 'object') {
            if ('value' in obj && typeof obj.value === 'string') {
              const m = obj.value.match(/[\d.]+/);
              obj.value = m ? parseFloat(m[0]) : null;
            }
          }
        }
      }
    }
    // FAR sanity
    if (item.geometry?.floor_area_ratio?.value > 20) {
      let f = item.geometry.floor_area_ratio.value;
      item.geometry.floor_area_ratio.value = (f >= 100 && f <= 500) ? f / 100 : 1.5;
    }
    // If FAR ended up as 0, that's almost certainly wrong — clear it so admin can fill manually
    if (item.geometry?.floor_area_ratio?.value === 0) {
      item.geometry.floor_area_ratio.value = '';
    }
    // Coverage sanity
    if (item.geometry?.max_ground_coverage?.value > 100) {
      item.geometry.max_ground_coverage.value = 100;
    }
    // Highrise FAR / coverage sanity
    if (item.highrise && typeof item.highrise === 'object') {
      for (const key of Object.keys(item.highrise)) {
        const obj = item.highrise[key];
        if (!obj || typeof obj !== 'object') continue;
        // FAR tiers sanity (far_upto_15m, far_15_to_24m, etc.)
        if (key.startsWith('far_') && obj.value > 20) {
          const f = obj.value;
          obj.value = (f >= 100 && f <= 500) ? f / 100 : '';
        }
        if (key.startsWith('far_') && obj.value === 0) {
          obj.value = '';
        }
        // Coverage tiers sanity
        if (key.startsWith('coverage_') && obj.value > 100) {
          obj.value = 100;
        }
      }
    }
    return item;
  });

  return parsed;
}

// Recover entries from truncated JSON
function recoverTruncatedJson(rawText: string): any[] {
  let text = rawText.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  }
  const firstBracket = text.indexOf('[');
  if (firstBracket === -1) return [];

  let jsonStr = text.substring(firstBracket);
  const lastComplete = jsonStr.lastIndexOf('},');
  if (lastComplete > 0) {
    jsonStr = jsonStr.substring(0, lastComplete + 1) + ']';
  } else {
    const lastBrace = jsonStr.lastIndexOf('}');
    if (lastBrace > 0) jsonStr = jsonStr.substring(0, lastBrace + 1) + ']';
  }

  try {
    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    console.error('[Regulation Extractor] Recovery JSON.parse also failed:', (e as Error).message);
    console.error('[Regulation Extractor] Attempted to parse:', jsonStr.substring(0, 300));
    return [];
  }
}

export const extractRegulationData = ai.defineFlow(
  {
    name: 'extractRegulationData',
    inputSchema: z.object({
      documentText: z.string().describe('The full text content of the regulation document'),
      fileName: z.string().describe('The name of the source file for context'),
      overrideLocation: z.string().optional(),
      pdfBase64: z.string().optional().describe('Base64-encoded raw PDF bytes for Gemini Vision'),
    }),
  },
  async (input) => {
    const prompt = `You are an expert HIGH-RISE BUILDING REGULATION data extractor. Your PRIMARY FOCUS is extracting data relevant to high-rise/multi-storey building development — setbacks, coverage, FAR/FSI, height restrictions, and all height-dependent parameters.

Document: ${input.fileName}

TASK:
Extract regulation data for EXACTLY these 5 zone types (use these exact names as the "type" field):
1. "Residential"
2. "Commercial"
3. "Industrial"
4. "Public"
5. "Mixed-Use"

Do NOT create subtypes like "Residential (Plotted)" or "Commercial (Retail)". Merge all residential subtypes into one "Residential" entry, all commercial subtypes into one "Commercial" entry, etc.
⚠️ DO NOT extract Hotels, Motels, Resorts, Service Apartments, or electrical/voltage data as zones.

${input.overrideLocation ? 
`LOCATION: Use exactly "${input.overrideLocation}" for all entries.` 
: 
`LOCATION: Determine the state/city from the document name or content.`}

⚠️⚠️ HIGH-RISE FOCUS INSTRUCTIONS ⚠️⚠️
Pay MAXIMUM attention to:
1. **Setbacks that vary by building height** — many regulations define different setbacks for buildings <15m, 15-24m, 24-45m, >45m etc. Extract the HIGH-RISE tier values (usually the strictest/largest setbacks).
2. **Coverage / ground coverage that varies by building height or number of floors** — extract for the tallest tier.
3. **FAR/FSI tiers** — if FAR increases with height or premium FSI is available for taller buildings, capture it.
4. **Height classification** — at what height does a building become "high-rise" (commonly 15m, 18m, or 24m in Indian regulations).
5. **Setback tables** — look for tables showing setbacks vs building height or setbacks vs road width. Extract ALL tiers.
6. **Structural & fire requirements for tall buildings** — refuge floors, pressurized staircases, fire command centers, helipad pads.
7. **Minimum plot area for high-rise** — many codes require larger plots (e.g. 2000+ sqm) for buildings above a certain height.

RULES:
- Only extract data EXPLICITLY stated in the document. Do NOT guess or hallucinate.
- FAR must be a decimal (e.g. 1.5, 2.0, 2.5). If you see "225" it means 2.25. If you see "150" it means 1.50.
- ⚠️ FAR / FSI MUST NEVER be 0. If you cannot find FAR, OMIT the field entirely. FAR is ALWAYS a positive number (typically 0.5 to 5.0 in Indian regulations). Look for it under labels like "FAR", "FSI", "Floor Space Index", "Floor Area Ratio", or in building-height-based tables.
- Setbacks in meters. Coverage as percentage (0-100).
- For EACH zone, search the ENTIRE document and fill ALL fields you can find.
- ⚠️ NEVER set value to null or 0 for fields like FAR, setbacks, coverage. If you truly cannot find it in the document, OMIT that field entirely instead of returning 0. If multiple values exist (e.g. by plot size), pick the HIGH-RISE / TALLEST BUILDING tier value.
- ⚠️ ALWAYS extract the ACTUAL NUMBER from the document, not just 1 or 0. Examples:
  • seismic_zone → extract the zone number (e.g. 4 or 5)
  • wind_load → extract the speed in m/s (e.g. 39)
  • soil_bearing_capacity → extract in kN/sqm (e.g. 200)
  • electrical_load_sanction → extract in kVA (e.g. 500)
  • sewage_treatment_plant → extract capacity in KLD (e.g. 50)
  • fire_exits_travel_distance → extract distance in m (e.g. 22.5)
  • highrise_threshold → the height in meters at which "high-rise" classification begins (e.g. 15 or 24)
  Only use 1/0 when the document ONLY says "required/not required" with NO specific number.
- ⚠️ Keep "desc" fields SHORT — max 80 characters. Include the height/floor tier context in the desc (e.g. "Front setback for bldg >24m height").

Return a JSON array where each object represents ONE zone extracted. You MUST structure each object exactly like this, grouping fields into categories:

{
  "location": "State/City name",
  "type": "Zone Name (e.g. Residential, Commercial)",
  "confidence": 0.9,
  "geometry": {
    "field_name": {"desc": "...", "unit": "...", "value": <number>}
  },
  "highrise": { ... },
  "facilities": { ... },
  "sustainability": { ... },
  "safety_and_services": { ... }
}

OMIT fields you cannot find. Do not leave them as null or 0.

COMPLETE LIST OF CATEGORIES AND FIELDS TO COMPILE FOR EACH ZONE:
"geometry": {
  "setback" (m), "front_setback" (m), "rear_setback" (m), "side_setback" (m),
  "road_width" (m), "max_ground_coverage" (%), "floor_area_ratio" (),
  "max_height" (m), "minimum_plot_size" (sqm), "minimum_frontage_width" (m),
  "density_norms" (DU/acre), "units_per_acre" (units/acre), "population_load" (persons/hectare),
  "premium_fsi_tdr" (), "premium_far_purchasable" (), "fungible_fsi_incentive" (),
  "fungible_far_incentive" (), "excluded_areas_calc" (), "exclusions_basement_services" (),
  "road_setback_building_line" (m), "highrise_setback_multiplier" (),
  "based_on_road_width" (m), "based_on_building_height" (m), "based_on_plot_size" (sqm),
  "height_vs_road_width" (), "aviation_clearance" (m), "shadow_skyline_control" ()
}

"highrise": {
  "highrise_threshold" (m) — height at which building is classified as high-rise,
  "front_setback_upto_15m" (m) — front setback for buildings up to 15m,
  "front_setback_15_to_24m" (m) — front setback for buildings 15m to 24m,
  "front_setback_24_to_45m" (m) — front setback for buildings 24m to 45m,
  "front_setback_above_45m" (m) — front setback for buildings above 45m,
  "rear_setback_upto_15m" (m) — rear setback for buildings up to 15m,
  "rear_setback_15_to_24m" (m) — rear setback for buildings 15m to 24m,
  "rear_setback_24_to_45m" (m) — rear setback for buildings 24m to 45m,
  "rear_setback_above_45m" (m) — rear setback for buildings above 45m,
  "side_setback_upto_15m" (m) — side setback for buildings up to 15m,
  "side_setback_15_to_24m" (m) — side setback for buildings 15m to 24m,
  "side_setback_24_to_45m" (m) — side setback for buildings 24m to 45m,
  "side_setback_above_45m" (m) — side setback for buildings above 45m,
  "coverage_upto_15m" (%) — ground coverage for buildings up to 15m,
  "coverage_15_to_24m" (%) — ground coverage for buildings 15m to 24m,
  "coverage_24_to_45m" (%) — ground coverage for buildings 24m to 45m,
  "coverage_above_45m" (%) — ground coverage for buildings above 45m,
  "far_upto_15m" () — FAR for buildings up to 15m,
  "far_15_to_24m" () — FAR for buildings 15m to 24m,
  "far_24_to_45m" () — FAR for buildings 24m to 45m,
  "far_above_45m" () — FAR for buildings above 45m,
  "min_plot_area_highrise" (sqm) — minimum plot area for high-rise construction,
  "min_road_width_highrise" (m) — minimum road width required for high-rise,
  "max_floors" () — maximum number of floors,
  "max_building_height" (m) — absolute maximum building height,
  "stilt_floor_height" (m) — height of stilt / parking floor,
  "floor_to_floor_height" (m) — standard floor-to-floor height,
  "basement_depth" (m) — maximum basement depth,
  "basement_levels_allowed" () — number of basement levels,
  "podium_height" (m) — maximum podium height allowed,
  "podium_coverage" (%) — coverage allowed at podium level,
  "setback_above_podium" (m) — additional setback above podium,
  "tower_coverage_above_podium" (%) — tower coverage above podium level,
  "green_building_mandate_height" (m) — height above which green certification is mandatory,
  "structural_audit_threshold" (m) — height above which structural audit is mandatory,
  "helipad_required_height" (m) — height above which helipad is required,
  "refuge_floor_interval" () — refuge floor required every N floors (e.g. 15),
  "refuge_floor_area" (sqm) — minimum area per refuge floor,
  "pressurized_staircase_threshold" (m) — height above which pressurized staircase required,
  "fire_lift_threshold" (m) — height above which fire lift is mandatory,
  "fire_command_center_threshold" (m) — height above which fire command center required
}

"facilities": {
  "parking" (spaces/unit), "open_space" (%), "entry_exit_width" (m),
  "internal_road_width" (m), "parking_ecs" (ECS), "visitor_parking" (%),
  "ramp_slope" (%), "turning_radius" (m), "staircase_width" (m),
  "staircase_count" (), "lift_requirements" (), "refuge_areas" (sqm),
  "corridor_widths" (m), "unit_size_compliance" (sqm)
}

"sustainability": {
  "rainwater_harvesting" (liters/sqm), "solar_panels" (% of roof),
  "leed_compliance" (), "igbc_compliance" (), "griha_compliance" (),
  "tree_plantation_green_cover" (%), "water_consumption_norm" (lpcd),
  "energy_efficiency" ()
}

"safety_and_services": {
  "fire_safety" (), "fire_tender_access" (m), "fire_tender_movement" (m),
  "staircases_by_height" (), "fire_exits_travel_distance" (m), "refuge_floors" (),
  "fire_fighting_systems" (), "fire_command_center" (),
  "water_supply_approval" (), "sewer_connection_stp" (), "stormwater_drainage" (),
  "electrical_load_sanction" (kVA), "transformer_placement" (),
  "backup_power_norms" (kVA), "gas_pipelines" (), "telecom_infrastructure" (),
  "sewage_treatment_plant" (KLD), "solid_waste_management" (),
  "seismic_zone" (), "wind_load" (m/s), "soil_bearing_capacity" (kN/sqm)
}

"administration": {
  "fee_rate" (% of cost), "land_use_zoning" (), "conversion_status" (),
  "land_use_category" (), "tod_rules" (), "special_zones" (),
  "saleable_vs_carpet_rera" (), "exit_compliance" (),
  "absorption_assumptions" (%/year), "infra_load_vs_financial_viability" ()
}

EXAMPLE OUTPUT STRUCTURE:
[
  {
    "location": "<state>",
    "type": "Residential",
    "geometry": { "front_setback": {"desc": "Front setback for high-rise (>24m)", "unit": "m", "value": 9}, "max_ground_coverage": {"desc": "Max coverage for bldg >24m height", "unit": "%", "value": 33}, ... },
    "highrise": {
      "highrise_threshold": {"desc": "Building classified high-rise above this", "unit": "m", "value": 15},
      "front_setback_upto_15m": {"desc": "Front setback for bldg up to 15m", "unit": "m", "value": 3},
      "front_setback_15_to_24m": {"desc": "Front setback for bldg 15-24m", "unit": "m", "value": 6},
      "front_setback_24_to_45m": {"desc": "Front setback for bldg 24-45m", "unit": "m", "value": 9},
      "front_setback_above_45m": {"desc": "Front setback for bldg >45m", "unit": "m", "value": 12},
      "coverage_upto_15m": {"desc": "Ground coverage for bldg up to 15m", "unit": "%", "value": 60},
      "coverage_above_45m": {"desc": "Ground coverage for bldg >45m", "unit": "%", "value": 30},
      "min_plot_area_highrise": {"desc": "Min plot for high-rise", "unit": "sqm", "value": 2000},
      "refuge_floor_interval": {"desc": "Refuge floor every 15 floors", "unit": "", "value": 15},
      ...
    },
    "facilities": { "parking": {"desc": "Parking for high-rise residential", "unit": "ECS", "value": 1.33}, ... },
    "sustainability": { ... },
    "safety_and_services": { "fire_safety": {"desc": "...", "unit": "", "value": 1}, ... },
    "administration": { ... },
    "confidence": 0.9
  }
]

⚠️ PRIORITY: The "highrise" section is the MOST IMPORTANT. Search aggressively for setback tables, coverage tables, and FAR tables that vary by building height. These are typically found in:
- Setback schedules / tables
- Chapter on "High-Rise Buildings" or "Special Buildings"
- NBC (National Building Code) references
- Fire safety chapters
- Annexures with dimensional requirements

Only include fields found in the document. Search thoroughly — data appears across different chapters/tables/annexures.
Return ONLY the JSON array — no markdown fences, no explanation.`;

    let responseText: string;

    if (input.pdfBase64) {
      console.log(`[Regulation Extractor] Using Gemini Vision for PDF: ${input.fileName}`);
      try {
        let visionResponse = await ai.generate({
          model: 'googleai/gemini-3.1-pro-preview',
          prompt: [
            { media: { contentType: 'application/pdf', url: `data:application/pdf;base64,${input.pdfBase64}` } },
            { text: prompt },
          ],
          config: { maxOutputTokens: 65536, temperature: 0.1 },
        });
        responseText = visionResponse.text;
        console.log(`[Regulation Extractor] Gemini Vision response: ${responseText.length} chars`);

        // If response is suspiciously short, retry once
        if (responseText.length < 5000) {
          console.warn(`[Regulation Extractor] Response too short (${responseText.length} chars), retrying...`);
          visionResponse = await ai.generate({
            model: 'googleai/gemini-3.1-pro-preview',
            prompt: [
              { media: { contentType: 'application/pdf', url: `data:application/pdf;base64,${input.pdfBase64}` } },
              { text: prompt },
            ],
            config: { maxOutputTokens: 65536, temperature: 0.2 },
          });
          responseText = visionResponse.text;
          console.log(`[Regulation Extractor] Retry response: ${responseText.length} chars`);
        }
      } catch (err: any) {
        console.warn('[Regulation Extractor] Vision failed, falling back to text:', err.message);
        responseText = await textFallback(prompt, input.documentText);
      }
    } else {
      responseText = await textFallback(prompt, input.documentText);
    }

    let result = parseAndSanitize(responseText);
    if (result.length === 0) {
      console.error('[Regulation Extractor] No entries parsed. Raw response (first 1000 chars):', responseText.substring(0, 1000));
      // One more retry with text fallback before giving up
      if (input.documentText && input.documentText.length > 50) {
        console.log('[Regulation Extractor] Attempting text fallback...');
        const fallbackText = await textFallback(prompt, input.documentText);
        result = parseAndSanitize(fallbackText);
      }
      if (result.length === 0) {
        throw new Error('Could not extract any regulation data from the document');
      }
    }
    console.log(`[Regulation Extractor] Successfully extracted ${result.length} entries`);
    return result;
  }
);

async function textFallback(prompt: string, documentText: string): Promise<string> {
  console.log(`[Regulation Extractor] Using text-based extraction (${documentText.length} chars)`);
  const fullPrompt = prompt + `\n\nDocument Content:\n${documentText.slice(0, 120000)}`;
  const { text } = await ai.generate({
    model: 'googleai/gemini-3.1-pro-preview',
    prompt: fullPrompt,
    config: { maxOutputTokens: 65536, temperature: 0.1 },
  });
  return text;
}
