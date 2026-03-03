
import { useMemo } from 'react';
import { Project, AdvancedKPIs } from '@/lib/types';
import { RegulationEngine } from '@/lib/engines/regulation-engine';

import { useRegulations } from './use-regulations';

export function useDevelopmentMetrics(project: Project | null): AdvancedKPIs | null {
    const { regulations, greenStandards, vastuRules } = useRegulations(project);

    return useMemo(() => {
        if (!project) return null;

        const engine = new RegulationEngine(project, regulations, greenStandards, vastuRules);
        return engine.calculateMetrics();

    }, [project, project?.plots, project?.lastModified, regulations, greenStandards, vastuRules]);
}
