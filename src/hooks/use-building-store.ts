
'use client';

import { create } from 'zustand';
import type { Feature, Polygon, Point, FeatureCollection } from 'geojson';
import * as turf from '@turf/turf';
import { BuildingIntendedUse, type Plot, type Building, type GreenArea, type ParkingArea, type Floor, type Project, type BuildableArea, type SelectableObjectType, AiScenario, type Label, RegulationData, GenerateMassingInput, AiMassingScenario, GenerateMassingOutput, GenerateSiteLayoutInput, GenerateSiteLayoutOutput, AiSiteLayout, AiMassingGeneratedObject, AiZone, GenerateZonesOutput, DesignOption, GreenRegulationData, DevelopmentStats, FeasibilityParams, UtilityType, UtilityArea, ParkingType } from '@/lib/types';
import { calculateDevelopmentStats, DEFAULT_FEASIBILITY_PARAMS } from '@/lib/development-calc';
import { calculateParkingCapacity } from '@/lib/parking-calc';
import { produce } from 'immer';
import { toast } from './use-toast';
import { useMemo } from 'react';
import { generateSiteLayout } from '@/ai/flows/ai-site-layout-generator';
import { generateMassingOptions } from '@/ai/flows/ai-massing-generator';
import { generateLayoutZones } from '@/ai/flows/ai-zone-generator';

import { generateLamellas, generateTowers, generatePerimeter, AlgoParams, AlgoTypology } from '@/lib/generators/basic-generator';
import { generateLShapes, generateUShapes, generateTShapes, generateHShapes, generateSlabShapes, generatePointShapes } from '@/lib/generators/geometric-typologies';
import { generateSiteUtilities, generateBuildingLayout } from '@/lib/generators/layout-generator';
import { splitPolygon } from '@/lib/polygon-utils';
import { db } from '@/lib/firebase';
import { calculateVastuScore } from '@/lib/engines/vastu-engine';
import { calculateGreenAnalysis } from '@/lib/engines/green-analysis-engine';
import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch, getDoc, query, where } from 'firebase/firestore';
import useAuthStore from './use-auth-store';

export type DrawingObjectType = 'Plot' | 'Zone' | 'Building';

type ZoneType = 'BuildableArea' | 'GreenArea' | 'ParkingArea' | 'UtilityArea';

interface ZoneDefinitionState {
    isDefining: boolean;
    geometry: Feature<Polygon> | null;
    centroid: Feature<Point> | null;
    activePlotId: string | null;
}

interface DrawingState {
    isDrawing: boolean;
    objectType: DrawingObjectType | null;
    activePlotId: string | null; // The plot we are drawing inside
}

interface BuildingState {
    projects: Project[];
    activeProjectId: string | null;
    plots: Plot[]; // plots for the active project
    drawingPoints: [number, number][];
    drawingState: DrawingState;
    zoneDefinition: ZoneDefinitionState;
    selectedObjectId: { type: SelectableObjectType; id: string } | null;
    hoveredObjectId: { type: SelectableObjectType; id: string } | null;
    uiState: { showVastuCompass: boolean; isFeasibilityPanelOpen: boolean; ghostMode: boolean }; // New UI State
    componentVisibility: { electrical: boolean; hvac: boolean; basements: boolean; cores: boolean; units: boolean };
    aiScenarios: (AiScenario | AiMassingScenario)[] | null;
    isLoading: boolean;
    active: boolean;
    isSaving: boolean;
    isGeneratingAi: boolean;
    isGeneratingAlgo: boolean;
    generationParams: AlgoParams;

    designOptions: DesignOption[]; // Saved scenarios
    tempScenarios: { plots: Plot[] }[] | null; // Temporary scenarios for selection
    isGeneratingScenarios: boolean;

    mapLocation: string | null;
    greenRegulations: GreenRegulationData[]; // Global Green Regulations cache

    actions: {
        setMapLocation: (location: string | null) => void;
        loadProjects: () => Promise<void>;
        createProject: (name: string, totalPlotArea?: number, intendedUse?: 'Residential' | 'Commercial' | 'Mixed Use' | 'Public' | 'Industrial', location?: string, regulationId?: string, greenCertification?: ('IGBC' | 'GRIHA' | 'LEED' | 'Green Building')[], vastuCompliant?: boolean) => Promise<Project | null>;
        deleteProject: (projectId: string) => Promise<void>;
        loadProject: (projectId: string) => Promise<void>;
        saveCurrentProject: () => Promise<void>;
        startDrawing: (objectType: DrawingObjectType, activePlotId?: string | null) => void;
        addDrawingPoint: (point: [number, number]) => void;
        finishDrawing: (geometry: Feature<Polygon | Point>) => boolean;
        defineZone: (name: string, type: ZoneType, intendedUse?: BuildingIntendedUse, utilityType?: UtilityType) => void;
        cancelDefineZone: () => void;
        selectObject: (id: string | null, type: SelectableObjectType | null) => void;
        updateBuilding: (buildingId: string, props: Partial<Omit<Building, 'id' | 'floors'>>) => void;
        updateProject: (projectId: string, props: Partial<Project>) => void;
        updatePlot: (plotId: string, props: Partial<Omit<Plot, 'id'>>) => void;
        updateObject: (objectId: string, objectType: SelectableObjectType, props: Partial<any>) => void;
        deletePlot: (id: string) => void;
        deleteObject: (plotId: string, objectId: string, type: 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'UtilityArea' | 'Label') => void;
        resetDrawing: () => void;
        undoLastPoint: () => void;
        clearAllPlots: () => void;
        runAiLayoutGenerator: (plotId: string, prompt: string) => Promise<void>;
        runAiMassingGenerator: (plotId: string) => Promise<void>;
        applyAiLayout: (plotId: string, scenario: AiScenario | AiMassingScenario) => void;
        clearAiScenarios: () => void;
        setHoveredObject: (id: string | null, type: SelectableObjectType | null) => void;
        toggleObjectVisibility: (plotId: string, objectId: string, type: SelectableObjectType) => void;

        setGenerationParams: (params: Partial<AlgoParams>) => void;
        generateScenarios: (plotId: string, params: AlgoParams) => void;
        runAlgoMassingGenerator: (plotId: string) => void;
        addParkingFloor: (buildingId: string, parkingType: ParkingType, level?: number) => void;
        setPlotRegulation: (plotId: string, regulationType: string) => void;
        setPlotRegulationByIndex: (plotId: string, index: number) => void;

        saveDesignOption: (name: string, description?: string) => void;
        loadDesignOption: (id: string) => void;
        deleteDesignOption: (id: string) => void;


        applyScenario: (scenarioIndex: number) => void;
        clearTempScenarios: () => void;
        toggleVastuCompass: (show: boolean) => void;
        toggleFeasibilityPanel: () => void;
        toggleGhostMode: () => void;
        toggleComponentVisibility: (component: 'electrical' | 'hvac' | 'basements' | 'cores' | 'units') => void;
        setFeasibilityPanelOpen: (isOpen: boolean) => void;

        undo: () => void;
        redo: () => void;
    };
}

import { hslToRgb, BUILDING_MATERIALS } from '@/lib/color-utils';

export const UTILITY_COLORS = {
    [UtilityType.STP]: '#8B4513', // SaddleBrown
    [UtilityType.WTP]: '#00CED1', // DarkTurquoise
    [UtilityType.HVAC]: '#FF8C00', // DarkOrange
    [UtilityType.Electrical]: '#FFD700', // Gold
    [UtilityType.Water]: '#1E90FF', // DodgerBlue
    [UtilityType.Fire]: '#FF0000', // Red
    [UtilityType.Gas]: '#228B22', // ForestGreen
    [UtilityType.Roads]: '#555555', // DarkGrey
};

const generateFloorColors = (count: number, buildingType: BuildingIntendedUse = BuildingIntendedUse.Residential): string[] => {
    const material = BUILDING_MATERIALS[buildingType] || BUILDING_MATERIALS[BuildingIntendedUse.Residential];
    const colors: string[] = [];

    for (let i = 0; i < count; i++) {
        // Create vertical gradient: lighter at bottom, darker at top
        const floorRatio = count > 1 ? i / (count - 1) : 0;

        // Darken by 10-15% toward the top for depth
        const lightnessAdjustment = -12 * floorRatio;
        const lightness = Math.max(40, Math.min(80, material.baseLightness + lightnessAdjustment));

        // Slight hue variation for realism (±5 degrees)
        const hueVariation = (Math.random() - 0.5) * 10;
        const hue = material.baseHue + hueVariation;

        colors.push(hslToRgb(hue, material.saturation, lightness));
    }

    return colors;
}

// Helper to determine opacity based on building type
const getOpacityForBuildingType = (buildingType: BuildingIntendedUse): number => {
    switch (buildingType) {
        case BuildingIntendedUse.Commercial:
            return 0.85; // More transparent for glass facades
        case BuildingIntendedUse.MixedUse:
            return 0.88; // Slightly transparent
        case BuildingIntendedUse.Residential:
            return 0.95; // More solid
        case BuildingIntendedUse.Industrial:
            return 0.98; // Very solid
        case BuildingIntendedUse.Public:
            return 0.92; // Moderately solid
        default:
            return 0.9;
    }
};

// Helper to convert geometry for Firestore
// Helper to convert geometry for Firestore
const prepareForFirestore = (plots: Plot[]): any[] => {
    console.log('[prepareForFirestore] Input plots:', plots.length);
    return plots.map(plot => {
        const prepared = {
            ...plot,
            geometry: plot.geometry ? JSON.stringify(plot.geometry) : null,
            centroid: plot.centroid ? JSON.stringify(plot.centroid) : null,
            buildings: (plot.buildings || []).map(b => ({
                ...b,
                geometry: JSON.stringify(b.geometry),
                centroid: JSON.stringify(b.centroid),
                cores: (b.cores || []).map(c => ({
                    ...c,
                    geometry: JSON.stringify(c.geometry)
                })),
                units: (b.units || []).map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry)
                })),
                internalUtilities: (b.internalUtilities || []).map(u => ({
                    ...u,
                    geometry: JSON.stringify(u.geometry)
                })),
            })),
            greenAreas: (plot.greenAreas || []).map(g => ({
                ...g,
                geometry: JSON.stringify(g.geometry),
                centroid: JSON.stringify(g.centroid),
            })),
            parkingAreas: (plot.parkingAreas || []).map(p => ({
                ...p,
                geometry: JSON.stringify(p.geometry),
                centroid: JSON.stringify(p.centroid),
            })),
            buildableAreas: (plot.buildableAreas || []).map(b => ({
                ...b,
                geometry: JSON.stringify(b.geometry),
                centroid: JSON.stringify(b.centroid),
            })),
            utilityAreas: (plot.utilityAreas || []).map(u => ({
                ...u,
                geometry: JSON.stringify(u.geometry),
                centroid: JSON.stringify(u.centroid),
            })),
        };
        return prepared;
    });
};

// Helper to safely parse geometry
const safeParse = (data: any, label: string) => {
    if (!data) return null;
    if (typeof data === 'object') return data; // Already an object
    try {
        const parsed = JSON.parse(data);
        // Handle double-serialization check
        if (typeof parsed === 'string') {
            try { return JSON.parse(parsed); }
            catch { return parsed; }
        }
        return parsed;
    } catch (e) {
        console.warn(`[safeParse] Failed to parse ${label}:`, data);
        return null;
    }
};

// Helper to parse geometry from Firestore
const parseFromFirestore = (plots: any[]): Plot[] => {
    if (!plots || !Array.isArray(plots)) {
        console.warn('[parseFromFirestore] Invalid input:', plots);
        return [];
    }
    console.log('[parseFromFirestore] Parsing plots:', plots.length);

    return plots.map(plot => {
        try {
            // Check if this plot is already parsed (has geometry object)
            // or if it needs parsing
            const parsedPlot = {
                ...plot,
                isHeatAnalysisActive: plot.isHeatAnalysisActive ?? false,
                geometry: safeParse(plot.geometry, `plot-${plot.id}-geometry`),
                centroid: safeParse(plot.centroid, `plot-${plot.id}-centroid`),
                buildings: (plot.buildings || []).map((b: any) => ({
                    ...b,
                    geometry: safeParse(b.geometry, `bldg-${b.id}`),
                    centroid: safeParse(b.centroid, `bldg-${b.id}-centroid`),
                    cores: (b.cores || []).map((c: any) => ({
                        ...c,
                        geometry: safeParse(c.geometry, `core-${c.id}`)
                    })),
                    units: (b.units || []).map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `unit-${u.id}`)
                    })),
                    internalUtilities: (b.internalUtilities || []).map((u: any) => ({
                        ...u,
                        geometry: safeParse(u.geometry, `util-int-${u.id}`)
                    })),
                })),
                greenAreas: (plot.greenAreas || []).map((g: any) => ({
                    ...g,
                    geometry: safeParse(g.geometry, `green-${g.id}`),
                    centroid: safeParse(g.centroid, `green-${g.id}-centroid`),
                })),
                parkingAreas: (plot.parkingAreas || []).map((p: any) => ({
                    ...p,
                    geometry: safeParse(p.geometry, `parking-${p.id}`),
                    centroid: safeParse(p.centroid, `parking-${p.id}-centroid`),
                })),
                buildableAreas: (plot.buildableAreas || []).map((b: any) => ({
                    ...b,
                    geometry: safeParse(b.geometry, `buildable-${b.id}`),
                    centroid: safeParse(b.centroid, `buildable-${b.id}-centroid`),
                })),
                utilityAreas: (plot.utilityAreas || []).map((u: any) => ({
                    ...u,
                    geometry: safeParse(u.geometry, `utility-${u.id}`),
                    centroid: safeParse(u.centroid, `utility-${u.id}-centroid`),
                })),
            };

            // Debug log for first plot to verify structure
            if (plot === plots[0]) {
                console.log('[parseFromFirestore] Parsed First Plot Sample:', {
                    id: parsedPlot.id,
                    hasGeometry: !!parsedPlot.geometry,
                    geometryType: parsedPlot.geometry?.type
                });
            }

            return parsedPlot;
        } catch (e) {
            console.error("Failed to parse plot from firestore", plot, e);
            return { ...plot, geometry: null, centroid: null, buildings: [], greenAreas: [], parkingAreas: [], buildableAreas: [], utilityAreas: [] };
        }
    }).filter(p => {
        if (!p.geometry) console.warn('[parseFromFirestore] Filtered out plot with missing geometry:', p.id);
        return p.geometry;
    }); // Filter out plots that failed to parse
};

