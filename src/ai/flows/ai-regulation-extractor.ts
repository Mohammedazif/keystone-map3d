import { ai } from '@/ai/genkit';
import { z } from 'genkit';
import { generateWithFallback } from '@/ai/model-fallback';

// Schema matching the RegulationData structure
const RegulationValueSchema = z.object({
    desc: z.string(),
    unit: z.string(),
    value: z.number(),
    min: z.number().optional(),
    max: z.number().optional(),
});

const ExtractedRegulationSchema = z.object({
    location: z.string().describe('The geographic location this regulation applies to (e.g., "Kerala", "Mumbai", "Andhra Pradesh")'),
    type: z.string().describe('The regulation type/category (e.g., "Residential", "Commercial", "Mixed-Use")'),
    geometry: z.object({
        setback: RegulationValueSchema.optional(),
        road_width: RegulationValueSchema.optional(),
        max_ground_coverage: RegulationValueSchema.optional(),
        floor_area_ratio: RegulationValueSchema.optional(),
    }).describe('Geometric constraints and spatial requirements'),
    facilities: z.object({
        parking: RegulationValueSchema.optional(),
        open_space: RegulationValueSchema.optional(),
    }).describe('Facility and amenity requirements'),
    sustainability: z.object({
        rainwater_harvesting: RegulationValueSchema.optional(),
        solar_panels: RegulationValueSchema.optional(),
    }).describe('Environmental and sustainability requirements'),
    safety_and_services: z.object({
        fire_safety: RegulationValueSchema.optional(),
    }).describe('Safety standards and service requirements'),
    administration: z.object({
        fee_rate: RegulationValueSchema.optional(),
    }).describe('Administrative fees and processing costs'),
    confidence: z.number().min(0).max(1).describe('Confidence score for this extraction (0-1)'),
});

export const extractRegulationData = ai.defineFlow(
    {
        name: 'extractRegulationData',
        inputSchema: z.object({
            documentText: z.string().describe('The full text content of the regulation document'),
            fileName: z.string().describe('The name of the source file for context'),
        }),
        outputSchema: ExtractedRegulationSchema,
    },
    async (input) => {
        const prompt = `You are an expert at extracting structured building regulation data from documents.

Document: ${input.fileName}
Content:
${input.documentText}

Extract the following information and return ONLY a valid JSON object (no markdown, no explanation):

**IMPORTANT - Location must be an Indian State/UT name from this list:**
Andaman and Nicobar Islands, Andhra Pradesh, Arunachal Pradesh, Assam, Bihar, Chandigarh, Chhattisgarh, Dadra and Nagar Haveli and Daman and Diu, Delhi, Goa, Gujarat, Haryana, Himachal Pradesh, Jammu and Kashmir, Jharkhand, Karnataka, Kerala, Ladakh, Lakshadweep, Madhya Pradesh, Maharashtra, Manipur, Meghalaya, Mizoram, Nagaland, Odisha, Puducherry, Punjab, Rajasthan, Sikkim, Tamil Nadu, Telangana, Tripura, Uttar Pradesh, Uttarakhand, West Bengal

**Type must be one of:** Residential, Commercial, Mixed Use, Industrial, Public

{
  "location": "The Indian state/UT name (MUST match one from the list above exactly)",
  "type": "Building category (MUST be one of: Residential, Commercial, Mixed Use, Industrial, Public)",
  "geometry": {
    "setback": {"desc": "Distance from plot boundary", "unit": "m", "value": 0, "min": 0, "max": 20},
    "road_width": {"desc": "Adjacent road width", "unit": "m", "value": 0, "min": 6, "max": 30},
    "max_ground_coverage": {"desc": "Maximum ground coverage", "unit": "%", "value": 0, "min": 10, "max": 80},
    "floor_area_ratio": {"desc": "FAR/FSI value", "unit": "", "value": 0, "min": 0.5, "max": 5}
  },
  "facilities": {
    "parking": {"desc": "Parking spaces per unit", "unit": "spaces/unit", "value": 0, "min": 0.5, "max": 3},
    "open_space": {"desc": "Required open space", "unit": "%", "value": 0, "min": 5, "max": 50}
  },
  "sustainability": {
    "rainwater_harvesting": {"desc": "Capacity", "unit": "liters/sqm", "value": 0, "min": 10, "max": 100},
    "solar_panels": {"desc": "Solar coverage", "unit": "% of roof", "value": 0, "min": 0, "max": 100}
  },
  "safety_and_services": {
    "fire_safety": {"desc": "Compliance level", "unit": "", "value": 1, "min": 1, "max": 3}
  },
  "administration": {
    "fee_rate": {"desc": "Processing fee", "unit": "% of cost", "value": 0, "min": 0.05, "max": 1}
  },
  "confidence": 0.8
}

**Important**:
- Location MUST be an exact match from the Indian states list (e.g., "Andhra Pradesh", "Kerala", "Tamil Nadu")
- If document mentions a city, identify which state it's in and use the state name
- Type MUST be exactly one of: Residential, Commercial, Mixed Use, Industrial, Public
- If a parameter value is not mentioned in the document, use 0
- Set confidence (0-1) based on how clear the extraction was
- Return ONLY the JSON object, no other text`;

        // Use fallback mechanism with OpenAI as primary
        const text = await generateWithFallback(prompt);

        // Parse the JSON response
        try {
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('No JSON found in response');
            }
            const parsed = JSON.parse(jsonMatch[0]);
            return parsed as z.infer<typeof ExtractedRegulationSchema>;
        } catch (e) {
            console.error('Failed to parse AI response:', text);
            throw new Error('Failed to parse regulation data from AI response');
        }
    }
);
