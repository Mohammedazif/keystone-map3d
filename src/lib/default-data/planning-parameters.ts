import { PlanningParameter } from '../types';

export const DEFAULT_PLANNING_PARAMETERS: Omit<PlanningParameter, 'id' | 'last_updated'>[] = [
    // Residential Defaults
    {
        category_name: "Affordable Housing",
        building_type: 'Residential',
        height_category: 'Mid-Rise (15-45m)',
        core_to_gfa_ratio_min: 0.12,
        core_to_gfa_ratio_max: 0.15,
        circulation_to_gfa_ratio: 0.10,
        efficiency_target: 0.75,
        passenger_lifts_per_unit: 0.02, // 1 per 50 units
        service_lifts_per_tower: 1,
        description: "Efficient cores with minimal circulation."
    },
    {
        category_name: "Luxury Residential",
        building_type: 'Residential',
        height_category: 'High-Rise (>45m)',
        core_to_gfa_ratio_min: 0.18,
        core_to_gfa_ratio_max: 0.22,
        circulation_to_gfa_ratio: 0.15,
        efficiency_target: 0.65, // Lower efficiency due to larger lobbies/balconies
        passenger_lifts_per_unit: 0.05, // 1 per 20 units (private lifts)
        service_lifts_per_tower: 2,
        description: "Large cores with separate service entries and wide corridors."
    },

    // Commercial Defaults
    {
        category_name: "Grade A Office",
        building_type: 'Commercial',
        height_category: 'High-Rise (>45m)',
        core_to_gfa_ratio_min: 0.15,
        core_to_gfa_ratio_max: 0.18,
        circulation_to_gfa_ratio: 0.08, // Efficient open plans
        efficiency_target: 0.78,
        passenger_lifts_per_sqm: 0.001, // 1 per 1000 sqm
        service_lifts_per_tower: 2,
        description: "Central core with efficient open floor plates."
    },
    {
        category_name: "Shopping Mall",
        building_type: 'Commercial',
        height_category: 'Mid-Rise (15-45m)',
        core_to_gfa_ratio_min: 0.10,
        core_to_gfa_ratio_max: 0.15,
        circulation_to_gfa_ratio: 0.25, // High circulation for shopping
        efficiency_target: 0.60,
        passenger_lifts_per_sqm: 0.002, // High traffic
        service_lifts_per_tower: 4, // Heavy logistics
        description: "High circulation ratio for atriums and corridors."
    }
];