async function fetchRegulationsForPlot(plotId: string, centroid: Feature<Point>) {
    const [lon, lat] = centroid.geometry.coordinates;
    let locationName: string | null = 'Default';
    let fetchedRegulations: RegulationData[] = [];

    try {
        const geoResponse = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json?types=region&access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}`);
        const geoData = await geoResponse.json();
        const regionFeature = geoData.features[0];
        if (regionFeature) {
            locationName = regionFeature.text;
        }

        if (locationName) {
            const regulationsRef = collection(db, 'regulations');
            const q = query(regulationsRef, where('location', '==', locationName));
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                fetchedRegulations = querySnapshot.docs.map(doc => doc.data() as RegulationData);
            }
        }
    } catch (e) {
        console.error('Failed to fetch location or regulations', e);
        toast({ variant: 'destructive', title: 'Location Error', description: 'Could not determine plot location or fetch regulations.' });
    }

    // Determine regulation based on Project settings
    const activeProject = useBuildingStore.getState().projects.find(p => p.id === useBuildingStore.getState().activeProjectId);
    const intendedUse = activeProject?.intendedUse || 'Residential';
    const projectRegulationId = activeProject?.regulationId;

    let defaultRegulation: RegulationData | undefined;

    // 1. Priority: Explicit Project Regulation ID
    if (projectRegulationId) {
        defaultRegulation = fetchedRegulations.find(r => r.id === projectRegulationId || r.type === projectRegulationId);
    }

    // 2. Fallback: Match Intended Use (Optimization)
    if (!defaultRegulation) {
        // Only try to find a match, do NOT force random ones
        defaultRegulation = fetchedRegulations.find(r => r.type && r.type.toLowerCase() === intendedUse.toLowerCase()); // Exact match preference

        if (!defaultRegulation) {
            defaultRegulation = fetchedRegulations.find(r => r.type && r.type.toLowerCase().includes(intendedUse.toLowerCase()));
        }
    }

    // Removed aggressive fallbacks (Residential / First Available) as per user request
    // If no regulation matches, it will remain NULL, allowing the user to set it manually or see "No Regulation"

    useBuildingStore.setState(produce((draft: BuildingState) => {
        const plotToUpdate = draft.plots.find(p => p.id === plotId);
        if (plotToUpdate) {
            plotToUpdate.location = locationName;
            plotToUpdate.availableRegulations = fetchedRegulations;
            plotToUpdate.selectedRegulationType = defaultRegulation?.type || null;
            plotToUpdate.regulation = defaultRegulation || null;

            // Extract regulation constraints
            plotToUpdate.setback = defaultRegulation?.geometry?.setback?.value ?? 4;
            plotToUpdate.maxBuildingHeight = defaultRegulation?.geometry?.max_height?.value;
            plotToUpdate.far = defaultRegulation?.geometry?.floor_area_ratio?.value;
            plotToUpdate.maxCoverage = defaultRegulation?.geometry?.max_ground_coverage?.value;
        }
    }));
}


const useBuildingStoreWithoutUndo = create<BuildingState>((set, get) => ({
    projects: [],
    activeProjectId: null,
    plots: [],
    drawingPoints: [],
    drawingState: {
        isDrawing: false,
        objectType: null,
        activePlotId: null
    },
    zoneDefinition: {
        isDefining: false,
        geometry: null,
        centroid: null,
        activePlotId: null,
    },
    selectedObjectId: null,
    hoveredObjectId: null,
    uiState: { showVastuCompass: false, isFeasibilityPanelOpen: false, ghostMode: false },
    componentVisibility: { electrical: false, hvac: false, basements: false, cores: false, units: false },
    aiScenarios: null,
    isLoading: true,
    active: false,
    isSaving: false,
    isGeneratingAi: false,

    isGeneratingAlgo: false,
    generationParams: {
        typology: 'lamella',
        width: 12,
        spacing: 15,
        orientation: 0,
        setback: 4,
    },

    designOptions: [],
    tempScenarios: null,
    isGeneratingScenarios: false,
    greenRegulations: [],

    mapLocation: null,
    actions: {
        setMapLocation: (location) => set({ mapLocation: location }),
        loadProjects: async () => {
            set({ isLoading: true });
            try {
                // Determine user - for now fetch all or filter by user if Auth implemented
                // const userId = useAuthStore.getState().user?.uid;
                const q = query(collection(db, 'projects')); // Fetch all for now
                const querySnapshot = await getDocs(q);
                const projects = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Project));

                // Sort by last modified descending
                projects.sort((a, b) => new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime());

                set({ projects, isLoading: false });
            } catch (error) {
                console.error("Error loading projects:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Failed to load projects.' });
                set({ isLoading: false });
            }
        },
        createProject: async (name, totalPlotArea, intendedUse = 'Residential', location, regulationId, greenCertification, vastuCompliant) => {
            console.log('[createProject] Received parameters:');
            console.log('  name:', name);
            console.log('  totalPlotArea:', totalPlotArea);
            console.log('  intendedUse:', intendedUse);
            console.log('  location:', location);
            console.log('  regulationId:', regulationId);
            console.log('  greenCertification:', greenCertification);
            console.log('  vastuCompliant:', vastuCompliant);

            try {
                const userId = useAuthStore.getState().user?.uid || 'guest';

                // Geocode the location to get lat/lng coordinates
                let locationCoords: { lat: number; lng: number } | undefined;
                if (location) {
                    try {
                        const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;
                        const geocodeUrl = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(location)}.json?access_token=${mapboxToken}&limit=1&country=IN`;
                        const response = await fetch(geocodeUrl);
                        const data = await response.json();

                        if (data.features && data.features.length > 0) {
                            const [lng, lat] = data.features[0].center;
                            locationCoords = { lat, lng };
                            console.log(`📍 Geocoded "${location}" to:`, locationCoords);
                        } else {
                            console.warn(`Could not geocode location: ${location}`);
                        }
                    } catch (geocodeError) {
                        console.error('Geocoding error:', geocodeError);
                        // Continue without coordinates if geocoding fails
                    }
                }

                const newProject: Project = {
                    id: crypto.randomUUID(),
                    userId,
                    name,
                    totalPlotArea,
                    intendedUse,
                    location: locationCoords || location, // Store coords if available, otherwise store string
                    regulationId,
                    greenCertification,
                    vastuCompliant,
                    plots: [],
                    lastModified: new Date().toISOString(),
                };

                // Save to Firestore (User Scoped)
                // Sanitize undefined values (Firestore doesn't allow undefined)
                const projectDataToSave = JSON.parse(JSON.stringify({
                    ...newProject,
                    plots: [] // Plots stored separately or empty initially
                }));

                await setDoc(doc(db, 'users', userId, 'projects', newProject.id), projectDataToSave);

                set(state => ({
                    projects: [newProject, ...state.projects],
                    activeProjectId: newProject.id,
                    plots: [], // Reset plots for new project
                    active: true
                }));

                toast({ title: 'Project Created', description: `Started working on ${name}.` });
                return newProject;
            } catch (error) {
                console.error("Error creating project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Failed to create project.' });
                return null;
            }
        },
        deleteProject: async (projectId) => {
            try {
                await deleteDoc(doc(db, 'projects', projectId));
                set(state => ({
                    projects: state.projects.filter(p => p.id !== projectId),
                    activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId,
                    plots: state.activeProjectId === projectId ? [] : state.plots
                }));
                toast({ title: 'Project Deleted' });
            } catch (error) {
                console.error("Error deleting project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete project.' });
            }
        },
        loadProject: async (projectId) => {
            set({ isLoading: true });
            try {
                const userId = useAuthStore.getState().user?.uid;
                if (!userId) throw new Error("User not authenticated");

                const projectDoc = await getDoc(doc(db, 'users', userId, 'projects', projectId));
                if (projectDoc.exists()) {
                    const projectData = projectDoc.data() as Project;
                    console.log('📦 Loaded project data from Firestore:', projectData);
                    console.log('📦 Loaded project data from Firestore:', projectData);
                    console.log('📍 Project location:', projectData.location);
                    // Debug Raw Plots Data
                    if (projectData.plots && projectData.plots.length > 0) {
                        const p0 = projectData.plots[0];
                        console.log('🔍 Raw Plot[0] from DB:', {
                            id: p0.id,
                            geometryType: typeof p0.geometry,
                            geometryPreview: typeof p0.geometry === 'string' ? (p0.geometry as string).substring(0, 50) : 'Object/Null'
                        });
                    }

                    // Parse plots if they are stored as JSON strings (simplified) or if we need to fetch subcollection
                    // Assuming plots are stored in the project document as sanitized JSON for now
                    // In a real app, plots might be a subcollection. Based on 'prepareForFirestore', they are in the doc?
                    // No, prepareForFirestore creates an array. 
                    // Let's assume they are in the 'plots' field of the project doc.

                    let loadedPlots: Plot[] = [];
                    if (projectData.plots) {
                        loadedPlots = parseFromFirestore(projectData.plots as any);
                    }

                    // Create the full project object with the ID
                    const fullProject: Project = {
                        ...projectData,
                        id: projectId
                    };

                    set(state => ({
                        activeProjectId: projectId,
                        plots: loadedPlots,
                        // Add or update the project in the projects array
                        projects: state.projects.some(p => p.id === projectId)
                            ? state.projects.map(p => p.id === projectId ? fullProject : p)
                            : [fullProject, ...state.projects],
                        isLoading: false,
                        active: true
                    }));
                    console.log(`✅ Project ${projectData.name} loaded with ${loadedPlots.length} plots.`);
                } else {
                    toast({ variant: 'destructive', title: 'Error', description: 'Project not found.' });
                    set({ isLoading: false });
                }
            } catch (error) {
                console.error("Error loading project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Failed to load project.' });
                set({ isLoading: false });
            }
        },
        // saveCurrentProject: Shadowed implementation removed
        saveDesignOption: (name, description) => {
            const { plots, generationParams, designOptions } = get();
            const newOption: DesignOption = {
                id: crypto.randomUUID(),
                name,
                description,
                createdAt: Date.now(),
                data: {
                    // Deep clone essential data to avoid reference issues
                    plots: JSON.parse(JSON.stringify(plots)),
                    generationParams: JSON.parse(JSON.stringify(generationParams))
                }
            };
            set({ designOptions: [...designOptions, newOption] });
            get().actions.saveCurrentProject();
            toast({ title: "Scenario Saved", description: `${name} has been saved.` });
        },
        loadDesignOption: (id) => {
            const { designOptions } = get();
            const option = designOptions.find(o => o.id === id);
            if (!option) return;

            set({
                plots: JSON.parse(JSON.stringify(option.data.plots)),
                generationParams: JSON.parse(JSON.stringify(option.data.generationParams)),
                // Reset selection if the object doesn't exist? Or keep it simple.
                selectedObjectId: null
            });
            toast({ title: "Scenario Loaded", description: `Active layout restored to ${option.name}.` });
        },
        deleteDesignOption: (id) => {
            set(produce((draft: BuildingState) => {
                draft.designOptions = draft.designOptions.filter(o => o.id !== id);
            }));
            get().actions.saveCurrentProject();
            toast({ title: "Scenario Deleted" });
        },
        toggleVastuCompass: (show) => set(produce((state: BuildingState) => {
            state.uiState.showVastuCompass = show;
        })),
        setFeasibilityPanelOpen: (isOpen) => set(produce((state: BuildingState) => {
            state.uiState.isFeasibilityPanelOpen = isOpen;
        })),

        generateScenarios: (plotId, params) => {
            const { plots } = get();
            const plotStub = plots.find(p => p.id === plotId);
            if (!plotStub) return;

            set({ isGeneratingScenarios: true });

            // Helper to generate buildings for a scenario
            const createScenario = (name: string, p: Omit<AlgoParams, 'width'> & { width?: number; maxBuildingHeight?: number; far?: number; maxCoverage?: number; overrideTypologies?: string[] }) => {
                let geomFeatures: Feature<Polygon>[] = [];

                // Adjust defaults based on Land Use
                let defaultWidth = 12; // Residential default
                if (params.landUse === 'commercial') defaultWidth = 20; // Deep office plates
                else if (params.landUse === 'institutional') defaultWidth = 16;
                else if (params.landUse === 'mixed') defaultWidth = 15;

                if (params.landUse === 'commercial') defaultWidth = 20; // Deep office plates
                else if (params.landUse === 'institutional') defaultWidth = 16;
                else if (params.landUse === 'mixed') defaultWidth = 15;

                const wingDepth = p.width || defaultWidth;

                console.log('Generating Scenario:', {
                    name,
                    typologies: params.typologies,
                    landUse: params.landUse,
                    setback: p.setback,
                    RAW_SETBACK_PARAM: params.setback
                });

                // Support both old single typology and new array format
                // ---------------------------------------------------------
                // Advanced Selection & Placement Logic (Vastu + Collision)
                // ---------------------------------------------------------

                // 1. Prepare Valid Area & Sectors
                // @ts-ignore
                const bufferedPlotForSectors = turf.buffer(plotStub.geometry, -p.setback / 1000, { units: 'kilometers' });
                const validAreaPoly = bufferedPlotForSectors || plotStub.geometry;
                const bbox = turf.bbox(validAreaPoly); // [minX, minY, maxX, maxY]
                const [minX, minY, maxX, maxY] = bbox;

                const widthStep = (maxX - minX) / 3;
                const heightStep = (maxY - minY) / 3;

                // Helper to get Sector Centroid
                const getSectorPoint = (col: number, row: number): Feature<Point> => {
                    const cx = minX + (col * widthStep) + (widthStep / 2);
                    const cy = minY + (row * heightStep) + (heightStep / 2);
                    return turf.point([cx, cy]);
                };

                // Vastu Zones (Row 0=Bottom/South, Row 2=Top/North)
                // 6 7 8 (NW, N, NE)
                // 3 4 5 (W,  C,  E)
                // 0 1 2 (SW, S, SE)
                // Cols: 0=West, 1=Center, 2=East

                // Define Vastu Priority Zones (Heaviest to Lightest)
                const vastuZones: [number, number][] = [
                    [0, 0], // 1. SW (Nairutya) - Master/Heaviest
                    [1, 0], // 2. South (Dakshin)
                    [0, 1], // 3. West (Paschim)
                    [2, 0], // 4. SE (Agneya) - Fire
                    [0, 2], // 5. NW (Vayavya) - Air
                    [1, 2], // 6. North (Kuber) - Lighter
                    [2, 1], // 7. East (Indra)
                    [2, 2]  // 8. NE (Ishanya) - Lightest/Water
                ];

                // Remove static mapper

                // 2. Sort Typologies by "Heaviness" (Size/Priority)
                const typologyWeights: Record<string, number> = {
                    'hshaped': 100,
                    'ushaped': 90,
                    'lshaped': 80,
                    'tshaped': 70,
                    'slab': 60,
                    'oshaped': 50,
                    'point': 10
                };

                let typologiesToGenerate = p.overrideTypologies || params.typologies || [params.typology || 'point'];

                const sortedTypologies = [...typologiesToGenerate].sort((a, b) => {
                    return (typologyWeights[b] || 0) - (typologyWeights[a] || 0);
                });

                // 3. Sequential Generation Loop
                const plotArea = turf.area(plotStub.geometry);

                // Keep track of placed buildings to avoid collision
                const builtObstacles: Feature<Polygon>[] = [];

                // Vastu: Protect Brahmasthan (Center)
                if (p.vastuCompliant) {
                    // Center is col=1, row=1
                    const cx1 = minX + widthStep;
                    const cx2 = minX + (2 * widthStep);
                    const cy1 = minY + heightStep;
                    const cy2 = minY + (2 * heightStep);
                    const brahmasthan = turf.polygon([[
                        [cx1, cy1], [cx2, cy1], [cx2, cy2], [cx1, cy2], [cx1, cy1]
                    ]]);
                    builtObstacles.push(brahmasthan);
                }

                sortedTypologies.forEach((typology: string, index: number) => {
                    // small plot check (warn/skip if too small)
                    // Relaxed constraints applied previously

                    // Dynamic Target Assignment
                    let targetPos: Feature<Point> | undefined = undefined;

                    if (p.vastuCompliant && typology !== 'point') {
                        // Assign zones based on Rank (Index)
                        // Heavier typologies are at lower indices (sorted desc)
                        // If index exceeds available zones, wrap or default
                        const zoneIndex = index % vastuZones.length;
                        const [col, row] = vastuZones[zoneIndex];
                        targetPos = getSectorPoint(col, row);
                    }
                    // For non-Vastu, we might want to distribute to corners too to avoid stacking? 
                    // Let's keep default behavior (center/random) for now or apply simple distribution if single
                    else if (!p.vastuCompliant && sortedTypologies.length > 1 && typology !== 'point') {
                        // Distribute to corners to avoid overlap if Vastu is OFF but multi-typo
                        const corners = [[0, 0], [2, 0], [2, 2], [0, 2]]; // SW, SE, NE, NW
                        const zoneIndex = index % corners.length;
                        const [col, row] = corners[zoneIndex];
                        targetPos = getSectorPoint(col, row);
                    }

                    let generated: Feature<Polygon>[] = [];

                    // Get current project unit mix
                    const project = get().projects.find(prj => prj.id === get().activeProjectId);
                    const projectUnitMix = project?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;

                    // Let generators calculate optimal dimensions based on plot
                    // Only pass wing depth hint if specified (otherwise generators use 10-14m)
                    const genParams: AlgoParams = {
                        ...p,
                        wingDepth: wingDepth || undefined, // Let generator calculate if not set
                        width: wingDepth || 12, // Default 12m for Point/Slab
                        obstacles: builtObstacles,
                        targetPosition: targetPos,
                        vastuCompliant: !!p.vastuCompliant,
                        unitMix: projectUnitMix, // Pass project unit mix
                        // Optional hints - generators will calculate optimal if not provided
                        wingLengthA: undefined,
                        wingLengthB: undefined
                    };

                    switch (typology) {
                        case 'point':
                            generated = generatePointShapes(plotStub.geometry, genParams);
                            break;
                        case 'slab':
                        case 'plot':
                            generated = generateSlabShapes(plotStub.geometry, genParams);
                            break;
                        case 'lshaped':
                            generated = generateLShapes(plotStub.geometry, genParams);
                            break;
                        case 'ushaped':
                            generated = generateUShapes(plotStub.geometry, genParams);
                            break;
                        case 'tshaped':
                            generated = generateTShapes(plotStub.geometry, genParams);
                            break;
                        case 'hshaped':
                            generated = generateHShapes(plotStub.geometry, genParams);
                            break;
                        case 'oshaped':
                            generated = generatePerimeter(plotStub.geometry, genParams as any);
                            break;
                        default:
                            generated = generatePointShapes(plotStub.geometry, genParams);
                    }

                    // CRITICAL FIX: Handle mutually exclusive geometry options (L, U, T, H)
                    // These generators return multiple distinct options (e.g. SW, SE, NE, NW L-shapes).
                    // We must NOT combine them into a single scenario (which creates a ring).
                    // Instead, we should pick ONE option per generated scenario loop iteration, 
                    // or if this `generateScenarios` function is creating a SINGLE scenario, we should randomly pick one.

                    // For now, since `generateScenarios` creates ONE scenario entity derived from `scenarioIterations`,
                    // we need to pick just ONE of the valid generated shapes to avoid the "Ring" effect.

                    if (['lshaped', 'ushaped', 'tshaped', 'hshaped'].includes(typology)) {
                        if (generated.length > 0) {
                            // Pick a random candidate to allow variation across the 3 scenario slots
                            // Since `generateScenarios` runs once per scenario definition in the UI,
                            // picking randomly here ensures Scenario 1, 2, and 3 get different shapes.

                            const randomIndex = Math.floor(Math.random() * generated.length);
                            const selectedCandidate = generated[randomIndex];

                            builtObstacles.push(selectedCandidate);
                            geomFeatures.push(selectedCandidate);
                        }
                    } else {
                        // For Point/Slab towers, we DO want multiple buildings in one scenario
                        if (generated.length > 0) {
                            const toAdd = generated;
                            builtObstacles.push(...toAdd);
                            geomFeatures.push(...toAdd);
                        }
                    }
                });

                // Convert to Buildings
                const newBuildings = geomFeatures.map((f, i) => {
                    // Calculate height based on floor count range AND regulation limits
                    const floorHeight = params.floorHeight || 3.5;

                    // User-specified constraints (defaults)
                    const minF = params.minFloors ?? 5;
                    let maxF = params.maxFloors ?? 12;

                    // Use constraints passed in 'p' if available (from specific regulation), otherwise fallback to plotStub
                    const constraintHeight = p.maxBuildingHeight !== undefined ? p.maxBuildingHeight : plotStub.maxBuildingHeight;

                    // Apply regulation height limit if available
                    if (constraintHeight) {
                        const regulationMaxFloors = Math.floor(constraintHeight / floorHeight);
                        maxF = Math.min(maxF, regulationMaxFloors);
                        console.log(`Regulation height limit: ${constraintHeight}m → max ${regulationMaxFloors} floors`);
                    }

                    // Ensure valid range
                    if (maxF < minF) {
                        console.warn(`Regulation constraint too restrictive. Adjusting minFloors from ${minF} to ${maxF}`);
                        maxF = Math.max(minF, maxF); // Allow at least minF
                    }

                    // Vastu-aware height assignment
                    let vastuHeightMultiplier = 1.0;
                    const projectData = get().projects.find(proj => proj.id === get().activeProjectId);
                    const isVastuEnabled = projectData?.vastuCompliant === true;

                    if (isVastuEnabled) {
                        // Calculate building position relative to plot center
                        const plotCentroid = turf.centroid(plotStub.geometry);
                        const buildingCentroid = turf.centroid(f);
                        const plotCenter = plotCentroid.geometry.coordinates;
                        const buildingCenter = buildingCentroid.geometry.coordinates;

                        // Calculate direction from plot center to building
                        const dx = buildingCenter[0] - plotCenter[0]; // East is positive
                        const dy = buildingCenter[1] - plotCenter[1]; // North is positive

                        // Vastu rules: SW = tallest (1.0), NE = shortest (0.5)
                        // SW: dx < 0 && dy < 0 → multiplier 1.0
                        // NE: dx > 0 && dy > 0 → multiplier 0.5
                        // Gradient between based on position
                        const swFactor = Math.max(0, (-dx - dy) / (Math.abs(dx) + Math.abs(dy) + 0.0001));
                        const neFactor = Math.max(0, (dx + dy) / (Math.abs(dx) + Math.abs(dy) + 0.0001));

                        // SW gets full height, NE gets 50% height, others are in between
                        vastuHeightMultiplier = 0.75 + 0.25 * swFactor - 0.25 * neFactor;
                        vastuHeightMultiplier = Math.max(0.5, Math.min(1.0, vastuHeightMultiplier));

                        console.log(`Vastu height multiplier for building ${i}: ${vastuHeightMultiplier.toFixed(2)} (SW factor: ${swFactor.toFixed(2)}, NE factor: ${neFactor.toFixed(2)})`);
                    }

                    const baseFloors = Math.floor(Math.random() * (maxF - minF + 1)) + minF;
                    const floors = Math.max(minF, Math.round(baseFloors * vastuHeightMultiplier));
                    const height = floors * floorHeight;

                    // Determine intended use from params
                    let intendedUse = BuildingIntendedUse.Residential;

                    // Check regulation type first for more specific classification
                    const regulationType = plotStub.selectedRegulationType?.toLowerCase() || '';

                    if (regulationType.includes('industrial') || regulationType.includes('warehouse') || regulationType.includes('storage') || regulationType.includes('manufacturing')) {
                        intendedUse = BuildingIntendedUse.Industrial;
                    } else if (regulationType.includes('public') || regulationType.includes('civic') || regulationType.includes('government') || params.landUse === 'institutional') {
                        intendedUse = BuildingIntendedUse.Public;
                    } else if (params.landUse === 'commercial') {
                        intendedUse = BuildingIntendedUse.Commercial;
                    } else if (params.landUse === 'mixed') {
                        intendedUse = BuildingIntendedUse.MixedUse;
                    }

                    const id = `gen-${crypto.randomUUID()}`;

                    // --- INTERNAL LAYOUT (CORES/UNITS) ---
                    // Some generators (like L/U/T/H) already calculate layout.
                    // Others (like Tower/Lamella) need it calculated here.
                    let layout: any = {
                        cores: f.properties?.cores || [],
                        units: f.properties?.units || [],
                        utilities: f.properties?.internalUtilities || []
                    };

                    if (layout.units.length === 0) {
                        const activeProject = get().projects.find(prj => prj.id === get().activeProjectId);
                        const projectUnitMix = activeProject?.feasibilityParams?.unitMix || DEFAULT_FEASIBILITY_PARAMS.unitMix;

                        console.log(`[use-building-store] Generating internal layout for building ${i} using unitMix`, projectUnitMix);
                        const layoutResult = generateBuildingLayout(f, {
                            subtype: f.properties?.subtype || params.typology,
                            unitMix: projectUnitMix
                        });
                        layout = { cores: layoutResult.cores, units: layoutResult.units, utilities: layoutResult.utilities };
                    }

                    // Ensure utilities from geometric-typologies (f.properties.internalUtilities) are preserved if not re-generated
                    if (!layout.utilities && f.properties?.internalUtilities) {
                        layout.utilities = f.properties.internalUtilities;
                    }

                    return {
                        id: id,
                        name: `Building ${i + 1}`,
                        isPolygonClosed: true,
                        geometry: f,
                        centroid: turf.centroid(f),
                        height: height,
                        opacity: 0.9,
                        extrusion: true,
                        soilData: null,
                        intendedUse: intendedUse,
                        floors: Array.from({ length: floors }, (_, j) => ({
                            id: `floor-${id}-${j}`,
                            height: floorHeight,
                            color: generateFloorColors(floors, intendedUse)[j] || '#cccccc'
                        })),
                        cores: layout.cores,
                        units: layout.units,
                        internalUtilities: layout.utilities || [],
                        area: turf.area(f),
                        numFloors: floors,
                        typicalFloorHeight: floorHeight,
                        visible: true,
                    } as Building;
                });

                // Apply FAR constraint if available (prefer passed constraint, then plot default)
                const effectiveFAR = p.far !== undefined ? p.far : plotStub.far;

                if (effectiveFAR && newBuildings.length > 0) {
                    const plotArea = turf.area(plotStub.geometry);
                    const totalBuiltArea = newBuildings.reduce((sum, b) => sum + (b.area * b.numFloors), 0);
                    const actualFAR = totalBuiltArea / plotArea;

                    console.log(`FAR Check: Actual=${actualFAR.toFixed(2)}, Limit=${effectiveFAR}`);

                    if (actualFAR > effectiveFAR * 1.05) { // Allow 5% tolerance
                        const scaleFactor = effectiveFAR / actualFAR;
                        console.warn(`FAR exceeded! Scaling building heights by ${(scaleFactor * 100).toFixed(1)}%`);

                        // Scale down floor counts proportionally
                        newBuildings.forEach(b => {
                            const newFloors = Math.max(1, Math.floor(b.numFloors * scaleFactor));
                            b.numFloors = newFloors;
                            b.height = newFloors * b.typicalFloorHeight;
                            b.floors = Array.from({ length: newFloors }, (_, j) => ({
                                id: `floor-${b.id}-${j}`,
                                height: b.typicalFloorHeight,
                                color: generateFloorColors(newFloors, b.intendedUse)[j] || '#cccccc'
                            }));
                        });
                    }
                }

                // --- PARKING GENERATION ---
                if (params.parkingType && newBuildings.length > 0) {
                    newBuildings.forEach((b: Building) => {
                        const parkingArea = b.area || 500;
                        const capacityPerFloor = Math.floor((parkingArea * 0.75) / 12.5);

                        if (params.parkingType === 'ug') {
                            // Add Basements (Levels -1, -2)
                            b.floors.push({
                                id: `floor-${b.id}-b1`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -1,
                                parkingCapacity: capacityPerFloor
                            });
                            b.floors.push({
                                id: `floor-${b.id}-b2`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -2,
                                parkingCapacity: capacityPerFloor
                            });
                        } else if (params.parkingType === 'pod') {
                            // Add Stilt (Level 0)
                            b.floors.push({
                                id: `floor-${b.id}-stilt`,
                                height: 3.5,
                                color: '#999999',
                                type: 'Parking',
                                parkingType: ParkingType.Stilt,
                                level: 0,
                                parkingCapacity: capacityPerFloor
                            });
                            // Increase total height to account for stilt lifting the tower
                            b.height += 3.5;
                        }
                    });
                }

                // Check ground coverage if available
                let effectiveCoverage = p.maxCoverage !== undefined ? p.maxCoverage : plotStub.maxCoverage;

                // Green Certification Optimization & Feasibility Logic
                const activeProject = get().projects.find(prj => prj.id === get().activeProjectId);
                const greenRegs = get().greenRegulations;

                if (activeProject?.greenCertification && Array.isArray(activeProject.greenCertification) && activeProject.greenCertification.length > 0) {
                    let strictMaxCoverage = 100;

                    // 1. Find stricter constraints from Green Regulations
                    activeProject.greenCertification.forEach(cert => {
                        // Find matching regulation doc
                        const match = greenRegs.find(r =>
                            r.certificationType === cert ||
                            r.name.includes(cert) ||
                            (cert === 'Green Building' && r.certificationType === 'Green Building')
                        );

                        if (match && match.constraints) {
                            // If Min Open Space is defined (e.g. 0.30), Max Coverage is 1 - 0.30 = 0.70
                            if (match.constraints.minOpenSpace) {
                                const impliedCoverage = 1 - match.constraints.minOpenSpace;
                                strictMaxCoverage = Math.min(strictMaxCoverage, impliedCoverage * 100);
                            }
                            // If Max Coverage is explicitly defined
                            if (match.constraints.maxGroundCoverage) {
                                strictMaxCoverage = Math.min(strictMaxCoverage, match.constraints.maxGroundCoverage * 100);
                            }
                        } else {
                            // Fallback Defaults if no doc found (Hardcoded safety)
                            if (cert === 'LEED') strictMaxCoverage = Math.min(strictMaxCoverage, 70); // 30% Open
                            if (cert === 'GRIHA') strictMaxCoverage = Math.min(strictMaxCoverage, 75); // 25% Open
                            if (cert === 'IGBC') strictMaxCoverage = Math.min(strictMaxCoverage, 80); // 20% Green
                        }
                    });

                    // 2. Apply Stricter Limit
                    if (strictMaxCoverage < 100 && effectiveCoverage) {
                        // Only reduce, never increase beyond local regulation
                        if (strictMaxCoverage < effectiveCoverage) {
                            console.log(`Green Logic applied: Reducing Max Coverage to ${strictMaxCoverage}% (was ${effectiveCoverage}%)`);
                            effectiveCoverage = strictMaxCoverage;
                        }
                    }
                }

                if (effectiveCoverage && newBuildings.length > 0) {
                    const plotArea = turf.area(plotStub.geometry);
                    const totalFootprint = newBuildings.reduce((sum, b) => sum + b.area, 0);
                    const coveragePercent = (totalFootprint / plotArea) * 100;

                    console.log(`Coverage Check: Actual=${coveragePercent.toFixed(1)}%, Limit=${effectiveCoverage}%`);

                    if (coveragePercent > effectiveCoverage * 1.05) { // Allow 5% tolerance
                        console.warn(`Ground coverage exceeded: ${coveragePercent.toFixed(1)}% > ${effectiveCoverage}%`);
                        toast({
                            title: "Coverage Limit Exceeded",
                            description: `Buildings cover ${coveragePercent.toFixed(1)}% of plot (limit: ${effectiveCoverage}%)`,
                            variant: 'destructive'
                        });
                    }
                }

                // Create a Deep Clone of the plot and replace buildings
                const plotClone = JSON.parse(JSON.stringify(plotStub));
                plotClone.buildings = newBuildings;

                // Clear other generated areas to avoid overlap confusion (re-populated below derived from params)
                plotClone.greenAreas = [];
                plotClone.parkingAreas = [];

                // --- UTILITY ZONE GENERATION ---
                console.log('[Utility Debug - generateScenarios] params.selectedUtilities:', params.selectedUtilities);
                plotClone.utilityAreas = [];

                if (params.selectedUtilities && Array.isArray(params.selectedUtilities) && params.selectedUtilities.length > 0) {
                    const selected = params.selectedUtilities;
                    const internalUtils = selected.filter((u: string) => ['HVAC', 'Electrical'].includes(u));
                    const externalUtils = selected.filter((u: string) => ['STP', 'WTP', 'Water', 'Fire', 'Gas'].includes(u));

                    // 1. Internal Utilities (Modify Buildings)
                    if (internalUtils.length > 0 && plotClone.buildings.length > 0) {
                        plotClone.buildings.forEach((b: Building) => {
                            b.utilities = [...internalUtils]; // Tag building

                            // Visual: Add HVAC Plant on Roof
                            // We add a small "mechanical floor" or block on top
                            if (internalUtils.includes('HVAC')) {
                                b.floors.push({
                                    id: `floor-${b.id}-hvac`,
                                    height: 2.5,
                                    color: '#EA580C', // Orange-600
                                    type: 'Utility',
                                    utilityType: UtilityType.HVAC
                                });
                                b.numFloors += 1;
                                b.height += 2.5;
                            }

                            // Visual: Electrical (Base/Plinth)
                            // Add a dedicated service floor at the bottom
                            if (internalUtils.includes('Electrical')) {
                                b.floors.unshift({
                                    id: `floor-${b.id}-electrical`,
                                    height: 3.0,
                                    color: '#FCD34D', // Amber-300
                                    type: 'Utility',
                                    utilityType: UtilityType.Electrical
                                });
                                b.numFloors += 1;
                                b.height += 3.0; // Increase total height
                            }
                        });
                    }

                    console.log('[Utility Debug] Generating', externalUtils.length, 'external utility zones');

                    // 2. External Utilities (Plot Zones)
                    if (externalUtils.length > 0) {
                        try {
                            const plotBoundary = plotStub.geometry;
                            const innerSetback = turf.buffer(plotBoundary, -(plotStub.setback || 5), { units: 'meters' });

                            if (innerSetback) {
                                // Get all coordinates to find corners of the actual polygon (better than bbox for irregular plots)
                                // Vastu/Smart Utility Generation
                                try {
                                    // Use the new generator which handles Vastu rules
                                    const smartUtils = generateSiteUtilities(
                                        innerSetback as Feature<Polygon>,
                                        plotClone.buildings,
                                        params.vastuCompliant
                                    );

                                    plotClone.utilityAreas.push(...smartUtils);
                                } catch (err) {
                                    console.warn("Smart utility generation failed, falling back or skipping", err);
                                }
                            }
                        } catch (e) {
                            console.warn("Failed to generate external utility placement", e);
                        }
                    }
                }

                return { plots: [plotClone] };
            };

            // Generate 3 Variations
            setTimeout(() => { // minimal delay to allow UI to show loading if needed

                // Base topology param mapping
                const baseTypo = (params.typology === 'lshaped' || params.typology === 'slab') ? 'lamella' :
                    (params.typology === 'ushaped' || params.typology === 'oshaped' ? 'perimeter' : 'tower');

                const generatedScenarios: { plots: Plot[] }[] = [];

                // Revert to generating active regulation scenarios
                // Use plotStub's current constraints (derived from active regulation) for all these variations

                // Dynamic Scenario Generation Strategies
                // 1. Determine base strategy based on constraints
                const isVastu = params.vastuCompliant === true; // or check project settings

                // Helper to get random int
                const rnd = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

                // HYBRID LOGIC: Determine distinct combinations for the 3 scenarios
                let scenarioTypologies: string[][] = [[], [], []];

                if (params.typologies && params.typologies.length > 1) {
                    // Generate all non-empty subsets logic
                    const getAllSubsets = (arr: string[]) => arr.reduce(
                        (subsets, value) => subsets.concat(subsets.map(set => [value, ...set])),
                        [[]] as string[][]
                    ).filter(s => s.length > 0);

                    const allSubsets = getAllSubsets(params.typologies);
                    // Shuffle subsets to get random variety each time
                    const shuffledSubsets = allSubsets.sort(() => 0.5 - Math.random());

                    // Assign to 3 slots (cycling if fewer subsets than slots)
                    for (let i = 0; i < 3; i++) {
                        scenarioTypologies[i] = shuffledSubsets[i % shuffledSubsets.length];
                    }
                }

                // Scenario 1: Optimized / Vastu (The "Best" fit)
                generatedScenarios.push(createScenario("Scenario 1: Optimized", {
                    typology: baseTypo as AlgoTypology,
                    spacing: 15,
                    orientation: isVastu ? 0 : 0,
                    setback: params.setback !== undefined ? params.setback : (plotStub.setback || 4),
                    vastuCompliant: isVastu,
                    overrideTypologies: scenarioTypologies[0].length > 0 ? scenarioTypologies[0] : undefined
                }));

                // Scenario 2: High Density / Maximized
                generatedScenarios.push(createScenario("Scenario 2: Max Density", {
                    typology: baseTypo as AlgoTypology,
                    spacing: 12,
                    orientation: isVastu ? 0 : (plotStub.roadAccessSides?.includes('E') ? 90 : 0),
                    setback: params.setback !== undefined ? params.setback : (plotStub.setback || 4),
                    vastuCompliant: isVastu,
                    overrideTypologies: scenarioTypologies[1].length > 0 ? scenarioTypologies[1] : undefined
                }));

                // Scenario 3: Creative / Alternative
                // Try a different angle or configuration
                const altAngle = isVastu ? 0 : 15;
                const altTypo = baseTypo;

                generatedScenarios.push(createScenario("Scenario 3: Alternative", {
                    typology: altTypo as AlgoTypology,
                    spacing: 18,
                    orientation: altAngle,
                    setback: params.setback !== undefined ? params.setback : (plotStub.setback || 4),
                    vastuCompliant: isVastu,
                    overrideTypologies: scenarioTypologies[2].length > 0 ? scenarioTypologies[2] : undefined
                }));

                set({
                    tempScenarios: generatedScenarios,
                    isGeneratingScenarios: false
                });
            }, 500);
        },

        applyScenario: (index) => {
            const { tempScenarios } = get();
            if (!tempScenarios || !tempScenarios[index]) return;

            const selectedScenario = tempScenarios[index];

            // Apply to main state
            set(produce(draft => {
                selectedScenario.plots.forEach((scenPlot: Plot) => {
                    const plotIndex = draft.plots.findIndex(p => p.id === scenPlot.id);
                    if (plotIndex !== -1) {
                        // Deep clone to ensure React detects the change and triggers map cleanup
                        // Replace all generated areas to ensure clean state
                        draft.plots[plotIndex].buildings = JSON.parse(JSON.stringify(scenPlot.buildings));
                        draft.plots[plotIndex].greenAreas = JSON.parse(JSON.stringify(scenPlot.greenAreas));
                        draft.plots[plotIndex].parkingAreas = JSON.parse(JSON.stringify(scenPlot.parkingAreas));
                        draft.plots[plotIndex].buildableAreas = JSON.parse(JSON.stringify(scenPlot.buildableAreas));
                        draft.plots[plotIndex].utilityAreas = JSON.parse(JSON.stringify(scenPlot.utilityAreas));
                    }
                });
            }));

            toast({ title: "Design Applied", description: "Scenario has been applied to the plot." });
        },

        clearTempScenarios: () => set({ tempScenarios: null }),

        setGenerationParams: (params) => {
            set(produce(draft => {
                Object.assign(draft.generationParams, params);
            }));
        },
        setPlotRegulation: (plotId: string, regulationType: string) => {
            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot && plot.availableRegulations) {
                    // CRITICAL FIX: If the plot already has this regulation type, DO NOT reset it.
                    // This prevents overwriting a specific variant (e.g. 3m setback) with the default variant (e.g. 5m setback)
                    // when a generic component calls this action with just the type string.
                    if (plot.selectedRegulationType === regulationType && plot.regulation) {
                        return;
                    }

                    const selectedReg = plot.availableRegulations.find(r => r.type === regulationType);
                    if (selectedReg) {
                        plot.selectedRegulationType = selectedReg.type;
                        plot.regulation = selectedReg;

                        // Update constraints
                        plot.setback = selectedReg.geometry?.setback?.value
                            || selectedReg.geometry?.min_setback?.value
                            || selectedReg.geometry?.front_setback?.value
                            || 4; // Improved setback fetching

                        plot.maxBuildingHeight = selectedReg.geometry?.max_height?.value;
                        plot.far = selectedReg.geometry?.floor_area_ratio?.value;
                        plot.maxCoverage = selectedReg.geometry?.max_ground_coverage?.value;

                        toast({ title: "Regulation Updated", description: `Applied constraints for ${selectedReg.type}` });
                    }
                }
            }));
        },
        setPlotRegulationByIndex: (plotId: string, index: number) => {
            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot && plot.availableRegulations && plot.availableRegulations[index]) {
                    const selectedReg = plot.availableRegulations[index];
                    plot.selectedRegulationType = selectedReg.type;
                    plot.regulation = selectedReg;

                    // Update constraints
                    plot.setback = selectedReg.geometry?.setback?.value
                        || selectedReg.geometry?.min_setback?.value
                        || selectedReg.geometry?.front_setback?.value
                        || 4; // Improved fallback logic here too

                    plot.maxBuildingHeight = selectedReg.geometry?.max_height?.value;
                    plot.far = selectedReg.geometry?.floor_area_ratio?.value;
                    plot.maxCoverage = selectedReg.geometry?.max_ground_coverage?.value;

                    console.log('[Store] Set Regulation By Index:', {
                        index,
                        type: selectedReg.type,
                        setback: plot.setback,
                        allRegulations: plot.availableRegulations.map((r, i) => `[${i}] ${r.type} (${r.geometry?.setback?.value || '?'}m)`)
                    });

                    toast({ title: "Regulation Updated", description: `Applied constraints for ${selectedReg.type}` });
                }
            }));
        },


        toggleGhostMode: () => {
            set(produce((draft: BuildingState) => {
                draft.uiState.ghostMode = !draft.uiState.ghostMode;
                toast({ title: draft.uiState.ghostMode ? "Ghost Mode Enabled" : "Ghost Mode Disabled", description: "Internal structures are now " + (draft.uiState.ghostMode ? "visible" : "hidden") });
            }));
        },

        toggleComponentVisibility: (component: 'electrical' | 'hvac' | 'basements' | 'cores' | 'units') => {
            set(produce((draft: BuildingState) => {
                // Toggle the specific component
                draft.componentVisibility[component] = !draft.componentVisibility[component];

                // Auto-enable ghostMode if any component is now visible
                const anyVisible = Object.values(draft.componentVisibility).some(v => v);
                if (anyVisible && !draft.uiState.ghostMode) {
                    draft.uiState.ghostMode = true;
                }
                // Auto-disable ghostMode if no components are visible
                else if (!anyVisible && draft.uiState.ghostMode) {
                    draft.uiState.ghostMode = false;
                }
            }));
        },

        setMapLocation: (location) => set({ mapLocation: location }),
        undo: () => console.warn('Undo not implemented'),
        redo: () => console.warn('Redo not implemented'),
        loadProjects: async () => {
            const userId = useAuthStore.getState().user?.uid;
            if (!userId) {
                set({ projects: [], isLoading: false });
                return;
            }


            set({ isLoading: true });

            try {
                const projectsCollection = collection(db, 'users', userId, 'projects');
                const projectSnapshot = await getDocs(projectsCollection);
                const projects = projectSnapshot.docs.map(doc => {
                    const data = doc.data() as Project;
                    // Ensure plots exist before parsing
                    if (data.plots) {
                        data.plots = parseFromFirestore(data.plots);
                    }
                    return data;
                });
                set({ projects, isLoading: false });
            } catch (error) {
                console.error("Error loading projects from Firestore:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not load projects.' });
                set({ isLoading: false });
            }
        },
        deleteProject: async (projectId: string) => {
            const userId = useAuthStore.getState().user?.uid;
            if (!userId) return;

            try {
                await deleteDoc(doc(db, 'users', userId, 'projects', projectId));
                set(produce(draft => {
                    draft.projects = draft.projects.filter(p => p.id !== projectId);
                    if (draft.activeProjectId === projectId) {
                        draft.activeProjectId = null;
                        draft.plots = [];
                    }
                }));
            } catch (error) {
                console.error("Error deleting project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not delete project.' });
            }
        },
        loadProject: async (projectId: string) => {
            set({ isLoading: true, activeProjectId: projectId, plots: [], selectedObjectId: null });
            const userId = useAuthStore.getState().user?.uid;
            if (!userId) {
                set({ isLoading: false });
                return;
            }

            try {
                const projectRef = doc(db, 'users', userId, 'projects', projectId);
                const docSnap = await getDoc(projectRef);
                if (docSnap.exists()) {
                    const data = docSnap.data() as Project;

                    const parsedPlots = parseFromFirestore(data.plots || []);
                    const project = { ...data, plots: parsedPlots };

                    // Fetch Green Regulations in background
                    getDocs(collection(db, 'greenRegulations')).then(snap => {
                        const regs = snap.docs.map(d => d.data() as GreenRegulationData);
                        set({ greenRegulations: regs });
                    }).catch(err => console.error("Failed to load green regs", err));

                    set(produce((draft: BuildingState) => {
                        const existingIndex = draft.projects.findIndex(p => p.id === projectId);
                        if (existingIndex !== -1) {
                            draft.projects[existingIndex] = project;
                        } else {
                            draft.projects.push(project);
                        }
                        draft.plots = project.plots || [];

                        // Load design options if available
                        if (project.designOptions) {
                            if (typeof project.designOptions === 'string') {
                                try {
                                    draft.designOptions = JSON.parse(project.designOptions);
                                } catch (e) {
                                    console.error("Failed to parse saved design options", e);
                                    draft.designOptions = [];
                                }
                            } else if (Array.isArray(project.designOptions)) {
                                draft.designOptions = project.designOptions;
                            }
                        } else {
                            draft.designOptions = [];
                        }

                        draft.isLoading = false;
                    }));

                    // After plots are loaded into state, fetch regulations for each
                    get().plots.forEach(plot => {
                        if (plot.centroid) {
                            fetchRegulationsForPlot(plot.id, plot.centroid);
                        }
                    });

                } else {
                    toast({ variant: 'destructive', title: 'Error', description: 'Project not found.' });
                    set({ isLoading: false });
                }
            } catch (error) {
                console.error("Error loading single project:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not load project.' });
                set({ isLoading: false });
            }
        },
        saveCurrentProject: async () => {
            set({ isSaving: true });
            const { activeProjectId, plots, projects, designOptions } = get();
            const userId = useAuthStore.getState().user?.uid;

            if (!userId || !activeProjectId) {
                toast({ variant: 'destructive', title: 'Error', description: 'Cannot save. No active user or project.' });
                set({ isSaving: false });
                return;
            }

            const projectToSave = projects.find(p => p.id === activeProjectId);
            if (!projectToSave) {
                set({ isSaving: false });
                return;
            }

            const updatedProject = {
                ...projectToSave,
                plots: prepareForFirestore(plots), // Convert geometries to strings
                designOptions: JSON.stringify(designOptions), // Persist saved scenarios
                lastModified: new Date().toISOString(),
            }

            try {
                const projectRef = doc(db, 'users', userId, 'projects', activeProjectId);
                const projectDataToSave = JSON.parse(JSON.stringify(updatedProject));
                await setDoc(projectRef, projectDataToSave);
                set(produce((draft: BuildingState) => {
                    const projIndex = draft.projects.findIndex(p => p.id === activeProjectId);
                    if (projIndex !== -1) {
                        // We keep the parsed geometry in the local state
                        draft.projects[projIndex].plots = plots;
                        draft.projects[projIndex].lastModified = updatedProject.lastModified;
                    }
                }));
                toast({ title: 'Project Saved!', description: `${projectToSave.name} has been saved.` });
            } catch (error) {
                console.error("Error saving project:", error);
                toast({ variant: 'destructive', title: 'Save Failed', description: 'Could not save project to the cloud.' });
            } finally {
                set({ isSaving: false });
            }
        },
        resetDrawing: () => {
            set(
                produce(draft => {
                    draft.drawingPoints = [];
                    draft.drawingState.isDrawing = false;
                    draft.drawingState.objectType = null;
                    draft.drawingState.activePlotId = null;
                })
            );
        },
        undoLastPoint: () => {
            set(produce(draft => {
                if (draft.drawingState.isDrawing && draft.drawingPoints.length > 0) {
                    draft.drawingPoints.pop();
                }
            }));
        },
        startDrawing: (objectType, activePlotId = null) => {
            set(
                produce(draft => {
                    draft.selectedObjectId = null;
                    draft.drawingPoints = [];
                    const newActivePlotId = objectType === 'Plot' ? null : activePlotId;
                    draft.drawingState = { isDrawing: true, objectType, activePlotId: newActivePlotId };
                })
            );
        },
        addDrawingPoint: (point) => {
            set(
                produce(draft => {
                    if (draft.drawingState.isDrawing) {
                        draft.drawingPoints.push(point);
                    }
                })
            );
        },
        finishDrawing: (geometry) => {
            try {
                const { drawingState, projects, activeProjectId, plots, actions } = get();
                if (!drawingState.isDrawing || !drawingState.objectType) return false;

                if (geometry.geometry.type !== 'Polygon') {
                    actions.resetDrawing();
                    return false;
                }

                const polygonGeometry = geometry as Feature<Polygon>;

                if (drawingState.objectType === 'Plot') {
                    const id = `plot-${Date.now()}`;
                    const newObjArea = turf.area(polygonGeometry);
                    const centroid = turf.centroid(polygonGeometry);
                    const newPlot: Plot = {
                        id, name: `Plot ${get().plots.length + 1}`, geometry: polygonGeometry, centroid, area: newObjArea,
                        setback: 4,
                        buildings: [], greenAreas: [], parkingAreas: [], buildableAreas: [], utilityAreas: [], entries: [], labels: [],
                        visible: true,
                        location: 'Loading...',
                        availableRegulations: [],
                        selectedRegulationType: null,
                        regulation: null,
                    };
                    set(produce(draft => {
                        draft.plots.push(newPlot);
                        draft.selectedObjectId = { type: 'Plot', id: newPlot.id };
                    }));

                    fetchRegulationsForPlot(id, centroid);

                } else if (drawingState.objectType === 'Zone') {
                    let currentPlotId = drawingState.activePlotId;
                    if (!currentPlotId) {
                        const parentPlot = plots.find((p: Plot) => turf.booleanContains(p.geometry, polygonGeometry));
                        if (!parentPlot) {
                            toast({
                                variant: 'destructive', title: 'Drawing Error',
                                description: 'Zones must be drawn completely inside a plot.',
                            });
                            actions.resetDrawing();
                            return false;
                        }
                        currentPlotId = parentPlot.id;
                    }
                    const centroid = turf.centroid(polygonGeometry);
                    set(produce((draft: BuildingState) => {
                        draft.zoneDefinition = {
                            isDefining: true,
                            geometry: polygonGeometry,
                            centroid: centroid,
                            activePlotId: currentPlotId,
                        };
                    }));
                } else if (drawingState.objectType === 'Building') {
                    let currentPlotId = drawingState.activePlotId;
                    if (!currentPlotId) {
                        const parentPlot = plots.find((p: Plot) => turf.booleanContains(p.geometry, polygonGeometry));
                        if (!parentPlot) {
                            toast({
                                variant: 'destructive', title: 'Drawing Error',
                                description: 'Buildings must be drawn completely inside a plot.',
                            });
                            actions.resetDrawing();
                            return false;
                        }
                        currentPlotId = parentPlot.id;
                    }
                    set(produce((draft: BuildingState) => {
                        const plot = draft.plots.find(p => p.id === currentPlotId);
                        if (plot) {
                            const project = projects.find(p => p.id === activeProjectId);
                            const id = `bldg-${Date.now()}`;
                            const area = turf.area(polygonGeometry);
                            const numFloors = 5;
                            const typicalFloorHeight = 3;

                            const parentBuildableArea = plot.buildableAreas.find((ba: BuildableArea) => (turf as any).booleanContains(ba.geometry, polygonGeometry));
                            const intendedUse = parentBuildableArea ? parentBuildableArea.intendedUse : BuildingIntendedUse.Residential;

                            const floors = Array.from({ length: numFloors }, (_, i) => ({ id: `floor-${id}-${i}`, height: typicalFloorHeight, color: generateFloorColors(numFloors, intendedUse)[i] }));
                            const newBuilding: Building = {
                                id: id,
                                name: `Building ${plot.buildings.length + 1}`,
                                isPolygonClosed: true,
                                geometry: polygonGeometry,
                                centroid: turf.centroid(polygonGeometry),
                                height: numFloors * typicalFloorHeight,
                                opacity: getOpacityForBuildingType(intendedUse),
                                extrusion: true,
                                soilData: { ph: null, bd: null },
                                intendedUse,
                                floors,
                                area,
                                numFloors,
                                typicalFloorHeight,
                                visible: true,
                            };
                            plot.buildings.push(newBuilding);
                            draft.selectedObjectId = { type: 'Building', id: id };
                        }
                    }));
                } else if (drawingState.objectType === 'Road') {
                    let currentPlotId = drawingState.activePlotId;
                    if (!currentPlotId) {
                        const parentPlot = plots.find((p: Plot) => turf.booleanContains(p.geometry, polygonGeometry));
                        if (parentPlot) currentPlotId = parentPlot.id;
                    }
                    if (currentPlotId) {
                        set(produce((draft: BuildingState) => {
                            const plot = draft.plots.find(p => p.id === currentPlotId);
                            if (plot) {
                                const id = `road-${Date.now()}`;
                                const roadArea: UtilityArea = {
                                    id,
                                    name: `Road ${plot.utilityAreas.filter(u => u.type === 'Roads').length + 1}`,
                                    type: UtilityType.Roads,
                                    geometry: polygonGeometry,
                                    centroid: turf.centroid(polygonGeometry),
                                    area: turf.area(polygonGeometry),
                                    visible: true
                                };
                                plot.utilityAreas.push(roadArea);
                                draft.selectedObjectId = { type: 'UtilityArea', id };
                            }
                        }));
                    } else {
                        // Allow road outside plot? For now, yes, but maybe warn?
                        // Actually, utilities are usually inside plots in this data model.
                        // If no plot found, we can't attach it.
                        toast({
                            variant: 'destructive',
                            title: 'Drawing Error',
                            description: 'Roads must be drawn inside a plot boundary.',
                        });
                        actions.resetDrawing();
                        return false;
                    }
                }


                actions.resetDrawing();
                return true;

            } catch (error: any) {
                console.error("Error finishing drawing:", error);
                toast({
                    variant: 'destructive', title: 'Invalid Shape',
                    description: 'The drawn shape is invalid. Please avoid self-intersecting lines and try again.',
                });
                get().actions.resetDrawing();
                return false;
            }
        },
        defineZone: (name, type, intendedUse, utilityType) => {
            const { zoneDefinition } = get();
            if (!zoneDefinition.isDefining || !zoneDefinition.geometry || !zoneDefinition.centroid || !zoneDefinition.activePlotId) return;

            const { geometry, centroid, activePlotId } = zoneDefinition;

            set(produce(draft => {
                const plot = draft.plots.find(p => p.id === activePlotId);
                if (!plot) return;

                const id = `obj-${Date.now()}`;
                const area = turf.area(geometry);
                const visible = true;

                const newArea = { id, name, geometry, centroid, area, visible };

                if (type === 'GreenArea') {
                    plot.greenAreas.push(newArea);
                    draft.selectedObjectId = { type: 'GreenArea', id };
                } else if (type === 'ParkingArea') {
                    plot.parkingAreas.push(newArea);
                    draft.selectedObjectId = { type: 'ParkingArea', id };
                } else if (type === 'BuildableArea') {
                    const buildableArea: BuildableArea = { ...newArea, intendedUse: intendedUse || BuildingIntendedUse.Residential };
                    plot.buildableAreas.push(buildableArea);
                    draft.selectedObjectId = { type: 'BuildableArea', id };
                } else if (type === 'UtilityArea') {
                    const utilityArea: UtilityArea = { ...newArea, type: utilityType || UtilityType.STP };
                    plot.utilityAreas.push(utilityArea);
                    draft.selectedObjectId = { type: 'UtilityArea', id };
                }
            }));

            get().actions.cancelDefineZone();
        },
        cancelDefineZone: () => {
            set({
                zoneDefinition: {
                    isDefining: false,
                    geometry: null,
                    centroid: null,
                    activePlotId: null,
                }
            });
        },
        selectObject: (id, type) => {
            get().actions.resetDrawing();
            if (!id || !type) {
                set({ selectedObjectId: null });
                return;
            }

            const { plots } = get();
            let selectedObjectCentroid: Feature<Point> | null = null;
            for (const plot of plots) {
                if (type === 'Plot' && plot.id === id) {
                    selectedObjectCentroid = plot.centroid;
                    break;
                }
                const allObjects = [...plot.buildings, ...plot.greenAreas, ...plot.parkingAreas, ...plot.buildableAreas];
                const foundObject = allObjects.find(obj => obj.id === id);
                if (foundObject) {
                    selectedObjectCentroid = foundObject.centroid;
                    break;
                }
            }

            if (selectedObjectCentroid) {
                window.dispatchEvent(new CustomEvent('flyTo', { detail: { center: selectedObjectCentroid.geometry.coordinates } }));
            }

            set(produce((draft: BuildingState) => {
                draft.selectedObjectId = { id, type };

                // Auto-exit Ghost Mode when selecting main entities
                if (type === 'Plot' || type === 'Building') {
                    draft.uiState.ghostMode = false;
                    // Reset all component visibilities
                    draft.componentVisibility.electrical = false;
                    draft.componentVisibility.hvac = false;
                    draft.componentVisibility.basements = false;
                    draft.componentVisibility.cores = false;
                    draft.componentVisibility.units = false;
                }
            }));
        },
        updateBuilding: (buildingId, props) => {
            set(produce((draft: BuildingState) => {
                for (const plot of draft.plots) {
                    const building = plot.buildings.find(b => b.id === buildingId);
                    if (building) {
                        const oldNumFloors = building.numFloors ?? building.floors.length;
                        const oldTypicalHeight = building.typicalFloorHeight ?? building.floors[0]?.height ?? 3;

                        Object.assign(building, props);

                        const newNumFloors = building.numFloors ?? oldNumFloors;
                        const newTypicalHeight = building.typicalFloorHeight ?? oldTypicalHeight;

                        if (props.numFloors !== undefined || props.typicalFloorHeight !== undefined) {
                            const colors = generateFloorColors(newNumFloors, building.intendedUse);

                            // Preserve special floors (Parking, Utility)
                            const specialFloors = building.floors.filter(f => f.type === 'Parking');
                            const standardFloors = building.floors.filter(f => f.type !== 'Parking');

                            const newFloors = Array.from({ length: newNumFloors }, (_, i) => ({
                                id: standardFloors[i]?.id || `floor-${Date.now()}-${i}`,
                                height: newTypicalHeight,
                                color: colors[i],
                                type: 'General' as const
                            }));

                            building.floors = [...specialFloors, ...newFloors];
                            building.height = newNumFloors * newTypicalHeight;
                        }

                        if (props.geometry) {
                            building.area = turf.area(props.geometry);
                        }

                        building.numFloors = newNumFloors;
                        building.typicalFloorHeight = newTypicalHeight;

                        break;
                    }
                }
            }));
        },
        addParkingFloor: (buildingId, parkingType, _level) => {
            // STILT/PODIUM PARKING DISABLED As per user request
            if (parkingType === ParkingType.Stilt || parkingType === ParkingType.Podium) return;

            set(produce((draft: BuildingState) => {
                for (const plot of draft.plots) {
                    const building = plot.buildings.find(b => b.id === buildingId);
                    if (building) {
                        const isBasement = parkingType === ParkingType.Basement;

                        // Calculate next level based on existing floors of same type
                        // Basements go down (-1, -2...), Stilts go up (0, 1...) relative to ground?
                        // Or just simplistic stacking
                        const existingTypeFloors = building.floors.filter(f => f.parkingType === parkingType);

                        let nextLevel = 0;
                        if (isBasement) {
                            // Find lowest basement level
                            const minLevel = existingTypeFloors.length > 0
                                ? Math.min(...existingTypeFloors.map(f => f.level ?? -1))
                                : 0;
                            nextLevel = minLevel - 1;
                        } else {
                            // Find highest stilt level
                            const maxLevel = existingTypeFloors.length > 0
                                ? Math.max(...existingTypeFloors.map(f => f.level ?? -1))
                                : -1;
                            nextLevel = maxLevel + 1;
                        }

                        // Override if explicit level provided (though usually not in this simple API)
                        if (_level !== undefined && _level !== -1) nextLevel = _level;

                        const newFloor: Floor = {
                            id: `floor-${building.id}-parking-${Date.now()}`,
                            height: isBasement ? 3.5 : 3.5,
                            color: isBasement ? '#808080' : '#A8A8A8',
                            type: 'Parking',
                            parkingType,
                            parkingCapacity: calculateParkingCapacity(building.area, 12.5, 0.75),
                            level: nextLevel
                        };

                        // Insert at correct position in array? 
                        // Visual renderer sorts by level or handles it. 
                        // Basements usually push to end of array in generation, but here we can just push.
                        building.floors.push(newFloor);
                        break;
                    }
                }
            }));
        },
        updateProject: (projectId, props) => {
            set(produce((draft: BuildingState) => {
                const project = draft.projects.find(p => p.id === projectId);
                if (project) {
                    Object.assign(project, props);
                }
            }));
        },
        updatePlot: (plotId, props) => {
            set(produce(draft => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot) {
                    Object.assign(plot, props);
                    if (props.geometry) {
                        plot.area = turf.area(props.geometry);
                    }
                    if (props.selectedRegulationType) {
                        plot.regulation = plot.availableRegulations?.find(r => r.type === props.selectedRegulationType) || null;
                    }
                }
            }));
        },
        updateObject: (objectId, objectType, props) => {
            set(produce((draft: BuildingState) => {
                for (const plot of draft.plots) {
                    let objectFound = false;
                    switch (objectType) {
                        case 'GreenArea':
                            const ga = plot.greenAreas.find(o => o.id === objectId);
                            if (ga) { Object.assign(ga, props); objectFound = true; }
                            break;
                        case 'ParkingArea':
                            const pa = plot.parkingAreas.find(o => o.id === objectId);
                            if (pa) {
                                Object.assign(pa, props);
                                if (props.area || props.efficiency || props.spaceSize || props.type) {
                                    pa.capacity = calculateParkingCapacity(pa.area, pa.spaceSize || 12.5, pa.efficiency || 0.75);
                                    if (!pa.spaceSize) pa.spaceSize = 12.5;
                                    if (!pa.efficiency) pa.efficiency = 0.75;
                                }
                                objectFound = true;
                            }
                            break;
                        case 'BuildableArea':
                            const ba = plot.buildableAreas.find(o => o.id === objectId);
                            if (ba) { Object.assign(ba, props); objectFound = true; }
                            break;
                        case 'UtilityArea':
                            const ua = plot.utilityAreas.find(o => o.id === objectId);
                            if (ua) { Object.assign(ua, props); objectFound = true; }
                            break;
                    }
                    if (objectFound) break;
                }
            }));
        },
        deletePlot: (id) => {
            const { selectedObjectId } = get();
            const wasSelected = selectedObjectId?.type === 'Plot' && selectedObjectId.id === id;
            set(produce(draft => {
                draft.plots = draft.plots.filter(p => p.id !== id);
                if (wasSelected) {
                    draft.selectedObjectId = null;
                }
            }));
        },
        deleteObject: (plotId, objectId, type) => {
            const { selectedObjectId } = get();
            const wasSelected = selectedObjectId?.id === objectId;
            set(produce(draft => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (plot) {
                    if (type === 'Building') plot.buildings = plot.buildings.filter(b => b.id !== objectId);
                    if (type === 'GreenArea') plot.greenAreas = plot.greenAreas.filter(g => g.id !== objectId);
                    if (type === 'ParkingArea') plot.parkingAreas = plot.parkingAreas.filter((p: any) => p.id !== objectId);
                    if (type === 'BuildableArea') plot.buildableAreas = plot.buildableAreas.filter(b => b.id !== objectId);
                    if (type === 'UtilityArea') plot.utilityAreas = plot.utilityAreas.filter((u: any) => u.id !== objectId);
                    if (type === 'Label' && plot.labels) plot.labels = plot.labels.filter(l => l.id !== objectId);

                    if (wasSelected) {
                        draft.selectedObjectId = null;
                    }
                }
            }));
        },
        clearAllPlots: () => {
            set({ plots: [], selectedObjectId: null });
            get().actions.resetDrawing();
        },

        runAlgoMassingGenerator: (plotId) => {
            const { plots, generationParams } = get();
            const plot = plots.find(p => p.id === plotId);
            if (!plot || !plot.geometry) return;

            set({ isGeneratingAlgo: true });

            // Run the algorithm synchronously (it's fast enough)
            // But we wrap in a small timeout to let UI show loading state if needed
            setTimeout(() => {
                const params = get().generationParams;

                // Adjust defaults based on Land Use
                const state = get();
                const activeProject = state.projects.find(p => p.id === state.activeProjectId);
                const projectIntendedUse = activeProject?.intendedUse;

                let defaultWidth = 12; // Residential default
                if (projectIntendedUse === 'Commercial') defaultWidth = 18;
                if (projectIntendedUse === 'Industrial') defaultWidth = 25;

                const wingDepth = params.gridOrientation || defaultWidth;

                // --- APPLY ADMIN PANEL REGULATIONS ---
                const reg = plot.regulation;

                // 1. Setback: Use the larger of user param or regulation
                // If regulation exists, it acts as a minimum setback.
                const regSetback = reg?.geometry?.setback?.value;
                const effectiveSetback = regSetback !== undefined
                    ? Math.max(params.setback || 5, regSetback)
                    : (params.setback || plot.setback || 5);

                // 2. Max Height: Use the smaller of user param or regulation
                // If regulation exists, it acts as a maximum height.
                const regMaxHeight = reg?.geometry?.max_height?.value;
                const effectiveMaxHeight = regMaxHeight !== undefined
                    ? Math.min(params.maxHeight || 200, regMaxHeight)
                    : (params.maxHeight || 60);

                // 3. Max Coverage:
                const regMaxCoveragePct = reg?.geometry?.max_ground_coverage?.value;
                const effectiveMaxCoveragePct = regMaxCoveragePct !== undefined
                    ? Math.min(params.coverage || 0.5, regMaxCoveragePct / 100)
                    : (params.coverage || 0.5);

                // 4. Solar Requirement
                const regSolarRequired = (reg?.sustainability?.solar_panels?.value || 0) > 0;
                // If regulation requires solar, force add it to utilities if not already selected
                if (regSolarRequired) {
                    if (!params.selectedUtilities) params.selectedUtilities = [];
                    if (!params.selectedUtilities.includes('Solar') && !params.selectedUtilities.includes('HVAC')) {
                        // If HVAC is there, maybe Solar is integrated or separate? Let's add Solar.
                        // Actually 'Solar' is not in UtilityType enum in some contexts, but let's see.
                        // Assuming valid utility string. 'Solar' was used in my previous edit loop logic.
                        if (!params.selectedUtilities.includes('Solar')) {
                            params.selectedUtilities.push('Solar');
                        }
                    }
                }

                // 5. Rainwater Harvesting -> WTP/Water?
                const regRWH = (reg?.sustainability?.rainwater_harvesting?.value || 0) > 0;
                if (regRWH) {
                    if (!params.selectedUtilities) params.selectedUtilities = [];
                    if (!params.selectedUtilities.includes('Water')) { // Map RWH to Water/WTP
                        params.selectedUtilities.push('Water');
                    }
                }

                console.log(`[Generator] Applied Regulation: Setback=${effectiveSetback}m, MaxHeight=${effectiveMaxHeight}m, Coverage=${effectiveMaxCoveragePct * 100}%`);

                // Generate Setback Polygon
                const plotBoundary = plot.geometry;
                const innerSetback = turf.buffer(plotBoundary, -effectiveSetback, { units: 'meters' });

                let generatedBuildings: Feature<Polygon>[] = [];

                // Select generator
                switch (params.typology as any) {
                    case 'point': generatedBuildings = generatePointShapes(plot.geometry, { wingDepth: wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, unitMix: params.unitMix } as any); break;
                    case 'slab': generatedBuildings = generateSlabShapes(plot.geometry, { wingDepth: wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, unitMix: params.unitMix } as any); break;
                    case 'lshaped': generatedBuildings = generateLShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 30, wingLengthB: 30 }); break;
                    case 'ushaped': generatedBuildings = generateUShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 40, wingLengthB: 30 }); break;
                    case 'tshaped': generatedBuildings = generateTShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 30, wingLengthB: 40 }); break;
                    case 'hshaped': generatedBuildings = generateHShapes(plot.geometry, { wingDepth, orientation: params.gridOrientation ?? 0, setback: effectiveSetback, wingLengthA: 30, wingLengthB: 20 }); break;
                    case 'oshaped': generatedBuildings = generatePerimeter(plot.geometry, { ...params, width: wingDepth, setback: effectiveSetback } as any); break;
                    default: generatedBuildings = generateLamellas(plot.geometry, { ...params, setback: effectiveSetback } as any);
                }

                // Convert Features to Buildings
                const newBuildings = generatedBuildings.map((f, i) => {
                    const floorHeight = params.floorHeight || 3.5;
                    const minF = params.minFloors ?? 5;
                    let maxF = params.maxFloors ?? 12;

                    // Regulation check could go here
                    // Use params or plot limits

                    const floors = Math.floor(Math.random() * (maxF - minF + 1)) + minF;
                    const height = floors * floorHeight;

                    // Determine intended use from params
                    let intendedUse = BuildingIntendedUse.Residential;
                    if (params.landUse === 'commercial') intendedUse = BuildingIntendedUse.Commercial;
                    else if (params.landUse === 'institutional') intendedUse = BuildingIntendedUse.Public;
                    else if (params.landUse === 'mixed') intendedUse = BuildingIntendedUse.MixedUse;

                    const id = `bldg-algo-${Date.now()}-${i}`;
                    const opacity = getOpacityForBuildingType(intendedUse);

                    return {
                        id: id,
                        name: `Block ${i + 1}`,
                        isPolygonClosed: true,
                        geometry: f,
                        centroid: turf.centroid(f),
                        height: height,
                        opacity: opacity,
                        extrusion: true,
                        soilData: null,
                        intendedUse: intendedUse,
                        floors: Array.from({ length: floors }, (_, j) => ({
                            id: `floor-${id}-${j}`,
                            height: floorHeight,
                            color: generateFloorColors(floors, intendedUse)[j] || '#cccccc'
                        })),
                        area: turf.area(f),
                        numFloors: floors,
                        typicalFloorHeight: floorHeight,
                        visible: true,
                    } as Building;
                });

                // --- PARKING GENERATION ---
                if (params.parkingType && newBuildings.length > 0) {
                    newBuildings.forEach((b: Building) => {
                        const parkingArea = b.area || 500;
                        const capacityPerFloor = Math.floor((parkingArea * 0.75) / 12.5);

                        if (params.parkingType === 'ug') {
                            // Add Basements (Levels -1, -2)
                            b.floors.push({
                                id: `floor-${b.id}-b1`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -1,
                                parkingCapacity: capacityPerFloor
                            });
                            b.floors.push({
                                id: `floor-${b.id}-b2`,
                                height: 3.5,
                                color: '#505050',
                                type: 'Parking',
                                parkingType: ParkingType.Basement,
                                level: -2,
                                parkingCapacity: capacityPerFloor
                            });
                        } else if (params.parkingType === 'pod') {
                            // Add Stilt (Level 0)
                            b.floors.push({
                                id: `floor-${b.id}-stilt`,
                                height: 3.5,
                                color: '#999999',
                                type: 'Parking',
                                parkingType: ParkingType.Stilt,
                                level: 0,
                                parkingCapacity: capacityPerFloor
                            });
                            // Increase total height to account for stilt lifting the tower
                            b.height += 3.5;
                        }
                        // Surface parking not generated on buildings
                    });
                }

                // --- UTILITY LOGIC ---
                const newUtilityAreas: UtilityArea[] = [];

                // Debug: Check what we received
                console.log('[Utility Debug] params.selectedUtilities:', params.selectedUtilities);
                console.log('[Utility Debug] Is array?', Array.isArray(params.selectedUtilities));
                console.log('[Utility Debug] Length:', params.selectedUtilities?.length);

                if (params.selectedUtilities && params.selectedUtilities.length > 0) {
                    const selected = params.selectedUtilities;

                    // Classification: Internal (building-attached) vs External (plot zones)
                    // Utility generation disabled based on user feedback (utilities already exist or manual placement preferred)
                    const internalUtils: string[] = []; // selected.filter((u: string) => ['HVAC', 'Electrical'].includes(u));
                    const externalUtils: string[] = []; // selected.filter((u: string) => ['STP', 'WTP', 'Water', 'Fire', 'Gas', 'Roads'].includes(u));

                    // 1. Internal Utilities (Modify Buildings)
                    if (internalUtils.length > 0 && newBuildings.length > 0) {
                        newBuildings.forEach((b: Building) => {
                            b.utilities = [...internalUtils] as UtilityType[]; // Tag building

                            // Visual: Add HVAC Plant on Roof
                            if (internalUtils.includes('HVAC')) {
                                const hvacColor = UTILITY_COLORS[UtilityType.HVAC] || '#FFA500';
                                b.floors.push({
                                    id: `floor-${b.id}-hvac`,
                                    height: 2.5,
                                    color: hvacColor,
                                    type: 'Utility',
                                    utilityType: UtilityType.HVAC
                                });
                                b.numFloors += 1;
                                b.height += 2.5;
                            }

                            // Visual: Add Electrical/Water Basement "Service Plinth"
                            if (internalUtils.includes('Electrical')) {
                                const elecColor = UTILITY_COLORS[UtilityType.Electrical] || '#FFD700';
                                b.floors.unshift({
                                    id: `floor-${b.id}-elec`,
                                    height: 3,
                                    color: elecColor,
                                    type: 'Utility',
                                    utilityType: UtilityType.Electrical
                                });
                                b.numFloors += 1;
                                b.height += 3;
                                b.baseHeight = (b.baseHeight || 0);
                            }
                        });
                    }

                    // 2. External Utilities (Create Zones AND Buildings)
                    if (externalUtils.length > 0) {
                        try {
                            const plotBoundary = plot.geometry;
                            const innerSetback = turf.buffer(plotBoundary, -(plot.setback || 5), { units: 'meters' });

                            if (innerSetback) {
                                const bbox = turf.bbox(innerSetback);

                                // Define zone sizes and positions
                                const utilityConfig: Record<string, { size: number, position: 'sw' | 'se' | 'nw' | 'ne' | 'n' }> = {
                                    'STP': { size: 15, position: 'sw' },
                                    'WTP': { size: 15, position: 'se' },
                                    'Water': { size: 10, position: 'nw' },
                                    'Fire': { size: 10, position: 'ne' },
                                    'Gas': { size: 8, position: 'n' },
                                    'Roads': { size: 20, position: 'n' }
                                };

                                externalUtils.forEach((utilName: string) => {
                                    const config = utilityConfig[utilName];
                                    if (!config) return;

                                    const size = config.size;
                                    let originX, originY;

                                    // Position based on config
                                    switch (config.position) {
                                        case 'sw': // Southwest
                                            originX = bbox[0];
                                            originY = bbox[1];
                                            break;
                                        case 'se': // Southeast
                                            originX = bbox[2] - size;
                                            originY = bbox[1];
                                            break;
                                        case 'nw': // Northwest
                                            originX = bbox[0];
                                            originY = bbox[3] - size;
                                            break;
                                        case 'ne': // Northeast
                                            originX = bbox[2] - size;
                                            originY = bbox[3] - size;
                                            break;
                                        case 'n': // North-center
                                            originX = (bbox[0] + bbox[2]) / 2 - size / 2;
                                            originY = bbox[3] - size;
                                            break;
                                        default:
                                            originX = bbox[0];
                                            originY = bbox[1];
                                    }

                                    const poly = turf.bboxPolygon([originX, originY, originX + size, originY + size]);

                                    // Create 3D Building Block for visualization
                                    const height = utilName === 'Gas' || utilName === 'Roads' ? 0.5 : 4; // Road flat, Gas low
                                    const utilBldg: Building = {
                                        id: `bldg-util-${utilName}-${crypto.randomUUID()}`,
                                        name: `${utilName} ${utilName === 'Roads' ? 'Infrastructure' : 'Block'}`,
                                        isPolygonClosed: true,
                                        geometry: poly.geometry as Feature<Polygon>,
                                        centroid: turf.centroid(poly),
                                        height: height,
                                        opacity: 1,
                                        extrusion: true,
                                        soilData: null,
                                        intendedUse: BuildingIntendedUse.Industrial,
                                        floors: [{
                                            id: `floor-util-${utilName}-${crypto.randomUUID()}`,
                                            height: height,
                                            color: utilName === 'STP' ? '#708090' : utilName === 'WTP' ? '#4682B4' : utilName === 'Roads' ? '#333333' : '#FFD700',
                                            type: 'Utility',
                                            utilityType: utilName as any
                                        }],
                                        area: size * size,
                                        numFloors: 1,
                                        typicalFloorHeight: height,
                                        visible: true
                                    };
                                    newBuildings.push(utilBldg);

                                    // Create Zone for KPI
                                    newUtilityAreas.push({
                                        id: `util-${crypto.randomUUID()}`,
                                        name: `${utilName} Zone`,
                                        type: utilName as UtilityType,
                                        geometry: poly.geometry as Feature<Polygon>,
                                        centroid: turf.centroid(poly),
                                        area: size * size,
                                        visible: true
                                    });
                                });
                            }
                        } catch (e) {
                            console.warn("Failed to generate external utility placement", e);
                        }
                    }
                }

                // Debug logging
                console.log('[Utility Debug] Generated utility areas:', newUtilityAreas.length);
                newUtilityAreas.forEach(u => console.log(`  - ${u.name} (${u.type}) at position`, u.centroid.geometry.coordinates));

                // Update State
                set(produce((draft: BuildingState) => {
                    const activePlot = draft.plots.find((p: Plot) => p.id === plotId);
                    if (activePlot) {
                        activePlot.buildings = newBuildings;
                        activePlot.utilityAreas = newUtilityAreas;

                        // Clear others
                        activePlot.greenAreas = [];
                        activePlot.parkingAreas = [];

                        // --- VASTU COMPLIANCE CHECK ---
                        // Only if project requires it
                        const state = get();
                        const activeProject = state.projects.find(p => p.id === state.activeProjectId);

                        if (activeProject?.vastuCompliant) {
                            // Import utility dynamically or assume available at top.
                            // For this logical block, we assume calculateVastuScore is selectable.
                            // Since we can't add imports with this tool easily in one go if top is far, 
                            // we rely on the user to fix import or we do it in next step. 
                            // Actually, I should have added the import first. 
                            // Let's assume I'll add the import in a separate call or this will fail compilation.
                            // Wait, I can't add import here safely without finding line 1.
                            // I will add the logic here and then add import.

                            // NOTE: regulation object is needed. 
                            // In this scope 'plot' is available but let's re-fetch from ID or use 'activePlot'.
                            // The 'plot' var from line 1689 is stale inside this timeout callback? 
                            // No, 'plot' is closure, but 'draft' is fresh.
                            // Let's try to get Vastu regulation.
                            const vastuReg = draft.vastuRegulations?.[0]; // Simplification: Use first available or selected

                            // We need to implement a way to select Vastu reg. For now, grab the first one.
                            if (activePlot && vastuReg) {
                                // We need a helper to run this inside produce, or run it outside.
                                // It's better to run pure logic outside. But we are inside produce.
                                // We'll assume the function is pure and imported.
                                const result = calculateVastuScore(activePlot as any, newBuildings, vastuReg); // Cast to avoid Immer Draft issues

                                if (!activePlot.developmentStats) {
                                    activePlot.developmentStats = calculateDevelopmentStats(activePlot as any, activePlot.buildings, DEFAULT_FEASIBILITY_PARAMS);
                                }
                                activePlot.developmentStats.vastuScore = {
                                    overall: result.overallScore,
                                    rating: result.rating,
                                    breakdown: result.breakdown
                                };
                            }
                        }
                    }
                    draft.isGeneratingAlgo = false;
                }));

                toast({ title: 'Generated Layout', description: `Created ${newBuildings.length} blocks.` });

            }, 50);
        },


        runAiLayoutGenerator: async (plotId: string, prompt: string) => {
            set({ isGeneratingAi: true });
            try {
                const { plots, actions } = get();
                const plot = plots.find(p => p.id === plotId);
                if (!plot) {
                    throw new Error('Selected plot not found.');
                }

                const regulation = plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType);
                let userDefinedAreas = [
                    ...plot.buildableAreas.map(a => ({ ...a, intendedUse: a.intendedUse })),
                    ...plot.greenAreas.map(a => ({ ...a, intendedUse: 'GreenArea' })),
                    ...plot.parkingAreas.map(a => ({ ...a, intendedUse: 'ParkingArea' })),
                    ...plot.utilityAreas.map(a => ({ ...a, intendedUse: 'UtilityArea' })),
                ];

                // Determine auto-generation rules for Utilities
                let augmentedPrompt = prompt;
                if (plot.area > 5000) {
                    augmentedPrompt += " Please also allocate specific utility zones for STP (Sewage Treatment Plant) and WTP (Water Treatment Plant) as separate UtilityAreas.";
                }

                // If no zones exist, run the first step to generate them
                if (userDefinedAreas.length === 0) {
                    toast({ title: 'No zones found.', description: 'AI will generate zones first, then place buildings.' });

                    // Clear previous AI zones to avoid accumulation
                    set(produce((draft: BuildingState) => {
                        const p = draft.plots.find(plot => plot.id === plotId);
                        if (p) {
                            p.greenAreas = p.greenAreas.filter(g => !g.id.startsWith('ai-zone-'));
                            p.parkingAreas = p.parkingAreas.filter(pa => !pa.id.startsWith('ai-zone-'));
                            p.buildableAreas = p.buildableAreas.filter(ba => !ba.id.startsWith('ai-zone-'));
                            p.utilityAreas = p.utilityAreas.filter(ua => !ua.id.startsWith('ai-zone-'));
                        }
                    }));

                    const zoneResult: GenerateZonesOutput = await generateLayoutZones({
                        plotGeometry: JSON.stringify(plot.geometry),
                        prompt: augmentedPrompt,
                        regulations: regulation ? JSON.stringify(regulation) : "No regulations specified."
                    });

                    if (!zoneResult.zones || zoneResult.zones.length === 0) {
                        throw new Error('AI failed to generate any layout zones.');
                    }

                    // Create geometries for the generated zones and update state
                    const plotFeat = plot.geometry;
                    const setbackPoly = turf.buffer(plot.geometry, -(plot.setback ?? 0), { units: 'meters' });

                    const geometries = splitPolygon(setbackPoly as any, zoneResult.zones.length);

                    zoneResult.zones.forEach((zone: AiZone, index: number) => {
                        const id = `ai-zone-${Date.now()}-${index}`;
                        const geometry = geometries[index];
                        const centroid = turf.centroid(geometry);
                        const area = turf.area(geometry);
                        const visible = true;

                        const newArea = { id, name: zone.name, geometry, centroid, area, visible };

                        if (zone.type === 'GreenArea') {
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.greenAreas.push(newArea); }));
                        } else if (zone.type === 'ParkingArea') {
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.parkingAreas.push(newArea); }));
                        } else if (zone.type === 'BuildableArea') {
                            const buildableArea: BuildableArea = { ...newArea, intendedUse: zone.intendedUse ?? BuildingIntendedUse.Residential };
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.buildableAreas.push(buildableArea); }));
                        } else if (zone.type === 'UtilityArea') {
                            const utilityArea: UtilityArea = { ...newArea, type: zone.utilityType || UtilityType.STP };
                            set(produce((draft: BuildingState) => { draft.plots.find(p => p.id === plot.id)?.utilityAreas.push(utilityArea); }));
                        }
                    });

                    // Refresh the userDefinedAreas to include the newly generated ones for the next step
                    const updatedPlot = get().plots.find(p => p.id === plotId);
                    userDefinedAreas = [
                        ...(updatedPlot?.buildableAreas.map(a => ({ ...a, intendedUse: a.intendedUse })) ?? []),
                        ...(updatedPlot?.greenAreas.map(a => ({ ...a, intendedUse: 'GreenArea' })) ?? []),
                        ...(updatedPlot?.parkingAreas.map(a => ({ ...a, intendedUse: 'ParkingArea' })) ?? []),
                        ...(updatedPlot?.utilityAreas.map(a => ({ ...a, intendedUse: 'UtilityArea' })) ?? []),
                    ];

                    if (userDefinedAreas.length === 0) {
                        throw new Error("Zone generation resulted in no usable areas.");
                    }
                }

                const serializableUserAreas = userDefinedAreas.map(({ id, name, geometry, area, intendedUse }) => ({ id, name, geometry, area, intendedUse }));

                // Step 2: Generate site layout using the (potentially new) zones
                const result: GenerateSiteLayoutOutput = await generateSiteLayout({
                    plotGeometry: JSON.stringify(plot.geometry),
                    userDefinedAreas: JSON.stringify(serializableUserAreas),
                    prompt: prompt,
                    regulations: regulation ? JSON.stringify(regulation) : "No regulations specified."
                });
                set({ aiScenarios: result.scenarios });

            } catch (error) {
                console.error("AI layout generation failed:", error);
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
                toast({ variant: 'destructive', title: 'AI Generation Failed', description: errorMessage });
            } finally {
                set({ isGeneratingAi: false });
            }
        },
        runAiMassingGenerator: async (plotId: string) => {
            set({ isGeneratingAi: true });
            const { plots, selectedObjectId } = get();
            const plot = plots.find(p => p.id === plotId);

            if (!plot) {
                toast({ variant: 'destructive', title: 'Error', description: 'A plot must be selected.' });
                set({ isGeneratingAi: false });
                return;
            }

            let targetArea: { name: string, area: number, geometry: any, setback?: number } = {
                name: plot.name,
                area: plot.area,
                geometry: plot.geometry,
                setback: plot.setback,
            };

            if (selectedObjectId?.type === 'BuildableArea') {
                const buildableArea = plot.buildableAreas.find(ba => ba.id === selectedObjectId.id);
                if (buildableArea) {
                    targetArea = {
                        name: buildableArea.name,
                        area: buildableArea.area,
                        geometry: buildableArea.geometry,
                        // No setback for a specific buildable area, as it's already defined
                    };
                }
            }

            const regulation = plot.regulation;
            if (!regulation) {
                toast({ variant: 'destructive', title: 'Regulation Error', description: 'No active regulation set for this plot. Cannot generate massing.' });
                set({ isGeneratingAi: false });
                return;
            }

            try {
                const input: GenerateMassingInput = {
                    plot: JSON.stringify(targetArea),
                    regulations: JSON.stringify(regulation),
                };
                const result = await generateMassingOptions(input);
                set({ aiScenarios: result.scenarios });
            } catch (error) {
                console.error("AI massing generation failed:", error);
                const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
                toast({ variant: 'destructive', title: 'AI Generation Failed', description: errorMessage });
            } finally {
                set({ isGeneratingAi: false });
            }
        },
        applyAiLayout: (plotId, scenario) => {
            const { projects, activeProjectId } = get();
            const project = projects.find(p => p.id === activeProjectId);
            if (!project) return;

            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find((p: Plot) => p.id === plotId);
                if (!plot) return;

                const originalUserAreas = [
                    ...plot.buildableAreas,
                    ...plot.greenAreas,
                    ...plot.parkingAreas,
                ];

                // Clear previously AI-generated items from this plot
                plot.buildings = plot.buildings.filter(b => !b.id.startsWith('ai-gen-'));
                plot.greenAreas = plot.greenAreas.filter(g => !g.id.startsWith('ai-gen-'));
                plot.parkingAreas = plot.parkingAreas.filter(p => !p.id.startsWith('ai-gen-'));
                plot.utilityAreas = plot.utilityAreas.filter(u => !u.id.startsWith('ai-gen-') && !u.id.startsWith('ai-zone-'));

                scenario.objects.forEach((aiObj, aiIndex) => {
                    const aiMassingObject = aiObj as AiMassingGeneratedObject;

                    let containerGeometry: Feature<Polygon> | null = null;

                    const placementTargetZone = originalUserAreas.find(ua => ua.name === aiMassingObject.placement);

                    if (placementTargetZone) {
                        containerGeometry = placementTargetZone.geometry;
                    } else if (aiMassingObject.placement === plot.name) {
                        const buffered = turf.buffer(plot.geometry, -plot.setback, { units: 'meters' as const });
                        if (buffered) containerGeometry = buffered as Feature<Polygon>;
                        else containerGeometry = plot.geometry;
                    }

                    if (!containerGeometry) {
                        console.warn(`Could not find placement target "${aiMassingObject.placement}" for AI object "${aiMassingObject.name}". Skipping.`);
                        return;
                    }

                    const buildingsInZone = scenario.objects.filter(o =>
                        (o as AiMassingGeneratedObject).placement === aiMassingObject.placement && o.type === 'Building'
                    );
                    const isMultiBuildingZone = buildingsInZone.length > 1;

                    let finalGeometry: Feature<Polygon>;
                    if (aiObj.type === 'Building' && isMultiBuildingZone) {
                        const geometries = splitPolygon(containerGeometry, buildingsInZone.length);
                        const buildingIndexInZone = buildingsInZone.findIndex(b => (b as AiMassingGeneratedObject).name === aiMassingObject.name);
                        finalGeometry = geometries[buildingIndexInZone] || containerGeometry;
                    } else {
                        finalGeometry = containerGeometry;
                    }

                    if (!finalGeometry) return;

                    const centroid = turf.centroid(finalGeometry);
                    const area = turf.area(finalGeometry);

                    // Validate centroid and area are valid
                    if (!centroid?.geometry?.coordinates ||
                        !Number.isFinite(centroid.geometry.coordinates[0]) ||
                        !Number.isFinite(centroid.geometry.coordinates[1]) ||
                        !Number.isFinite(area) || area <= 0) {
                        console.warn(`Skipping AI object "${aiMassingObject.name}": Invalid centroid or area`, { centroid, area });
                        return;
                    }

                    // Validate geometry coordinates
                    const coords = finalGeometry.geometry.coordinates[0];
                    if (!coords || coords.length < 3) {
                        console.warn(`Skipping AI object "${aiMassingObject.name}": Invalid geometry coordinates`);
                        return;
                    }

                    const hasInvalidCoords = coords.some((coord: any) =>
                        !Array.isArray(coord) || coord.length < 2 ||
                        !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])
                    );

                    if (hasInvalidCoords) {
                        console.warn(`Skipping AI object "${aiMassingObject.name}": Geometry contains NaN or invalid coordinates`);
                        return;
                    }

                    const id = `ai-gen-${Date.now()}-${aiIndex}`;

                    if (aiObj.type === 'Building') {
                        const numFloors = aiMassingObject.numFloors ?? 10;
                        const typicalFloorHeight = 3.5;
                        const massing = aiMassingObject.massing || 'Simple';

                        if (massing === 'PodiumTower' && numFloors > 5) {
                            // Create Podium
                            const podiumFloors = 3;
                            const podiumHeight = podiumFloors * typicalFloorHeight;
                            const podiumId = `${id}-podium`;

                            const podiumBuilding: Building = {
                                id: podiumId,
                                name: `${aiMassingObject.name} (Podium)`,
                                geometry: finalGeometry,
                                centroid,
                                area,
                                isPolygonClosed: true,
                                height: podiumHeight,
                                opacity: getOpacityForBuildingType(aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential),
                                extrusion: true,
                                soilData: { ph: null, bd: null },
                                intendedUse: aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential,
                                floors: Array.from({ length: podiumFloors }, (_, i) => ({
                                    id: `floor-${podiumId}-${i}`,
                                    height: typicalFloorHeight,
                                    color: generateFloorColors(numFloors, aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential)[i] // Use same color palette
                                })),
                                numFloors: podiumFloors,
                                typicalFloorHeight,
                                visible: true,
                                baseHeight: 0,
                            };
                            plot.buildings.push(podiumBuilding);

                            // Create Tower
                            const towerFloors = numFloors - podiumFloors;
                            const towerHeight = towerFloors * typicalFloorHeight;
                            const towerId = `${id}-tower`;

                            let towerGeometry = finalGeometry;
                            let towerBufferSucceeded = false;

                            // Try to create a smaller tower footprint (inset from podium)
                            try {
                                // Use -3 meters buffer for more reliable results
                                const buffered = turf.buffer(finalGeometry, -3, { units: 'meters' });
                                if (buffered && buffered.geometry && buffered.geometry.type === 'Polygon') {
                                    const testCentroid = turf.centroid(buffered);
                                    const testArea = turf.area(buffered);

                                    // Only use buffered geometry if it's valid and at least 40% of original area
                                    if (testCentroid?.geometry?.coordinates &&
                                        Number.isFinite(testCentroid.geometry.coordinates[0]) &&
                                        Number.isFinite(testCentroid.geometry.coordinates[1]) &&
                                        Number.isFinite(testArea) &&
                                        testArea > 0 &&
                                        testArea >= area * 0.4) {
                                        towerGeometry = buffered as Feature<Polygon>;
                                        towerBufferSucceeded = true;
                                    }
                                }
                            } catch (e) {
                                console.warn("Failed to create tower buffer", e);
                            }

                            // If buffer failed, try a percentage-based shrink
                            if (!towerBufferSucceeded) {
                                try {
                                    // Shrink the polygon by 30% from centroid for more visible difference
                                    const podiumCentroid = turf.centroid(finalGeometry);
                                    const podiumCenter = podiumCentroid.geometry.coordinates;
                                    const coords = finalGeometry.geometry.coordinates[0];

                                    const shrunkCoords = coords.map((coord: any) => {
                                        const dx = coord[0] - podiumCenter[0];
                                        const dy = coord[1] - podiumCenter[1];
                                        return [
                                            podiumCenter[0] + dx * 0.7, // 70% of distance from center (30% shrink)
                                            podiumCenter[1] + dy * 0.7
                                        ];
                                    });

                                    towerGeometry = {
                                        type: 'Feature',
                                        properties: {},
                                        geometry: {
                                            type: 'Polygon',
                                            coordinates: [shrunkCoords]
                                        }
                                    } as Feature<Polygon>;
                                    console.log(`Used percentage-based shrink for tower "${aiMassingObject.name}"`);
                                } catch (e) {
                                    console.warn(`Failed to shrink tower geometry for "${aiMassingObject.name}", using podium geometry`, e);
                                    towerGeometry = finalGeometry; // Last resort fallback
                                }
                            }

                            const towerBuilding: Building = {
                                id: towerId,
                                name: `${aiMassingObject.name} (Tower)`,
                                geometry: towerGeometry,
                                centroid: turf.centroid(towerGeometry),
                                area: turf.area(towerGeometry),
                                isPolygonClosed: true,
                                height: towerHeight,
                                opacity: getOpacityForBuildingType(aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential),
                                extrusion: true,
                                soilData: { ph: null, bd: null },
                                intendedUse: aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential,
                                floors: Array.from({ length: towerFloors }, (_, i) => ({
                                    id: `floor-${towerId}-${i}`,
                                    height: typicalFloorHeight,
                                    color: generateFloorColors(numFloors, aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential)[i + podiumFloors]
                                })),
                                numFloors: towerFloors,
                                typicalFloorHeight,
                                visible: true,
                                baseHeight: podiumHeight,
                            };
                            plot.buildings.push(towerBuilding);

                        } else {
                            // Simple Massing
                            const newBuilding: Building = {
                                id, name: aiMassingObject.name, geometry: finalGeometry, centroid, area,
                                isPolygonClosed: true,
                                height: numFloors * typicalFloorHeight,
                                opacity: getOpacityForBuildingType(aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential),
                                extrusion: true,
                                soilData: { ph: null, bd: null },
                                intendedUse: aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential,
                                floors: Array.from({ length: numFloors }, (_, i) => ({
                                    id: `floor-${id}-${i}`,
                                    height: typicalFloorHeight,
                                    color: generateFloorColors(numFloors, aiMassingObject.intendedUse ?? BuildingIntendedUse.Residential)[i]
                                })),
                                numFloors, typicalFloorHeight, visible: true,
                                baseHeight: 0,
                            };
                            plot.buildings.push(newBuilding);
                        }

                    } else if (aiObj.type === 'GreenArea') {
                        plot.greenAreas.push({ id, name: (aiObj as any).name, geometry: finalGeometry, centroid, area, visible: true });
                    } else if (aiObj.type === 'ParkingArea') {
                        plot.parkingAreas.push({ id, name: (aiObj as any).name, geometry: finalGeometry, centroid, area, visible: true });
                    }
                });
            }));
            get().actions.clearAiScenarios();
        },
        clearAiScenarios: () => {
            set({ aiScenarios: null });
        },
        setHoveredObject: (id, type) => {
            if (!id || !type) {
                set({ hoveredObjectId: null });
            } else {
                set({ hoveredObjectId: { id, type } });
            }
        },
        toggleObjectVisibility: (plotId, objectId, type) => {
            set(produce((draft: BuildingState) => {
                const plot = draft.plots.find(p => p.id === plotId);
                if (!plot) return;

                let targetObject: any;

                if (type === 'Plot' && plot.id === objectId) {
                    targetObject = plot;
                } else {
                    const allObjects = [
                        ...plot.buildings,
                        ...plot.greenAreas,
                        ...plot.parkingAreas,
                        ...plot.buildableAreas
                    ];
                    targetObject = allObjects.find(obj => obj.id === objectId);
                }

                if (targetObject) {
                    targetObject.visible = !targetObject.visible;
                }
            }));
        },
    },
}));

