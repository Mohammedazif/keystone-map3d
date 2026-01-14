import { useBuildingStore, UTILITY_COLORS } from '@/hooks/use-building-store';
import { BUILDING_MATERIALS, hslToRgb } from '@/lib/color-utils';
import { useToast } from '@/hooks/use-toast';
import { BuildingIntendedUse, GreenRegulationData } from '@/lib/types';
import * as turf from '@turf/turf';
import mapboxgl, { GeoJSONSource, LngLatLike, Map, Marker } from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Script from 'next/script';
import { createShaktiChakraGroup } from '@/lib/shakti-chakra-visualizer';
import { AnalysisMode } from './solar-controls';
import { runVisualAnalysis } from '@/lib/engines/visual-analysis-engine';
import { useRegulations } from '@/hooks/use-regulations';

declare global {
  interface Window {
    tb: any;
    THREE: any;
    Threebox: any;
  }
}

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || '';

const DRAWING_OUTLINE_SOURCE_ID = 'drawing-outline-source';
const DRAWING_OUTLINE_LAYER_ID = 'drawing-outline-layer';
const FIRST_POINT_COLOR = '#F5A623';
const LABELS_SOURCE_ID = 'building-labels-source';
const LABELS_LAYER_ID = 'building-labels-layer';

// Helper to darken/lighten hex color
const adjustColorBrightness = (hex: string, percent: number) => {
  const num = parseInt(hex.replace('#', ''), 16);
  const amt = Math.round(2.55 * percent);
  const R = (num >> 16) + amt;
  const G = (num >> 8 & 0x00FF) + amt;
  const B = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (R < 255 ? R < 1 ? 0 : R : 255) * 0x10000 + (G < 255 ? G < 1 ? 0 : G : 255) * 0x100 + (B < 255 ? B < 1 ? 0 : B : 255)).toString(16).slice(1);
};

interface MapEditorProps {
  onMapReady?: () => void;
  solarDate: Date;
  setSolarDate: (d: Date) => void;
  isSolarEnabled: boolean;
  setIsSolarEnabled: (b: boolean) => void;
  analysisMode: AnalysisMode;
  setAnalysisMode: (m: AnalysisMode) => void;
  activeGreenRegulations?: GreenRegulationData[];
}

