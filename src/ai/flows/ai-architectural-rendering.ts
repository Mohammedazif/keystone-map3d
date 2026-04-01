'use server';
/**
 * @fileOverview Generates a photorealistic architectural rendering using NanoBanana API.
 *
 * Collects full building, plot, and design strategy details to create an accurate prompt.
 * Supports single or multi-building plots.
 * 
 * API: https://docs.nanobananaapi.ai/
 * Flow: POST /generate → get taskId → poll GET /record-info until done → return resultImageUrl
 */

import {
  type GenerateRenderingInput,
  type GenerateRenderingOutput,
  type RenderingProjectSummary,
} from '@/lib/types';

const NANO_BANANA_BASE = 'https://api.nanobananaapi.ai/api/v1/nanobanana';
const POLL_INTERVAL_MS = 3000;
const MAX_POLLS = 120; // ~6 minutes max wait (Pro 2K can take 2-5 min)

/**
 * Creates a detailed architectural prompt from all building, plot and design parameters
 */
function createArchitecturalPrompt(input: GenerateRenderingInput): string {
  const { buildings, plot, design } = input;
  const uniqueBuildingIds = new Set(buildings.map((b: any) => {
    if (typeof b.id === 'string') {
      return b.id.replace(/-podium$/, '').replace(/-tower$/, '');
    }
    return String(b.id || b.name);
  }));
  const numBuildings = uniqueBuildingIds.size;

  function getBaseId(b: any) {
    if (typeof b.id === 'string') return b.id.replace(/-podium$/, '').replace(/-tower$/, '');
    return String(b.id || b.name);
  }

  const buildingGroups = new Map<string, { main: any, podium: any, tower: any }>();
  buildings.forEach((b: any) => {
    const baseId = getBaseId(b);
    if (!buildingGroups.has(baseId)) buildingGroups.set(baseId, { main: b, podium: null, tower: null });
    const g = buildingGroups.get(baseId)!;
    if (typeof b.id === 'string') {
      if (b.id.includes('-podium')) g.podium = b;
      else if (b.id.includes('-tower')) g.tower = b;
      else g.main = b;
    }
  });

  const buildingGroupArray = Array.from(buildingGroups.values());

  // ── Building descriptions (compact, grouped by identical config) ──
  function describeBuildingGroup(group: any): string {
    const isComposite = group.podium && group.tower;
    const b = group.tower || group.main || group.podium;
    const p = group.podium;
    const t = group.tower;

    // For composite (podium-tower) buildings, the podium may have the mixed-use data
    // while the tower is pure Residential. Check both parts.
    const overallUse = isComposite
      ? (p.intendedUse === 'Mixed-Use' || t.intendedUse === 'Mixed-Use' ? 'Mixed-Use' : b.intendedUse || 'Residential')
      : (b.intendedUse || 'Residential');
    const use = overallUse;
    const gfH = b.groundFloorHeight || b.floorHeight || 3.5;
    const tfH = b.floorHeight || 3.5;

    // For composite buildings, merge floor allocations from podium + tower
    // Podium has the mixed floors (Retail, Institutional, Hospitality, Office)
    // Tower has the Residential floors (only residential acts as tower)
    let allocs = b.floorUseAllocation;
    if (isComposite) {
      const podiumAllocs = p.floorUseAllocation || [];
      const towerAllocs = t.floorUseAllocation || [];
      const merged: { use: string; floors: string; count: number }[] = [];

      // Add podium zones
      if (podiumAllocs.length > 0) {
        // Podium has per-floor allocation → use it directly
        merged.push(...podiumAllocs);
      } else if (p.intendedUse && p.intendedUse !== 'Residential') {
        // Podium has a single non-residential use
        merged.push({ use: p.intendedUse, floors: `F1-${p.numFloors}`, count: p.numFloors });
      }

      // Add tower zones
      if (towerAllocs.length > 0) {
        // Tower has its own per-floor allocation (rare, but possible)
        merged.push(...towerAllocs);
      } else if (t.numFloors > 0) {
        // Tower is single-use (typically Residential) → add it as one zone
        const towerUse = t.intendedUse || 'Residential';
        const startF = p.numFloors + 1;
        const endF = p.numFloors + t.numFloors;
        merged.push({ use: towerUse, floors: startF === endF ? `F${startF}` : `F${startF}-${endF}`, count: t.numFloors });
      }

      if (merged.length > 0) allocs = merged;

      // Debug: trace the merge
      console.log(`[AI Prompt] Composite building:`,
        `podium.intendedUse=${p.intendedUse}, podium.floorUseAllocation=${JSON.stringify(p.floorUseAllocation)},`,
        `tower.intendedUse=${t.intendedUse}, tower.floorUseAllocation=${JSON.stringify(t.floorUseAllocation)},`,
        `merged allocs=${JSON.stringify(allocs)}, overallUse=${use}`
      );
    } else {
      // Debug: non-composite building
      console.log(`[AI Prompt] Simple building:`,
        `intendedUse=${b.intendedUse}, floorUseAllocation=${JSON.stringify(b.floorUseAllocation)},`,
        `programMix=${JSON.stringify(b.programMix)}`
      );
    }

    // Formatting mixed-use allocation if present — with VISUAL CUES per zone
    // Map use types to explicit visual descriptions so the AI renders distinct facades
    const useVisualCues: Record<string, string> = {
      'Retail': 'large glass shopfronts with signage and awnings',
      'Office': 'sleek glass curtain wall with uniform rectangular windows, no balconies',
      'Residential': 'private balconies with railings, varied window sizes',
      'Hospitality': 'hotel-style: smaller uniform window grid, ornamental facade bands, entrance canopy',
      'Institutional': 'civic stone-clad facade, tall arched windows, prominent entrance portico',
      'Public': 'civic stone-clad facade, tall arched windows, prominent entrance portico',
      'Commercial': 'commercial glass facade with aluminum framing',
      'Retail/Office': 'glass shopfronts at ground, office glass curtain wall above',
      'Mixed-Use': 'mixed facade treatments',
    };
    function describeUseZone(useName: string): string {
      const cue = useVisualCues[useName] || useVisualCues[useName.split('/')[0]] || '';
      return cue ? `${useName} (${cue})` : useName;
    }

    let allocString = '';
    if (allocs && allocs.length > 0) {
      // Precise per-floor allocation with visual cues
      allocString = ` Vertical zones bottom→top: ${allocs.map((a: any) => `${a.floors} ${describeUseZone(a.use)}`).join('; ')}.`;
    } else if ((b.programMix || p?.programMix) && use === 'Mixed-Use') {
      // Fallback: use programMix percentages with visual cues
      const mix = b.programMix || p?.programMix;
      const parts: string[] = [];
      if (mix.residential > 0) parts.push(`${mix.residential}% ${describeUseZone('Residential')}`);
      if (mix.commercial > 0) parts.push(`${mix.commercial}% ${describeUseZone('Commercial')}`);
      if (mix.hospitality > 0) parts.push(`${mix.hospitality}% ${describeUseZone('Hospitality')}`);
      if (mix.institutional > 0) parts.push(`${mix.institutional}% ${describeUseZone('Institutional')}`);
      if (parts.length > 1) allocString = ` Vertical zones bottom→top: ${parts.join('; ')}.`;
    }

    if (isComposite) {
      const pGfH = p.groundFloorHeight || p.floorHeight || gfH;
      const pTfH = p.floorHeight || tfH;
      const tTfH = t.floorHeight || tfH;
      const podH = pGfH + (p.numFloors - 1) * pTfH;
      const towH = t.numFloors * tTfH;
      const totalH = Math.round(podH + towH);
      return `${use}, podium-tower: ${p.numFloors}F podium (${Math.round(podH)}m, GF ${pGfH}m) + ${t.numFloors}F tower (${Math.round(towH)}m) = ${totalH}m total. Podium wider than tower.${allocString}`;
    } else {
      const totalH = Math.round(gfH + (b.numFloors - 1) * tfH);
      return `${use}, ${b.numFloors}F, ${totalH}m tall (GF ${gfH}m, upper ${tfH}m). ${Math.round(b.footprintWidth || 0)}×${Math.round(b.footprintDepth || 0)}m footprint.${allocString}`;
    }
  }

  // Group identical buildings to save prompt space
  function getBuildingSignature(group: any): string {
    const isComposite = group.podium && group.tower;
    const b = group.tower || group.main || group.podium;
    if (isComposite) {
      // Include BOTH podium and tower intendedUse to avoid grouping mixed-use podiums with residential ones
      return `composite_${group.podium.numFloors}_${group.tower.numFloors}_${group.podium.intendedUse}_${b.intendedUse}_${b.floorHeight}_${b.groundFloorHeight || ''}`;
    }
    return `simple_${b.numFloors}_${b.intendedUse}_${b.floorHeight}_${b.groundFloorHeight || ''}`;
  }

  const sigMap = new Map<string, { indices: number[]; group: any }>();
  buildingGroupArray.forEach((group, i) => {
    const sig = getBuildingSignature(group);
    if (!sigMap.has(sig)) sigMap.set(sig, { indices: [], group });
    sigMap.get(sig)!.indices.push(i + 1);
  });

  const buildingLines: string[] = [];
  for (const { indices, group } of sigMap.values()) {
    const desc = describeBuildingGroup(group);
    if (indices.length === numBuildings) {
      // All buildings identical
      buildingLines.push(`ALL ${numBuildings} buildings: ${desc}`);
    } else if (indices.length > 1) {
      buildingLines.push(`Buildings ${indices.join(',')}: ${desc}`);
    } else {
      buildingLines.push(`Building ${indices[0]}: ${desc}`);
    }
  }
  const buildingDescriptions = buildingLines.join('\n');

  // ── Plot context (compact) ──────────────────────────────────────
  const plotDesc = `${Math.round(plot.plotArea)}sqm, ${plot.setback}m setback${plot.greenAreas > 0 ? `, ${plot.greenAreas} green areas` : ''}${plot.parkingAreas > 0 ? `, ${plot.parkingAreas} parking zones` : ''}`;

  // ── Materials (compact) ─────────────────────────────────────────
  const uniqueUseTypes = new Set(buildings.map((b: any) => b.intendedUse));
  const materialParts: string[] = [];
  const useMaterials: Record<string, string> = {
    'Residential': 'glass facades, balconies with railings, warm window lighting',
    'Commercial': 'glass curtain walls, steel, aluminum framing',
    'Office': 'sleek glass curtain wall, uniform rectangular windows',
    'Retail': 'large glass shopfronts, signage, awnings',
    'Mixed-Use': 'retail shopfronts at ground level, glass curtain walls for office floors, residential balconies on upper floors',
    'Hospitality': 'hotel entrance canopy, glass lobby, uniform window grid, ornamental facade bands',
    'Institutional': 'institutional stone cladding, tall arched windows, prominent entrance portico',
    'Public': 'civic stone-clad facade, tall arched windows, prominent entrance portico',
  };
  for (const use of uniqueUseTypes) {
    if (useMaterials[use]) materialParts.push(`${use}: ${useMaterials[use]}`);
  }
  const materials = materialParts.length > 1
    ? `Each building uses distinct materials per its use: ${materialParts.join('. ')}`
    : materialParts[0] || 'glass, concrete, modern facades';

  // ── Peripheral zones (compact) ──────────────────────────────────
  const hasParking = plot.parkingAreas > 0;
  const hasRoads = design.selectedUtilities?.includes('Roads');
  let peripheralDesc = '';
  if (hasParking && hasRoads) peripheralDesc = 'Site has: parking strip (outer) → road → buildings (inner). ';
  else if (hasParking) peripheralDesc = 'Site has peripheral parking strip around buildings. ';
  else if (hasRoads) peripheralDesc = 'Site has internal road around buildings. ';

  // ── Composite note (compact) ────────────────────────────────────
  const compositeBuildings = buildingGroupArray.filter(g => g.podium && g.tower);
  let compositeNote = '';
  if (compositeBuildings.length > 0) {
    compositeNote = compositeBuildings.length === numBuildings
      ? 'All buildings have stepped podium-tower massing (wider base, narrower tower on top). '
      : `${compositeBuildings.length} of ${numBuildings} buildings have podium-tower massing. `;
  }

  // ── Height uniformity ──────────────────────────────────────────
  const allHeights = buildingGroupArray.map(g => {
    if (g.podium && g.tower) {
      const pGfH = g.podium.groundFloorHeight || g.podium.floorHeight || 3.5;
      const pTfH = g.podium.floorHeight || 3.5;
      const tTfH = g.tower.floorHeight || 3.5;
      return Math.round(pGfH + (g.podium.numFloors - 1) * pTfH + g.tower.numFloors * tTfH);
    }
    const b = g.main || g.tower || g.podium;
    const gfH = b.groundFloorHeight || b.floorHeight || 3.5;
    const tfH = b.floorHeight || 3.5;
    return Math.round(gfH + (b.numFloors - 1) * tfH);
  });
  const allSameHeight = allHeights.length > 1 && allHeights.every(h => h === allHeights[0]);
  const uniformNote = allSameHeight ? `All ${numBuildings} buildings MUST be identical height (${allHeights[0]}m). ` : '';

  // ── Image-to-image prefix ──────────────────────────────────────
  const hasControlImage = !!input.controlImageBase64;
  const img2imgPrefix = hasControlImage
    ? `Reference image is a 2D site plan showing EXACTLY ${numBuildings} black building footprints. Extrude ONLY these ${numBuildings} dark footprints into 3D buildings preserving exact positions and sizes. White/empty areas in the reference are open space — keep them as landscaped gardens or paved areas, NOT buildings. `
    : '';

  // ── User overrides (from the Generation Panel prompt box) ──────
  const userStyle = input.userPrompt?.trim();
  const styleSection = userStyle
    ? `Style: ${userStyle}.`
    : `Materials: ${materials}. Style: professional architectural visualization, photorealistic, daytime, blue sky, 4K.\nCamera: elevated bird's-eye isometric view showing ALL ${numBuildings} buildings clearly. No building hidden behind another.`;

  // ── Spatial arrangement ──────────────────────────────────────────
  // Detect if buildings are arranged in a perimeter pattern (empty center)
  let layoutNote = '';
  if (numBuildings >= 4 && plot.greenAreas > 0) {
    layoutNote = `Buildings are arranged along the PERIMETER of the plot. The center of the plot is an open landscaped courtyard/garden — do NOT place any buildings in the center. `;
  } else if (numBuildings >= 4) {
    layoutNote = `Buildings are positioned around the edges of the plot with open space between them. `;
  }

  // ── Compose final prompt (target <5000 chars) ──────────────────
  const prompt = `${img2imgPrefix}Photorealistic 3D architectural rendering, ${plot.location}. ${numBuildings} buildings on ${plotDesc}.

${peripheralDesc}${compositeNote}${uniformNote}${layoutNote}
${buildingDescriptions}

${styleSection}

CONSTRAINTS: Exactly ${numBuildings} separate standalone buildings. Each building physically independent with clear space between them. Do not merge or add buildings. Follow the reference image positions EXACTLY — do not add, remove, or reposition any building.`;

  return prompt;
}

