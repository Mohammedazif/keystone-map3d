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

        const location = typeof project.location === 'string' ? project.location : "Delhi"; // Default
        const buildingType = project.intendedUse || "Residential";

        let heightCategory: TimeEstimationParameter['height_category'] = 'Mid-Rise (15-45m)';

        // console.log("Estimating for:", { location, buildingType, heightCategory });

        // 1. MATCH COST PARAMETERS
        const lookupType = buildingType === 'Mixed-Use' ? 'Mixed Use' : buildingType;
        let costParam = costs.find(c => c.location === location && c.building_type === lookupType);
        if (!costParam) {
            // console.log("Exact match not found. Trying Delhi fallback...");
            costParam = costs.find(c => c.location === 'Delhi' && c.building_type === lookupType);
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
        let totalCost = 0;
        let totalRev = 0;
        let totalEarthwork = 0;
        let totalStructure = 0;
        let totalFinishing = 0;
        let totalServices = 0;
        const perBuildingBreakdown: any[] = [];
        let maxTimelineMonths = 0;
        let criticalPathPhases = { excavation: 0, foundation: 0, structure: 0, finishing: 0, overlap: 0, contingency: 0 };
        let isPotential = false;

        // Iterate over all buildings to calculate specific costs
        let processedGFA = 0;
        const buildings = project.plots.flatMap(p => p.buildings);
        
        // Helper to get time param for a specific building
        const getTimeParam = (bType: string, height: number) => {
            let hCat: TimeEstimationParameter['height_category'] = 'Mid-Rise (15-45m)';
            if (height < 15) hCat = 'Low-Rise (<15m)';
            if (height > 45) hCat = 'High-Rise (>45m)';
            return times.find(t => t.building_type === bType && t.height_category === hCat) || timeParam;
        };

        const getCostParam = (bType: string) => {
            return costs.find(c => c.location === location && c.building_type === bType) || costParam;
        }

        if (buildings.length > 0) {
            buildings.forEach(b => {
                const bType = b.intendedUse || buildingType;
                const bCostParam = getCostParam(bType);
                const bTimeParam = getTimeParam(bType, b.height);
                
                // Estimate GFA for this building
                // If it has floors, use floor area * floors. If not, use footprint * floors.
                // Creating a rough GFA estimate:
                const floors = b.numFloors || Math.ceil(b.height / (b.typicalFloorHeight || 3));
                const footprint = b.area;
                const bGFA = footprint * floors;

                processedGFA += bGFA;

                // Break down cost for this building
                const bEarthwork = bGFA * bCostParam.earthwork_cost_per_sqm;
                const bStructure = bGFA * bCostParam.structure_cost_per_sqm;
                const bFinishing = bGFA * bCostParam.finishing_cost_per_sqm;
                const bServices = bGFA * bCostParam.services_cost_per_sqm;
                
                const bCost = bEarthwork + bStructure + bFinishing + bServices;
                const bRev = bGFA * bCostParam.sellable_ratio * bCostParam.market_rate_per_sqm;
                
                totalCost += bCost;
                totalRev += bRev;
                
                // Aggregate components
                totalEarthwork += bEarthwork;
                totalStructure += bStructure;
                totalFinishing += bFinishing;
                totalServices += bServices;

                // Timeline
                const structureDays = floors * bTimeParam.structure_per_floor_days;
                const finishingDays = floors * bTimeParam.finishing_per_floor_days;
                const totalDays = 
                    (bTimeParam.excavation_timeline_months * 30) +
                    (bTimeParam.foundation_timeline_months * 30) +
                    structureDays +
                    finishingDays - 
                    ((finishingDays/30) * bTimeParam.services_overlap_factor * 30) +
                    (bTimeParam.contingency_buffer_months * 30);
                
                const bMonths = totalDays / 30;
                
                // Track critical path (longest duration building)
                if (bMonths > maxTimelineMonths) {
                    maxTimelineMonths = bMonths;
                    const overlapMonths = (finishingDays / 30) * bTimeParam.services_overlap_factor;
                    criticalPathPhases = {
                        excavation: bTimeParam.excavation_timeline_months,
                        foundation: bTimeParam.foundation_timeline_months,
                        structure: structureDays / 30,
                        finishing: finishingDays / 30,
                        overlap: overlapMonths,
                        contingency: bTimeParam.contingency_buffer_months
                    };
                }

                perBuildingBreakdown.push({
                    buildingId: b.id,
                    buildingName: b.name || `Building ${b.id.slice(0, 4)}`,
                    timeline: {
                        total: bMonths,
                        structure: structureDays / 30,
                        finishing: finishingDays / 30
                    },
                    cost: {
                        total: bCost,
                        ratePerSqm: bCostParam.total_cost_per_sqm
                    }
                });
            });
        } else {
             // Fallback if no buildings generated yet (use plot potential)
            isPotential = true;
            // Existing potential logic...
            let gfa = metrics.totalBuiltUpArea;
            if (gfa === 0 && project.plots.length > 0) {
                 const plotStats = calculateDevelopmentStats(project.plots[0], project.feasibilityParams || DEFAULT_FEASIBILITY_PARAMS);
                 gfa = plotStats.totalBuiltUpArea;
            }
            
            totalEarthwork = gfa * costParam.earthwork_cost_per_sqm;
            totalStructure = gfa * costParam.structure_cost_per_sqm;
            totalFinishing = gfa * costParam.finishing_cost_per_sqm;
            totalServices = gfa * costParam.services_cost_per_sqm;
            totalCost = totalEarthwork + totalStructure + totalFinishing + totalServices;
            
            totalRev = gfa * costParam.sellable_ratio * costParam.market_rate_per_sqm;
            
            // Standard timeline for potential
            const floors = Math.ceil(metrics.achievedFAR / (metrics.groundCoveragePct / 100 || 0.4)) || 10;
            const structureDays = floors * timeParam.structure_per_floor_days;
            const finishingDays = floors * timeParam.finishing_per_floor_days;
            const overlapMonths = (finishingDays / 30) * timeParam.services_overlap_factor;
             const totalDays =
                (timeParam.excavation_timeline_months * 30) +
                (timeParam.foundation_timeline_months * 30) +
                structureDays +
                finishingDays -
                (overlapMonths * 30) +
                (timeParam.contingency_buffer_months * 30);
            maxTimelineMonths = totalDays / 30;
            
            criticalPathPhases = {
                excavation: timeParam.excavation_timeline_months,
                foundation: timeParam.foundation_timeline_months,
                structure: structureDays / 30,
                finishing: finishingDays / 30,
                overlap: overlapMonths,
                contingency: timeParam.contingency_buffer_months
            };
        }

        // Add 5% contingency to total cost (if not already in param, but param usually has raw. Let's add project level soft cost buffer?)
        // The doc says "Soft Costs & Add-Ons... usually 5-10% of build cost". 
        // Our params have "total_cost_per_sqm", let's assume it includes construction but maybe not all soft costs.
        // Let's stick to the parameter's "total" for now to match admin panel expectation, 
        // OR add the contingency here as per previous logic.
        // Previous logic: constructionCost.contingency = subTotal * 0.05;
        // The params in Admin Panel show "Total Construction Cost" which sums up the components.
        // Let's apply limiting factors.
        
        // Add 5% contingency on top of everything
        const contingency = totalCost * 0.05;
        const finalTotalCost = totalCost + contingency; 

        // Profit
        const profit = totalRev - finalTotalCost; 
        const roi = finalTotalCost > 0 ? (profit / finalTotalCost) * 100 : 0;

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
            total_construction_cost: finalTotalCost,
            cost_breakdown: {
                earthwork: totalEarthwork,
                structure: totalStructure,
                finishing: totalFinishing,
                services: totalServices,
                contingency: contingency
            },
            total_revenue: totalRev,
            potential_profit: profit,
            roi_percentage: roi,
            timeline: {
                total_months: maxTimelineMonths,
                phases: criticalPathPhases
            },
            efficiency_metrics: {
                achieved: achievedEfficiency,
                target: targetEfficiency,
                status: effStatus
            },
            breakdown: perBuildingBreakdown
        };
    }, [project, metrics, costs, times, planning, isLoading]);

    return { estimates, isLoading, params: { costs, times, planning } };
}
