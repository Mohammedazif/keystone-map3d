import { useState, useEffect } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Project, RegulationData, GreenRegulationData, VastuRegulationData } from '@/lib/types';

interface UseRegulationsReturn {
    regulations: RegulationData | null;
    greenStandards: GreenRegulationData | null;
    vastuRules: VastuRegulationData | null;
    isLoading: boolean;
}

export function useRegulations(project: Project | null): UseRegulationsReturn {
    const [regulations, setRegulations] = useState<RegulationData | null>(null);
    const [greenStandards, setGreenStandards] = useState<GreenRegulationData | null>(null);
    const [vastuRules, setVastuRules] = useState<VastuRegulationData | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!project) return;

        const fetchData = async () => {
            setIsLoading(true);
            // Reset states to ensure clean slate on project change
            setRegulations(null);
            setGreenStandards(null);
            setVastuRules(null);

            try {
                // 1. Fetch Building Regulations
                // Priority: Specific Regulation ID > Generic ID > Smart Fallback
                // Parse location safely since it might be an object
                let location = 'Delhi';
                if (typeof project.location === 'string') {
                    location = project.location;
                } else if (project.location && typeof project.location === 'object') {
                    // If it's a coordinate object without a resolved string name, we'll have to rely on smart fallback or NBC
                    location = (project.location as any).name || (project.location as any).text || 'Default';
                }
                
                let intendedUse = project.intendedUse || 'Residential';
                // Normalize Mixed Use to deal with hyphenation inconsistencies
                if (intendedUse.toLowerCase() === 'mixed use') intendedUse = 'Mixed-Use';
                else if (intendedUse.toLowerCase() === 'mixed-use') intendedUse = 'Mixed Use';

                let foundReg: RegulationData | null = null;

                // A. Check for Specific Regulation ID
                if (project.regulationId) {
                    console.log(`Fetching specific regulation: ${project.regulationId}`);
                    const specificDoc = await getDoc(doc(db, 'regulations', project.regulationId));
                    if (specificDoc.exists()) {
                        foundReg = specificDoc.data() as RegulationData;
                    }
                }

                // B. Check Generic ID (e.g. "Delhi-Residential")
                if (!foundReg) {
                    const genericId = `${location}-${intendedUse}`;
                    console.log(`Fetching generic regulation: ${genericId}`);
                    const genericDoc = await getDoc(doc(db, 'regulations', genericId));
                    if (genericDoc.exists()) {
                        foundReg = genericDoc.data() as RegulationData;
                    }
                }

                // C. Smart Fallback (Query by Location + Fuzzy Match)
                if (!foundReg) {
                    console.log(`⚠️ Generic regulation not found, checking alternates for ${location} + ${intendedUse}`);
                    const q = query(
                        collection(db, 'regulations'),
                        where('location', '==', location)
                    );
                    const snap = await getDocs(q);

                    if (!snap.empty) {
                        const allRegs = snap.docs.map(d => d.data() as RegulationData);

                        // Priority 1: Exact type match
                        // Priority 2: Type includes intended use (e.g. "Residential - Group Housing" includes "Residential")
                        // Priority 3: First available

                        foundReg = allRegs.find(r => r.type === intendedUse)
                            || allRegs.find(r => r.type && r.type.includes(intendedUse))
                            || allRegs[0];

                        if (foundReg) {
                            console.log(`✅ Smart Fallback found: ${foundReg.type}`);
                        }
                    }
                }

                // D. National NBC Fallback
                if (!foundReg) {
                    console.log(`⚠️ No local regulations found for ${location}. Falling back to National (NBC)...`);
                    const nbcQ = query(
                        collection(db, 'regulations'),
                        where('location', '==', 'National (NBC)')
                    );
                    const nbcSnap = await getDocs(nbcQ);

                    if (!nbcSnap.empty) {
                        const nbcRegs = nbcSnap.docs.map(d => d.data() as RegulationData);
                        
                        // Try to match intended Use, otherwise take any
                        foundReg = nbcRegs.find(r => r.type && r.type.toLowerCase() === intendedUse.toLowerCase())
                            || nbcRegs.find(r => r.type && r.type.toLowerCase().replace('-', ' ') === intendedUse.toLowerCase().replace('-', ' '))
                            || nbcRegs.find(r => r.type && r.type.toLowerCase().includes(intendedUse.toLowerCase().replace('-', ' ')))
                            || nbcRegs[0];

                        if (foundReg) {
                            console.log(`✅ NBC Fallback selected: ${foundReg.type}`);
                        }
                    }
                }

                if (foundReg) {
                    setRegulations(foundReg);
                } else {
                    console.warn(`❌ No regulations OR NBC fallback found for ${location}`);
                }


                // 2. Fetch Green Regulations
                if (project.greenCertification) {
                    // Handle case where it might be a string (legacy/corrupt data) or array
                    const certs = Array.isArray(project.greenCertification) ? project.greenCertification : [project.greenCertification];

                    if (certs.length > 0) {
                        const certType = certs[0]; // e.g., 'GRIHA'
                        console.log(`Fetching Green Regulations for ${certType}`);
                        const q = query(collection(db, 'greenRegulations'), where('certificationType', '==', certType));
                        const snapshot = await getDocs(q);
                        if (!snapshot.empty) {
                            setGreenStandards(snapshot.docs[0].data() as GreenRegulationData);
                        }
                    }
                }

                // 3. Fetch Vastu Regulations
                if (project.vastuCompliant) {
                    console.log(`Fetching Vastu Regulations`);
                    const q = query(collection(db, 'vastuRegulations')); // Could filter by Type if needed
                    const snapshot = await getDocs(q);
                    if (!snapshot.empty) {
                        setVastuRules(snapshot.docs[0].data() as VastuRegulationData);
                    }
                }

            } catch (error) {
                console.error("Error fetching project regulations:", error);
            } finally {
                setIsLoading(false);
            }
        };

        fetchData();
    }, [
        project?.id,
        project?.location,
        project?.intendedUse,
        project?.regulationId, // Add specific ID dependency
        project?.vastuCompliant,
        // Use stringified certifications to prevent infinite loops on array reference change
        JSON.stringify(project?.greenCertification)
    ]);

    return { regulations, greenStandards, vastuRules, isLoading };
}
