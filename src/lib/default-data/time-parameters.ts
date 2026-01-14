import { TimeEstimationParameter } from '../types';

export const DEFAULT_TIME_PARAMETERS: Omit<TimeEstimationParameter, 'id' | 'last_updated'>[] = [
    // Residential Defaults
    {
        building_type: 'Residential',
        height_category: 'Low-Rise (<15m)',
        excavation_timeline_months: 2,
        foundation_timeline_months: 2,
        structure_per_floor_days: 15,
        finishing_per_floor_days: 20,
        services_overlap_factor: 0.3,
        contingency_buffer_months: 2
    },
    {
        building_type: 'Residential',
        height_category: 'Mid-Rise (15-45m)',
        excavation_timeline_months: 3,
        foundation_timeline_months: 4,
        structure_per_floor_days: 12, // Faster with standardized shuttering
        finishing_per_floor_days: 18,
        services_overlap_factor: 0.5,
        contingency_buffer_months: 3
    },
    {
        building_type: 'Residential',
        height_category: 'High-Rise (>45m)',
        excavation_timeline_months: 5,
        foundation_timeline_months: 6,
        structure_per_floor_days: 8, // Mivan/Aluminum formwork speed
        finishing_per_floor_days: 15,
        services_overlap_factor: 0.7, // High overlap
        contingency_buffer_months: 4
    },

    // Commercial Defaults
    {
        building_type: 'Commercial',
        height_category: 'Low-Rise (<15m)',
        excavation_timeline_months: 1.5,
        foundation_timeline_months: 2,
        structure_per_floor_days: 12,
        finishing_per_floor_days: 15,
        services_overlap_factor: 0.4,
        contingency_buffer_months: 2
    },
    {
        building_type: 'Commercial',
        height_category: 'Mid-Rise (15-45m)',
        excavation_timeline_months: 3,
        foundation_timeline_months: 4,
        structure_per_floor_days: 10,
        finishing_per_floor_days: 12,
        services_overlap_factor: 0.6,
        contingency_buffer_months: 3
    },
    {
        building_type: 'Commercial',
        height_category: 'High-Rise (>45m)',
        excavation_timeline_months: 5,
        foundation_timeline_months: 7,
        structure_per_floor_days: 7, // Steel structure/Post-tension speed
        finishing_per_floor_days: 10, // Shell & Core usually
        services_overlap_factor: 0.8,
        contingency_buffer_months: 4
    }
];
