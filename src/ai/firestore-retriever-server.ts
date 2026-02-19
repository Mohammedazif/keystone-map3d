/**
 * Server-side Firestore retriever using Firebase Admin SDK
 * This file should ONLY be imported in API routes or server-side code
 */

import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import path from 'path';

// Initialize Firebase Admin SDK
if (!getApps().length) {
    try {
        if (process.env.FIREBASE_SERVICE_ACCOUNT) {
            console.log('[Firebase Admin] Initializing with Service Account environment variable');
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
            // Fix for PEM private key newlines in environment variables
            if (serviceAccount.private_key) {
                serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
            }
            initializeApp({
                credential: cert(serviceAccount),
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'keystone-map3d',
            });
        } else {
            const keyPath = path.resolve(process.cwd(), 'firebase-admin-key.json');
            console.log('[Firebase Admin] Initializing with key file:', keyPath);
            initializeApp({
                credential: cert(keyPath),
                projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'keystone-map3d',
            });
        }
        console.log('[Firebase Admin] Initialization successful');
    } catch (error) {
        console.error('Failed to initialize Firebase Admin:', error);
    }
}

const db = getFirestore();

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
 */
const LOCATION_MAP: Record<string, string> = {
    // === SOUTH INDIA ===
    'karnataka': 'Karnataka building_bye_laws_cc_2017.pdf',
    'bangalore': 'Karnataka building_bye_laws_cc_2017.pdf',
    'bengaluru': 'Karnataka building_bye_laws_cc_2017.pdf',
    'andhra': 'APBuildingByelaws2019.pdf',
    'andhra pradesh': 'APBuildingByelaws2019.pdf',
    'ap': 'APBuildingByelaws2019.pdf',
    'telangana': 'Telangana.pdf',
    'hyderabad': 'Telangana.pdf',
    'tamil nadu': 'TN CDRBR-2019.pdf',
    'chennai': 'TN CDRBR-2019.pdf',
    'tn': 'TN CDRBR-2019.pdf',
    'kerala': 'Kerala_MBR_2019.pdf',
    'trivandrum': 'Kerala_MBR_2019.pdf',
    'kochi': 'Kerala_MBR_2019.pdf',

    // === NORTH INDIA ===
    'delhi': 'COMPENDIUM_OF_UBBL_201605082020_0.pdf',
    'new delhi': 'COMPENDIUM_OF_UBBL_201605082020_0.pdf',
    'ubbl': 'COMPENDIUM_OF_UBBL_201605082020_0.pdf',
    'haryana': 'Haryana Building Code-2017 with amendments upto 06.11.2024.pdf',
    'gurgaon': 'Haryana Building Code-2017 with amendments upto 06.11.2024.pdf',
    'gurugram': 'Haryana Building Code-2017 with amendments upto 06.11.2024.pdf',
    'punjab': 'punjab-buildingrules2025-draft.pdf',
    'chandigarh': 'Chandigarh.pdf',
    'uttar pradesh': 'UP-Model-Building-Bylaws_English.pdf',
    'up': 'UP-Model-Building-Bylaws_English.pdf',
    'noida': 'UP-Model-Building-Bylaws_English.pdf',
    'jammu': 'JAMMU-KASHMIR-UNIFIED.pdf',
    'kashmir': 'JAMMU-KASHMIR-UNIFIED.pdf',
    'j&k': 'JAMMU-KASHMIR-UNIFIED.pdf',
    'uttarakhand': 'Uttrakhand_byelaws_I.pdf',
    'rajasthan': 'Rajasthan model building byelaws.pdf',
    'jaipur': 'Rajasthan model building byelaws.pdf',

    // === WEST INDIA ===
    'gujarat': 'Gujarat.pdf',
    'ahmedabad': 'Gujarat.pdf',
    'maharashtra': 'Maharashtra model building byelaws.pdf',
    'mumbai': 'Maharashtra model building byelaws.pdf',
    'pune': 'Maharashtra model building byelaws.pdf',

    // === EAST & CENTRAL INDIA ===
    'odisha': 'ODISHA-PLANNING-BUILDING-STANDARDS-RULES-2020.pdf',
    'bhubaneswar': 'ODISHA-PLANNING-BUILDING-STANDARDS-RULES-2020.pdf',
    'west bengal': 'West bengal-_Building_-Rules-2007.pdf',
    'kolkata': 'West bengal-_Building_-Rules-2007.pdf',
    'bihar': 'biharbuildingbyelaws-2014.pdf',
    'patna': 'biharbuildingbyelaws-2014.pdf',
    'chhattisgarh': 'chhattisgarh.pdf',
    'raipur': 'chhattisgarh.pdf',
    'madhya pradesh': 'MP model building byelaws.pdf',
    'mp': 'MP model building byelaws.pdf',
    'bhopal': 'MP model building byelaws.pdf',
    'indore': 'MP model building byelaws.pdf',

    // === NORTH EAST INDIA ===
    'mizoram': 'Mizoram-building-regulations.pdf',
    'nagaland': 'NAGALAND Building-Bye-Laws.pdf',
    'meghalaya': 'The_Meghalaya_Building_Bye_Laws_2021.pdf',

    // === NATIONAL CODES ===
    'nbc': 'in.gov.nbc.2016.vol1.digital.pdf',
    'national building code': 'in.gov.nbc.2016.vol1.digital.pdf',
    'national': 'in.gov.nbc.2016.vol1.digital.pdf',
    'nbc vol 1': 'in.gov.nbc.2016.vol1.digital.pdf',
    'nbc vol 2': 'in.gov.nbc.2016.vol2.digital.pdf',
    'nbc volume 1': 'in.gov.nbc.2016.vol1.digital.pdf',
    'nbc volume 2': 'in.gov.nbc.2016.vol2.digital.pdf',

    // === GREEN BUILDING & SUSTAINABILITY ===
    'green': 'IGBC_Green_New_Buildings_Rating_System_(Version_3.0_with_Fifth_Addendum).pdf',
    'igbc': 'IGBC_Green_New_Buildings_Rating_System_(Version_3.0_with_Fifth_Addendum).pdf',
    'igbc homes': 'IGBC Green Homes Rating System Ver 3.0.pdf',
    'igbc township': 'IGBC Green Townships - Abridged Reference Guide (Pilot Version).pdf',
    'griha': 'GRIHA-Version-6-V1.pdf',
    'griha manual': 'griha-manual-vol1.pdf',
    'leed': 'LEED v5 BD+C Rating System_November 2025_clean.pdf',

    // === VASTU ===
    'vastu': 'vastu rules.docx',
    'vastu shakti': 'SHAKTI CHAKRA DEGREES-Model.pdf',
};

