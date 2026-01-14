import type { CostRevenueParameters } from '../types';

export const DEFAULT_COST_PARAMETERS: Omit<CostRevenueParameters, 'id' | 'last_updated'>[] = [
    {
        location: "Delhi",
        building_type: "Residential",
        earthwork_cost_per_sqm: 500,
        structure_cost_per_sqm: 8000,
        finishing_cost_per_sqm: 6000,
        services_cost_per_sqm: 3000,
        total_cost_per_sqm: 17500,
        market_rate_per_sqm: 80000,
        sellable_ratio: 0.75,
        currency: "INR",
        notes: "Delhi NCR residential market rates 2026 Q1"
    },
    {
        location: "Delhi",
        building_type: "Commercial",
        earthwork_cost_per_sqm: 600,
        structure_cost_per_sqm: 10000,
        finishing_cost_per_sqm: 8000,
        services_cost_per_sqm: 4500,
        total_cost_per_sqm: 23100,
        market_rate_per_sqm: 120000,
        sellable_ratio: 0.80,
        currency: "INR",
        notes: "Delhi NCR commercial office space rates 2026 Q1"
    },
    {
        location: "Mumbai",
        building_type: "Residential",
        earthwork_cost_per_sqm: 600,
        structure_cost_per_sqm: 9000,
        finishing_cost_per_sqm: 7000,
        services_cost_per_sqm: 3500,
        total_cost_per_sqm: 20100,
        market_rate_per_sqm: 150000,
        sellable_ratio: 0.73,
        currency: "INR",
        notes: "Mumbai residential market rates 2026 Q1 - premium pricing"
    },
    {
        location: "Bangalore",
        building_type: "Residential",
        earthwork_cost_per_sqm: 550,
        structure_cost_per_sqm: 8500,
        finishing_cost_per_sqm: 6500,
        services_cost_per_sqm: 3200,
        total_cost_per_sqm: 18750,
        market_rate_per_sqm: 90000,
        sellable_ratio: 0.74,
        currency: "INR",
        notes: "Bangalore residential market rates 2026 Q1"
    },
    {
        location: "Bangalore",
        building_type: "Commercial",
        earthwork_cost_per_sqm: 650,
        structure_cost_per_sqm: 10500,
        finishing_cost_per_sqm: 8500,
        services_cost_per_sqm: 5000,
        total_cost_per_sqm: 24650,
        market_rate_per_sqm: 130000,
        sellable_ratio: 0.82,
        currency: "INR",
        notes: "Bangalore IT/commercial space rates 2026 Q1"
    },
    {
        location: "Pune",
        building_type: "Residential",
        earthwork_cost_per_sqm: 480,
        structure_cost_per_sqm: 7500,
        finishing_cost_per_sqm: 5500,
        services_cost_per_sqm: 2800,
        total_cost_per_sqm: 16280,
        market_rate_per_sqm: 70000,
        sellable_ratio: 0.76,
        currency: "INR",
        notes: "Pune residential market rates 2026 Q1"
    },
    {
        location: "Hyderabad",
        building_type: "Residential",
        earthwork_cost_per_sqm: 470,
        structure_cost_per_sqm: 7200,
        finishing_cost_per_sqm: 5200,
        services_cost_per_sqm: 2700,
        total_cost_per_sqm: 15570,
        market_rate_per_sqm: 65000,
        sellable_ratio: 0.77,
        currency: "INR",
        notes: "Hyderabad residential market rates 2026 Q1"
    }
];
