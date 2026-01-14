import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateWithFallback } from '@/ai/model-fallback';

// Schema for Green Regulation Data
const ExtractedGreenRegulationSchema = z.object({
    name: z.string().describe('The name of the regulation or certification (e.g., "IGBC Green Homes Version 3.0")'),
    certificationType: z.enum(['IGBC', 'GRIHA', 'LEED', 'Green Building']).describe('The type of certification system detected.'),
    constraints: z.object({
        minOpenSpace: z.number().nullish().describe('Minimum percentage of site area that must be open space (0-1)'),
        maxGroundCoverage: z.number().nullish().describe('Maximum percentage of site area that can be covered (0-1)'),
        minGreenCover: z.number().nullish().describe('Minimum percentage of site area that must be vegetated/green (0-1)'),
    }).describe('Mandatory site planning constraints for backward compatibility.'),
    categories: z.array(z.object({
        name: z.string(),
        credits: z.array(z.object({
            code: z.string().optional(),
            name: z.string(),
            points: z.number().nullish(), // Allow null or undefined
            type: z.string().optional(),
            // Removing verbose fields from schema/prompt to prevent truncation
        }))
    })).optional().describe('Comprehensive list of certification categories and credits'),
    confidence: z.number().min(0).max(1).describe('Confidence score for this extraction (0-1)'),
});

