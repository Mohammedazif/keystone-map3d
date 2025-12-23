
'use client';

import { create } from 'zustand';
import type { Feature, Polygon, Point } from '@turf/turf';
import * as turf from '@turf/turf';
import { BuildingIntendedUse, type Plot, type Building, type GreenArea, type ParkingArea, type Floor, type Project, type BuildableArea, type SelectableObjectType, AiScenario, type Label, RegulationData, GenerateMassingInput, AiMassingScenario, GenerateMassingOutput, GenerateSiteLayoutInput, GenerateSiteLayoutOutput, AiSiteLayout, AiMassingGeneratedObject, AiZone, GenerateZonesOutput } from '@/lib/types';
import { produce } from 'immer';
import { toast } from './use-toast';
import { useMemo } from 'react';
import { generateSiteLayout } from '@/ai/flows/ai-site-layout-generator';
import { generateMassingOptions } from '@/ai/flows/ai-massing-generator';
import { generateLayoutZones } from '@/ai/flows/ai-zone-generator';
import { splitPolygon } from '@/lib/polygon-utils';
import { db } from '@/lib/firebase';
import { collection, doc, getDocs, setDoc, deleteDoc, writeBatch, getDoc, query, where } from 'firebase/firestore';
import useAuthStore from './use-auth-store';

export type DrawingObjectType = 'Plot' | 'Zone' | 'Building';

type ZoneType = 'BuildableArea' | 'GreenArea' | 'ParkingArea';

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
    aiScenarios: (AiMassingScenario | AiSiteLayout)[] | null;
    isLoading: boolean;
    isSaving: boolean;
    isGeneratingAi: boolean;
    mapLocation: string | null;
    actions: {
        setMapLocation: (location: string | null) => void;
        loadProjects: () => Promise<void>;
        createProject: (name: string, totalPlotArea?: number) => Promise<Project | null>;
        deleteProject: (projectId: string) => Promise<void>;
        loadProject: (projectId: string) => Promise<void>;
        saveCurrentProject: () => Promise<void>;
        startDrawing: (objectType: DrawingObjectType, activePlotId?: string | null) => void;
        addDrawingPoint: (point: [number, number]) => void;
        finishDrawing: (geometry: Feature<Polygon | Point>) => boolean;
        defineZone: (name: string, type: ZoneType, intendedUse?: BuildingIntendedUse) => void;
        cancelDefineZone: () => void;
        selectObject: (id: string | null, type: SelectableObjectType | null) => void;
        updateBuilding: (buildingId: string, props: Partial<Omit<Building, 'id' | 'floors'>>) => void;
        updatePlot: (plotId: string, props: Partial<Omit<Plot, 'id'>>) => void;
        updateObject: (objectId: string, objectType: SelectableObjectType, props: Partial<any>) => void;
        deletePlot: (id: string) => void;
        deleteObject: (plotId: string, objectId: string, type: 'Building' | 'GreenArea' | 'ParkingArea' | 'BuildableArea' | 'Label') => void;
        resetDrawing: () => void;
        undoLastPoint: () => void;
        clearAllPlots: () => void;
        runAiLayoutGenerator: (plotId: string, prompt: string) => Promise<void>;
        runAiMassingGenerator: (plotId: string) => Promise<void>;
        applyAiLayout: (plotId: string, scenario: AiMassingScenario | AiSiteLayout) => void;
        clearAiScenarios: () => void;
        setHoveredObject: (id: string | null, type: SelectableObjectType | null) => void;
        toggleObjectVisibility: (plotId: string, objectId: string, type: SelectableObjectType) => void;
        undo: () => void;
        redo: () => void;
    };
}

// Helper to convert HSL to RGB string
const hslToRgb = (h: number, s: number, l: number): string => {
    s /= 100;
    l /= 100;
    const k = (n: number) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    const r = Math.round(255 * f(0));
    const g = Math.round(255 * f(8));
    const b = Math.round(255 * f(4));
    return `rgb(${r}, ${g}, ${b})`;
};

