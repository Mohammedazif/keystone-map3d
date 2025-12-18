// use server'

/**
 * @fileOverview Assesses soil suitability for building foundations based on provided soil data.
 *
 * - assessSoilSuitability - A function that assesses soil suitability.
 * - SoilSuitabilityInput - The input type for the assessSoilSuitability function.
 * - SoilSuitabilityOutput - The return type for the assessSoilSuitability function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const SoilSuitabilityInputSchema = z.object({
  soilPh: z.number().describe('The pH value of the soil.'),
  soilBd: z.number().describe('The bulk density of the soil in kg/dm³.'),
  buildingDescription: z.string().describe('A description of the building to be constructed, including size and materials.')
});
export type SoilSuitabilityInput = z.infer<typeof SoilSuitabilityInputSchema>;

const SoilSuitabilityOutputSchema = z.object({
  suitabilityAssessment: z.string().describe('An assessment of the soil suitability for the building foundation, including potential challenges and recommendations.')
});
export type SoilSuitabilityOutput = z.infer<typeof SoilSuitabilityOutputSchema>;

export async function assessSoilSuitability(input: SoilSuitabilityInput): Promise<SoilSuitabilityOutput> {
  return assessSoilSuitabilityFlow(input);
}

const prompt = ai.definePrompt({
  name: 'soilSuitabilityPrompt',
  input: {schema: SoilSuitabilityInputSchema},
  output: {schema: SoilSuitabilityOutputSchema},
  prompt: `You are a geotechnical engineer specializing in soil analysis for building foundations.

You will assess the suitability of the soil for the foundation of a building, taking into account the soil pH, bulk density, and a description of the building to be constructed. Provide a detailed assessment of potential challenges and recommendations.

Soil pH: {{{soilPh}}}
Soil Bulk Density: {{{soilBd}}} kg/dm³
Building Description: {{{buildingDescription}}}`,
});

const assessSoilSuitabilityFlow = ai.defineFlow(
  {
    name: 'assessSoilSuitabilityFlow',
    inputSchema: SoilSuitabilityInputSchema,
    outputSchema: SoilSuitabilityOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