// NBC source filename patterns (for fallback detection)
const NBC_SOURCE_PATTERNS = ['nbc', 'national building code', 'national_building_code'];

function isNationalSource(source: string): boolean {
    const lower = source.toLowerCase();
    return NBC_SOURCE_PATTERNS.some(p => lower.includes(p)) || source === 'isNational';
}

async function getNationalChunks(db: FirebaseFirestore.Firestore, limit = 400): Promise<RegulationDocument[]> {
    // Query for chunks with isNational flag OR with NBC filename patterns
    const snapshot = await db.collection('regulations-vectors')
        .where('isNational', '==', true)
        .limit(limit)
        .get();

    if (!snapshot.empty) {
        return snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                text: data.text || '',
                metadata: { source: data.source || 'NBC', filePath: data.filePath, documentId: doc.id },
            };
        });
    }

    // Fallback: try the known NBC filename
    const nbcSnapshot = await db.collection('regulations-vectors')
        .where('source', '==', 'in.gov.nbc.2016.vol1.digital.pdf')
        .limit(limit)
        .get();

    return nbcSnapshot.docs.map(doc => {
        const data = doc.data();
        return {
            text: data.text || '',
            metadata: { source: data.source || 'NBC', filePath: data.filePath, documentId: doc.id },
        };
    });
}

/**
 * Retrieve relevant regulation documents from Firestore (SERVER-SIDE ONLY)
 */
export async function retrieveRegulationsServer(
    searchQuery: string,
    maxResults: number = 100,
    preferGeneral: boolean = false
): Promise<RegulationDocument[]> {
    try {
        console.log('[Firestore Retriever] Query:', searchQuery, 'General:', preferGeneral);

        let colRef: FirebaseFirestore.Query = db.collection('regulations-vectors');

        const lowerQuery = searchQuery.toLowerCase();
        let matchedSource = null;

        for (const [location, source] of Object.entries(LOCATION_MAP)) {
            if (lowerQuery.includes(location)) {
                matchedSource = source;
                console.log(`[Firestore Retriever] Detected location '${location}', filtering by source: '${source}'`);
                break;
            }
        }

        if (matchedSource) {
            const STATE_LIMIT = 600;
            colRef = colRef.where('source', '==', matchedSource).limit(STATE_LIMIT);

            const snapshot = await colRef.get();

            if (!snapshot.empty) {
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
                console.log(`[Firestore Retriever] Retrieved ${documents.length} chunks for ${matchedSource}`);
                return documents;
            }

            // State source found in map but no chunks indexed yet — fall back to NBC
            console.log(`[Firestore Retriever] No chunks found for '${matchedSource}'. Falling back to NBC.`);
            const nbcDocs = await getNationalChunks(db);
            if (nbcDocs.length > 0) {
                console.log(`[Firestore Retriever] NBC fallback returned ${nbcDocs.length} chunks.`);
                return [
                    {
                        text: `NOTE: Specific regulations for the requested location are not yet indexed. The following information is from the National Building Code (NBC) of India, which serves as the national standard and fallback.`,
                        metadata: { source: 'system-nbc-fallback', filePath: 'system' },
                    },
                    ...nbcDocs,
                ];
            }
            return [];

        } else if (preferGeneral) {
            console.log('[Firestore Retriever] No location detected, General Mode preferred. Searching NBC.');
            const nbcDocs = await getNationalChunks(db);
            console.log(`[Firestore Retriever] Retrieved ${nbcDocs.length} chunks for NBC (General Mode).`);
            return nbcDocs;

        } else {
            console.log('[Firestore Retriever] No specific location detected in query.');
            // Return synthetic document with available sources
            return [{
                text: `SYSTEM MESSAGE: The user query did not specify a known location keyword (e.g. 'Karnataka', 'Delhi'). 
The following regulations are available in the knowledge base:
- Karnataka (Bangalore)
- Andhra Pradesh
- Telangana (Hyderabad)
- Tamil Nadu (Chennai)
- Delhi (UBBL)
- Gujarat
- Maharashtra (Mumbai, Pune)
- Kerala
- Uttar Pradesh (Noida)
- Chandigarh, Punjab, Odisha, Bihar, Chhattisgarh
- Mizoram, Madhya Pradesh, Nagaland, Rajasthan, Meghalaya, Uttarakhand, West Bengal
- National Building Code (NBC) - Use keyword 'National' or 'NBC'
- Green Building (IGBC, GRIHA, LEED)
- Vastu Shastra

Please ask the user to specify which location or code they are referring to.`,
                metadata: {
                    source: "system-available-locations",
                    filePath: "system"
                }
            }];
        }
    } catch (error) {
        console.error('Error retrieving regulations:', error);
        return [];
    }
}
