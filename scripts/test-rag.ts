import { config } from 'dotenv';
config();
import { ai } from '../src/ai/genkit';

import { ragChat } from '../src/ai/flows/rag-chat';

async function main() {
    const query = "What are the requirements for green buildings?";
    console.log(`Querying: ${query}`);

    try {
        const response = await ragChat({ query });
        console.log('Response:', response);
    } catch (error) {
        console.error('Error:', error);
    }
}

main();
