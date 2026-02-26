import { useState, useEffect, useMemo } from 'react';
import { db } from '@/lib/firebase';
import type { GreenRegulationData, Project } from '@/lib/types';

export function useGreenRegulations(project: Project | null | undefined) {
    const [regulations, setRegulations] = useState<GreenRegulationData[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const certKey = useMemo(() => {
        if (!project?.greenCertification) return '';
        const certs = Array.isArray(project.greenCertification)
            ? project.greenCertification
            : [project.greenCertification];
        return [...certs].sort().join(',');
    }, [project?.greenCertification]);

    useEffect(() => {
        const fetchRegs = async () => {
            if (!project || certKey === '') {
                setRegulations([]);
                setIsLoading(false);
                return;
            }

            const certs = certKey.split(',').filter(Boolean);
            if (certs.length === 0) {
                setRegulations([]);
                return;
            }

            setIsLoading(true);
            try {
                const allRegulations: GreenRegulationData[] = [];
                const { collection, query, where, getDocs, doc, getDoc } = await import('firebase/firestore');

                for (const cert of certs) {
                    const docRef = doc(db, 'greenRegulations', cert);
                    const docSnap = await getDoc(docRef);

                    if (docSnap.exists()) {
                        allRegulations.push(docSnap.data() as GreenRegulationData);
                    } else {
                        const q = query(
                            collection(db, 'greenRegulations'),
                            where('certificationType', '==', cert)
                        );
                        const snapshot = await getDocs(q);
                        if (!snapshot.empty) {
                            snapshot.docs.forEach(d => allRegulations.push(d.data() as GreenRegulationData));
                        }
                    }
                }

                const uniqueRegs = Array.from(new Map(allRegulations.map(item => [item.id, item])).values());
                setRegulations(uniqueRegs);
            } catch (err) {
                console.error('Error fetching green regulations:', err);
            } finally {
                setIsLoading(false);
            }
        };

        fetchRegs();
    }, [certKey]);

    return { regulations, isLoading };
}