export const extractGreenLogic = ai.defineFlow(
    {
        name: 'extractGreenLogic',
        inputSchema: z.object({
            documentText: z.string(),
            fileName: z.string(),
        }),
        outputSchema: ExtractedGreenRegulationSchema,
    },
    async (input) => {
        // For large documents, try to find the most relevant sections
        let relevantText = input.documentText;

        // If document is very large, try to extract relevant sections
        if (input.documentText.length > 50000) {
            console.log('[ExtractGreenLogic] Large document detected, searching for relevant sections...');

            // Expanded keywords for all major certification categories
            const keywords = [
                // Site & General
                'site planning', 'site selection', 'open space', 'ground coverage', 'green cover', 'landscape',
                // Water
                'water conservation', 'water efficiency', 'rainwater harvesting', 'plumbing fixtures', 'irrigation',
                // Energy
                'energy efficiency', 'energy optimization', 'renewable energy', 'solar', 'lighting', 'hvac', 'epi',
                // Materials
                'materials', 'resources', 'waste management', 'recycled content', 'local materials', 'construction waste',
                // IEQ & Health
                'interior environmental quality', 'health', 'wellbeing', 'daylighting', 'ventilation', 'air quality', 'low voc',
                // Innovation
                'innovation', 'design process',
                // Structure
                'mandatory requirement', 'credit', 'prerequisite', 'points', 'intent'
            ];

            // Split into chunks and find the most relevant ones. 
            // INCREASED chunk size and count to capture more context for full certification
            const chunkSize = 8000;
            const chunks: { text: string; score: number; index: number }[] = [];

            for (let i = 0; i < input.documentText.length; i += chunkSize) {
                const chunk = input.documentText.substring(i, i + chunkSize);
                let score = 0;

                // Score based on keyword matches
                keywords.forEach(keyword => {
                    const matches = chunk.toLowerCase().match(new RegExp(keyword, 'g'));
                    if (matches) score += matches.length;
                });

                if (score > 0) {
                    chunks.push({ text: chunk, score, index: i });
                }
            }

            // Sort by score and take top chunks. INCREASED to top 18 to cover comprehensive document
            chunks.sort((a, b) => b.score - a.score);
            const topChunks = chunks.slice(0, 18);

            // Sort by original position to maintain context
            topChunks.sort((a, b) => a.index - b.index);

            relevantText = topChunks.map(c => c.text).join('\n\n[...]\n\n');
            console.log(`[ExtractGreenLogic] Extracted ${topChunks.length} relevant sections (${relevantText.length} chars)`);
        }

        const prompt = `You are an expert at extracting comprehensive Green Building Regulation criteria (IGBC, GRIHA, LEED).

Document: ${input.fileName}
This is a standard certification document.
Content (Extracted Sections):
${relevantText.slice(0, 85000)} ...

Task:
1. **CRITICAL**: Extract the 3 MANDATORY constraints (Open Space, Ground Coverage, Green Cover).
   - **Min Open Space**: Look for "Open Space", "Site Area", "Paved Area".
   - **Max Ground Coverage**: Look for "Ground Coverage", "Footprint".
   - **Min Green Cover**: Look for "Green Cover", "Landscape Area", "Softscape", "Vegetation".
     - **TRICK**: Green ratings often don't have a "Mandatory" green cover, but give points for it. Look for the **Credit Requirement** (e.g. "Ensure at least 15% of site area is soft paved"). Use that 15% (0.15) as the Min Green Cover.
     - Look for "per capita green cover" or "tree cover norms".

2. **COMPREHENSIVE EXTRACTION**: Extract ALL Categories and Credits.
   - **IMPORTANT**: To save space, extract ONLY: "code", "name", "points", "type".
   - **DO NOT** extract "requirements", "intent", or "strategies".
   - List every single credit code and name available.

3. Identify the Certification Standard (IGBC, GRIHA, LEED).

**Structure**:
{
  "name": "IGBC Green Homes v3.0",
  "certificationType": "IGBC",
  "constraints": {
    "minOpenSpace": 0.3,
    "maxGroundCoverage": 0.4,
    "minGreenCover": 0.2
  },
  "categories": [ 
    {
      "name": "Sustainable Design",
      "credits": [
         { "code": "Credit 1", "name": "Natural Topography", "points": 2, "type": "credit" },
         { "code": "Mandatory 1", "name": "Soil Erosion", "points": null, "type": "mandatory" }
      ]
    },
    ...
  ]
}

Return ONLY the JSON object.`;


        // Use fallback mechanism
        const text = await generateWithFallback(prompt);

        try {
            // Check if response is just "null" or empty
            if (!text || text.trim() === 'null' || text.trim() === '') {
                console.warn('[ExtractGreenLogic] AI returned null or empty response, using fallback');
                return {
                    name: input.fileName.replace(/\.(pdf|docx|txt)$/i, ''),
                    certificationType: 'Green Building' as const,
                    constraints: {
                        minOpenSpace: undefined,
                        maxGroundCoverage: undefined,
                        minGreenCover: undefined,
                    },
                    confidence: 0.3,
                    categories: []
                };
            }

            const firstBracket = text.indexOf('{');
            const lastBracket = text.lastIndexOf('}');

            if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
                console.warn('[ExtractGreenLogic] No JSON object found in response, using fallback');
                return {
                    name: input.fileName.replace(/\.(pdf|docx|txt)$/i, ''),
                    certificationType: 'Green Building' as const,
                    constraints: {
                        minOpenSpace: undefined,
                        maxGroundCoverage: undefined,
                        minGreenCover: undefined,
                    },
                    confidence: 0.2,
                    categories: []
                };
            }

            const jsonString = text.substring(firstBracket, lastBracket + 1);
            const parsed = JSON.parse(jsonString);

            // Sanitize numeric constraints (must be 0-1)
            if (parsed.constraints) {
                const sanitize = (val: any) => {
                    if (val === null || val === undefined) return null;

                    let num = val;
                    if (typeof val === 'string') {
                        // Clean string (e.g. "30%" -> 30)
                        num = parseFloat(val.replace(/[^0-9.]/g, ''));
                    }

                    if (typeof num !== 'number' || isNaN(num)) return null;

                    // If value is between 1 and 100, assume percentage -> convert to decimal
                    if (num > 1 && num <= 100) return num / 100; // e.g. 30 -> 0.3

                    // If value is 0-1, it's already decimal
                    if (num >= 0 && num <= 1) return num;

                    // If > 100 (e.g. 900), it's likely bad data or absolute value -> Reject
                    return null;
                };

                parsed.constraints.minOpenSpace = sanitize(parsed.constraints.minOpenSpace);
                parsed.constraints.maxGroundCoverage = sanitize(parsed.constraints.maxGroundCoverage);
                parsed.constraints.minGreenCover = sanitize(parsed.constraints.minGreenCover);
            }

            // Normailize 'confidence'
            if (typeof parsed.confidence !== 'number') {
                parsed.confidence = 0.85; // Default confidence
            }

            // Normalize 'categories'
            if (Array.isArray(parsed.categories)) {
                parsed.categories = parsed.categories.map((cat: any) => {
                    // Fix 'category' vs 'name'
                    if (!cat.name && cat.category) {
                        cat.name = cat.category;
                    }

                    // Fix 'credits' being just strings handling
                    if (Array.isArray(cat.credits)) {
                        cat.credits = cat.credits.map((cred: any) => {
                            if (typeof cred === 'string') {
                                return { name: cred, type: 'credit' };
                            }
                            return cred;
                        });
                    }
                    return cat;
                });
            } else {
                parsed.categories = [];
            }

            // Default fallback for mandatory fields if AI misses them to match schema roughly
            if (!parsed.certificationType) parsed.certificationType = 'Green Building';
            if (!parsed.name) parsed.name = input.fileName;

            return parsed as z.infer<typeof ExtractedGreenRegulationSchema>;
        } catch (e) {
            console.warn('[ExtractGreenLogic] Failed to parse AI response, using fallback:', e);
            // Return fallback instead of throwing
            return {
                name: input.fileName.replace(/\.(pdf|docx|txt)$/i, ''),
                certificationType: 'Green Building' as const,
                constraints: {
                    minOpenSpace: undefined,
                    maxGroundCoverage: undefined,
                    minGreenCover: undefined,
                },
                categories: [],
                confidence: 0.1,
            };
        }
    }
);
