import { useState, useEffect, useMemo } from 'react';
import {
    Project,
    AdvancedKPIs,
    CostRevenueParameters,
    TimeEstimationParameter,
    PlanningParameter,
    ProjectEstimates,
    FeasibilityParams
} from '@/lib/types';
import { calculateDevelopmentStats, DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';
import { db } from '@/lib/firebase';
import { collection, getDocs } from 'firebase/firestore';

export function useProjectEstimates(project: Project | null, metrics: AdvancedKPIs | null) {
    const [costs, setCosts] = useState<CostRevenueParameters[]>([]);
    const [times, setTimes] = useState<TimeEstimationParameter[]>([]);
    const [planning, setPlanning] = useState<PlanningParameter[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    // Fetch all parameters on mount
    useEffect(() => {
        const fetchAllParams = async () => {
            if (!project) return;
            setIsLoading(true);
            try {
                // Fetch in parallel
                // console.log("Fetching new project parameters...");
                const [costSnap, timeSnap, planningSnap] = await Promise.all([
                    getDocs(collection(db, 'cost_revenue_parameters')),
                    getDocs(collection(db, 'time_parameters')),
                    getDocs(collection(db, 'planning_parameters'))
                ]);

                // console.log(`Fetched: ${costSnap.size} costs, ${timeSnap.size} times, ${planningSnap.size} planning params`);

                setCosts(costSnap.docs.map(d => d.data() as CostRevenueParameters));
                setTimes(timeSnap.docs.map(d => d.data() as TimeEstimationParameter));
                setPlanning(planningSnap.docs.map(d => d.data() as PlanningParameter));
            } catch (error) {
                console.error("Error fetching project parameters:", error);
            } finally {
                setIsLoading(false);
            }
        };



        if (project?.id) {
            fetchAllParams();
        }
    }, [project?.id]); // Only re-fetch if project ID changes

    // Calculate Estimates
    const estimates: ProjectEstimates | null = useMemo(() => {
        if (!project || !metrics || isLoading) return null;

        const location = project.location || "Delhi"; // Default
        const buildingType = project.intendedUse || "Residential";

        let heightCategory: TimeEstimationParameter['height_category'] = 'Mid-Rise (15-45m)';

        // console.log("Estimating for:", { location, buildingType, heightCategory });

        // 1. MATCH COST PARAMETERS
        let costParam = costs.find(c => c.location === location && c.building_type === buildingType);
        if (!costParam) {
            // console.log("Exact match not found. Trying Delhi fallback...");
            costParam = costs.find(c => c.location === 'Delhi' && c.building_type === buildingType);
        }
        if (!costParam) {
            // console.log("Delhi fallback not found. Using first available.");
            costParam = costs[0];
        }

        // console.log("Selected Cost Param:", costParam);

        // 2. MATCH TIME PARAMETERS
        const timeParam = times.find(t => t.building_type === buildingType && t.height_category === heightCategory)
            || times[0];
        // console.log("Selected Time Param:", timeParam);

        // 3. MATCH PLANNING PARAMETERS
        const planParam = planning.find(p => p.building_type === buildingType && p.height_category === heightCategory)
            || planning[0];
        // console.log("Selected Plan Param:", planParam);

        if (!costParam || !timeParam) {
            console.warn("CRITICAL: Missing cost or time params. Returning null.");
            return null;
        }

        // --- CALCULATIONS ---

        // DETERMINATE GFA (Achieved vs Potential)
        let gfa = metrics.totalBuiltUpArea;
        let isPotential = false;

        // If no design exists, calculate potential max GFA based on plot
        if (gfa === 0 && project.plots.length > 0) {
            isPotential = true;
            console.log("GFA is 0. Calculating potential...", project.plots.length);
            // Use the first plot for estimation (multi-plot support later)
            const plotStats = calculateDevelopmentStats(project.plots[0], project.feasibilityParams || DEFAULT_FEASIBILITY_PARAMS);
            gfa = plotStats.totalBuiltUpArea;
            console.log("Potential GFA:", gfa);
        }

        // A. Costs
        const constructionCost = {
            earthwork: gfa * costParam.earthwork_cost_per_sqm,
            structure: gfa * costParam.structure_cost_per_sqm,
            finishing: gfa * costParam.finishing_cost_per_sqm,
            services: gfa * costParam.services_cost_per_sqm,
            contingency: 0 // calculated below
        };
        const subTotal = Object.values(constructionCost).reduce((a, b) => a + b, 0);
        constructionCost.contingency = subTotal * 0.05; // 5% standard contingency
        const totalConstructionCost = subTotal + constructionCost.contingency;

        // B. Revenue
        const sellableArea = gfa * costParam.sellable_ratio;
        const totalRevenue = sellableArea * costParam.market_rate_per_sqm;

        // Profit
        const profit = totalRevenue - totalConstructionCost; // Excluding land cost for now
        const roi = totalConstructionCost > 0 ? (profit / totalConstructionCost) * 100 : 0;

        // C. Timeline
        // Estimate floors based on GFA / (Plot Area * Coverage)
        // If we don't have explicit floors, estimate:
        let floors = Math.ceil(metrics.achievedFAR / (metrics.groundCoveragePct / 100 || 0.4));

        if (isPotential && project.plots.length > 0) {
            const plot = project.plots[0];
            // Approx Potential Floors = FAR / Coverage (assume 50% coverage if not set)
            const far = plot.far || 3.0;
            const cov = (plot.maxCoverage || 50) / 100;
            floors = Math.ceil(far / cov);
        }

        const validFloors = isFinite(floors) && floors > 0 ? floors : 4; // Default to 4 floors if unknown

        const structureDays = validFloors * timeParam.structure_per_floor_days;
        const finishingDays = validFloors * timeParam.finishing_per_floor_days;

        // Convert to months
        const structureMonths = structureDays / 30;
        const finishingMonths = finishingDays / 30;
        const overlapMonths = finishingMonths * timeParam.services_overlap_factor;

        const totalDays =
            (timeParam.excavation_timeline_months * 30) +
            (timeParam.foundation_timeline_months * 30) +
            structureDays +
            finishingDays -
            (overlapMonths * 30) +
            (timeParam.contingency_buffer_months * 30);

        const totalMonths = totalDays / 30;

        // D. Efficiency
        const achievedEfficiency = isPotential ? (planParam?.efficiency_target || 0.75) : metrics.efficiency;
        const targetEfficiency = planParam?.efficiency_target || 0.75;

        let effStatus: 'Optimal' | 'Inefficient' | 'Aggressive' = 'Optimal';
        if (!isPotential) {
            if (achievedEfficiency < targetEfficiency - 0.05) effStatus = 'Inefficient';
            if (achievedEfficiency > targetEfficiency + 0.05) effStatus = 'Aggressive';
        }

        return {
            isPotential,
            total_construction_cost: totalConstructionCost,
            cost_breakdown: constructionCost,
            total_revenue: totalRevenue,
            potential_profit: profit,
            roi_percentage: roi,
            timeline: {
                total_months: totalMonths,
                phases: {
                    excavation: timeParam.excavation_timeline_months,
                    foundation: timeParam.foundation_timeline_months,
                    structure: structureMonths,
                    finishing: finishingMonths
                }
            },
            efficiency_metrics: {
                achieved: achievedEfficiency,
                target: targetEfficiency,
                status: effStatus
            }
        };
    }, [project, metrics, costs, times, planning, isLoading]);

    return { estimates, isLoading, params: { costs, times, planning } };
}
