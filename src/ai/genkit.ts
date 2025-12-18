import { genkit } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { devLocalVectorstore } from '@genkit-ai/dev-local-vectorstore';

export const ai = genkit({
  plugins: [
    googleAI({ apiVersion: 'v1' }),
    devLocalVectorstore([
      {
        indexName: 'compliance-rag',
        embedder: 'googleai/text-embedding-004',
      },
    ]),
  ],
  model: 'googleai/gemini-2.5-flash',
});

