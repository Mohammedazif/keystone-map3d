
import { RegulationData } from '../types';

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
        const far = Number(regulation.geometry.floor_area_ratio?.value as any) || 1.5;
        const coveragePercent = Number(regulation.geometry.max_ground_coverage?.value as any) || 50;
        const maxHeight = Number(regulation.geometry.max_height?.value as any) || 15;

        // Setbacks
        const front = Number(regulation.geometry.front_setback?.value as any) || Number(regulation.geometry.setback?.value as any) || 0;
        const rear = Number(regulation.geometry.rear_setback?.value as any) || Number(regulation.geometry.setback?.value as any) || 0;
        const side = Number(regulation.geometry.side_setback?.value as any) || Number(regulation.geometry.setback?.value as any) || 0;
        const general = Number(regulation.geometry.setback?.value as any) || 0;

        // 2. Calculate Limits
        const maxFootprint = plotArea * (coveragePercent / 100);
        const maxGFA = plotArea * far;

        // Height to Floors (Assuming 3m per floor for now, can be parameterized)
        const floorHeight = 3.0;
        const maxFloorsByHeight = Math.floor(maxHeight / floorHeight);

        // 3. Calculate Target Floors to utilize Max GFA
        // Ideal: Build as much GFA as possible within footprint
        // Floors = GFA / Footprint
        // We use maxFootprint as the "ideal" footprint to see min floors needed
        // But deeper logic: If footprint is smaller, we need MORE floors.
        // Let's return the theoretical max floors needed if we max out footprint.
        // Actually, let's return the LIMITS. Generator chooses actual shape.

        return {
            maxFootprint,
            maxGFA,
            maxFloors: maxFloorsByHeight,
            targetFloors: Math.min(maxFloorsByHeight, Math.ceil(maxGFA / maxFootprint)), // Target if we max out footprint
            setbacks: { front, rear, side, general }
        };
    }
}