/**
 * Uploads a base64 PNG to a public temporary file host and returns the URL.
 * Uses tmpfiles.org (no API key needed, files expire after 1 hour).
 */
async function uploadToPublicHost(base64Data: string): Promise<string | null> {
  try {
    // Strip data URI prefix
    const raw = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(raw, 'base64');

    // Upload to tmpfiles.org
    const formData = new FormData();
    const blob = new Blob([buffer], { type: 'image/png' });
    formData.append('file', blob, 'site-plan.png');

    const res = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      console.warn('[AI Rendering] tmpfiles.org upload failed:', res.status);
      return null;
    }

    const data = await res.json();
    // tmpfiles.org returns { data: { url: "https://tmpfiles.org/12345/site-plan.png" } }
    // The direct download URL requires replacing /tmpfiles.org/ with /tmpfiles.org/dl/
    const uploadUrl: string = data?.data?.url;
    if (!uploadUrl) return null;

    const directUrl = uploadUrl.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    console.log('[AI Rendering] Control image uploaded to:', directUrl);
    return directUrl;
  } catch (e) {
    console.warn('[AI Rendering] Public upload failed:', e);
    return null;
  }
}

export async function generateArchitecturalRendering(
  input: GenerateRenderingInput
): Promise<GenerateRenderingOutput> {
  // Guard: Next.js server action serialization can lose nested structure
  if (!input?.buildings?.length) {
    throw new Error('No buildings provided for rendering.');
  }

  const apiKey = process.env.NANO_BANANA_API_KEY;
  if (!apiKey) {
    throw new Error('NANO_BANANA_API_KEY is not configured in environment variables.');
  }

  const prompt = createArchitecturalPrompt(input);
  console.log('[AI Rendering] Prompt length:', prompt.length, 'chars');
  console.log('[AI Rendering] Prompt preview:', prompt.substring(0, 500));

  // Upload control image to a public host if provided
  let controlImageUrl: string | null = null;
  if (input.controlImageBase64) {
    controlImageUrl = await uploadToPublicHost(input.controlImageBase64);
  }

  const useImg2Img = !!controlImageUrl;
  console.log(`[AI Rendering] Mode: ${useImg2Img ? 'Image-to-Image (Pro)' : 'Text-to-Image (Pro)'}${useImg2Img ? ` (control: ${controlImageUrl})` : ''}`);

  // Step 1: Submit generation task using the PRO endpoint for better quality
  let submitData: any;
  try {
    const requestBody: Record<string, any> = {
      prompt,
      resolution: '2K',
      aspectRatio: '16:9',
      callBackUrl: 'https://localhost/noop', // required field; we poll instead
    };

    // Add reference image for image-to-image mode
    if (useImg2Img && controlImageUrl) {
      requestBody.imageUrls = [controlImageUrl];
    }

    console.log('[AI Rendering] Submitting to NanoBanana Pro endpoint...');
    const submitRes = await fetch(`${NANO_BANANA_BASE}/generate-pro`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!submitRes.ok) {
      const errText = await submitRes.text().catch(() => '');
      console.error('[AI Rendering] Pro endpoint failed:', submitRes.status, errText);
      // Fallback to basic endpoint if Pro is unavailable
      console.log('[AI Rendering] Falling back to basic endpoint...');
      return await generateWithBasicEndpoint(input, prompt, controlImageUrl, apiKey);
    }

    submitData = await submitRes.json();
  } catch (e) {
    console.error('[AI Rendering] Pro endpoint error:', e);
    // Fallback to basic endpoint
    return await generateWithBasicEndpoint(input, prompt, controlImageUrl, apiKey);
  }

  if (submitData.code !== 200 || !submitData.data?.taskId) {
    console.warn('[AI Rendering] Pro submit failed, falling back:', submitData);
    return await generateWithBasicEndpoint(input, prompt, controlImageUrl, apiKey);
  }

  const taskId = submitData.data.taskId;
  console.log('[AI Rendering] Pro task submitted:', taskId);

  // Step 2: Poll for completion
  // Pro endpoint uses same record-info polling with same response format
  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    // Log progress every ~15 seconds
    if (i % 5 === 4) {
      const elapsed = Math.round((i + 1) * POLL_INTERVAL_MS / 1000);
      console.log(`[AI Rendering] Still generating... (${elapsed}s elapsed)`);
    }

    let pollData: any;
    try {
      const pollRes = await fetch(
        `${NANO_BANANA_BASE}/record-info?taskId=${encodeURIComponent(taskId)}`,
        {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        }
      );

      if (!pollRes.ok) continue;
      pollData = await pollRes.json();
    } catch {
      // Network hiccup during polling — retry
      continue;
    }

    const flag = pollData?.data?.successFlag;

    if (flag === 1) {
      // SUCCESS — Pro uses data.info.resultImageUrl OR data.response.resultImageUrl
      const rawUrl = pollData.data.info?.resultImageUrl
        || pollData.data.response?.resultImageUrl
        || pollData.data.response?.originImageUrl;
      if (!rawUrl) {
        throw new Error('Image generation completed but no image was returned. Please try again.');
      }
      // Proxy through our API route to avoid TLS/network issues with tempfile host
      const imageUrl = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
      console.log('[AI Rendering] Pro generation complete:', rawUrl);
      return { imageUrl, buildings: input.buildings, plot: input.plot, summary: {} as RenderingProjectSummary };
    }

    if (flag === 2 || flag === 3) {
      const errMsg = pollData.data.errorMessage || 'Unknown error';
      console.error('[AI Rendering] Pro generation failed:', errMsg);
      throw new Error(`Image generation failed: ${errMsg}. Please try again.`);
    }
    // flag === 0 means still generating — continue polling
  }

  throw new Error('Image generation timed out. Please try again.');
}