const useBuildingStore = useBuildingStoreWithoutUndo;

const useSelectedBuilding = () => {
    const { plots, selectedObjectId } = useBuildingStore();
    if (selectedObjectId?.type !== 'Building') return null;

    for (const plot of plots) {
        const building = plot.buildings.find(b => b.id === selectedObjectId.id);
        if (building) return building;
    }
    return null;
};

const useSelectedPlot = () => {
    const { plots, selectedObjectId } = useBuildingStore();
    if (!selectedObjectId) {
        if (plots.length > 0) {
            const plot = plots[0];
            return {
                ...plot,
                regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
            };
        }
        return null;
    }

    if (selectedObjectId.type === 'Plot') {
        const plot = plots.find(p => p.id === selectedObjectId.id);
        if (plot) {
            return {
                ...plot,
                regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
            };
        }
        return null;
    }

    for (const plot of plots) {
        const objectExists = [
            ...plot.buildings,
            ...plot.greenAreas,
            ...plot.parkingAreas,
            ...plot.buildableAreas,
        ].some(obj => obj.id === selectedObjectId.id);

        if (objectExists) {
            return {
                ...plot,
                regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
            };
        }
    }

    if (plots.length > 0) {
        const plot = plots[0];
        return {
            ...plot,
            regulation: plot.availableRegulations?.find(r => r.type === plot.selectedRegulationType) || plot.regulation || null
        };
    }

    return null;
};


