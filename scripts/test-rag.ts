import { config } from 'dotenv';
config();
import { ai } from '../src/ai/genkit';

import { ragChat } from '../src/ai/flows/rag-chat';

async function main() {
    const query = "What is the minimum front setback required for a residential building on a plot abutting a 12m wide road in Karnataka Building Bye-Laws? 3 meters (common in many states for roads 9-12m wide).";
    console.log(`Querying: ${query}`);
        try {
        const response = await ragChat({ query });
                console.log('Response:', response);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
