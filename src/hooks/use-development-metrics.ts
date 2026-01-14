
import { useMemo } from 'react';
import { Project, AdvancedKPIs } from '@/lib/types';
import { RegulationEngine } from '@/lib/engines/regulation-engine';

import { useRegulations } from './use-regulations';

export function useDevelopmentMetrics(project: Project | null): AdvancedKPIs | null {
    const { regulations, greenStandards, vastuRules, greenAnalysis } = useRegulations(project);

    return useMemo(() => {
        if (!project) return null;

        // Pass fetched dynamic regulations to the engine
        const engine = new RegulationEngine(project, regulations, greenStandards, vastuRules, greenAnalysis);
        return engine.calculateMetrics();

    }, [project, project?.plots, project?.lastModified, regulations, greenStandards, vastuRules, greenAnalysis]);
}
