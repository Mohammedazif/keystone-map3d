import { useBuildingStore, UTILITY_COLORS } from '@/hooks/use-building-store';
import { BUILDING_MATERIALS, hslToRgb } from '@/lib/color-utils';
import { useToast } from '@/hooks/use-toast';
import { BuildingIntendedUse, GreenRegulationData, UtilityType } from '@/lib/types';
import { Feature, Polygon, Point } from 'geojson';
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
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [isThreeboxLoaded, setIsThreeboxLoaded] = useState(false);
  const [isTerrainEnabled, setIsTerrainEnabled] = useState(false); // Terrain OFF by default
  const markers = useRef<Marker[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState('hsl(210, 40%, 50%)'); // Default primary color
  const hasNavigatedRef = useRef(false); // Track if we've navigated in this component instance
  const threeboxObjects = useRef<any[]>([]); // Track active Threebox objects for cleanup



  // Optimized Selectors
  const actions = useBuildingStore(s => s.actions);
  const drawingPoints = useBuildingStore(s => s.drawingPoints);
  const drawingState = useBuildingStore(s => s.drawingState);
  const selectedObjectId = useBuildingStore(s => s.selectedObjectId);
  const isLoading = useBuildingStore(s => s.isLoading);
  const plots = useBuildingStore(s => s.plots);
  const uiState = useBuildingStore(s => s.uiState);
  const activeProjectId = useBuildingStore(s => s.activeProjectId);
  const projects = useBuildingStore(s => s.projects);


  const activeProject = projects.find(p => p.id === activeProjectId);
  const { regulations } = useRegulations(activeProject || null);





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

      // Terrain & Atmosphere Configuration
      mapInstance.setMaxPitch(85); // Allow looking up easier in mountains

      // NOTE: Terrain disabled per user request for "flat" plot
      /*
      // Add terrain source
      mapInstance.addSource('mapbox-dem', {
        'type': 'raster-dem',
        'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
        'tileSize': 512,
        'maxzoom': 14
      });

      // add the DEM source as a terrain layer (OFF by default, user can toggle)
      mapInstance.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': 1.5 });
      */

      // Add Sky Layer for better horizon context in 3D
      mapInstance.addLayer({
        'id': 'sky',
        'type': 'sky',
        'paint': {
          'sky-type': 'atmosphere',
          'sky-atmosphere-sun': [0.0, 0.0],
          'sky-atmosphere-sun-intensity': 15
        }
      });

      // Enable 3D buildings in Mapbox Standard Style
      try {
        mapInstance.setConfigProperty('basemap', 'show3dObjects', true);
      } catch (e) {
        console.warn("Could not set show3dObjects config", e);
      }

      setIsMapLoaded(true);
    });

    // Listen for style data changes to ensure we render when style is ready
    mapInstance.on('styledata', () => {
      if (mapInstance.isStyleLoaded()) {
        setStyleLoaded(true);
      }
    });

    mapInstance.on('click', handleMapClick);

    return () => {
      const mapInst = map.current;
      if (!mapInst) return;
      mapInst.remove();
      map.current = null;
    };

  }, []);



  // Auto-navigate to project location or first plot on load
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    // Check if we've already navigated in this component instance
    if (hasNavigatedRef.current) return;

    // Priority 1: Use first plot's centroid if available
    if (plots.length > 0) {
      const firstPlot = plots[0];
      if (firstPlot?.geometry?.geometry) {
        try {
          const centroid = turf.centroid(firstPlot.geometry);
          const [lng, lat] = centroid.geometry.coordinates;

          console.log('✈️ Flying to plot centroid:', { lat, lng });
          map.current.flyTo({
            center: [lng, lat],
            zoom: 17,
            essential: true,
            duration: 1500
          });

          // Trigger map update after navigation completes
          map.current.once('moveend', () => {
            if (map.current) {
              hasNavigatedRef.current = true;
              console.log('✅ Marked as navigated (session)');

              // Trigger single repaint
              map.current.triggerRepaint();

              // Auto-select immediately
              actions.selectObject(firstPlot.id, 'Plot');
              console.log('🎯 Auto-selected plot for visibility');
            }
          });
          return;
        } catch (error) {
          console.warn('Failed to calculate plot centroid:', error);
        }
      }
    }

    // Priority 2: Use project location if no plots exist
    if (activeProject?.location && typeof activeProject.location === 'object') {
      const { lat, lng } = activeProject.location as { lat: number, lng: number };
      if (lat && lng) {
        console.log('✈️ Flying to project location:', { lat, lng });
        map.current.flyTo({
          center: [lng, lat],
          zoom: 16,
          essential: true,
          duration: 1500
        });

        map.current.once('moveend', () => {
          if (map.current) {
            hasNavigatedRef.current = true;
            map.current.triggerRepaint();
          }
        });
      }
    }
  }, [isMapLoaded, plots, activeProject, activeProjectId, actions]);

  // Automatic Road Detection
  useEffect(() => {
    if (!map.current || !isMapLoaded || plots.length === 0) return;

    const detectRoads = () => {
      // Small debounce to prevent thrashing during pan/zoom
      if (map.current?.isMoving()) return;

      plots.forEach(plot => {
        // Skip if already detected to save performance (optional, or re-detect on move?)
        // For now, let's re-detect to be robust 
        if (!plot.geometry || !plot.visible) return;

        // Get plot bbox in pixels
        const bbox = turf.bbox(plot.geometry);
        const [minX, minY, maxX, maxY] = bbox;

        // Convert real coords to screen pixels
        const sw = map.current!.project([minX, minY]);
        const ne = map.current!.project([maxX, maxY]);

        // Add 30px buffer to look for roads around the plot
        const buffer = 30;
        const queryBox: [mapboxgl.PointLike, mapboxgl.PointLike] = [
          [Math.min(sw.x, ne.x) - buffer, Math.min(sw.y, ne.y) - buffer],
          [Math.max(sw.x, ne.x) + buffer, Math.max(sw.y, ne.y) + buffer]
        ];

        // Query map features
        const features = map.current!.queryRenderedFeatures(queryBox, {
          // Filter by known Mapbox road layers (standard style)
          filter: ['any',
            ['in', 'class', 'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street', 'minor', 'road'],
            ['in', 'highway', 'residential', 'service', 'track', 'footway']
          ]
        });

        // Filter results specifically for road-like layers
        // Mapbox Standard/Streets use 'road-label', 'road-primary', etc.
        const roadFeatures = features.filter(f => {
          const id = f.layer?.id.toLowerCase();
          return id && (id.includes('road') || id.includes('street') || id.includes('way')) && !id.includes('label');
        });

        if (roadFeatures.length > 0) {
          // Determine Direction
          // Simple heuristic: Where is the road relative to plot centroid?
          const center = turf.centroid(plot.geometry);
          const [cx, cy] = center.geometry.coordinates;

          const accessSides = new Set<string>();

          roadFeatures.forEach(rf => {
            // Get nearest point on road using turf (expensive loop?)
            // Cheaper: Look at feature bounding box or vertices
            // Even cheaper: Check if road bbox intersects with N/S/E/W quadrants relative to center
            const rBbox = turf.bbox(rf);

            // If road overlaps or is close to North side (y > cy)
            if (rBbox[3] > cy + (maxY - minY) * 0.4) accessSides.add('N');
            // South (y < cy)
            if (rBbox[1] < cy - (maxY - minY) * 0.4) accessSides.add('S');
            // East (x > cx)
            if (rBbox[2] > cx + (maxX - minX) * 0.4) accessSides.add('E');
            // West (x < cx)
            if (rBbox[0] < cx - (maxX - minX) * 0.4) accessSides.add('W');
          });

          // Update Plot if changed
          const newSides = Array.from(accessSides);
          const oldSides = plot.roadAccessSides || [];

          // Shallow compare
          const hasChanged = newSides.length !== oldSides.length || !newSides.every(s => oldSides.includes(s));

          if (hasChanged && newSides.length > 0) {
            console.log(`🛣️ Detected Road Access for ${plot.name}:`, newSides);
            actions.updatePlot(plot.id, { roadAccessSides: newSides });
            toast({
              title: "Road Access Detected",
              description: `Identified roads on: ${newSides.join(', ')} side(s).`
            });
          }
        }
      });
    };

    map.current.on('idle', detectRoads);
    // return () => map.current?.off('idle', detectRoads); // Cleanup?
    // Note: React effects run often, we likely need to debounce this or only run once per plot load.
    // For now, 'idle' is good as it runs after tiles load.

  }, [isMapLoaded, plots, actions]);


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

      // Strict cleanup: Remove ALL heatmap overlays from world
      if (window.tb && window.tb.world) {
        window.tb.world.traverse((obj: any) => {
          if (obj.name && obj.name.startsWith('heatmap-overlay-')) {
            obj.parent?.remove(obj);
          }
        });
        window.tb.repaint();
      }
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
        // Calculate bbox center for accurate positioning
        const bbox = turf.bbox(plot.geometry);
        const center: [number, number] = [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

        console.log('📍 Vastu Compass Center (bbox center):', center, 'Plot:', plot.id);
        console.log('🔍 DETAILED DEBUG:', {
          plotId: plot.id,
          bboxCenterUsed: center,
          bbox: bbox,
          plotCentroid: plot.centroid?.geometry?.coordinates,
          geometryType: plot.geometry?.type,
          area: plot.area
        });

        // Radius: Make it smaller to fit within plot (0.5x the calculated radius)
        const r = Math.sqrt(plot.area / Math.PI) * 0.5;
        console.log('🎯 Compass Radius:', r, 'meters');

        const compassGroup = createShaktiChakraGroup(THREE, r);
        const compassName = 'vastu-compass-group';
        compassGroup.name = `${compassName}-${plot.id}`;

        // Get elevation at centroid
        let elevation = 0;
        if (map.current?.queryTerrainElevation) {
          elevation = map.current.queryTerrainElevation({ lng: center[0], lat: center[1] }) || 0;
        }

        // Create Threebox Object with explicit anchor
        // @ts-ignore
        const tbObj = window.tb.Object3D({
          obj: compassGroup,
          units: 'meters',
          anchor: 'center'  // Explicitly set anchor to center
        }).setCoords([center[0], center[1], elevation + 0.5]);  // Add small elevation offset

        console.log('✅ Threebox Object Created:', {
          name: `${compassName}-${plot.id}`,
          coordinates: center,
          elevation: elevation,
          radius: r,
          tbObjName: tbObj.name
        });

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



            // 3. Entrance Visualization (Green Arrow)
            if (building.entrances && building.entrances.length > 0) {
              building.entrances.forEach((entrance, idx) => {
                const entColor = 0x00FF00; // Bright Green
                const entSize = 1.0;
                const entHeight = 2.0;

                // Position: Convert from Lat/Lng to Local 3D
                const [lng, lat] = entrance.position;
                const entX = -1 * (lng - center[0]) * 111320 * Math.cos(center[1] * Math.PI / 180);
                const entY = -1 * (lat - center[1]) * 110540;

                // Create Cone pointing down
                const coneGeo = new THREE.ConeGeometry(entSize * 0.6, entHeight, 16);
                const coneMat = new THREE.MeshStandardMaterial({
                  color: entColor,
                  emissive: 0x004400,
                  roughness: 0.2,
                  metalness: 0.3
                });
                configureMaterial(coneMat, isFullyOpaque, 1.0);

                const cone = new THREE.Mesh(coneGeo, coneMat);
                cone.position.set(entX, entY, 3.0); // Float at 3m height
                cone.rotation.x = Math.PI; // Point Down
                cone.renderOrder = getRenderOrder(true, 5); // Render on top

                buildingGroup.add(cone);
              });
            }

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
                frame.frustumCulled = false; // Prevent culling
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

            // Extract properties for visualization logic
            const buildProps = building.geometry.properties || {};
            const subtype = buildProps.subtype || 'general';

            // Calculate approximate dimensions from BBox for Core sizing
            const bbox = turf.bbox(building.geometry);
            const width = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'meters' });
            const depth = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'meters' });

            // CREATE CORE (Concrete Shaft) - DISABLED: Using Mapbox fill-extrusion cores instead
            // This was creating a grey box at the building centroid which appeared in the courtyard for U-shapes
            // const coreWidth = Math.max(3, width * 0.2);
            // const coreDepth = Math.max(3, depth * 0.2);
            // const coreGeo = new THREE.BoxGeometry(coreWidth, coreDepth, building.height + 1.5);
            // const coreMat = new THREE.MeshStandardMaterial({
            //   color: 0x707070,
            //   roughness: 0.9,
            //   metalness: 0.1
            // });
            // configureMaterial(coreMat, isFullyOpaque, opacityVal);
            // const core = new THREE.Mesh(coreGeo, coreMat);
            // core.position.set(0, 0, (building.height + 1.5) / 2);
            // core.renderOrder = getRenderOrder(isFullyOpaque, 3);
            // buildingGroup.add(core);

            // CREATE UNITS (Conceptual Volume Blocks) - DISABLED based on user feedback
            // if (subtype !== 'park' && (subtype === 'slab' || subtype === 'tower' || subtype === 'generated' || building.intendedUse === 'Residential')) {
            //   const numFloors = Math.floor(building.height / 3.5); // Approx 3.5m floor to floor
            //   // Limit to avoid performance hit on huge buildings
            //   const floorsToShow = Math.min(numFloors, 50);

            //   // Use InstancedMesh for performance if we were doing thousands, but for now simple loop is okay for < 50 items
            //   // Actually, let's just do a few floors to show the concept
            //   const startFloor = 1;

            //   for (let f = startFloor; f < floorsToShow; f++) {
            //     const z = f * 3.5;

            //     // Create 4 'units' per floor for visual breakup
            //     const unitSize = 2.5;
            //     // Place in corners relative to core
            //     const offsets = [
            //       { x: coreWidth / 1.5 + 1, y: coreDepth / 1.5 + 1 },
            //       { x: -(coreWidth / 1.5 + 1), y: coreDepth / 1.5 + 1 },
            //       { x: coreWidth / 1.5 + 1, y: -(coreDepth / 1.5 + 1) },
            //       { x: -(coreWidth / 1.5 + 1), y: -(coreDepth / 1.5 + 1) }
            //     ];

            //     offsets.forEach(off => {
            //       // Random variation to look like occupied units
            //       if (Math.random() > 0.3) {
            //         const uW = 3 + Math.random();
            //         const uD = 3 + Math.random();
            //         const uH = 2.8;
            //         const uGeo = new THREE.BoxGeometry(uW, uD, uH);
            //         const uMat = new THREE.MeshStandardMaterial({
            //           color: 0xFFF8E7, // Warm interior light
            //           emissive: 0xFFF0D0,
            //           emissiveIntensity: 0.2
            //         });
            //         configureMaterial(uMat, isFullyOpaque, opacityVal);
            //         const unit = new THREE.Mesh(uGeo, uMat);
            //         unit.position.set(off.x, off.y, z + uH / 2);
            //         unit.renderOrder = getRenderOrder(isFullyOpaque, 2);
            //         buildingGroup.add(unit);
            //       }
            //     });
            //   }
            // }

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
          // Add to Threebox
          // Get terrain elevation: Anchor at the LOWEST point of the footprint to avoid floating corners
          let elevation = 0;
          if (map.current && map.current.queryTerrainElevation) {
            // Check all corners to find minimum elevation
            let minElev = Infinity;

            // Check centroid first
            const centerLngLat = { lng: center[0], lat: center[1] } as mapboxgl.LngLatLike;
            const centerElev = map.current.queryTerrainElevation(centerLngLat) || 0;
            minElev = centerElev;

            // Check polygon vertices
            if (buildingCoords && buildingCoords.length > 0) {
              buildingCoords.forEach((coord: any) => {
                const pt = { lng: coord[0], lat: coord[1] } as mapboxgl.LngLatLike;
                const elev = map.current!.queryTerrainElevation(pt) ?? 0;
                if (elev !== null && elev < minElev) {
                  minElev = elev;
                }
              });
            }

            // If we found a valid min elevation (and it's not still Infinity for some reason)
            if (minElev !== Infinity && minElev !== null && minElev !== undefined) {
              elevation = minElev;
            } else {
              elevation = 0; // Default to 0 if strictly invalid
            }
          }

          // @ts-ignore
          const tbObject = window.tb.Object3D({
            obj: buildingGroup,
            units: 'meters',
            anchor: 'auto'
          }).setCoords([center[0], center[1], elevation]);

          // IMPORTANT: Tag the wrapper object so our Analysis Engine can find it
          tbObject.userData.isBuildingGroup = true;
          tbObject.name = `building-wrapper-${building.id}`;

          // DEEP CULLING FIX: Disable frustum culling on the wrapper and all children
          tbObject.frustumCulled = false;
          tbObject.traverse((child: any) => {
            child.frustumCulled = false;
            // Force bounding sphere update if possible
            if (child.geometry) {
              child.geometry.computeBoundingSphere();
            }
          });

          window.tb.add(tbObject);
          threeboxObjects.current.push(tbObject);
        } catch (error) {
          console.error(`Error rendering building ${building.id}:`, error);
          console.warn(`Skipping building ${building.id} due to rendering error`);
        }
      });
    });

    // RENDER ENTRY / EXIT POINTS
    plots.forEach(plot => {
      if (!plot.visible) return;

      // If no entries defined, generate default one based on Vastu or Geometry
      let entries = plot.entries || [];
      if (entries.length === 0 && plot.geometry) {
        // Auto-generate logic (Visual only, ephemeral)
        const bbox = turf.bbox(plot.geometry); // [minX, minY, maxX, maxY]

        let entryPos: [number, number] | null = null;

        if (activeProject?.vastuCompliant) {
          // Vastu: Preferred North-East, East, North
          // Simple logic: Find vertex closest to North-East corner of bbox
          const neCorner = [bbox[2], bbox[3]]; // MaxX, MaxY
          // @ts-ignore
          const vertices = turf.explode(plot.geometry).features;
          let closest = vertices[0];
          let minDist = Infinity;

          vertices.forEach((v: any) => {
            // @ts-ignore
            const dist = turf.distance(v, turf.point(neCorner));
            if (dist < minDist) {
              minDist = dist;
              closest = v;
            }
          });
          // @ts-ignore
          entryPos = closest.geometry.coordinates as [number, number];
        } else {
          // Default: South or arbitrary road facing side (Bottom edge)
          const sCorner = [(bbox[0] + bbox[2]) / 2, bbox[1]]; // Mid-South
          entryPos = sCorner as [number, number];
        }

        if (entryPos) {
          entries = [{
            id: `auto-entry-${plot.id}`,
            type: 'Entry',
            position: entryPos,
            name: 'Main Gate'
          }];
        }
      }

      entries.forEach(entry => {
        const color = entry.type === 'Entry' ? 0x00FF00 : (entry.type === 'Exit' ? 0xFF0000 : 0xFFAA00);

        // Create 3D Marker (Cone pointing down)
        const geometry = new THREE.ConeGeometry(2, 6, 8);
        geometry.rotateX(Math.PI); // Point down
        const material = new THREE.MeshStandardMaterial({ color: color, emissive: color, emissiveIntensity: 0.5 });
        const marker = new THREE.Mesh(geometry, material);

        // Get elevation
        // @ts-ignore
        let elev = 0;
        if (map.current?.queryTerrainElevation) {
          elev = map.current.queryTerrainElevation({ lng: entry.position[0], lat: entry.position[1] }) || 0;
        }

        // @ts-ignore
        const tbObj = window.tb.Object3D({
          obj: marker,
          units: 'meters',
          anchor: 'center'
        }).setCoords([entry.position[0], entry.position[1], elev + 4]); // Float 4m above ground

        window.tb.add(tbObj);
        threeboxObjects.current.push(tbObj);
      });
    });


    // RENDER TREES IN GREEN AREAS
    // Optimization: create geometries once.
    const rectTrunkGeo = new THREE.CylinderGeometry(0.2, 0.3, 1.5, 5);
    const rectLeafGeo = new THREE.ConeGeometry(1.5, 3, 6);

    plots.forEach(plot => {
      if (!plot.visible) return;
      plot.greenAreas.forEach(ga => {
        if (!ga.geometry || ga.geometry.geometry.type !== 'Polygon') return;
        const areaSqM = ga.area || turf.area(ga.geometry);
        const numTrees = Math.min(15, Math.floor(areaSqM / 50));
        if (numTrees <= 0) return;

        const bbox = turf.bbox(ga.geometry);
        let treesAdded = 0;
        let attempts = 0;

        while (treesAdded < numTrees && attempts < 50) {
          attempts++;
          const lng = bbox[0] + Math.random() * (bbox[2] - bbox[0]);
          const lat = bbox[1] + Math.random() * (bbox[3] - bbox[1]);
          if (turf.booleanPointInPolygon(turf.point([lng, lat]), ga.geometry as any)) {
            treesAdded++;
            const scale = 0.5 + Math.random() * 0.8;

            const trunk = new THREE.Mesh(rectTrunkGeo, new THREE.MeshStandardMaterial({ color: 0x5D4037 }));
            const leaves = new THREE.Mesh(rectLeafGeo, new THREE.MeshStandardMaterial({ color: 0x2E7D32 }));

            trunk.scale.set(scale, scale, scale);
            leaves.scale.set(scale, scale, scale);

            trunk.position.z = (1.5 * scale) / 2;
            trunk.rotation.x = Math.PI / 2; // Upright in Threebox (Z is up)

            leaves.position.z = (1.5 * scale) + (1.5 * scale) / 2; // Stacked
            leaves.rotation.x = Math.PI / 2;

            const treeGrp = new THREE.Group();
            treeGrp.add(trunk);
            treeGrp.add(leaves);

            // Elevation
            let elev = 0;
            if (map.current?.queryTerrainElevation) {
              elev = map.current.queryTerrainElevation({ lng, lat }) || 0;
            }

            // @ts-ignore
            const tbTree = window.tb.Object3D({
              obj: treeGrp,
              units: 'meters',
              anchor: 'center'
            }).setCoords([lng, lat, elev]);

            window.tb.add(tbTree);
            threeboxObjects.current.push(tbTree);
          }
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


  // Debug Effect: Trace Plots Data
  useEffect(() => {
    if (plots.length > 0) {
      console.log(`[MapEditor] 🕵️ Plots Data Updated. Count: ${plots.length}`);
      const p0 = plots[0];
      console.log(`[MapEditor] Plot[0] Preview:`, {
        id: p0.id,
        geometryType: p0.geometry?.type,
        coordsSample: (p0.geometry as any)?.coordinates ? 'Present' : 'Missing',
        isGeometryObject: typeof p0.geometry === 'object',
        geometryKeys: p0.geometry ? Object.keys(p0.geometry) : []
      });
    } else {
      console.log(`[MapEditor] Plots array is empty.`);
    }
  }, [plots, uiState.ghostMode]);

  // Effect to render all plots and their contents
  useEffect(() => {
    console.log(`[MapEditor] Render Effect Triggered. isMapLoaded: ${isMapLoaded}, styleLoaded: ${styleLoaded}, mapRef: ${!!map.current}`);

    if (!isMapLoaded || !styleLoaded || !map.current) {
      if (map.current && map.current.isStyleLoaded() && !styleLoaded) {
        // Fallback: If map says style is loaded but state lags, force update
        console.log("[MapEditor] Style check passed despite state lag. Updating state...");
        setStyleLoaded(true);
      } else {
        console.warn("[MapEditor] Render Effect SKIPPED due to map state.");
        return;
      }
    }
    const mapInstance = map.current;

    // FIX: Hide standard Mapbox 3D buildings to prevent overlap glitch
    if (mapInstance.getLayer('building')) {
      mapInstance.setLayoutProperty('building', 'visibility', 'none');
    }
    if (mapInstance.getLayer('3d-buildings')) {
      mapInstance.setLayoutProperty('3d-buildings', 'visibility', 'none');
    }

    const renderedIds = new Set<string>();

    // PRE-CLEANUP: Remove ALL old core/unit layers before rendering new ones
    // This prevents ghost layers from persisting across renders
    const existingLayers = mapInstance.getStyle()?.layers || [];
    existingLayers.forEach(layer => {
      const layerId = layer.id;
      if (layerId.startsWith('core-') || layerId.startsWith('unit-')) {
        if (mapInstance.getLayer(layerId)) {
          try {
            mapInstance.removeLayer(layerId);
          } catch (e) {
            console.warn('[PRE-CLEANUP] Failed to remove layer:', layerId, e);
          }
        }
      }
    });

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
          'text-opacity': ['case',
            ['boolean', ['feature-state', 'hover'], false], 1,
            ['==', ['get', 'linkedId'], 'SELECTED_ID_PLACEHOLDER'], 1, // We'll update this via setPaintProperty
            0
          ]
        },
      });
    }

    // Effect to update label visibility based on selection/hover
    // We do this separately to avoid full re-render
    if (mapInstance.getLayer(LABELS_LAYER_ID)) {
      mapInstance.setPaintProperty(LABELS_LAYER_ID, 'text-opacity', [
        'case',
        ['==', ['get', 'linkedId'], hoveredId || ''], 1,
        0
      ]);
    }


    plots.forEach(plot => {
      // Add plot area label
      if (plot.centroid) {
        allLabels.push(
          turf.point(plot.centroid.geometry.coordinates, {
            label: `${plot.area.toFixed(0)} m²`,
            id: `plot-label-${plot.id}`,
            linkedId: plot.id // Link to plot ID for selection highlight
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
              linkedId: building.id // Link to building ID for hover
            })
          );
        }

        // --- RENDER INTERNAL LAYOUT (CORES & UNITS) ---
        // Cores
        if (building.cores) {
          building.cores.forEach(core => {
            const layerId = `core-${building.id}-${core.id}`;
            renderedIds.add(layerId);

            // Add props for rendering
            const geometry = {
              ...core.geometry,
              properties: {
                ...core.geometry.properties,
                height: building.numFloors * (building.typicalFloorHeight || 3),
                base_height: 0,
                color: '#FF00FF' // Magenta for Core visibility
              }
            };

            let source = mapInstance.getSource(layerId) as GeoJSONSource;
            if (source) source.setData(geometry);
            else mapInstance.addSource(layerId, { type: 'geojson', data: geometry });

            if (!mapInstance.getLayer(layerId)) {
              mapInstance.addLayer({
                id: layerId,
                type: 'fill-extrusion',
                source: layerId,
                minzoom: 15,
                paint: {
                  'fill-extrusion-color': ['get', 'color'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-opacity': uiState.ghostMode ? 0.95 : 0
                }
              }, LABELS_LAYER_ID);
            } else {
              mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', uiState.ghostMode ? 0.95 : 0);
            }
          });
        }

        // Units
        if (building.units) {
          building.units.forEach(unit => {
            const layerId = `unit-${building.id}-${unit.id}`;
            renderedIds.add(layerId);

            // Add props for rendering
            const geometry = {
              ...unit.geometry,
              properties: {
                ...unit.geometry.properties,
                height: building.numFloors * (building.typicalFloorHeight || 3),
                base_height: 0, // In future, this could be stacked per floor
                color: unit.color || '#ADD8E6'
              }
            };

            let source = mapInstance.getSource(layerId) as GeoJSONSource;
            if (source) source.setData(geometry);
            else mapInstance.addSource(layerId, { type: 'geojson', data: geometry });

            if (!mapInstance.getLayer(layerId)) {
              mapInstance.addLayer({
                id: layerId,
                type: 'fill-extrusion',
                source: layerId,
                minzoom: 15,
                paint: {
                  'fill-extrusion-color': ['get', 'color'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-opacity': uiState.ghostMode ? 0.8 : 0
                }
              }, LABELS_LAYER_ID);
            } else {
              mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', uiState.ghostMode ? 0.8 : 0);
            }
          });
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

    // Consolidate footprints
    const allBuildingFootprints: Feature<Polygon>[] = [];

    plots.forEach(plot => {
      const plotId = plot.id;
      // Debug Rendering
      if (plots.length > 0 && plot === plots[0]) {
        console.log(`[MapEditor] Rendering Plot ${plotId}`, {
          geometryType: plot.geometry?.type,
          hasCoordinates: !!(plot.geometry as any)?.coordinates,
          isSelected: plotId === selectedObjectId?.id
        });
      }

      renderedIds.add(`plot-base-${plotId}`);
      renderedIds.add(`plot-setback-${plotId}`);
      renderedIds.add(`plot-label-${plotId}`);


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

      let geometryToRender = plot.geometry;
      let geometryType = geometryToRender?.type;

      // Normalize Feature to Geometry
      if (geometryType === 'Feature' && (geometryToRender as any).geometry) {
        console.log(`[MapEditor] Normalizing Feature to Geometry for Plot ${plotId}`);
        geometryToRender = (geometryToRender as any).geometry;
        geometryType = geometryToRender.type;
      } else {
        console.log(`[MapEditor] No normalization needed for Plot ${plotId}. Type: ${geometryType}`);
      }

      let setbackPolygon = null;
      try {
        if (((geometryType as string) === 'Polygon' || (geometryType as string) === 'MultiPolygon') && plot.setback > 0) {
          // turf.buffer works with Features too, but passing raw geometry is safer contextually
          setbackPolygon = turf.buffer(plot.geometry as any, -plot.setback, { units: 'meters' });
        }
      } catch (e) {
        console.warn("[Setback Debug] Buffer FAILED for plot", plot.id, e);
        setbackPolygon = plot.geometry;
      }

      let sourceBase = mapInstance.getSource(plotBaseSourceId) as GeoJSONSource;

      // Strict Validation on the Normalized Geometry
      let validNormalizedGeometry = geometryToRender;
      if (!validNormalizedGeometry || typeof validNormalizedGeometry !== 'object' || !validNormalizedGeometry.type || !(validNormalizedGeometry as any).coordinates) {
        console.warn(`[MapEditor] ❌ Invalid Geometry Object for Plot ${plotId}`, validNormalizedGeometry);
      }

      const dataToRender = validNormalizedGeometry || plot.geometry; // Fallback to raw if normalization fails but maybe it's still renderable?


      if (sourceBase) {
        if (dataToRender) sourceBase.setData(dataToRender);
      } else {
        if (dataToRender) mapInstance.addSource(plotBaseSourceId, { type: 'geojson', data: dataToRender });
      }

      if (!mapInstance.getLayer(plotBaseLayerId)) {
        if (dataToRender) { // Only add layer if source valid
          mapInstance.addLayer({
            id: plotBaseLayerId,
            type: 'fill',
            source: plotBaseSourceId,
            paint: {
              'fill-color': [
                'case',
                ['==', plotId, selectedObjectId?.id || ''],
                '#48bb78',
                '#4a5568'
              ],
              'fill-opacity': [
                'case',
                ['==', plotId, selectedObjectId?.id || ''],
                uiState.ghostMode ? 0.2 : 0.6, // Low opacity in Ghost Mode
                uiState.ghostMode ? 0.05 : 0.1
              ]
            }
          }, LABELS_LAYER_ID);
        }
      } else {
        // Update selection highlight if layer exists
        mapInstance.setPaintProperty(plotBaseLayerId, 'fill-color', '#4a5568'); // Always use base color, no green highlight
        mapInstance.setPaintProperty(plotBaseLayerId, 'fill-opacity', [
          'case',
          ['==', plotId, selectedObjectId?.id || ''],
          0.1, // Keep opacity low even when selected
          0.1
        ]);
      }

      let sourceSetback = mapInstance.getSource(plotSetbackSourceId) as GeoJSONSource;
      if (sourceSetback) sourceSetback.setData(setbackPolygon || dataToRender);
      else if (dataToRender) mapInstance.addSource(plotSetbackSourceId, { type: 'geojson', data: setbackPolygon || dataToRender });

      if (!mapInstance.getLayer(plotSetbackLayerId)) {
        mapInstance.addLayer({
          id: plotSetbackLayerId,
          type: 'line',
          source: plotSetbackSourceId,
          paint: {
            'line-color': [
              'case',
              ['==', plotId, selectedObjectId?.id || ''],
              '#ed8936',
              '#f6ad55'
            ],
            'line-width': [
              'case',
              ['==', plotId, selectedObjectId?.id || ''],
              3,
              2
            ],
            'line-dasharray': [2, 2]
          }
        }, LABELS_LAYER_ID);
      } else {
        mapInstance.setPaintProperty(plotSetbackLayerId, 'line-color', [
          'case',
          ['==', plotId, selectedObjectId?.id || ''],
          '#ed8936',
          '#f6ad55'
        ]);
        mapInstance.setPaintProperty(plotSetbackLayerId, 'line-width', [
          'case',
          ['==', plotId, selectedObjectId?.id || ''],
          3,
          2
        ]);
      }

      // Plot Label Layer
      const labelSourceId = `plot-label-${plotId}`;
      const labelLayerId = `plot-label-${plotId}`;
      const labelData = {
        type: 'Feature',
        geometry: plot.centroid.geometry,
        properties: {
          label: `${plot.name}\n${Math.round(plot.area)} m²`,
        }
      };

      let sourceLabel = mapInstance.getSource(labelSourceId) as GeoJSONSource;
      if (sourceLabel) sourceLabel.setData(labelData as any);
      else mapInstance.addSource(labelSourceId, { type: 'geojson', data: labelData as any });

      if (!mapInstance.getLayer(labelLayerId)) {
        mapInstance.addLayer({
          id: labelLayerId,
          type: 'symbol',
          source: labelSourceId,
          layout: {
            'text-field': ['get', 'label'],
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-size': 12,
            'text-offset': [0, 0], // Center
            'text-anchor': 'center'
          },
          paint: {
            'text-color': '#ffffff',
            'text-halo-color': '#000000',
            'text-halo-width': 2
          }
        });
      }

      plot.buildings.forEach(building => {
        // Accumulate footprints for single-layer rendering
        // @ts-ignore
        const feat = turf.feature(building.geometry.geometry, {
          id: building.id,
          linkedId: building.id,
          name: building.name || 'Building',
          use: building.intendedUse || 'General',
          height: building.height || 0,
          floors: building.numFloors || 0
        });
        // @ts-ignore
        allBuildingFootprints.push(feat);
      });

      /*
      // Green Areas disabled per user request
      plot.greenAreas.forEach(area => {
        const areaId = `green-area-${area.id}`;
        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(area.geometry);
        else mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry });

        if (!mapInstance.getLayer(areaId)) {
          mapInstance.addLayer({ id: areaId, type: 'fill', source: areaId, paint: { 'fill-color': '#48bb78', 'fill-opacity': 0.7 } }, LABELS_LAYER_ID);
        }
      });
      */

      plot.parkingAreas.forEach(area => {
        const areaId = `parking-area-${area.id}`;
        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(area.geometry);
        else mapInstance.addSource(areaId, { type: 'geojson', data: area.geometry });

        if (!mapInstance.getLayer(areaId)) {
          // ... logic to add layer ...
        } else {
          // Check if existing layer matches correct type (line), otherwise remove it to re-create
          const existingRef = mapInstance.getLayer(areaId);
          if (existingRef && existingRef.type !== 'line') {
            mapInstance.removeLayer(areaId);
          }
        }

        // Re-check after potential removal
        if (!mapInstance.getLayer(areaId)) {
          const isBasement = (area.type === 'Basement');

          if (isBasement) {
            // Render Basement as outlined only (dashed) to imply underground
            mapInstance.addLayer({
              id: areaId,
              type: 'line',
              source: areaId,
              paint: {
                'line-color': '#1a202c',
                'line-width': 2,
                'line-dasharray': [2, 2],
                'line-opacity': 0.7
              }
            }, LABELS_LAYER_ID);
          } else {
            // Render Surface/Podium as Fill - Make it subtle/invisible by default to avoid conflicts
            // The user complained about "grey thing outside" which is this layer.
            // We'll make it transparent with a dashed outline, effectively hiding the mass.
            mapInstance.addLayer({
              id: areaId,
              type: 'line',
              source: areaId,
              paint: {
                'line-color': '#4a5568',
                'line-width': 1,
                'line-dasharray': [2, 4],
                'line-opacity': 0.3
              }
            }, LABELS_LAYER_ID);
          }
        }
      });

      // Combine existing utilities with ephemeral roads if needed
      const utilitiesToRender = [...(plot.utilityAreas || [])];
      const hasRoads = utilitiesToRender.some(u => u.type === 'Roads' || u.type === 'AppRoads' as any);

      if (!hasRoads && plot.geometry) {
        // Ephemeral Road Generation - DISABLED by user request
        // Vastu: Roads from North or East
        // Standard: Road from South

        /* 
        const bbox = turf.bbox(plot.geometry);
        const center = turf.center(plot.geometry);
        const fromDir = (activeProject?.vastuCompliant) ? 'East' : 'South';
        let startPt: any;

        if (fromDir === 'East') {
          // Midpoint of right edge
          startPt = turf.point([bbox[2], (bbox[1] + bbox[3]) / 2]) as Feature<Point>;
        } else {
          // Midpoint of bottom edge
          startPt = turf.point([(bbox[0] + bbox[2]) / 2, bbox[1]]) as Feature<Point>;
        }

        if (startPt && center && (startPt as any).geometry && (center as any).geometry) {
          // Create simple driveway to building/center
          const roadLine = turf.lineString([
            (startPt as any).geometry.coordinates,
            (center as any).geometry.coordinates
          ]);

          // Buffer it to make a Polygon road (width 6m)
          const roadPoly = turf.buffer(roadLine, 0.003, { units: 'kilometers' }); // 3m radius = 6m width

          if (roadPoly) {
            utilitiesToRender.push({
              id: `ephemeral-road-${plot.id}`,
              name: 'Access Road',
              type: 'Roads' as UtilityType,
              geometry: roadPoly as Feature<Polygon>,
              centroid: center as Feature<Point>,
              area: 0,
              visible: true
            });
          }
        }
        */
      }

      utilitiesToRender.forEach(u => {
        const areaId = `utility-area-${u.id}`;
        // Add to rendered IDs to prevent removal
        renderedIds.add(areaId);
        renderedIds.add(`utility-area-label-${u.id}`);

        const featureData = {
          type: 'Feature',
          geometry: (u.geometry as any).type === 'Feature' ? (u.geometry as any).geometry : u.geometry,
          properties: {
            id: u.id,
            name: u.name,
            type: u.type,
            area: u.area
          }
        };

        let source = mapInstance.getSource(areaId) as GeoJSONSource;
        if (source) source.setData(featureData as any);
        else mapInstance.addSource(areaId, { type: 'geojson', data: featureData as any });

        // Determine Color based on Type (using includes for partial matches)
        let color = '#718096'; // Default Gray
        const typeStr = (u.type || '').toLowerCase();

        if (typeStr.includes('stp')) color = '#9C27B0'; // Purple
        else if (typeStr.includes('wtp') || typeStr.includes('water')) color = '#2196F3'; // Blue
        else if (typeStr.includes('electrical') || typeStr.includes('electric')) color = '#F44336'; // Red
        else if (typeStr.includes('fire')) color = '#E91E63'; // Pink
        else if (typeStr.includes('hvac')) color = '#FF9800'; // Orange
        else if (typeStr.includes('gas')) color = '#795548'; // Brown
        else if (typeStr.includes('road')) color = '#546E7A'; // Blue Grey

        const isRoad = u.type === 'Roads' || u.type === 'AppRoads' as any; // Handle potential variants

        if (!mapInstance.getLayer(areaId)) {
          if (isRoad) {
            // 2D Flat Rendering for Roads
            mapInstance.addLayer({
              id: areaId,
              type: 'fill',
              source: areaId,
              paint: {
                'fill-color': color,
                'fill-opacity': 0.9,
                'fill-outline-color': '#455A64'
              }
            }, LABELS_LAYER_ID);
          } else {
            // 3D Extrusion for other utilities to ensure visibility
            mapInstance.addLayer({
              id: areaId,
              type: 'fill-extrusion',
              source: areaId,
              paint: {
                'fill-extrusion-color': color,
                'fill-extrusion-height': 2.5, // 2.5m height
                'fill-extrusion-opacity': 0.7,
                'fill-extrusion-base': 0
              }
            }, LABELS_LAYER_ID);
          }
        } else {
          // Update paint properties if layer exists
          const existingLayer = mapInstance.getLayer(areaId);
          if (existingLayer) {
            if (isRoad) {
              if (existingLayer.type === 'fill') {
                mapInstance.setPaintProperty(areaId, 'fill-color', color);
              }
            } else {
              if (existingLayer.type === 'fill-extrusion') {
                mapInstance.setPaintProperty(areaId, 'fill-extrusion-color', color);
              }
            }
          }
        }
      });
    });

    const allBuildingsSourceId = 'all-buildings-footprints';
    const allBuildingsLayerId = 'all-buildings-hit-layer';
    renderedIds.add(allBuildingsSourceId);
    renderedIds.add(allBuildingsLayerId);

    let buildingSource = mapInstance.getSource(allBuildingsSourceId) as GeoJSONSource;
    // @ts-ignore
    const buildingCollection = turf.featureCollection(allBuildingFootprints);
    if (buildingSource) buildingSource.setData(buildingCollection);
    else mapInstance.addSource(allBuildingsSourceId, { type: 'geojson', data: buildingCollection });

    if (!mapInstance.getLayer(allBuildingsLayerId)) {
      mapInstance.addLayer({
        id: allBuildingsLayerId,
        type: 'fill',
        source: allBuildingsSourceId,
        paint: { 'fill-color': '#000', 'fill-opacity': 0 } // Invisible, hits only
      }, LABELS_LAYER_ID); // Ensure it is below labels

      mapInstance.on('mousemove', allBuildingsLayerId, (e) => {
        if (e.features && e.features.length > 0) {
          mapInstance.getCanvas().style.cursor = 'pointer';
        }
      });
      mapInstance.on('mouseleave', allBuildingsLayerId, () => {
        mapInstance.getCanvas().style.cursor = '';
      });
    }

    const currentStyle = mapInstance.getStyle();
    if (currentStyle && currentStyle.layers) {
      currentStyle.layers.forEach(layer => {
        const layerId = layer.id;
        const isManagedByPlots = layerId.startsWith('plot-') || layerId.startsWith('building-') || layerId.startsWith('green-') || layerId.startsWith('parking-') || layerId.startsWith('buildable-') || layerId.startsWith('utility-') || layerId.startsWith('core-') || layerId.startsWith('unit-');

        if (isManagedByPlots && !renderedIds.has(layerId) && layerId !== LABELS_LAYER_ID) {
          if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
        }
      });
    }

    if (currentStyle && currentStyle.sources) {
      Object.keys(currentStyle.sources).forEach(sourceId => {
        const isManagedByPlots = sourceId.startsWith('plot-') || sourceId.startsWith('building-') || sourceId.startsWith('green-') || sourceId.startsWith('parking-') || sourceId.startsWith('buildable-') || sourceId.startsWith('utility-') || sourceId.startsWith('core-') || sourceId.startsWith('unit-');

        if (isManagedByPlots && !renderedIds.has(sourceId) && sourceId !== LABELS_SOURCE_ID) {
          const style = mapInstance.getStyle();
          const isSourceInUse = style?.layers?.some(layer => (layer as any).source === sourceId);
          if (!isSourceInUse && mapInstance.getSource(sourceId)) {
            mapInstance.removeSource(sourceId);
          }
        }
      });
    }

  }, [plots, isMapLoaded, selectedObjectId, primaryColor, isLoading, activeProject, styleLoaded, uiState.ghostMode]);

  // HOVER TOOLTIP EFFECT
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;
    const m = map.current;

    const popup = new mapboxgl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'editor-tooltip'
    });

    const onMouseMove = (e: mapboxgl.MapMouseEvent) => {
      // Query specific interactive layers
      // We check for: Buildings (hit layer), Utilities (prefix), Roads
      const features = m.queryRenderedFeatures(e.point).filter(f => {
        return f.layer && f.layer.id && (f.layer.id === 'all-buildings-hit-layer' || f.layer.id.startsWith('utility-area-'));
      });

      if (features.length > 0) {
        const f = features[0];
        m.getCanvas().style.cursor = 'pointer';

        let html = '';
        const props = f.properties || {};

        if (f.layer.id === 'all-buildings-hit-layer') {
          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || 'Building'}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">${props.use || ''}</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">${props.floors || 0} Fl • ${Math.round(props.height || 0)}m</div>
          `;
        } else if (f.layer.id.startsWith('utility-area-')) {
          const typeLabel = props.type || 'Utility';
          const areaLabel = props.area ? `${Math.round(props.area)} m²` : '';

          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || typeLabel}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">${typeLabel}</div>
            ${areaLabel ? `<div class="text-xs mt-1 text-neutral-800" style="color: #262626;">${areaLabel}</div>` : ''}
          `;
        }

        if (html) {
          popup.setLngLat(e.lngLat).setHTML(html).addTo(m);
        }
      } else {
        m.getCanvas().style.cursor = '';
        popup.remove();
      }
    };

    m.on('mousemove', onMouseMove);
    m.on('mouseleave', () => popup.remove());

    return () => {
      m.off('mousemove', onMouseMove);
      popup.remove();
    };
  }, [isMapLoaded]);


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

      {/* Terrain Toggle Button */}
      <div className="absolute top-4 right-14 z-10 bg-background/90 backdrop-blur rounded-md border shadow-sm p-1">
        <button
          onClick={() => {
            const newStatus = !isTerrainEnabled;
            setIsTerrainEnabled(newStatus);
            if (map.current) {
              // Toggle Terrain
              map.current.setTerrain({ 'source': 'mapbox-dem', 'exaggeration': newStatus ? 1.0 : 0.0 });
              // Trigger repaint to update building elevations
              window.tb.repaint();
              // Force React re-render or effect re-run if needed for building height updates? 
              // Actually the building effect depends on 'isTerrainEnabled' if we add it to dependency
            }
          }}
          className={`p-2 rounded-sm text-xs font-medium transition-colors ${isTerrainEnabled ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
          title="Toggle 3D Terrain"
        >
          {isTerrainEnabled ? '⛰️ Terrain ON' : 'Analytic Flat'}
        </button>
      </div>

    </div >
  );
}




