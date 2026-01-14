import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import type { GreenRegulationData, Project } from '@/lib/types';

export function useGreenRegulations(project: Project | null | undefined) {
    const [regulations, setRegulations] = useState<GreenRegulationData[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        const fetchRegs = async () => {
            console.log('[useGreenRegulations] Project:', project);
            console.log('[useGreenRegulations] greenCertification:', project?.greenCertification);

            if (!project) {
                console.log('[useGreenRegulations] No project - returning empty regulations');
                setRegulations([]);
                return;
            }

            // Normalize to array to handle potential string values or legacy data
            let certs: string[] = [];
            if (Array.isArray(project.greenCertification)) {
                certs = project.greenCertification;
            } else if (typeof project.greenCertification === 'string') {
                certs = [project.greenCertification];
            }

            if (certs.length === 0) {
                console.log('[useGreenRegulations] No certificates found - returning empty regulations');
                setRegulations([]);
                return;
            }

            console.log('[useGreenRegulations] Fetching regulations for certificates:', certs);
            setIsLoading(true);
            try {
                const allRegulations: GreenRegulationData[] = [];
                const { collection, query, where, getDocs, doc, getDoc } = await import('firebase/firestore');

                for (const cert of certs) {
                    console.log('[useGreenRegulations] Processing cert:', cert);

                    // 1. Try to fetch as specific Document ID
                    const docRef = doc(db, 'greenRegulations', cert);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        console.log('[useGreenRegulations] Found by ID:', cert);
                        allRegulations.push(docSnap.data() as GreenRegulationData);
                    } else {
                        // 2. If not found by ID (or it's a generic type like 'IGBC'), query by type
                        console.log('[useGreenRegulations] Not found by ID, querying by type:', cert);
                        const q = query(
                            collection(db, 'greenRegulations'),
                            where('certificationType', '==', cert)
                        );
                        const snapshot = await getDocs(q);

                        if (!snapshot.empty) {
                            console.log(`[useGreenRegulations] Found ${snapshot.size} docs by type:`, cert);
                            snapshot.docs.forEach(d => allRegulations.push(d.data() as GreenRegulationData));
                        } else {
                            console.log('[useGreenRegulations] No regulations found for:', cert);
                        }
                    }
                }

                // Remove duplicates
                const uniqueRegs = Array.from(new Map(allRegulations.map(item => [item.id, item])).values());

                console.log('[useGreenRegulations] Final regulations:', uniqueRegs);
                setRegulations(uniqueRegs);
            } catch (err) {
                console.error('Error fetching green regulations:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchRegs();
    }, [project?.greenCertification]);

    return { regulations, isLoading };
}
