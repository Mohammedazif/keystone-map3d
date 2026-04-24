
import { RegulationData, getPrimarySetback } from '../types';

export interface ComplianceInput {
    plotArea: number;
    regulation: RegulationData;
}

export interface ComplianceOutput {
    maxFootprint: number;
    maxGFA: number;
    maxFloors: number;
    targetFloors: number;
    setbacks: {
        front: number;
        rear: number;
        side: number;
        general: number;
    };
}

export class ComplianceEngine {
    static calculate(input: ComplianceInput): ComplianceOutput {
        const { plotArea, regulation } = input;

        // 1. Get Regulation Values (Sanitized)
        const far = Number(
            regulation.geometry.floor_area_ratio?.value ||
            regulation.geometry.max_far?.value ||
            regulation.geometry.fsi?.value as any
        );
        const coveragePercent = Number(regulation.geometry.max_ground_coverage?.value as any);
        const maxHeight = Number(
            regulation.geometry.max_height?.value ||
            regulation.geometry.building_height?.value as any
        );

        // Validate critical values
        if (!far || isNaN(far)) {
            console.warn('[ComplianceEngine] Missing or invalid FAR in regulation. Using minimal default 1.0');
        }
        if (!coveragePercent || isNaN(coveragePercent)) {
            console.warn('[ComplianceEngine] Missing or invalid coverage in regulation. Using default 40%');
        }
        if (!maxHeight || isNaN(maxHeight)) {
            console.warn('[ComplianceEngine] Missing or invalid height in regulation. Using default 15m');
        }

        const effectiveFAR = far && !isNaN(far) ? far : 1.0;
        const effectiveCoverage = coveragePercent && !isNaN(coveragePercent) ? coveragePercent : 40;
        const effectiveHeight = maxHeight && !isNaN(maxHeight) ? maxHeight : 15;

        // Setbacks
        const defaultSetback = getPrimarySetback(regulation) || 0;
        const front = Number(regulation.geometry.front_setback?.value as any) || defaultSetback;
        const rear = Number(regulation.geometry.rear_setback?.value as any) || defaultSetback;
        const side = Number(regulation.geometry.side_setback?.value as any) || defaultSetback;
        const general = defaultSetback;

        // 2. Calculate Limits
        const maxFootprint = plotArea * (effectiveCoverage / 100);
        const maxGFA = plotArea * effectiveFAR;

        // Floors
        const maxFloorsExplicit = Number(
            regulation.geometry.max_floors?.value ||
            regulation.geometry.number_of_floors?.value ||
            regulation.geometry.floors?.value as any
        );

        const floorHeight = 3.5;
        const maxFloorsByHeight = Math.floor(effectiveHeight / floorHeight);
        const maxFloors = !isNaN(maxFloorsExplicit) && maxFloorsExplicit > 0
            ? maxFloorsExplicit
            : maxFloorsByHeight;


        return {
            maxFootprint,
            maxGFA,
            maxFloors,
            targetFloors: Math.min(maxFloors, Math.ceil(maxGFA / maxFootprint)), // Target if we max out footprint
            setbacks: { front, rear, side, general }
        };
    }
}
