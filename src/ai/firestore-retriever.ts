import { db } from '@/lib/firebase';
import { collection, getDocs, query, limit } from 'firebase/firestore';

export interface RegulationDocument {
    text: string;
    metadata: {
        source: string;
        filePath?: string;
        documentId?: string;
    };
}

/**
 * Retrieve relevant regulation documents from Firestore
 * This runs on the CLIENT SIDE using the Firebase client SDK
 */
export async function retrieveRegulations(
    searchQuery: string,
    maxResults: number = 100
): Promise<RegulationDocument[]> {
    try {
        const docsRef = collection(db, 'regulations-vectors');
        const q = query(docsRef, limit(maxResults));

        const snapshot = await getDocs(q);
        const documents: RegulationDocument[] = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                text: data.text || '',
                metadata: {
                    source: data.source || 'unknown',
                    filePath: data.filePath,
                    documentId: doc.id,
                },
            };
        });

        return documents;
    } catch (error) {
        console.error('Error retrieving regulations:', error);
        return [];
    }
}