// Material palettes for different building types
const BUILDING_MATERIALS = {
    [BuildingIntendedUse.Residential]: {
        baseHue: 30, // Warm beige/tan
        saturation: 25,
        baseLightness: 70,
    },
    [BuildingIntendedUse.Commercial]: {
        baseHue: 210, // Glass blue
        saturation: 45,
        baseLightness: 65,
    },
    [BuildingIntendedUse.MixedUse]: {
        baseHue: 200, // Steel blue-gray
        saturation: 20,
        baseLightness: 60,
    },
    [BuildingIntendedUse.Industrial]: {
        baseHue: 0, // Concrete gray
        saturation: 5,
        baseLightness: 55,
    },
    [BuildingIntendedUse.Public]: {
        baseHue: 45, // Stone/sandstone
        saturation: 30,
        baseLightness: 65,
    },
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
const prepareForFirestore = (plots: Plot[]): any[] => {
    return plots.map(plot => ({
        ...plot,
        geometry: JSON.stringify(plot.geometry),
        centroid: JSON.stringify(plot.centroid),
        buildings: plot.buildings.map(b => ({
            ...b,
            geometry: JSON.stringify(b.geometry),
            centroid: JSON.stringify(b.centroid),
        })),
        greenAreas: plot.greenAreas.map(g => ({
            ...g,
            geometry: JSON.stringify(g.geometry),
            centroid: JSON.stringify(g.centroid),
        })),
        parkingAreas: plot.parkingAreas.map(p => ({
            ...p,
            geometry: JSON.stringify(p.geometry),
            centroid: JSON.stringify(p.centroid),
        })),
        buildableAreas: plot.buildableAreas.map(b => ({
            ...b,
            geometry: JSON.stringify(b.geometry),
            centroid: JSON.stringify(b.centroid),
        })),
    }));
};

// Helper to parse geometry from Firestore
const parseFromFirestore = (plots: any[]): Plot[] => {
    if (!plots || !Array.isArray(plots)) return [];
    return plots.map(plot => {
        try {
            return {
                ...plot,
                isHeatAnalysisActive: plot.isHeatAnalysisActive ?? false,
                geometry: plot.geometry ? JSON.parse(plot.geometry) : null,
                centroid: plot.centroid ? JSON.parse(plot.centroid) : null,
                buildings: (plot.buildings || []).map((b: any) => ({
                    ...b,
                    geometry: b.geometry ? JSON.parse(b.geometry) : null,
                    centroid: b.centroid ? JSON.parse(b.centroid) : null,
                })),
                greenAreas: (plot.greenAreas || []).map((g: any) => ({
                    ...g,
                    geometry: g.geometry ? JSON.parse(g.geometry) : null,
                    centroid: g.centroid ? JSON.parse(g.centroid) : null,
                })),
                parkingAreas: (plot.parkingAreas || []).map((p: any) => ({
                    ...p,
                    geometry: p.geometry ? JSON.parse(p.geometry) : null,
                    centroid: p.centroid ? JSON.parse(p.centroid) : null,
                })),
                buildableAreas: (plot.buildableAreas || []).map((b: any) => ({
                    ...b,
                    geometry: b.geometry ? JSON.parse(b.geometry) : null,
                    centroid: b.centroid ? JSON.parse(b.centroid) : null,
                })),
            };
        } catch (e) {
            console.error("Failed to parse plot from firestore", plot, e);
            return { ...plot, geometry: null, centroid: null, buildings: [], greenAreas: [], parkingAreas: [], buildableAreas: [] };
        }
    }).filter(p => p.geometry); // Filter out plots that failed to parse
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

    const firstRegulation = fetchedRegulations.length > 0 ? fetchedRegulations[0] : null;

    useBuildingStore.setState(produce((draft: BuildingState) => {
        const plotToUpdate = draft.plots.find(p => p.id === plotId);
        if (plotToUpdate) {
            plotToUpdate.location = locationName;
            plotToUpdate.availableRegulations = fetchedRegulations;
            plotToUpdate.selectedRegulationType = firstRegulation?.type || null;
            plotToUpdate.regulation = firstRegulation;
            plotToUpdate.setback = firstRegulation?.geometry?.setback?.value ?? 4;
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
    aiScenarios: null,
    isLoading: true,
    isSaving: false,
    isGeneratingAi: false,
    mapLocation: null,
    actions: {
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
        createProject: async (name, totalPlotArea) => {
            const userId = useAuthStore.getState().user?.uid;
            if (!userId) {
                toast({ variant: 'destructive', title: 'Not Signed In', description: 'You must be signed in to create a project.' });
                return null;
            }

            const newProject: Project = {
                id: `proj-${Date.now()}`,
                name,
                plots: [],
                lastModified: new Date().toISOString(),
                totalPlotArea: totalPlotArea ?? null,
            };

            try {
                console.log(`[createProject] Attempting to create project for user: ${userId}`);
                const projectRef = doc(db, 'users', userId, 'projects', newProject.id);
                console.log(`[createProject] Writing to path: ${projectRef.path}`);
                // No need to stringify here since plots is an empty array
                await setDoc(projectRef, newProject);
                set(produce(draft => {
                    draft.projects.push(newProject);
                }));
                return newProject;
            } catch (error) {
                console.error("Error creating project in Firestore:", error);
                toast({ variant: 'destructive', title: 'Error', description: 'Could not create project.' });
                return null;
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

                    set(produce((draft: BuildingState) => {
                        const existingIndex = draft.projects.findIndex(p => p.id === projectId);
                        if (existingIndex !== -1) {
                            draft.projects[existingIndex] = project;
                        } else {
                            draft.projects.push(project);
                        }
                        draft.plots = project.plots || [];
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
            const { activeProjectId, plots, projects } = get();
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
                lastModified: new Date().toISOString(),
            }

            try {
                const projectRef = doc(db, 'users', userId, 'projects', activeProjectId);
                await setDoc(projectRef, updatedProject);
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
                        buildings: [], greenAreas: [], parkingAreas: [], buildableAreas: [], labels: [],
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
                        const parentPlot = plots.find(p => turf.booleanContains(p.geometry, polygonGeometry));
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
                    set(produce(draft => {
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
                        const parentPlot = plots.find(p => turf.booleanContains(p.geometry, polygonGeometry));
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
                    set(produce(draft => {
                        const plot = draft.plots.find(p => p.id === currentPlotId);
                        if (plot) {
                            const project = projects.find(p => p.id === activeProjectId);
                            const id = `bldg-${Date.now()}`;
                            const area = turf.area(polygonGeometry);
                            const numFloors = 5;
                            const typicalFloorHeight = 3;

                            const parentBuildableArea = plot.buildableAreas.find(ba => turf.booleanContains(ba.geometry, polygonGeometry));
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
        defineZone: (name, type, intendedUse) => {
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

            set({ selectedObjectId: { id, type } });
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
                            building.floors = Array.from({ length: newNumFloors }, (_, i) => ({
                                id: building.floors[i]?.id || `floor-${Date.now()}-${i}`,
                                height: newTypicalHeight,
                                color: colors[i]
                            }));
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
                            if (pa) { Object.assign(pa, props); objectFound = true; }
                            break;
                        case 'BuildableArea':
                            const ba = plot.buildableAreas.find(o => o.id === objectId);
                            if (ba) { Object.assign(ba, props); objectFound = true; }
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
                    if (type === 'ParkingArea') plot.parkingAreas = plot.parkingAreas.filter(p => p.id !== objectId);
                    if (type === 'BuildableArea') plot.buildableAreas = plot.buildableAreas.filter(b => b.id !== objectId);
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
                ];

                // If no zones exist, run the first step to generate them
                if (userDefinedAreas.length === 0) {
                    toast({ title: 'No zones found.', description: 'AI will generate zones first, then place buildings.' });

                    const zoneResult: GenerateZonesOutput = await generateLayoutZones({
                        plotGeometry: JSON.stringify(plot.geometry),
                        prompt: prompt,
                        regulations: regulation ? JSON.stringify(regulation) : "No regulations specified."
                    });

                    if (!zoneResult.zones || zoneResult.zones.length === 0) {
                        throw new Error('AI failed to generate any layout zones.');
                    }

                    // Create geometries for the generated zones and update state
                    const plotFeat = turf.feature(plot.geometry.geometry);
                    const setbackPoly = turf.buffer(plotFeat, -(plot.setback ?? 0), { units: 'meters' });

                    const geometries = splitPolygon(setbackPoly as Feature<Polygon>, zoneResult.zones.length);

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
                        }
                    });

                    // Refresh the userDefinedAreas to include the newly generated ones for the next step
                    const updatedPlot = get().plots.find(p => p.id === plotId);
                    userDefinedAreas = [
                        ...(updatedPlot?.buildableAreas.map(a => ({ ...a, intendedUse: a.intendedUse })) ?? []),
                        ...(updatedPlot?.greenAreas.map(a => ({ ...a, intendedUse: 'GreenArea' })) ?? []),
                        ...(updatedPlot?.parkingAreas.map(a => ({ ...a, intendedUse: 'ParkingArea' })) ?? []),
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

            set(produce(draft => {
                const plot = draft.plots.find(p => p.id === plotId);
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

                scenario.objects.forEach((aiObj, aiIndex) => {
                    const aiMassingObject = aiObj as AiMassingGeneratedObject;

                    let containerGeometry: Feature<Polygon> | null = null;

                    const placementTargetZone = originalUserAreas.find(ua => ua.name === aiMassingObject.placement);

                    if (placementTargetZone) {
                        containerGeometry = placementTargetZone.geometry;
                    } else if (aiMassingObject.placement === plot.name) {
                        const buffered = turf.buffer(plot.geometry, -plot.setback, { units: 'meters' });
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
                name: 'No Project',
                totalPlotArea: 0,
                far: far,
                totalBuildableArea: 0,
                consumedBuildableArea: 0,
                consumedPlotArea: consumedPlotArea,
            };
        }

        const totalBuildableArea = (project.totalPlotArea ?? consumedPlotArea) * far;
        const consumedBuildableArea = plots
            .flatMap(p => p.buildings)
            .reduce((acc, b) => acc + b.area * b.floors.length, 0);

        return {
            ...project,
            far,
            totalBuildableArea,
            consumedBuildableArea,
            consumedPlotArea: project.totalPlotArea ?? consumedPlotArea,
        };
    }, [projects, activeProjectId, plots, selectedPlot]);
}

export { useBuildingStore, useSelectedBuilding, useProjectData, useSelectedPlot };