export function MapEditor({
  onMapReady,
  solarDate,
  setSolarDate,
  isSolarEnabled,
  setIsSolarEnabled,
  analysisMode,
  setAnalysisMode,
  activeGreenRegulations = []
}: MapEditorProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const [buildingsReady, setBuildingsReady] = useState(false); // Track when buildings are ready for analysis

  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isThreeboxLoaded, setIsThreeboxLoaded] = useState(false);
  const markers = useRef<Marker[]>([]);
  const [primaryColor, setPrimaryColor] = useState('hsl(210, 40%, 50%)'); // Default primary color

  const { actions, drawingPoints, drawingState, selectedObjectId, isLoading, plots, uiState, activeProjectId, projects } = useBuildingStore();


  const activeProject = projects.find(p => p.id === activeProjectId);
  const { regulations } = useRegulations(activeProject || null);



  // Sync uploaded regulations to store so Sidebar/Charts use them too
  useEffect(() => {
    if (activeProject && regulations) {
      plots.forEach(plot => {
        // If plot doesn't have regulation or it doesn't match the active fetched one
        const currentId = plot.regulation ? `${plot.regulation.location}-${plot.regulation.type}` : '';
        const newId = `${regulations.location}-${regulations.type}`;

        if (currentId !== newId) {
          console.log(`Syncing regulation ${newId} to plot ${plot.id}`);
          actions.updatePlot(plot.id, { regulation: regulations });
        }
      });
    }
  }, [activeProject, plots, regulations, actions]);

  const { toast } = useToast();

  const getStoreState = useBuildingStore.getState;

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const computedStyle = getComputedStyle(document.documentElement);
      const primaryHslRaw = computedStyle.getPropertyValue('--primary').trim();
      if (primaryHslRaw) {
        // Mapbox expects comma-separated HSL values, not space-separated
        const commaSeparatedHsl = primaryHslRaw.replace(/\s+/g, ',');
        setPrimaryColor(`hsl(${commaSeparatedHsl})`);
      }
    }
  }, []);

  const closePolygon = useCallback(async () => {
    const { drawingPoints, drawingState } = getStoreState();
    if (drawingPoints.length < 3 || !drawingState.isDrawing) return;

    const finalPoints = [...drawingPoints, drawingPoints[0]];
    const polygonFeature = turf.polygon([finalPoints]);
    const centroid = turf.centroid(polygonFeature);

    const success = actions.finishDrawing(polygonFeature);
    if (!success) {
      // Toast message is now handled inside the store for more specific errors.
      // Generic fallback in case the store doesn't provide one.
      const lastToast = toast({
        variant: 'destructive',
        title: 'Drawing Error',
        description: 'Could not create the object. Ensure it is drawn correctly and within required boundaries.',
      });
    }

  }, [actions, getStoreState, toast]);

  const handleMapClick = useCallback(
    (e: mapboxgl.MapLayerMouseEvent) => {
      if (!map.current || !map.current.isStyleLoaded()) return;

      const { drawingState, drawingPoints, plots } = getStoreState();

      if (drawingState.isDrawing) {
        const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];

        if (drawingPoints.length > 2) {
          const firstPoint = drawingPoints[0];
          const clickPoint: LngLatLike = { lng: e.lngLat.lng, lat: e.lngLat.lat };
          const firstMapPoint: LngLatLike = { lng: firstPoint[0], lat: firstPoint[1] };
          const pixelDist = map.current?.project(clickPoint).dist(map.current.project(firstMapPoint));

          if (pixelDist && pixelDist < 15) { // 15px tolerance
            closePolygon();
            return;
          }
        }
        actions.addDrawingPoint(coords);
      } else {
        // Logic for selecting objects on the map
        const allMapLayers = map.current.getStyle().layers.map(l => l.id);
        const clickableLayers = plots.flatMap(p =>
          [
            `plot-base-${p.id}`,
            ...p.buildings.flatMap(b => b.floors.map(f => `building-floor-fill-${f.id}-${b.id}`)),
            ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
            ...p.greenAreas.map(g => `green-area-${g.id}`),
            ...p.parkingAreas.map(pa => `parking-area-${pa.id}`),
            ...p.utilityAreas.map(u => `utility-area-${u.id}`)
          ]
        ).filter(id => allMapLayers.includes(id));

        if (clickableLayers.length === 0) return;

        const features = map.current.queryRenderedFeatures(e.point, {
          layers: clickableLayers,
        });

        if (features && features.length > 0) {
          const feature = features[0];
          const layerId = feature.layer?.id;
          if (!layerId) return;

          if (layerId.startsWith('plot-base-')) {
            const plotId = layerId.replace('plot-base-', '');
            if (plots.some(p => p.id === plotId)) {
              actions.selectObject(plotId, 'Plot');
            }
          } else if (layerId.startsWith('building-floor-fill-')) {
            const buildingId = layerId.split('-').pop();
            if (!buildingId) return;
            for (const plot of plots) {
              if (plot.buildings.some(b => b.id === buildingId)) {
                actions.selectObject(buildingId, 'Building');
                break;
              }
            }
          } else if (layerId.startsWith('buildable-area-')) {
            const buildableAreaId = layerId.replace('buildable-area-', '');
            for (const plot of plots) {
              if (plot.buildableAreas.some(b => b.id === buildableAreaId)) {
                actions.selectObject(buildableAreaId, 'BuildableArea');
                break;
              }
            }
          } else if (layerId.startsWith('green-area-')) {
            const greenAreaId = layerId.replace('green-area-', '');
            actions.selectObject(greenAreaId, 'GreenArea');
          } else if (layerId.startsWith('parking-area-')) {
            const parkingAreaId = layerId.replace('parking-area-', '');
            actions.selectObject(parkingAreaId, 'ParkingArea');
          } else if (layerId.startsWith('utility-area-')) {
            const utilityAreaId = layerId.replace('utility-area-', '');
            actions.selectObject(utilityAreaId, 'UtilityArea');
          }
        }
      }
    },
    [closePolygon, actions, getStoreState, plots]
  );

  const handleMouseMove = useCallback((e: mapboxgl.MapLayerMouseEvent) => {
    if (!map.current || !map.current.isStyleLoaded()) return;
    const { drawingState, drawingPoints, plots } = getStoreState();

    if (drawingState.isDrawing) {
      map.current.getCanvas().style.cursor = 'crosshair';
      if (drawingPoints.length > 2) {
        const firstPoint = drawingPoints[0];
        const hoverPoint: LngLatLike = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        const firstMapPoint: LngLatLike = { lng: firstPoint[0], lat: firstPoint[1] };
        const pixelDist = map.current?.project(hoverPoint).dist(map.current.project(firstMapPoint));
        if (pixelDist && pixelDist < 15) {
          map.current.getCanvas().style.cursor = 'pointer';
        }
      }
    } else {
      const allMapLayers = map.current.getStyle().layers.map(l => l.id);
      const hoverableLayers = plots.flatMap(p =>
        [
          `plot-base-${p.id}`,
          ...p.buildings.flatMap(b => b.floors.map(f => `building-floor-fill-${f.id}-${b.id}`)),
          ...p.buildableAreas.map(b => `buildable-area-${b.id}`),
          ...p.greenAreas.map(g => `green-area-${g.id}`),
          ...p.parkingAreas.map(pa => `parking-area-${pa.id}`),
          ...p.utilityAreas.map(u => `utility-area-${u.id}`)
        ]
      ).filter(id => allMapLayers.includes(id));

      if (hoverableLayers.length > 0) {
        const features = map.current.queryRenderedFeatures(e.point, { layers: hoverableLayers });
        map.current.getCanvas().style.cursor = features && features.length > 0 ? 'pointer' : 'grab';
      } else {
        map.current.getCanvas().style.cursor = 'grab';
      }
    }
  },
    [getStoreState]
  );

  const locateUser = useCallback(() => {
    if (!map.current) return;
    if (!navigator.geolocation) {
      toast({ variant: 'destructive', title: 'Geolocation not supported' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!map.current) return;
        const userLoc: LngLatLike = [pos.coords.longitude, pos.coords.latitude];
        map.current.flyTo({ center: userLoc, zoom: 16 });
        new mapboxgl.Marker({ color: '#10b981' }).setLngLat(userLoc).addTo(map.current);
      },
      err => {
        toast({ variant: 'destructive', title: 'Unable to retrieve location', description: err.message });
      }
    );
  }, [toast]);


  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const { drawingState } = getStoreState();
      if (!drawingState.isDrawing) return;

      if (event.key === 'Escape') {
        actions.resetDrawing();
      }

      if (event.key === 'z' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        actions.undoLastPoint();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [actions, getStoreState]);

  useEffect(() => {
    const handleLocate = () => locateUser();
    const handleCloseEvent = () => closePolygon();
    const handleResize = () => {
      if (map.current) {
        map.current.resize();
      }
    }
    window.addEventListener('locateUser', handleLocate);
    window.addEventListener('closePolygon', handleCloseEvent);
    window.addEventListener('resizeMap', handleResize);

    return () => {
      window.removeEventListener('locateUser', handleLocate);
      window.removeEventListener('closePolygon', handleCloseEvent);
      window.removeEventListener('resizeMap', handleResize);
    };
  }, [locateUser, closePolygon]);

  useEffect(() => {
    const handleFlyTo = (event: Event) => {
      if (!map.current) return;
      const customEvent = event as CustomEvent;
      const { center, zoom } = customEvent.detail;
      map.current.flyTo({ center, zoom: zoom || 16, essential: true });
    }
    window.addEventListener('flyTo', handleFlyTo);
    return () => {
      window.removeEventListener('flyTo', handleFlyTo);
    };
  }, []);

  // Initialize Map
  useEffect(() => {
    if (map.current) return;
    if (!mapContainer.current) return;
    if (!mapboxgl.accessToken) {
      toast({
        variant: 'destructive',
        title: 'Configuration Error',
        description: 'Mapbox access token is missing. Please set NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN in your environment variables.',
      });
      return;
    }

    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/standard',
      center: [-74.006, 40.7128], // Default to NYC
      zoom: 15,
      pitch: 60,
      antialias: true,
    });

    const mapInstance = map.current;

    mapInstance.on('load', () => {
      onMapReady?.();
      mapInstance.addControl(new mapboxgl.NavigationControl(), 'top-right');

      // Enable 3D buildings in Mapbox Standard Style
      mapInstance.setConfigProperty('basemap', 'show3dObjects', true);

      setIsMapLoaded(true);
    });

    mapInstance.on('click', handleMapClick);

    return () => {
      const mapInst = map.current;
      if (!mapInst) return;
      mapInst.remove();
      map.current = null;
    };

  }, []);



  // Effect: Run Visual Analysis when mode/date changes or buildings change
  useEffect(() => {
    if (!isMapLoaded || !window.tb || !window.tb.world) return;

    console.log('[Analysis Effect] Mode:', analysisMode, 'Date:', solarDate);
    console.log('[Analysis Effect] Active Green Regulations:', activeGreenRegulations);

    // Collect buildings immediately (synchronously)
    const buildings: any[] = [];
    const context: any[] = [];

    if (window.tb.world && window.tb.world.children) {
      window.tb.world.children.forEach((child: any) => {
        if (child.userData.isBuildingGroup) {
          child.traverse((node: any) => {
            if (node.isMesh) {
              buildings.push(node);
            }
          });
        } else if (child.name && child.name.startsWith('building-group')) {
          child.traverse((node: any) => {
            if (node.isMesh) {
              buildings.push(node);
            }
          });
        }
      });
    }

    console.log(`[Analysis Effect] Found ${buildings.length} building meshes`);

    // IMMEDIATE: Reset colors synchronously when switching to 'none'
    if (analysisMode === 'none') {
      console.log('[Analysis Effect] Resetting colors immediately');
      runVisualAnalysis(buildings, context, 'none', solarDate, activeGreenRegulations);
      return; // Don't run debounced analysis
    }

    // For analysis modes: small debounce to batch rapid changes
    const timer = setTimeout(() => {
      console.log('[Analysis Effect] Running analysis after debounce');

      if (buildings.length === 0) {
        console.warn('[Analysis Effect] No buildings found - skipping analysis');
        return;
      }

      runVisualAnalysis(buildings, context, analysisMode, solarDate, activeGreenRegulations);
    }, 150); // Fast response time

    return () => clearTimeout(timer);
  }, [analysisMode, solarDate, plots, isMapLoaded, activeGreenRegulations]); // Added isMapLoaded dependency

  // Solar Lighting Effect
  useEffect(() => {
    if (!window.tb || !isMapLoaded) return;
    const THREE = window.tb.THREE || window.THREE;
    if (!THREE) return;

    // Access the scene
    const scene = window.tb.scene || window.tb.world; // Threebox attaches to 'world'? 
    // Threebox structure: tb.world is the root Group added to Mapbox. 
    // But lights are usually attached to tb.scene? Wait, Threebox doesn't expose 'scene' officially in docs easily?
    // usually tb.world.parent or just search the scene graph.
    // In Threebox, 'tb.scene' might be undefined.
    // Let's assume standard Threebox behavior: lights are children of window.tb.world or similar?
    // Actually, Threebox adds lights to the map scene?

    // Best bet: Create a group for our custom lights, remove 'default' lights if we can find them.
    // For 'defaultLights: true', it adds `tb.lights` array.

    // Strategy: 
    // 1. Find and remove existing sun/simulation lights.
    // 2. If simulation enabled, calculate position and add directional shadow casting light.
    // 3. If disabled, ensure default generic lighting exists (Ambient + Directional from Top).

    const LIGHT_GROUP_NAME = 'simulation-lights-group';
    let lightGroup = scene.getObjectByName(LIGHT_GROUP_NAME);

    if (!lightGroup) {
      lightGroup = new THREE.Group();
      lightGroup.name = LIGHT_GROUP_NAME;
      scene.add(lightGroup);
    }

    // Clear previous frame lights
    lightGroup.clear();

    if (isSolarEnabled) {
      // Calculate position
      // Center of map for light target?
      const center = map.current?.getCenter();
      if (center) {
        const { getSunPosition } = require('@/lib/sun-utils');
        const { azimuth, altitude } = getSunPosition(solarDate, center.lat, center.lng);

        // Convert Az/Alt to Vector3
        // Azimuth 0 = South, PI/2 = West. 
        // Three.js Y up? No, Mapbox Z up.
        // X = East, Y = North, Z = Up.
        // Azimuth Ref: 0 is usually North in Map/Navigation, but solar formula might be South-based.
        // Our formula: 0->South. 
        // To Mapbox (Z-up, Y-North):
        // South vector: (0, -1, 0).
        // Altitude (angle from horizon).

        // Simple conversion:
        // dist * [ sin(azi) * cos(alt),  -cos(azi) * cos(alt), sin(alt) ] ??
        // Let's trial and error or use standard conversion.
        // Formula returned Azimuth 0 -> South. 
        // Vector should be:
        // x = sin(azimuth) * cos(altitude)
        // y = -cos(azimuth) * cos(altitude) // South is -y
        // z = sin(altitude)

        const dist = 1000; // Far away
        const x = dist * Math.sin(azimuth) * Math.cos(altitude);
        const y = dist * -1 * Math.cos(azimuth) * Math.cos(altitude);
        const z = dist * Math.sin(altitude);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        sunLight.position.set(x, y, z);
        // Target the center (0,0,0 of the scene is usually map center in Mercator? No, Threebox handles unit coords.)
        // We set target to 0,0,0 local? 
        sunLight.castShadow = true;

        // Shadow Props
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        const d = 500; // Shadow camera size
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;

        lightGroup.add(sunLight);
        lightGroup.add(sunLight.target);

        // Softer Ambient
        const ambient = new THREE.AmbientLight(0x404040, 0.4);
        lightGroup.add(ambient);

        // console.log(`Sun Sim: Az=${azimuth.toFixed(2)}, Alt=${altitude.toFixed(2)}`, {x,y,z});
      }

      // Try to disable default lights if possible
      // if(window.tb.lights) window.tb.lights.forEach(l => l.visible = false);

    } else {
      // Default Lighting (if we disabled built-ins, we restore, OR we just let built-ins handle it)
      // Assuming built-ins are always on. If we add strong lights on top, might be too bright?
      // Let's assume built-ins are "Base".
      // Simulation Mode adds a STRONG shadow caster.
      // Ideally we turn off defaults.
    }

    window.tb.repaint();

  }, [isSolarEnabled, solarDate, isMapLoaded]);

  useEffect(() => {
    if (!isMapLoaded || !isThreeboxLoaded || !map.current) return;

    const mapInstance = map.current;

    if (mapInstance.getLayer('custom-threebox-layer')) return;

    // Initialize Threebox
    mapInstance.addLayer({
      id: 'custom-threebox-layer',
      type: 'custom',
      renderingMode: '3d',
      slot: 'middle',
      onAdd: function (map, mbxContext) {
        if (window.tb) return;

        // @ts-ignore
        if (window.Threebox) {
          // @ts-ignore
          // Initialize with defaultLights: true initially, but we might control them later
          // Actually, Threebox 'defaultLights' creates an Ambient and a DirectionalLight.
          // To have full control, passing false is better, then we add our own.
          // But for backward compatibility with existing views, we start with true?
          // Let's stick to true for now, and try to remove/replace them if possible.
          // Or just init with false and add our own "Default" set.
          window.tb = new window.Threebox(map, mbxContext, {
            defaultLights: true,
            passiveRendering: false
          });


          if (window.tb.renderer) {
            window.tb.renderer.autoClear = false;
            window.tb.renderer.autoClearColor = false;
            window.tb.renderer.autoClearDepth = false;
            window.tb.renderer.autoClearStencil = false;


            const gl = window.tb.renderer.getContext();
            gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL);
            gl.depthMask(true);
            gl.enable(gl.CULL_FACE);
            gl.cullFace(gl.BACK);

            // Shadows setup
            window.tb.renderer.shadowMap.enabled = true;
            window.tb.renderer.shadowMap.type = window.THREE.PCFSoftShadowMap;
          }

          console.log('Threebox initialized with shared depth buffer');
        }
      },
      render: function (gl, matrix) {
        if (window.tb) {
          try {
            window.tb.update();
          } catch (e) {
            // Suppress repeating errors or log once
            // console.warn('Threebox update error:', e);
          }
        }
      },
    });

  }, [isMapLoaded, isThreeboxLoaded]);

  // --- MANAGE SOLAR LIGHTING ---
  useEffect(() => {
    if (!window.tb || !isMapLoaded) return;
    const THREE = window.tb.THREE || window.THREE;
    if (!THREE) return;

    // Access the scene
    const scene = window.tb.scene || window.tb.world; // Threebox attaches to 'world'? 
    // Threebox structure: tb.world is the root Group added to Mapbox. 
    // But lights are usually attached to tb.scene? Wait, Threebox doesn't expose 'scene' officially in docs easily?
    // usually tb.world.parent or just search the scene graph.
    // In Threebox, 'tb.scene' might be undefined.
    // Let's assume standard Threebox behavior: lights are children of window.tb.world or similar?
    // Actually, Threebox adds lights to the map scene?

    // Best bet: Create a group for our custom lights, remove 'default' lights if we can find them.
    // For 'defaultLights: true', it adds `tb.lights` array.

    // Strategy: 
    // 1. Find and remove existing sun/simulation lights.
    // 2. If simulation enabled, calculate position and add directional shadow casting light.
    // 3. If disabled, ensure default generic lighting exists (Ambient + Directional from Top).

    const LIGHT_GROUP_NAME = 'simulation-lights-group';
    let lightGroup = scene.getObjectByName(LIGHT_GROUP_NAME);

    if (!lightGroup) {
      lightGroup = new THREE.Group();
      lightGroup.name = LIGHT_GROUP_NAME;
      scene.add(lightGroup);
    }

    // Clear previous frame lights
    lightGroup.clear();

    if (isSolarEnabled) {
      // Calculate position
      // Center of map for light target?
      const center = map.current?.getCenter();
      if (center) {
        const { getSunPosition } = require('@/lib/sun-utils');
        const { azimuth, altitude } = getSunPosition(solarDate, center.lat, center.lng);

        // Convert Az/Alt to Vector3
        // Azimuth 0 = South, PI/2 = West. 
        // Three.js Y up? No, Mapbox Z up.
        // X = East, Y = North, Z = Up.
        // Azimuth Ref: 0 is usually North in Map/Navigation, but solar formula might be South-based.
        // Our formula: 0=South. 
        // To Mapbox (Z-up, Y-North):
        // South vector: (0, -1, 0).
        // Altitude (angle from horizon).

        // Simple conversion:
        // dist * [ sin(azi) * cos(alt),  -cos(azi) * cos(alt), sin(alt) ] ??
        // Let's trial and error or use standard conversion.
        // Formula returned Azimuth 0 -> South. 
        // Vector should be:
        // x = sin(azimuth) * cos(altitude)
        // y = -cos(azimuth) * cos(altitude) // South is -y
        // z = sin(altitude)

        const dist = 1000; // Far away
        const x = dist * Math.sin(azimuth) * Math.cos(altitude);
        const y = dist * -1 * Math.cos(azimuth) * Math.cos(altitude);
        const z = dist * Math.sin(altitude);

        const sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        sunLight.position.set(x, y, z);
        // Target the center (0,0,0 of the scene is usually map center in Mercator? No, Threebox handles unit coords.)
        // We set target to 0,0,0 local? 
        sunLight.castShadow = true;

        // Shadow Props
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        const d = 500; // Shadow camera size
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;

        lightGroup.add(sunLight);
        lightGroup.add(sunLight.target);

        // Softer Ambient
        const ambient = new THREE.AmbientLight(0x404040, 0.4);
        lightGroup.add(ambient);

        // console.log(`Sun Sim: Az=${azimuth.toFixed(2)}, Alt=${altitude.toFixed(2)}`, {x,y,z});
      }

      // Try to disable default lights if possible
      // if(window.tb.lights) window.tb.lights.forEach(l => l.visible = false);

    } else {
      // Default Lighting (if we disabled built-ins, we restore, OR we just let built-ins handle it)
      // Assuming built-ins are always on. If we add strong lights on top, might be too bright?
      // Let's assume built-ins are "Base".
      // Simulation Mode adds a STRONG shadow caster.
      // Ideally we turn off defaults.
    }

    window.tb.repaint();

  }, [isSolarEnabled, solarDate, isMapLoaded]);

  const vastuObjectsRef = useRef<any[]>([]);

  // Vastu Compass Rendering
  useEffect(() => {
    if (!window.tb || !isMapLoaded) return;

    // 1. Cleanup existing objects using our kept references
    vastuObjectsRef.current.forEach(obj => {
      try {
        window.tb.remove(obj);
      } catch (e) {
        console.warn('Failed to remove Vastu object', e);
      }
    });
    vastuObjectsRef.current = [];

    // 2. Add if enabled
    if (uiState?.showVastuCompass && plots.length > 0) {
      const THREE = window.tb.THREE || window.THREE;
      if (!THREE) return;

      plots.forEach(plot => {
        // Calculate true center by averaging polygon vertices
        let center: [number, number] | undefined;

        const geom = plot.geometry?.geometry;
        if (geom && geom.type === 'Polygon' && geom.coordinates && geom.coordinates[0]) {
          const coords = geom.coordinates[0];
          let sumLng = 0, sumLat = 0;
          const numPoints = coords.length - 1; // Exclude duplicate closing point

          for (let i = 0; i < numPoints; i++) {
            sumLng += coords[i][0];
            sumLat += coords[i][1];
          }

          center = [sumLng / numPoints, sumLat / numPoints];
          console.log('📍 Vastu Compass Center:', center, 'Plot:', plot.id);
        }

        if (!center) {
          console.warn('⚠️ Could not calculate center for plot:', plot.id);
          return;
        }

        // Radius: Make it smaller to fit within plot (0.5x the calculated radius)
        const r = Math.sqrt(plot.area / Math.PI) * 0.5;

        const compassGroup = createShaktiChakraGroup(THREE, r);
        const compassName = 'vastu-compass-group';
        compassGroup.name = `${compassName}-${plot.id}`;

        // Create Threebox Object
        // @ts-ignore
        const tbObj = window.tb.Object3D({ obj: compassGroup, units: 'meters' })
          .setCoords(center);

        // Set name for debugging
        tbObj.name = compassGroup.name;

        window.tb.add(tbObj);
        vastuObjectsRef.current.push(tbObj);
      });
      window.tb.repaint();
    } else {
      window.tb.repaint();
    }
  }, [uiState?.showVastuCompass, plots, isMapLoaded]);


  const buildingProps = useMemo(() =>
    plots.flatMap(p => p.buildings.map(b => `${b.id}-${b.opacity}-${b.height}-${b.numFloors}`)).join(','),
    [plots]
  );

  useEffect(() => {
    if (!isMapLoaded || !isThreeboxLoaded || !window.tb || !plots.length) return;

    // Check if THREE is available
    // @ts-ignore
    const THREE = window.tb.THREE || window.THREE;
    if (!THREE) {
      console.warn('THREE.js not available yet');
      return;
    }

    // Clear existing Threebox objects
    if (window.tb.world) {
      while (window.tb.world.children.length > 0) {
        window.tb.world.remove(window.tb.world.children[0]);
      }
    }

    plots.forEach(plot => {
      plot.buildings.forEach(building => {
        try {
          // Validate building has required geometry
          if (!building.centroid?.geometry?.coordinates ||
            !building.geometry?.geometry?.coordinates?.[0]) {
            console.warn(`Skipping building ${building.id}: Invalid geometry or centroid`);
            return;
          }

          const center = building.centroid.geometry.coordinates;
          const coordinates = building.geometry.geometry.coordinates[0];

          // Validate centroid coordinates are valid numbers
          if (!Array.isArray(center) || center.length < 2 ||
            !Number.isFinite(center[0]) || !Number.isFinite(center[1])) {
            console.warn(`Skipping building ${building.id}: Invalid centroid coordinates`, center);
            return;
          }

          // Validate building coordinates
          if (!Array.isArray(coordinates) || coordinates.length < 3) {
            console.warn(`Skipping building ${building.id}: Invalid or insufficient coordinates`);
            return;
          }

          // Validate all coordinates are valid numbers
          const hasInvalidCoords = coordinates.some((coord: any) =>
            !Array.isArray(coord) || coord.length < 2 ||
            !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])
          );

          if (hasInvalidCoords) {
            console.warn(`Skipping building ${building.id}: Contains NaN or invalid coordinate values`);
            return;
          }

          // Create building group
          const buildingGroup = new THREE.Group();
          buildingGroup.userData.isBuildingGroup = true;
          buildingGroup.name = `building-group-${building.id}`;
          const buildingCoords = [...coordinates];

          // --- GEOMETRY GENERATION ---

          // 1. Calculate Base Shapes
          const shape = new THREE.Shape();
          const glassShape = new THREE.Shape();

          // Convert coordinates to local metric space
          const localCoords = buildingCoords.map((coord: any) => {
            const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
            const latDiff = -1 * (coord[1] - center[1]) * 110540;
            return [lngDiff, latDiff];
          });

          // Create base shape
          localCoords.forEach((pt, index) => {
            if (index === 0) shape.moveTo(pt[0], pt[1]);
            else shape.lineTo(pt[0], pt[1]);
          });

          // Create recessed glass shape (buffer inwards)
          // We use turf to buffer the original polygon, then convert to local coords
          try {
            const buffered = turf.buffer(building.geometry as any, -0.0005, { units: 'kilometers' } as any); // ~0.5m inset
            if (buffered && buffered.geometry && buffered.geometry.type === 'Polygon') {
              const bufferedCoords = buffered.geometry.coordinates[0];
              bufferedCoords.forEach((coord: any, index: number) => {
                const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                const latDiff = -1 * (coord[1] - center[1]) * 110540;
                if (index === 0) glassShape.moveTo(lngDiff, latDiff);
                else glassShape.lineTo(lngDiff, latDiff);
              });
            } else {
              // Fallback if buffer fails (e.g. too small), use original shape
              localCoords.forEach((pt, index) => {
                if (index === 0) glassShape.moveTo(pt[0], pt[1]);
                else glassShape.lineTo(pt[0], pt[1]);
              });
            }
          } catch (e) {
            // Fallback
            localCoords.forEach((pt, index) => {
              if (index === 0) glassShape.moveTo(pt[0], pt[1]);
              else glassShape.lineTo(pt[0], pt[1]);
            });
          }


          // --- HELPERS & CONFIG ---
          // --- HELPERS & CONFIG ---

          // GHOST MODE / OPACITY LOGIC
          let activeOpacity = 1.0;
          let isGhostMode = false;
          let isBasementActive = false; // Specific mode for underground viewing
          let highlightedFloorId: string | null = null;

          // Categorize floors (needed for floor selection logic below)
          const allFloors = building.floors || [];
          const basementFloors = allFloors.filter(f => f.type === 'Parking' && f.parkingType === 'Basement');
          const stiltFloors = allFloors.filter(f => f.type === 'Parking' && (f.parkingType === 'Stilt' || f.parkingType === 'Podium'));
          const towerFloors = allFloors.filter(f => f.type !== 'Parking' && !(f.type === 'Utility' && f.utilityType === 'Electrical'));


          // Only activate Ghost Mode when clicking Electrical/HVAC (floor components) OR Basement
          if (selectedObjectId && selectedObjectId.id.startsWith('floor-')) {
            highlightedFloorId = selectedObjectId.id;
            // If this building contains the highlighted floor
            if (highlightedFloorId.includes(building.id)) {
              // Check if the selected floor is a BASEMENT
              const selectedFloor = allFloors.find(f => f.id === highlightedFloorId);
              if (selectedFloor && selectedFloor.parkingType === 'Basement') {
                isBasementActive = true;
                isGhostMode = true;
                activeOpacity = 0.1; // Fade superstructure significantly
              } else {
                // Normal floor selection? Maybe just highlight that floor, keep others normal?
                // For now, let's keep existing logic which might have ghosted? 
                // Previous logic: activeOpacity = 0.15. 
                // Let's stick to ghosting for any floor selection to focus?
                isGhostMode = true;
                activeOpacity = 0.15;
              }
            } else {
              activeOpacity = 0.1; // Fade other buildings to keep focus on the utility
            }
          }

          const opacityVal = activeOpacity;
          const isFullyOpaque = opacityVal >= 0.85;

          const configureMaterial = (mat: any, isOpaque: boolean, opacity: number) => {
            if (isOpaque) {
              mat.transparent = false;
              mat.opacity = 1.0;
              mat.depthWrite = true;
              mat.depthTest = true;
              mat.alphaTest = 0.5;
              mat.blending = THREE.NoBlending;
            } else {
              mat.transparent = true;
              mat.opacity = opacity;
              mat.depthWrite = false;
              mat.depthTest = true;
              mat.alphaTest = 0;
              mat.blending = THREE.NormalBlending;
            }
          };

          const getRenderOrder = (isOpaque: boolean, transparentOrder: number) => {
            return isOpaque ? -1 : transparentOrder;
          };

          // --- MATERIALS ---
          // Mapbox Style Colors
          // Mapbox Style Colors - Dynamic based on Use
          const matParams = BUILDING_MATERIALS[building.intendedUse] || BUILDING_MATERIALS[BuildingIntendedUse.Residential];

          const floorColorHex = hslToRgb(matParams.baseHue, matParams.saturation, matParams.baseLightness);
          const glassHue = (matParams.baseHue + 180) % 360; // Complementary for glass or specific? 
          // Actually, let's keep glass bluish/neutral for transparency? 
          // Commercial uses bluish glass. Residential uses clearer/warmer.
          // Let's customize glass per type if needed, or stick to a derived one.
          // For now, let's derive glass color slightly shifted from base or fixed.
          // Better: Fixed glass styles per type?
          // Commercial: Blue-Grey. Resi: Neutral. Ind: Dark.

          let glassColorHex = '#8DA3B4';
          let roofColorHex = '#E6E6E6'; // Default light gray

          if (building.intendedUse === BuildingIntendedUse.Residential) {
            glassColorHex = '#C8D5E0'; // Light blue-gray
            roofColorHex = '#D4C5B0'; // Warm beige roof
          } else if (building.intendedUse === BuildingIntendedUse.Commercial) {
            glassColorHex = '#8DA3B4'; // Blue-gray
            roofColorHex = '#B8C5D6'; // Cool blue-gray roof
          } else if (building.intendedUse === BuildingIntendedUse.Industrial) {
            glassColorHex = '#708090'; // Slate gray
            roofColorHex = '#9CA3A8'; // Dark gray roof
          } else if (building.intendedUse === BuildingIntendedUse.Public) {
            glassColorHex = '#A0B0C0'; // Neutral gray-blue
            roofColorHex = '#C8A090'; // Terracotta-tinted roof
          } else if (building.intendedUse === BuildingIntendedUse.MixedUse) {
            glassColorHex = '#9DA3B8'; // Purple-gray
            roofColorHex = '#C8BED6'; // Purple-tinted roof
          }

          const floorColor = new THREE.Color(floorColorHex);
          const glassColor = new THREE.Color(glassColorHex);
          const roofColor = new THREE.Color(roofColorHex);

          const floorMaterial = new THREE.MeshStandardMaterial({
            color: floorColor,
            roughness: 0.9,
            metalness: 0.1,
          });

          const glassMaterial = new THREE.MeshStandardMaterial({
            color: glassColor,
            roughness: 0.2,
            metalness: 0.8,
            envMapIntensity: 1.0,
          });

          const roofMaterial = new THREE.MeshStandardMaterial({
            color: roofColor,
            roughness: 0.9,
            metalness: 0.0,
          });

          // --- MESH GENERATION ---
          // (Floor categorization moved up before selection logic)

          // 1. Render Basements (Downwards)
          // VISIBILITY: Only if isBasementActive is true
          if (isBasementActive) {
            const basementMat = new THREE.MeshStandardMaterial({
              color: 0x404040, // Darker Concrete
              roughness: 0.9,
              metalness: 0.1,
              transparent: true,
              opacity: 0.8, // Slightly see-through? Or solid? User said "shown by making building ghosted". 
              // Implies basement should be clear.
              depthTest: false // IMPORTANT: See through ground
            });

            const basementParametMat = new THREE.LineDashedMaterial({
              color: 0xffffff,
              dashSize: 1,
              gapSize: 0.5,
              linewidth: 1,
            });

            basementFloors.forEach((f, idx) => {
              const h = f.height || 3.5;
              const level = f.level !== undefined ? f.level : -(idx + 1);

              // Solid Mesh
              const bGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
              const bMesh = new THREE.Mesh(bGeo, basementMat);
              bMesh.position.z = level * h;

              const isSelected = highlightedFloorId === f.id;

              // Highlight selected basement
              if (isSelected) {
                basementMat.color.setHex(0x606060);
                basementMat.opacity = 0.9;
              } else {
                basementMat.color.setHex(0x404040);
                basementMat.opacity = 0.6;
              }

              bMesh.renderOrder = 999; // Draw on top of ground?
              buildingGroup.add(bMesh);

              // Dotted Outline (Edges)
              const edges = new THREE.EdgesGeometry(bGeo);
              const line = new THREE.LineSegments(edges, basementParametMat);
              line.computeLineDistances();
              line.position.copy(bMesh.position);
              line.renderOrder = 1000;
              // @ts-ignore
              line.material.depthTest = false;
              buildingGroup.add(line);
            });
          }

          // 2. Base Height (Stilt/Podium)
          let currentZ = 0;

          if (stiltFloors.length > 0) {
            stiltFloors.forEach(f => {
              const h = f.height || 3.5;
              const sGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
              const sMesh = new THREE.Mesh(sGeo, floorMaterial);
              sMesh.position.z = currentZ;

              const isSelected = highlightedFloorId === f.id;
              configureMaterial(floorMaterial, isSelected || isFullyOpaque, opacityVal);

              sMesh.castShadow = true;
              sMesh.receiveShadow = true;
              buildingGroup.add(sMesh);

              currentZ += h;
            });
          } else {
            // 2b. Check for Electrical Room (Ground Floor utility) replacing first floor logic?
            // Or just standard ground floor.
            // If we have electrical utility, render specifically?
            // Existing logic handled this. Let's incorporate.
            const firstFloor = allFloors.find(f => f.utilityType === 'Electrical');
            if (firstFloor) {
              const h = 3.5;
              const eGeo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
              const eMesh = new THREE.Mesh(eGeo, floorMaterial);
              eMesh.position.z = currentZ;

              const isSelected = highlightedFloorId === firstFloor.id;
              configureMaterial(floorMaterial, isSelected || isFullyOpaque, isSelected ? 1.0 : opacityVal);
              buildingGroup.add(eMesh);

              // Skip this floor in towerFloors if it's there?
              // We filtered 'Utility' type earlier from towerFloors.
              currentZ += h;
            }
          }

          // 3. Tower (Glass Core + Slabs)
          // Aggregated height of remaining floors
          if (towerFloors.length > 0) {
            const towerHeight = towerFloors.reduce((sum, f) => sum + (f.height || 3.0), 0);

            // Glass Core
            const glassExtrudeSettings = {
              depth: towerHeight,
              bevelEnabled: false,
            };
            const glassGeometry = new THREE.ExtrudeGeometry(glassShape, glassExtrudeSettings);
            const glassMesh = new THREE.Mesh(glassGeometry, glassMaterial);
            glassMesh.position.z = currentZ;
            glassMesh.castShadow = true;
            glassMesh.receiveShadow = true;
            configureMaterial(glassMaterial, isFullyOpaque, opacityVal);
            buildingGroup.add(glassMesh);

            // Slabs (Protruding Rings) + Walls
            const slabThickness = 0.25;
            const slabGeometry = new THREE.ExtrudeGeometry(shape, {
              depth: slabThickness,
              bevelEnabled: false
            });

            // Create wall ring shape (outer shape with glass cutout as hole)
            const wallRingShape = new THREE.Shape();
            localCoords.forEach((pt, index) => {
              if (index === 0) wallRingShape.moveTo(pt[0], pt[1]);
              else wallRingShape.lineTo(pt[0], pt[1]);
            });

            // Add glass shape as hole in wall ring
            try {
              const buffered = turf.buffer(building.geometry as any, -0.0005, { units: 'kilometers' } as any);
              if (buffered && buffered.geometry && buffered.geometry.type === 'Polygon') {
                const innerCoords = buffered.geometry.coordinates[0];
                const hole = new THREE.Path();
                innerCoords.forEach((coord: any, index: number) => {
                  const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                  const latDiff = -1 * (coord[1] - center[1]) * 110540;
                  if (index === 0) hole.moveTo(lngDiff, latDiff);
                  else hole.lineTo(lngDiff, latDiff);
                });
                wallRingShape.holes.push(hole);
              }
            } catch (e) { }

            towerFloors.forEach((f, i) => {
              const floorHeight = f.height || 3.0;
              const wallHeight = floorHeight - slabThickness; // Wall is floor height minus slab
              const relativeZ = i * floorHeight;

              // Add WALL RING (colored perimeter wall between glass and outer edge)
              const wallRingGeometry = new THREE.ExtrudeGeometry(wallRingShape, {
                depth: wallHeight,
                bevelEnabled: false
              });
              const wallRing = new THREE.Mesh(wallRingGeometry, floorMaterial);
              wallRing.position.z = currentZ + relativeZ + slabThickness;
              wallRing.castShadow = true;
              wallRing.receiveShadow = true;
              configureMaterial(floorMaterial, isFullyOpaque, opacityVal);
              buildingGroup.add(wallRing);

              // Add FLOOR SLAB at top of each floor
              const slabZ = (i + 1) * floorHeight - slabThickness;
              const slab = new THREE.Mesh(slabGeometry, floorMaterial);
              slab.position.z = currentZ + slabZ;
              slab.castShadow = true;
              slab.receiveShadow = true;
              configureMaterial(floorMaterial, isFullyOpaque, opacityVal);
              buildingGroup.add(slab);
            });

            currentZ += towerHeight;

            // Add wall under parapet to close the gap
            const lastFloorHeight = towerFloors.length > 0 ? (towerFloors[towerFloors.length - 1].height || 3.0) : 3.0;
            const gapHeight = lastFloorHeight - slabThickness;
            if (gapHeight > 0) {
              const gapWallGeometry = new THREE.ExtrudeGeometry(wallRingShape, {
                depth: gapHeight,
                bevelEnabled: false
              });
              const gapWall = new THREE.Mesh(gapWallGeometry, floorMaterial);
              gapWall.position.z = currentZ - lastFloorHeight + slabThickness;
              gapWall.castShadow = true;
              gapWall.receiveShadow = true;
              configureMaterial(floorMaterial, isFullyOpaque, opacityVal);
              buildingGroup.add(gapWall);
            }
          }

          // 4. Parapet
          const parapetHeight = 1.2;
          const parapetShape = new THREE.Shape();
          localCoords.forEach((pt, index) => {
            if (index === 0) parapetShape.moveTo(pt[0], pt[1]);
            else parapetShape.lineTo(pt[0], pt[1]);
          });

          // Add hole (glass shape)
          // Simplified: just extrude outer. Creating holes from points is tricky without robust function.
          // Reuse glassShape directly as hole? Parapet shouldn't cover glass?
          // If we just render a thin wall strip?
          // Fallback: Just render a cap if holes fail.
          // For now, simple block for parapet.

          if (glassShape.curves.length > 0) {
            try {
              // Try to add hole if possible.
              // ... (Simulated hole logic from before)
              const buffered = turf.buffer(building.geometry as any, -0.0005, { units: 'kilometers' } as any);
              if (buffered && buffered.geometry) {
                const innerCoords = buffered.geometry.coordinates[0];
                const hole = new THREE.Path();
                innerCoords.forEach((coord: any, index: number) => {
                  const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                  const latDiff = -1 * (coord[1] - center[1]) * 110540;
                  if (index === 0) hole.moveTo(lngDiff, latDiff);
                  else hole.lineTo(lngDiff, latDiff);
                });
                parapetShape.holes.push(hole);
              }
            } catch (e) { }
          }

          const parapetGeometry = new THREE.ExtrudeGeometry(parapetShape, {
            depth: parapetHeight,
            bevelEnabled: false
          });
          const parapet = new THREE.Mesh(parapetGeometry, roofMaterial);
          parapet.position.z = currentZ;
          parapet.castShadow = true;
          parapet.receiveShadow = true;
          buildingGroup.add(parapet);

          // --- UTILITY 3D VISUALIZATION ---

          // 1. HVAC Rooftop Unit (Box on top)
          if (building.utilities && building.utilities.includes('HVAC' as any)) {
            // Calculate size relative to roof area, but keep it reasonable
            const buildingWidth = Math.sqrt(building.area);
            const hvacSize = Math.max(3.0, Math.min(5.0, buildingWidth * 0.2)); // Balanced size (3m to 5m)
            const hvacHeight = 2.0;

            // Calculate safe position (Midpoint of Longest Wall, pushed inward via Normal)
            let hvacX = 0, hvacY = 0;
            try {
              const geo = (building.geometry as any);
              const coords = geo.coordinates || geo.geometry?.coordinates;
              const type = geo.type || geo.geometry?.type;
              const ring = (type === 'MultiPolygon') ? coords[0][0] : coords[0];

              if (ring && ring.length >= 3) {
                // 1. Determine Winding Order
                let signedArea = 0;
                for (let i = 0; i < ring.length - 1; i++) {
                  signedArea += (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]);
                }
                const isCCW = signedArea > 0;

                // 2. Find Longest Edge
                let p0 = ring[0], p1 = ring[1];
                let maxDist = 0;
                for (let i = 0; i < ring.length - 1; i++) {
                  const dist = Math.sqrt(Math.pow(ring[i + 1][0] - ring[i][0], 2) + Math.pow(ring[i + 1][1] - ring[i][1], 2));
                  if (dist > maxDist) {
                    maxDist = dist;
                    p0 = ring[i];
                    p1 = ring[i + 1];
                  }
                }

                // 3. Midpoint
                const mx = (p0[0] + p1[0]) / 2;
                const my = (p0[1] + p1[1]) / 2;

                // 4. Inward Normal based on Winding
                // Vector along edge
                const dx = p1[0] - p0[0];
                const dy = p1[1] - p0[1];
                const len = Math.sqrt(dx * dx + dy * dy);
                const ux = dx / len;
                const uy = dy / len;

                // If CCW, Inward is Left (-uy, ux)
                // If CW, Inward is Right (uy, -ux)
                const inwardN = isCCW ? [-uy, ux] : [uy, -ux];

                // 5. Convert to Local & Push
                const wxLocal = -1 * (mx - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                const wyLocal = -1 * (my - center[1]) * 110540;

                // Calculate Local Vector for Normal
                const nxPt = mx + inwardN[0] * 0.0001;
                const nyPt = my + inwardN[1] * 0.0001;
                const nxLocal = -1 * (nxPt - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                const nyLocal = -1 * (nyPt - center[1]) * 110540;

                const lvx = nxLocal - wxLocal;
                const lvy = nyLocal - wyLocal;
                const lvLen = Math.sqrt(lvx * lvx + lvy * lvy);

                const offset = (hvacSize / 2) + 0.5; // Half size + 0.5m padding

                if (lvLen > 0) {
                  hvacX = wxLocal + (lvx / lvLen) * offset;
                  hvacY = wyLocal + (lvy / lvLen) * offset;
                } else {
                  hvacX = wxLocal; hvacY = wyLocal;
                }
              }
            } catch (e) { }

            const hvacGeo = new THREE.BoxGeometry(hvacSize, hvacSize, hvacHeight);
            const hvacMat = new THREE.MeshStandardMaterial({
              color: 0x808080, // Silver/Grey
              roughness: 0.4,
              metalness: 0.7,
            });

            // Check if HVAC floor is selected
            const hvacFloorId = `floor-${building.id}-hvac`;
            const isHvacSelected = highlightedFloorId === hvacFloorId;
            configureMaterial(hvacMat, isHvacSelected || isFullyOpaque, isHvacSelected ? 1.0 : opacityVal);

            const hvacBox = new THREE.Mesh(hvacGeo, hvacMat);
            hvacBox.position.set(hvacX, hvacY, building.height + hvacHeight / 2);
            hvacBox.castShadow = true;
            hvacBox.receiveShadow = true;
            hvacBox.renderOrder = getRenderOrder(isFullyOpaque, 2);
            buildingGroup.add(hvacBox);

            // Add some mechanical detail (fan grill texture simulation via simple geometry?)
            const fanGeo = new THREE.CylinderGeometry(hvacSize * 0.3, hvacSize * 0.3, 0.2, 16);
            const fanMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
            configureMaterial(fanMat, isFullyOpaque, opacityVal);
            const fan = new THREE.Mesh(fanGeo, fanMat);
            fan.position.set(hvacX, hvacY, building.height + hvacHeight + 0.1);
            fan.rotation.x = Math.PI / 2;
            fan.renderOrder = getRenderOrder(isFullyOpaque, 2);
            buildingGroup.add(fan);
          }

          // 2. Electrical MEP Infrastructure (Detailed System)
          if (building.utilities && building.utilities.includes('Electrical' as any)) {
            const elecColor = 0xFFD700; // Gold
            const buildingWidth = Math.sqrt(building.area);
            const pipeRadius = 0.15;
            const segments = 8;

            const elecMat = new THREE.MeshStandardMaterial({
              color: elecColor,
              emissive: 0xAA6600,
              emissiveIntensity: 0.3,
              roughness: 0.3,
              metalness: 0.8,
              transparent: false,  // Not transparent - hidden by facade
              opacity: 1.0,
              depthTest: true,
              depthWrite: true
            });

            // Transformer Room (using pointOnSurface for guaranteed interior fit)
            const transformerSize = Math.max(1.5, Math.min(3.0, buildingWidth * 0.15));
            const transformerHeight = 2.5;

            // Calculate safe interior position (Midpoint of Longest Wall, pushed inward via Normal)
            let transX = 0, transY = 0;
            try {
              const geo = (building.geometry as any);
              const coords = geo.coordinates || geo.geometry?.coordinates;
              const type = geo.type || geo.geometry?.type;
              const ring = (type === 'MultiPolygon') ? coords[0][0] : coords[0];

              if (ring && ring.length >= 3) {
                // 1. Determine Winding Order
                let signedArea = 0;
                for (let i = 0; i < ring.length - 1; i++) {
                  signedArea += (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]);
                }
                const isCCW = signedArea > 0;

                // 2. Find Longest Edge
                let p0 = ring[0], p1 = ring[1];
                let maxDist = 0;
                for (let i = 0; i < ring.length - 1; i++) {
                  const dist = Math.sqrt(Math.pow(ring[i + 1][0] - ring[i][0], 2) + Math.pow(ring[i + 1][1] - ring[i][1], 2));
                  if (dist > maxDist) {
                    maxDist = dist;
                    p0 = ring[i];
                    p1 = ring[i + 1];
                  }
                }

                // 3. Midpoint
                const mx = (p0[0] + p1[0]) / 2;
                const my = (p0[1] + p1[1]) / 2;

                // 4. Inward Normal based on Winding
                // Vector along edge
                const dx = p1[0] - p0[0];
                const dy = p1[1] - p0[1];
                const len = Math.sqrt(dx * dx + dy * dy);
                const ux = dx / len;
                const uy = dy / len;

                // If CCW, Inward is Left (-uy, ux)
                // If CW, Inward is Right (uy, -ux)
                const inwardN = isCCW ? [-uy, ux] : [uy, -ux];

                // 5. Convert to Local & Push
                const wxLocal = -1 * (mx - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                const wyLocal = -1 * (my - center[1]) * 110540;

                // Calculate Local Vector for Normal
                const nxPt = mx + inwardN[0] * 0.0001;
                const nyPt = my + inwardN[1] * 0.0001;
                const nxLocal = -1 * (nxPt - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                const nyLocal = -1 * (nyPt - center[1]) * 110540;

                const lvx = nxLocal - wxLocal;
                const lvy = nyLocal - wyLocal;
                const lvLen = Math.sqrt(lvx * lvx + lvy * lvy);

                const offset = (transformerSize / 2) + 0.5; // Half size + 0.5m padding

                if (lvLen > 0) {
                  transX = wxLocal + (lvx / lvLen) * offset;
                  transY = wyLocal + (lvy / lvLen) * offset;
                } else {
                  transX = wxLocal; transY = wyLocal;
                }
              }
            } catch (e) { }
            const transformerGeo = new THREE.BoxGeometry(transformerSize, transformerSize, transformerHeight);
            const transformer = new THREE.Mesh(transformerGeo, elecMat);
            transformer.position.set(transX, transY, transformerHeight / 2);
            buildingGroup.add(transformer);

            // Calculate safe interior positions using geometry buffer analysis
            let riserPositions: { x: number; y: number }[] = [];

            // Pipes & Risers calculation - DISABLED
            // To show only transformers, we keep riserPositions empty
            /*
            try {
              // ... geometry analysis code ...
            } catch (e) { console.warn(e); }
            if (riserPositions.length < 3) { riserPositions = [{x:0,y:0}]; }
            */

            riserPositions.forEach((pos, idx) => {
              const riserGeo = new THREE.CylinderGeometry(pipeRadius, pipeRadius, building.height, segments);
              const riser = new THREE.Mesh(riserGeo, elecMat);
              riser.position.set(pos.x, pos.y, building.height / 2);
              buildingGroup.add(riser);

              const enclosureGeo = new THREE.BoxGeometry(0.6, 0.6, building.height);
              const enclosureMat = elecMat.clone();
              enclosureMat.opacity = 0.3;
              const enclosure = new THREE.Mesh(enclosureGeo, enclosureMat);
              enclosure.position.set(pos.x, pos.y, building.height / 2);
              buildingGroup.add(enclosure);
            });


            // NOTE: Water, Fire, STP, WTP, Gas are now rendered as plot-level zones (see utilityAreas rendering below)


            if (false && building.numFloors) {
              const floorHeight = building.height / building.numFloors;
              for (let floor = 1; floor <= building.numFloors; floor++) {
                const floorZ = floor * floorHeight - 0.5;

                const run1Length = Math.abs(riserPositions[0].x - riserPositions[1].x);
                const run1Geo = new THREE.CylinderGeometry(pipeRadius * 0.7, pipeRadius * 0.7, run1Length, segments);
                const run1 = new THREE.Mesh(run1Geo, elecMat);
                run1.rotation.z = Math.PI / 2;
                run1.position.set(
                  (riserPositions[0].x + riserPositions[1].x) / 2,
                  riserPositions[0].y,
                  floorZ
                );
                buildingGroup.add(run1);

                if (riserPositions.length > 2) {
                  const run2Length = Math.abs(riserPositions[2].y - riserPositions[0].y);
                  const run2Geo = new THREE.CylinderGeometry(pipeRadius * 0.7, pipeRadius * 0.7, run2Length, segments);
                  const run2 = new THREE.Mesh(run2Geo, elecMat);
                  run2.rotation.x = Math.PI / 2;
                  run2.position.set(
                    0,
                    (riserPositions[0].y + riserPositions[2].y) / 2,
                    floorZ
                  );
                  buildingGroup.add(run2);
                }

                if (floor % 2 === 0 && riserPositions.length > 0) {
                  const panelGeo = new THREE.BoxGeometry(0.5, 0.25, 0.8);
                  const panel = new THREE.Mesh(panelGeo, elecMat);
                  panel.position.set(buildingWidth * 0.08, buildingWidth * 0.08, floorZ);
                  buildingGroup.add(panel);
                }
              }
            }

            // Ground Distribution (from transformer to risers)
            const transformerX = -buildingWidth * 0.08;
            const transformerY = -buildingWidth * 0.08;

            riserPositions.forEach((pos) => {
              const conduitLength = Math.sqrt(
                Math.pow(pos.x - transformerX, 2) +
                Math.pow(pos.y - transformerY, 2)
              );
              const angle = Math.atan2(pos.y - transformerY, pos.x - transformerX);

              const conduitGeo = new THREE.CylinderGeometry(pipeRadius * 0.8, pipeRadius * 0.8, conduitLength, segments);
              const conduit = new THREE.Mesh(conduitGeo, elecMat);
              conduit.rotation.z = -angle + Math.PI / 2;
              conduit.position.set(
                (transformerX + pos.x) / 2,
                (transformerY + pos.y) / 2,
                0.5
              );
              buildingGroup.add(conduit);
            });

            // Roof Junction
            const roofJunctionGeo = new THREE.BoxGeometry(1, 1, 0.8);
            const roofJunction = new THREE.Mesh(roofJunctionGeo, elecMat);
            roofJunction.position.set(transX, transY, building.height + 0.4);
            buildingGroup.add(roofJunction);
          }


          // Roof Penthouse (Legacy - commented out)
          // ... 

          // Roof Floor 
          const roofFloorGeo = new THREE.ExtrudeGeometry(glassShape, {
            depth: 0.2,
            bevelEnabled: false
          });
          const roofFloor = new THREE.Mesh(roofFloorGeo, roofMaterial);
          roofFloor.position.z = building.height - 0.2;
          roofFloor.receiveShadow = true;
          buildingGroup.add(roofFloor);


          // 3D WINDOW FRAMES
          const windowFloorCount = building.numFloors || building.floors.length;
          const windowFloorHeight = building.height / windowFloorCount;
          const windowWidth = 1.4;
          const windowHeight = Math.min(1.8, windowFloorHeight * 0.6);
          const windowDepth = 0.12;
          const windowSpacingH = 2.8;

          const frameMaterial = new THREE.MeshStandardMaterial({
            color: 0x0A0A0A,
            roughness: 0.3,
            metalness: 0.7,
            polygonOffset: true,
            polygonOffsetFactor: -1,
            polygonOffsetUnits: -1
          });
          configureMaterial(frameMaterial, isFullyOpaque, opacityVal);

          const glassOpacity = Math.min(0.15, opacityVal * 0.15);
          const windowGlassMaterial = new THREE.MeshStandardMaterial({
            color: 0x6BA3D8,
            opacity: glassOpacity,
            transparent: glassOpacity < 1.0,
            roughness: 0.05,
            metalness: 0.95,
            depthWrite: false,
            alphaTest: 0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2
          });

          // Floor division lines
          for (let floor = 1; floor < windowFloorCount; floor++) {
            const floorLineShape = new THREE.Shape();
            buildingCoords.forEach((coord: any, index: number) => {
              const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
              const latDiff = -1 * (coord[1] - center[1]) * 110540;
              if (index === 0) {
                floorLineShape.moveTo(lngDiff, latDiff);
              } else {
                floorLineShape.lineTo(lngDiff, latDiff);
              }
            });

            const floorLineGeo = new THREE.ExtrudeGeometry(floorLineShape, { depth: 0.15, bevelEnabled: false });
            const floorLineMat = new THREE.MeshStandardMaterial({
              color: 0x404040,
              roughness: 0.8,
              polygonOffset: true,
              polygonOffsetFactor: -1,
              polygonOffsetUnits: -1
            });
            configureMaterial(floorLineMat, isFullyOpaque, opacityVal);
            const floorLine = new THREE.Mesh(floorLineGeo, floorLineMat);
            floorLine.position.z = floor * windowFloorHeight;
            floorLine.renderOrder = getRenderOrder(isFullyOpaque, 2);
            buildingGroup.add(floorLine);
          }

          // Windows
          for (let i = 0; i < buildingCoords.length - 1; i++) {
            const p1 = buildingCoords[i];
            const p2 = buildingCoords[i + 1];

            const x1 = -1 * (p1[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
            const y1 = -1 * (p1[1] - center[1]) * 110540;
            const x2 = -1 * (p2[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
            const y2 = -1 * (p2[1] - center[1]) * 110540;

            const facadeLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            const facadeAngle = Math.atan2(y2 - y1, x2 - x1);
            const windowsPerFloor = Math.max(1, Math.floor(facadeLength / windowSpacingH));

            const totalWindowWidth = windowsPerFloor * windowSpacingH;
            const startOffset = (facadeLength - totalWindowWidth) / 2 + windowSpacingH / 2;

            for (let floor = 0; floor < windowFloorCount; floor++) {
              for (let w = 0; w < windowsPerFloor; w++) {
                const offset = startOffset + w * windowSpacingH;
                const windowX = x1 + Math.cos(facadeAngle) * offset;
                const windowY = y1 + Math.sin(facadeAngle) * offset;
                const windowZ = floor * windowFloorHeight + windowFloorHeight * 0.5;

                const frameGeo = new THREE.BoxGeometry(windowWidth + 0.1, windowDepth, windowHeight + 0.1);
                const frame = new THREE.Mesh(frameGeo, frameMaterial);
                frame.position.set(windowX, windowY, windowZ);
                frame.rotation.z = facadeAngle;
                frame.castShadow = true;
                frame.receiveShadow = true;
                frame.renderOrder = getRenderOrder(isFullyOpaque, 3);
                buildingGroup.add(frame);

                const glassGeo = new THREE.BoxGeometry(windowWidth, windowDepth * 0.4, windowHeight);
                const glass = new THREE.Mesh(glassGeo, windowGlassMaterial);
                glass.position.set(windowX, windowY, windowZ);
                glass.rotation.z = facadeAngle;
                glass.castShadow = true;
                glass.renderOrder = 4;
                buildingGroup.add(glass);
              }
            }
          }

          // INTERNAL FLOORS
          const internalFloorMat = new THREE.MeshStandardMaterial({
            color: 0xDDDDDD,
            roughness: 0.8,
            metalness: 0.1,
            side: THREE.DoubleSide,
            emissive: 0x202020
          });
          configureMaterial(internalFloorMat, isFullyOpaque, opacityVal);

          const internalFloorGeo = new THREE.ShapeGeometry(shape);

          for (let i = 0; i < windowFloorCount; i++) {
            const floorMesh = new THREE.Mesh(internalFloorGeo, internalFloorMat);
            floorMesh.position.z = i * windowFloorHeight + 0.05;
            floorMesh.receiveShadow = true;
            floorMesh.renderOrder = getRenderOrder(isFullyOpaque, 2);
            buildingGroup.add(floorMesh);
          }

          // ENTRANCE DOOR 
          let longestFacadeIdx = 0;
          let maxLength = 0;
          for (let i = 0; i < buildingCoords.length - 1; i++) {
            const p1 = buildingCoords[i];
            const p2 = buildingCoords[i + 1];
            const x1 = -1 * (p1[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
            const y1 = -1 * (p1[1] - center[1]) * 110540;
            const x2 = -1 * (p2[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
            const y2 = -1 * (p2[1] - center[1]) * 110540;
            const length = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
            if (length > maxLength) {
              maxLength = length;
              longestFacadeIdx = i;
            }
          }

          const doorP1 = buildingCoords[longestFacadeIdx];
          const doorP2 = buildingCoords[(longestFacadeIdx + 1) % buildingCoords.length];
          const doorX1 = -1 * (doorP1[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
          const doorY1 = -1 * (doorP1[1] - center[1]) * 110540;
          const doorX2 = -1 * (doorP2[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
          const doorY2 = -1 * (doorP2[1] - center[1]) * 110540;
          const doorAngle = Math.atan2(doorY2 - doorY1, doorX2 - doorX1);
          const doorX = (doorX1 + doorX2) / 2;
          const doorY = (doorY1 + doorY2) / 2;

          const doorGeo = new THREE.BoxGeometry(2.5, 0.2, 3.5);
          const doorMat = new THREE.MeshStandardMaterial({
            color: 0x2C2C2C,
            roughness: 0.3,
            metalness: 0.7
          });
          configureMaterial(doorMat, isFullyOpaque, opacityVal);
          const door = new THREE.Mesh(doorGeo, doorMat);
          door.position.set(doorX, doorY, 1.75);
          door.rotation.z = doorAngle;
          door.renderOrder = getRenderOrder(isFullyOpaque, 3);
          buildingGroup.add(door);

          // ROOF WITH PARAPET WALLS AND CORNER DETAILS
          const roofInset = 0.8;
          const roofParapetHeight = 0.6;

          // Inset roof shape
          const insetRoofShape = new THREE.Shape();
          const insetCoords: number[][] = [];

          // Calculate inset coordinates
          let hasInvalidInset = false;

          // Project all coordinates to meters
          const meterCoords: number[][] = [];
          buildingCoords.forEach((coord: any) => {
            const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
            const latDiff = -1 * (coord[1] - center[1]) * 110540;
            meterCoords.push([lngDiff, latDiff]);
          });

          const cleanCoords: number[][] = [];
          const minDistSq = 0.0001; // 1cm squared (0.01m * 0.01m)

          meterCoords.forEach((coord) => {
            if (cleanCoords.length === 0) {
              cleanCoords.push(coord);
            } else {
              const last = cleanCoords[cleanCoords.length - 1];
              const distSq = (coord[0] - last[0]) ** 2 + (coord[1] - last[1]) ** 2;
              if (distSq > minDistSq) {
                cleanCoords.push(coord);
              }
            }
          });


          if (cleanCoords.length > 2) {
            const first = cleanCoords[0];
            const last = cleanCoords[cleanCoords.length - 1];
            const distSq = (first[0] - last[0]) ** 2 + (first[1] - last[1]) ** 2;
            if (distSq <= minDistSq) {
              cleanCoords.pop();
            }
          }

          if (cleanCoords.length < 3) {
            hasInvalidInset = true;
          } else {
            cleanCoords.forEach((coord, index) => {
              const x = coord[0];
              const y = coord[1];

              const prevIdx = (index - 1 + cleanCoords.length) % cleanCoords.length;
              const nextIdx = (index + 1) % cleanCoords.length;

              const prevCoord = cleanCoords[prevIdx];
              const nextCoord = cleanCoords[nextIdx];

              const prevX = prevCoord[0];
              const prevY = prevCoord[1];
              const nextX = nextCoord[0];
              const nextY = nextCoord[1];

              const edge1X = x - prevX;
              const edge1Y = y - prevY;
              const edge2X = nextX - x;
              const edge2Y = nextY - y;

              const len1 = Math.sqrt(edge1X * edge1X + edge1Y * edge1Y);
              const len2 = Math.sqrt(edge2X * edge2X + edge2Y * edge2Y);

              if (len1 < 0.01 || len2 < 0.01) {
                insetCoords.push([x, y]);
                if (index === 0) insetRoofShape.moveTo(x, y);
                else insetRoofShape.lineTo(x, y);
                return;
              }

              const normal1X = -edge1Y / len1;
              const normal1Y = edge1X / len1;
              const normal2X = -edge2Y / len2;
              const normal2Y = edge2X / len2;

              const avgNormalX = (normal1X + normal2X) / 2;
              const avgNormalY = (normal1Y + normal2Y) / 2;
              const avgLen = Math.sqrt(avgNormalX * avgNormalX + avgNormalY * avgNormalY);

              if (avgLen < 0.01) {
                insetCoords.push([x, y]);
                if (index === 0) insetRoofShape.moveTo(x, y);
                else insetRoofShape.lineTo(x, y);
                return;
              }

              const scale = Math.min(1 / avgLen, 3.0);

              const insetX = x + (avgNormalX * scale) * roofInset;
              const insetY = y + (avgNormalY * scale) * roofInset;
              if (!Number.isFinite(insetX) || !Number.isFinite(insetY)) {
                hasInvalidInset = true;
                return;
              }

              insetCoords.push([insetX, insetY]);

              if (index === 0) {
                insetRoofShape.moveTo(insetX, insetY);
              } else {
                insetRoofShape.lineTo(insetX, insetY);
              }
            });
          }

          if (!hasInvalidInset && insetCoords.length >= 3) {
            const roofGeometry = new THREE.ShapeGeometry(insetRoofShape);
            const roofMaterial = new THREE.MeshStandardMaterial({
              color: 0xE6DCC3,
              roughness: 0.9,
              metalness: 0.1,
              side: THREE.DoubleSide
            });
            configureMaterial(roofMaterial, isFullyOpaque, opacityVal);
            const roof = new THREE.Mesh(roofGeometry, roofMaterial);
            roof.position.z = building.height + 0.02;

            roof.renderOrder = getRenderOrder(isFullyOpaque, 2);
            buildingGroup.add(roof);

            // ADD HVAC / MECHANICAL UNITS
            /*
            if (building.area > 150) { // Only for large enough roofs
              // Calculate centroid
              let cx = 0, cy = 0;
              insetCoords.forEach(p => { cx += p[0]; cy += p[1]; });
              cx /= insetCoords.length;
              cy /= insetCoords.length;
  
              const numUnits = Math.floor(Math.random() * 2) + 1; // 1-2 units
              const unitMat = new THREE.MeshStandardMaterial({ color: 0xDDDDDD, roughness: 0.7 });
              configureMaterial(unitMat, isFullyOpaque, opacityVal);
  
              for (let u = 0; u < numUnits; u++) {
                const w = 2.0 + Math.random() * 2;
                const d = 2.0 + Math.random() * 2;
                const h = 1.2 + Math.random() * 1.0;
                const unitGeo = new THREE.BoxGeometry(w, d, h);
                const unit = new THREE.Mesh(unitGeo, unitMat);
  
                // Small random offset from center
                const offsetX = (Math.random() - 0.5) * 3;
                const offsetY = (Math.random() - 0.5) * 3;
  
                unit.position.set(cx + offsetX, cy + offsetY, building.height + h / 2);
                unit.renderOrder = getRenderOrder(isFullyOpaque, 2);
                buildingGroup.add(unit);
              }
            }
            */

            // CREATE PARAPET WALLS
            for (let i = 0; i < insetCoords.length; i++) {
              const p1 = insetCoords[i];
              const p2 = insetCoords[(i + 1) % insetCoords.length];

              const wallLength = Math.sqrt((p2[0] - p1[0]) ** 2 + (p2[1] - p1[1]) ** 2);
              const wallAngle = Math.atan2(p2[1] - p1[1], p2[0] - p1[0]);

              const parapetGeo = new THREE.BoxGeometry(wallLength, 0.4, roofParapetHeight); // Thicker wall (0.4m)
              const parapetMat = new THREE.MeshStandardMaterial({
                color: 0xFFFFFF,
                roughness: 0.5,
                metalness: 0.1
              });
              configureMaterial(parapetMat, isFullyOpaque, opacityVal);
              const parapet = new THREE.Mesh(parapetGeo, parapetMat);

              parapet.position.set(
                (p1[0] + p2[0]) / 2,
                (p1[1] + p2[1]) / 2,
                building.height + roofParapetHeight / 2
              );
              parapet.rotation.z = wallAngle;
              parapet.renderOrder = getRenderOrder(isFullyOpaque, 2);
              buildingGroup.add(parapet);

              // Add corner detail posts
              const cornerPostGeo = new THREE.CylinderGeometry(0.25, 0.25, roofParapetHeight + 0.1, 8); // Thicker posts
              const cornerPostMat = new THREE.MeshStandardMaterial({
                color: 0xFFFFFF,
                roughness: 0.5,
                metalness: 0.1
              });
              configureMaterial(cornerPostMat, isFullyOpaque, opacityVal);
              const cornerPost = new THREE.Mesh(cornerPostGeo, cornerPostMat);
              cornerPost.position.set(p1[0], p1[1], building.height + roofParapetHeight / 2);
              cornerPost.renderOrder = getRenderOrder(isFullyOpaque, 2);
              buildingGroup.add(cornerPost);
            }
          } else {
            console.warn(`Skipping inset roof for building ${building.id}: Invalid roof geometry detected`);
            const simpleRoofShape = new THREE.Shape();
            buildingCoords.forEach((coord: any, index: number) => {
              const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
              const latDiff = -1 * (coord[1] - center[1]) * 110540;
              if (index === 0) {
                simpleRoofShape.moveTo(lngDiff, latDiff);
              } else {
                simpleRoofShape.lineTo(lngDiff, latDiff);
              }
            });

            const roofGeometry = new THREE.ShapeGeometry(simpleRoofShape);
            const roofMaterial = new THREE.MeshStandardMaterial({
              color: 0xE6DCC3,
              roughness: 0.9,
              metalness: 0.1,
              side: THREE.DoubleSide
            });
            configureMaterial(roofMaterial, isFullyOpaque, opacityVal);
            const roof = new THREE.Mesh(roofGeometry, roofMaterial);
            roof.position.z = building.height + 0.02;

            roof.renderOrder = getRenderOrder(isFullyOpaque, 2);
            buildingGroup.add(roof);
          }

          const cornerMaterial = new THREE.MeshStandardMaterial({
            color: 0x505050,
            roughness: 0.8,
            metalness: 0.15
          });
          configureMaterial(cornerMaterial, isFullyOpaque, opacityVal);

          buildingCoords.forEach((coord: any, index: number) => {
            if (index < buildingCoords.length - 1) {
              const lngDiff = -1 * (coord[0] - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
              const latDiff = -1 * (coord[1] - center[1]) * 110540;

              const cornerGeo = new THREE.BoxGeometry(0.2, 0.2, roofParapetHeight + 0.1);
              const corner = new THREE.Mesh(cornerGeo, cornerMaterial);
              corner.position.set(lngDiff, latDiff, building.height + (roofParapetHeight + 0.1) / 2);
              corner.renderOrder = getRenderOrder(isFullyOpaque, 2);
              buildingGroup.add(corner);
            }
          });

          // Position entire building
          buildingGroup.position.z = building.baseHeight || 0;

          // Add to Threebox
          // @ts-ignore
          const tbObject = window.tb.Object3D({
            obj: buildingGroup,
            units: 'meters',
            anchor: 'center'
          }).setCoords([center[0], center[1]]);

          // IMPORTANT: Tag the wrapper object so our Analysis Engine can find it
          tbObject.userData.isBuildingGroup = true;
          tbObject.name = `building-wrapper-${building.id}`;

          window.tb.add(tbObject);
        } catch (error) {
          console.error(`Error rendering building ${building.id}:`, error);
          console.warn(`Skipping building ${building.id} due to rendering error`);
        }
      });
    });

    // Force repaint
    map.current?.triggerRepaint();

  }, [isMapLoaded, isThreeboxLoaded, buildingProps, selectedObjectId]);

  // Effect to handle drawing state
  useEffect(() => {
    if (!isMapLoaded || !map.current) return;
    const mapInstance = map.current;
    if (!mapInstance.isStyleLoaded()) return;

    markers.current.forEach(m => m.remove());
    markers.current = [];

    if (drawingState.isDrawing) {
      drawingPoints.forEach((point, index) => {
        const isFirstPoint = index === 0;
        const marker = new mapboxgl.Marker({ color: isFirstPoint ? FIRST_POINT_COLOR : primaryColor }).setLngLat(point as LngLatLike).addTo(mapInstance);
        markers.current.push(marker);
      });

      const outlineSource = mapInstance.getSource(DRAWING_OUTLINE_SOURCE_ID) as GeoJSONSource;
      let outlineData: turf.Feature<turf.LineString> | turf.FeatureCollection = turf.featureCollection([]);
      if (drawingPoints.length > 1) {
        outlineData = turf.lineString(drawingPoints);
      }

      if (outlineSource) {
        outlineSource.setData(outlineData);
      } else {
        mapInstance.addSource(DRAWING_OUTLINE_SOURCE_ID, { type: 'geojson', data: outlineData });
        mapInstance.addLayer({
          id: DRAWING_OUTLINE_LAYER_ID,
          type: 'line',
          source: DRAWING_OUTLINE_SOURCE_ID,
          paint: { 'line-color': '#F5A623', 'line-width': 3, 'line-dasharray': [2, 1] },
        });
      }
    } else {
      if (mapInstance.getLayer(DRAWING_OUTLINE_LAYER_ID)) {
        mapInstance.removeLayer(DRAWING_OUTLINE_LAYER_ID);
      }
      if (mapInstance.getSource(DRAWING_OUTLINE_SOURCE_ID)) {
        mapInstance.removeSource(DRAWING_OUTLINE_SOURCE_ID);
      }
    }
  }, [drawingState.isDrawing, drawingPoints, isMapLoaded, primaryColor]);


  // Effect to render all plots and their contents
  useEffect(() => {
    if (!isMapLoaded || !map.current || !map.current.isStyleLoaded()) return;
    const mapInstance = map.current;

    const renderedIds = new Set<string>();

    const allLabels: turf.Feature<turf.Point, { label: string; id: string }>[] = [];

    // Ensure the label layer and source exist before we do anything else
    if (!mapInstance.getSource(LABELS_SOURCE_ID)) {
      mapInstance.addSource(LABELS_SOURCE_ID, {
        type: 'geojson',
        data: turf.featureCollection([]),
      });
    }
    if (!mapInstance.getLayer(LABELS_LAYER_ID)) {
      mapInstance.addLayer({
        id: LABELS_LAYER_ID,
        type: 'symbol',
        source: LABELS_SOURCE_ID,
        layout: {
          'text-field': ['get', 'label'],
          'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
          'text-size': 14,
          'text-anchor': 'center',
          'text-allow-overlap': false,
          'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
          'text-radial-offset': 0.5,
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#000000',
          'text-halo-width': 1.5,
        },
      });
    }


    plots.forEach(plot => {
      // Add plot area label
      if (plot.centroid) {
        allLabels.push(
          turf.point(plot.centroid.geometry.coordinates, {
            label: `${plot.area.toFixed(0)} m²`,
            id: `plot-label-${plot.id}`,
          })
        );
      }

      // Add building labels
      plot.buildings.forEach(building => {
        if (building.centroid) {
          let labelText = `${building.name}\n${building.intendedUse}\n${building.area.toFixed(0)} m²`;

          allLabels.push(
            turf.point(building.centroid.geometry.coordinates, {
              label: labelText,
              id: `building-label-${building.id}`,
            })
          );
        }
      });

      plot.greenAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} m²`,
              id: `green-area-label-${area.id}`
            })
          )
        }
      });

      plot.parkingAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} m²`,
              id: `parking-area-label-${area.id}`
            })
          )
        }
      });

      plot.buildableAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} m²`,
              id: `buildable-area-label-${area.id}`
            })
          )
        }
      });
      plot.utilityAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n(${area.type})\n${area.area.toFixed(0)} m²`,
              id: `utility-area-label-${area.id}`
            })
          )
        }
      });
    });

    const labelCollection = turf.featureCollection(allLabels);
    const labelsSource = mapInstance.getSource(LABELS_SOURCE_ID) as GeoJSONSource;
    if (labelsSource) {
      labelsSource.setData(labelCollection);
    }

    plots.forEach(plot => {
      const plotId = plot.id;

      renderedIds.add(`plot-base-${plotId}`);
      renderedIds.add(`plot-setback-${plotId}`);
      renderedIds.add(`plot-label-${plotId}`);

      plot.buildings.forEach(b => {
        renderedIds.add(`building-source-${b.id}`);
        renderedIds.add(`building-label-${b.id}`);
        b.floors.forEach(f => {
          renderedIds.add(`building-floor-fill-${f.id}-${b.id}`);
          renderedIds.add(`building-floor-border-${f.id}-${b.id}`);
        })
      });
      plot.greenAreas.forEach(g => {
        renderedIds.add(`green-area-${g.id}`);
        renderedIds.add(`green-area-label-${g.id}`);
      });
      plot.parkingAreas.forEach(p => {
        renderedIds.add(`parking-area-${p.id}`);
        renderedIds.add(`parking-area-label-${p.id}`);
      });
      plot.buildableAreas.forEach(b => {
        renderedIds.add(`buildable-area-${b.id}`);
        renderedIds.add(`buildable-area-border-${b.id}`);
        renderedIds.add(`buildable-area-label-${b.id}`);
      });
      plot.utilityAreas.forEach(u => {
        renderedIds.add(`utility-area-${u.id}`);
        renderedIds.add(`utility-area-label-${u.id}`);
      });

      const plotBaseSourceId = `plot-base-${plotId}`;
      const plotSetbackSourceId = `plot-setback-${plotId}`;
      const plotBaseLayerId = `plot-base-${plotId}`;
      const plotSetbackLayerId = `plot-setback-${plotId}`;

      let setbackPolygon = null;
      try {
        if (plot.geometry.geometry.type === 'Polygon' && plot.setback > 0) {
          setbackPolygon = turf.buffer(plot.geometry, -plot.setback, { units: 'meters' } as any);
        }
      } catch (e) {
        console.warn("Could not create setback buffer, likely invalid geometry. A common cause is self-intersecting polygons.", e);
        setbackPolygon = plot.geometry;
      }

      let sourceBase = mapInstance.getSource(plotBaseSourceId) as GeoJSONSource;
      if (sourceBase) sourceBase.setData(plot.geometry);
      else mapInstance.addSource(plotBaseSourceId, { type: 'geojson', data: plot.geometry });

      if (!mapInstance.getLayer(plotBaseLayerId)) {
        mapInstance.addLayer({
          id: plotBaseLayerId,
          type: 'fill',
          source: plotBaseSourceId,
          paint: { 'fill-color': '#4a5568', 'fill-opacity': 0.1 }
        }, LABELS_LAYER_ID);
      }

      let sourceSetback = mapInstance.getSource(plotSetbackSourceId) as GeoJSONSource;
      if (sourceSetback) sourceSetback.setData(setbackPolygon || plot.geometry);
      else mapInstance.addSource(plotSetbackSourceId, { type: 'geojson', data: setbackPolygon || plot.geometry });

      if (!mapInstance.getLayer(plotSetbackLayerId)) {
        mapInstance.addLayer({
          id: plotSetbackLayerId,
          type: 'line',
          source: plotSetbackSourceId,
          paint: { 'line-color': '#f6ad55', 'line-width': 2, 'line-dasharray': [2, 2] }
        }, LABELS_LAYER_ID);
      }

      plot.buildings.forEach(building => {
        const buildingSourceId = `building-source-${building.id}`;
        const isSelected = selectedObjectId?.id === building.id;

        // Legacy rendering removed in favor of Threebox
        // We keep the source creation if needed for other things, but for now we can skip it if unused.
        // Actually, let's keep the source creation just in case we want to add a 2D footprint later.
        let buildingSource = mapInstance.getSource(buildingSourceId) as GeoJSONSource;
        if (buildingSource) buildingSource.setData(building.geometry);
        else mapInstance.addSource(buildingSourceId, { type: 'geojson', data: building.geometry });
      });

      plot.greenAreas.forEach(area => {
        const areaId = `green-area-${area.id}`;
        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(area.geometry);
        else mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry });

        if (!mapInstance.getLayer(areaId)) {
          mapInstance.addLayer({ id: areaId, type: 'fill', source: areaId, paint: { 'fill-color': '#48bb78', 'fill-opacity': 0.7 } }, LABELS_LAYER_ID);
        }
      });

      plot.parkingAreas.forEach(area => {
        const areaId = `parking-area-${area.id}`;
        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(area.geometry);
        else mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry });

        if (!mapInstance.getLayer(areaId)) {
          mapInstance.addLayer({ id: areaId, type: 'fill', source: areaId, paint: { 'fill-color': '#374151', 'fill-opacity': 0.7 } }, LABELS_LAYER_ID);
        }
      });

      plot.buildableAreas.forEach(area => {
        const areaId = `buildable-area-${area.id}`;
        const borderId = `buildable-area-border-${area.id}`;
        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(area.geometry);
        else mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry });

        if (!mapInstance.getLayer(areaId)) {
          mapInstance.addLayer({ id: areaId, type: 'fill', source: areaId, paint: { 'fill-color': '#a78bfa', 'fill-opacity': selectedObjectId?.id === area.id ? 0.3 : 0.1 } }, LABELS_LAYER_ID);
          mapInstance.addLayer({ id: borderId, type: 'line', source: areaId, paint: { 'line-color': '#8b5cf6', 'line-width': 2, 'line-dasharray': [2, 1] } }, LABELS_LAYER_ID);
        } else {
          mapInstance.setPaintProperty(areaId, 'fill-opacity', selectedObjectId?.id === area.id ? 0.4 : 0.1);
          mapInstance.setPaintProperty(borderId, 'line-color', selectedObjectId?.id === area.id ? '#c4b5fd' : '#8b5cf6');
        }
      });

      // Debug logging for utility zones
      console.log('[Utility Render Debug] Plot has', plot.utilityAreas?.length || 0, 'utility areas');

      plot.utilityAreas.forEach(area => {
        const areaId = `utility-area-${area.id}`;
        console.log('[Utility Render Debug] Rendering', area.name, 'type:', area.type, 'id:', areaId);

        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(area.geometry);
        else mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry });

        const color = UTILITY_COLORS[area.type] || '#cccccc';

        if (!mapInstance.getLayer(areaId)) {
          mapInstance.addLayer({
            id: areaId,
            type: 'fill-extrusion',
            source: areaId,
            paint: {
              'fill-extrusion-color': color,
              'fill-extrusion-height': 2, // Extrude them slightly to make them visible
              'fill-extrusion-opacity': 0.9
            }
          }, LABELS_LAYER_ID);
          console.log('[Utility Render Debug] Created layer for', area.name, 'with color', color);
        } else {
          // Update color if type changes (dynamic color update)
          mapInstance.setPaintProperty(areaId, 'fill-extrusion-color', color);
        }
      });
    });

    const currentStyle = mapInstance.getStyle();
    if (currentStyle && currentStyle.layers) {
      currentStyle.layers.forEach(layer => {
        const layerId = layer.id;
        const isManagedByPlots = layerId.startsWith('plot-') || layerId.startsWith('building-') || layerId.startsWith('green-') || layerId.startsWith('parking-') || layerId.startsWith('buildable-') || layerId.startsWith('utility-');

        if (isManagedByPlots && !renderedIds.has(layerId) && layerId !== LABELS_LAYER_ID) {
          if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
        }
      });
    }

    if (currentStyle && currentStyle.sources) {
      Object.keys(currentStyle.sources).forEach(sourceId => {
        const isManagedByPlots = sourceId.startsWith('plot-') || sourceId.startsWith('building-') || sourceId.startsWith('green-') || sourceId.startsWith('parking-') || sourceId.startsWith('buildable-') || sourceId.startsWith('utility-');

        if (isManagedByPlots && !renderedIds.has(sourceId) && sourceId !== LABELS_SOURCE_ID) {
          const isSourceInUse = mapInstance.getStyle().layers.some(layer => (layer as any).source === sourceId);
          if (!isSourceInUse && mapInstance.getSource(sourceId)) {
            mapInstance.removeSource(sourceId);
          }
        }
      });
    }

  }, [plots, isMapLoaded, selectedObjectId, primaryColor, isLoading]);


  return (
    <div className="relative w-full h-full">
      <Script
        src="https://cdn.jsdelivr.net/gh/jscastro76/threebox@v.2.2.2/dist/threebox.min.js"
        strategy="afterInteractive"
        onLoad={() => {
          console.log('Threebox script loaded');
          setIsThreeboxLoaded(true);
        }}
      />
      <div ref={mapContainer} className="w-full h-full" />

      {/* Sidebar Overlay */}


    </div>
  );
}