/**
 * Fallback: use the basic /generate endpoint if Pro is unavailable
 */
async function generateWithBasicEndpoint(
  input: GenerateRenderingInput,
  prompt: string,
  controlImageUrl: string | null,
  apiKey: string
): Promise<GenerateRenderingOutput> {
  const useImg2Img = !!controlImageUrl;
  const generationType = useImg2Img ? 'IMAGETOIAMGE' : 'TEXTTOIAMGE';

  const requestBody: Record<string, any> = {
    prompt,
    type: generationType,
    numImages: 1,
    image_size: '16:9',
    callBackUrl: 'https://localhost/noop',
  };

  if (useImg2Img && controlImageUrl) {
    requestBody.imageUrls = [controlImageUrl];
  }

  console.log('[AI Rendering] Using basic endpoint, mode:', generationType);
  const submitRes = await fetch(`${NANO_BANANA_BASE}/generate`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  if (!submitRes.ok) {
    throw new Error('Image generation service is temporarily unavailable. Please try again.');
  }

  const submitData = await submitRes.json();
  if (submitData.code !== 200 || !submitData.data?.taskId) {
    throw new Error('Failed to start image generation. Please try again.');
  }

  const taskId = submitData.data.taskId;

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));

    let pollData: any;
    try {
      const pollRes = await fetch(
        `${NANO_BANANA_BASE}/record-info?taskId=${encodeURIComponent(taskId)}`,
        { headers: { 'Authorization': `Bearer ${apiKey}` } }
      );
      if (!pollRes.ok) continue;
      pollData = await pollRes.json();
    } catch { continue; }

    const flag = pollData?.data?.successFlag;
    if (flag === 1) {
      const rawUrl = pollData.data.response?.resultImageUrl
        || pollData.data.response?.originImageUrl;
      if (!rawUrl) throw new Error('Image generation completed but no image was returned.');
      const imageUrl = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
      return { imageUrl, buildings: input.buildings, plot: input.plot, summary: {} as RenderingProjectSummary };
    }
    if (flag === 2 || flag === 3) {
      throw new Error('Image generation failed. Please try again with different parameters.');
    }
  }

  throw new Error('Image generation timed out. Please try again.');
}