const useProjectData = () => {
    const { projects, activeProjectId, plots } = useBuildingStore();
    const selectedPlot = useSelectedPlot();

    return useMemo(() => {
        const project = projects.find(p => p.id === activeProjectId);

        const consumedPlotArea = plots.reduce((acc, p) => acc + p.area, 0);

        const far = selectedPlot?.regulation?.geometry?.floor_area_ratio?.value ?? 1.8;

        if (!project) {
            return {
                id: 'temp-no-project',
                userId: 'guest',
                name: 'No Project',
                totalPlotArea: 0,
                far: far,
                totalBuildableArea: 0,
                consumedBuildableArea: 0,
                consumedPlotArea: consumedPlotArea,
                intendedUse: 'Residential' as BuildingIntendedUse,
                location: 'Delhi',
                greenCertification: [],
                vastuCompliant: false,
                plots: [],
                lastModified: new Date().toISOString()
            };
        }

        const totalBuildableArea = (project.totalPlotArea ?? consumedPlotArea) * far;
        const consumedBuildableArea = plots
            .flatMap(p => p.buildings)
            .reduce((acc, b) => acc + b.area * b.floors.length, 0);

        return {
            ...project,
            plots, // Explicitly include active plots
            far,
            totalBuildableArea,
            consumedBuildableArea,
            consumedPlotArea: project.totalPlotArea ?? consumedPlotArea,
        };
    }, [projects, activeProjectId, plots, selectedPlot]);
}

export { useBuildingStore, useSelectedBuilding, useProjectData, useSelectedPlot };


