import { useBuildingStore, UTILITY_COLORS } from '@/hooks/use-building-store';
import { BUILDING_MATERIALS, hslToRgb } from '@/lib/color-utils';
import { useToast } from '@/hooks/use-toast';
import { BuildingIntendedUse, GreenRegulationData, UtilityType, Building, Core, Unit, Plot, GreenArea, ParkingArea, BuildableArea, UtilityArea } from '@/lib/types';
import { Feature, Polygon, Point, LineString, FeatureCollection } from 'geojson';
import * as turf from '@turf/turf';
import mapboxgl, { GeoJSONSource, LngLatLike, Map, Marker } from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Script from 'next/script';
import { createShaktiChakraGroup } from '@/lib/shakti-chakra-visualizer';
import { AnalysisMode } from './solar-controls';
import { runVisualAnalysis, runGroundAnalysis, runWallAnalysis, calculateAggregateStats } from '@/lib/engines/visual-analysis-engine';
import { useRegulations } from '@/hooks/use-regulations';
import { generateBuildingTexture } from '@/lib/texture-generator';
import { WindStreamlineLayer } from '@/lib/wind-streamline-layer';
import { Amenity } from '@/services/mapbox-places-service';


declare global {
  interface Window {
    tb: any;
    THREE: any;
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

// Helper for Building Colors
const getBuildingColor = (use: string | BuildingIntendedUse) => {
  const useStr = (use || '').toString().toLowerCase();
  if (useStr === 'residential') return '#4CAF50'; // Green
  if (useStr === 'commercial') return '#F44336'; // Red
  if (useStr === 'institutional') return '#2196F3'; // Blue
  if (useStr === 'mixed use') return '#FBC02D'; // Yellow
  if (useStr === 'industrial') return '#9C27B0'; // Purple
  if (useStr === 'hospitality') return '#E91E63'; // Pink
  return '#9E9E9E'; // Grey default
};


interface MapEditorProps {
  onMapReady?: () => void;
  solarDate: Date;
  setSolarDate: (d: Date) => void;
  isSimulatorEnabled: boolean;
  setIsSimulatorEnabled: (b: boolean) => void;
  analysisMode: AnalysisMode;
  setAnalysisMode: (m: AnalysisMode) => void;
  activeGreenRegulations?: GreenRegulationData[];
}

export function MapEditor({
  onMapReady,
  solarDate,
  setSolarDate,
  isSimulatorEnabled,
  setIsSimulatorEnabled,
  analysisMode,
  setAnalysisMode,
  activeGreenRegulations = []
}: MapEditorProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const [buildingsReady, setBuildingsReady] = useState(false); // Track when buildings are ready for analysis

  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [styleLoaded, setStyleLoaded] = useState(false);
  // Threebox loaded state removed
  const [isTerrainEnabled, setIsTerrainEnabled] = useState(false); // Terrain OFF by default
  const markers = useRef<Marker[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState('hsl(210, 40%, 50%)'); // Default primary color
  const hasNavigatedRef = useRef(false); // Track if we've navigated in this component instance
  const windStreamlineLayer = useRef<WindStreamlineLayer | null>(null);



  // Optimized Selectors
  const actions = useBuildingStore(s => s.actions);
  const drawingPoints = useBuildingStore(s => s.drawingPoints);
  const drawingState = useBuildingStore(s => s.drawingState);
  const selectedObjectId = useBuildingStore(s => s.selectedObjectId);
  const isLoading = useBuildingStore(s => s.isLoading);
  const plots = useBuildingStore(s => s.plots);
  const mapCommand = useBuildingStore(s => s.mapCommand);
  const uiState = useBuildingStore(s => s.uiState);
  const componentVisibility = useBuildingStore(s => s.componentVisibility);
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

      // GENERATE & ADD TEXTURES
      const buildingTypes = ['Residential', 'Commercial', 'Institutional', 'Mixed Use', 'Industrial', 'Hospitality'];
      buildingTypes.forEach(type => {
        // Generate texture with a base color matching our palette
        const color = getBuildingColor(type as BuildingIntendedUse);
        const img = generateBuildingTexture(type as any, color);
        if (img && !mapInstance.hasImage(`texture-${type}`)) {
          mapInstance.addImage(`texture-${type}`, img, { pixelRatio: 2 });
        }
      });

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

      // Add Wind Arrow Image
      const arrowSize = 32;
      const canvas = document.createElement('canvas');
      canvas.width = arrowSize;
      canvas.height = arrowSize;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = '#3b82f6'; // blue-500
        ctx.lineWidth = 3;
        ctx.beginPath();
        // Draw an arrow pointing UP (0 degrees)
        ctx.moveTo(16, 4);
        ctx.lineTo(16, 28);
        ctx.moveTo(16, 4);
        ctx.lineTo(8, 12);
        ctx.moveTo(16, 4);
        ctx.lineTo(24, 12);
        ctx.stroke();
        mapInstance.addImage('wind-arrow', ctx.getImageData(0, 0, arrowSize, arrowSize));
      }

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

          console.log('âœˆï¸ Flying to plot centroid:', { lat, lng });
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
              console.log('âœ… Marked as navigated (session)');

              // Trigger single repaint
              map.current.triggerRepaint();

              // Auto-select immediately
              actions.selectObject(firstPlot.id, 'Plot');
              console.log('ðŸŽ¯ Auto-selected plot for visibility');
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
        console.log('âœˆï¸ Flying to project location:', { lat, lng });
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
            console.log(`ðŸ›£ï¸ Detected Road Access for ${plot.name}:`, newSides);
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





  // Render Amenity Markers
  useEffect(() => {
    if (!map.current || !isMapLoaded) return;

    // Clear existing markers
    markers.current.forEach(marker => marker.remove());
    markers.current = [];

    const amenities = activeProject?.locationData?.amenities;
    if (!amenities || amenities.length === 0) return;

    amenities.forEach((amenity: Amenity) => {
      // Create element
      const el = document.createElement('div');
      el.className = 'amenity-marker';
      el.style.width = '24px';
      el.style.height = '24px';
      el.style.borderRadius = '50%';
      el.style.border = '2px solid white';
      el.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      el.style.cursor = 'pointer';

      // Color based on category
      let color = '#888';
      if (amenity.category === 'transit') color = '#2196F3'; // Blue
      else if (amenity.category === 'school') color = '#FF9800'; // Orange
      else if (amenity.category === 'hospital') color = '#F44336'; // Red
      else if (amenity.category === 'park') color = '#4CAF50'; // Green
      else if (amenity.category === 'shopping') color = '#9C27B0'; // Purple
      else if (amenity.category === 'restaurant') color = '#FFEB3B'; // Yellow

      el.style.backgroundColor = color;

      // Create Popup
      const popup = new mapboxgl.Popup({ offset: 25 })
        .setHTML(`
          <div style="padding: 5px;">
            <strong style="font-size: 14px; color: #333;">${amenity.name}</strong><br/>
            <span style="color: #666; font-size: 12px; text-transform: capitalize;">
              ${amenity.category} • ${amenity.distance}m
            </span><br/>
            <span style="color: #999; font-size: 10px;">${amenity.address}</span>
          </div>
        `);

      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat(amenity.coordinates as [number, number])
        .setPopup(popup)
        .addTo(map.current!);

      markers.current.push(marker);
    });

    // Optional: Fit bounds? Maybe too intrusive on every update.
    // For now, let the user pan/zoom manually or use simple flyTo on setLocationData action if needed.

  }, [isMapLoaded, activeProject?.locationData?.amenities]);


  // Move cleanupOverlays to a reusable callback
  const cleanupOverlays = useCallback(() => {
    if (!map.current) return;

    // Cleanup Mapbox Heatmap Layer
    const heatmapId = 'solar-ground-heatmap';
    if (map.current.getLayer(heatmapId)) map.current.removeLayer(heatmapId);

    // Cleanup Wall Analysis Layer
    const wallLayerId = 'analysis-walls';
    const wallSourceId = 'analysis-walls-source';
    if (map.current.getLayer(wallLayerId)) map.current.removeLayer(wallLayerId);

    // Cleanup Wind Direction Layer (old arrows)
    const windDirId = 'wind-direction';
    if (map.current.getLayer(windDirId)) map.current.removeLayer(windDirId);

    // Cleanup Wind Streamline Layer
    if (windStreamlineLayer.current && map.current.getLayer('wind-streamlines')) {
      map.current.removeLayer('wind-streamlines');
      windStreamlineLayer.current = null;
    }

    // Now cleanup sources after layers are gone
    if (map.current.getSource(heatmapId)) map.current.removeSource(heatmapId);
    if (map.current.getSource(wallSourceId)) map.current.removeSource(wallSourceId);
    if (map.current.getSource(windDirId)) map.current.removeSource(windDirId);

    if (window.tb && window.tb.world) {
      const oldGroup = window.tb.world.getObjectByName('analysis-results-group');
      if (oldGroup) {
        window.tb.world.remove(oldGroup);
      }
      window.tb.world.children.forEach((child: any) => {
        if (child.name && child.name.startsWith('heatmap-overlay-')) {
          window.tb.world.remove(child);
        }
      });
    }
  }, []);

  // Execute Map Commands (e.g., flyTo from Location Panel)
  useEffect(() => {
    if (!map.current || !isMapLoaded || !mapCommand) return;

    if (mapCommand.type === 'flyTo') {
      map.current.flyTo({
        center: mapCommand.center,
        zoom: mapCommand.zoom || 15,
        essential: true,
        duration: 1500
      });

      // Clear the command after executing
      useBuildingStore.setState({ mapCommand: null });
    }
  }, [mapCommand, isMapLoaded]);

  // Monitor toggle to reset analysis
  useEffect(() => {
    if (!isSimulatorEnabled) {
      setAnalysisMode('none');
      cleanupOverlays();
    }
  }, [isSimulatorEnabled, setAnalysisMode, cleanupOverlays]);


  const resetBuildingColors = (forcedColor?: string) => {
    if (!map.current) return;

    plots.forEach(plot => {
      plot.buildings.forEach(building => {
        // Reset each building's floors to their original color (or forced color)
        const colorToApply = forcedColor || getBuildingColor(building.intendedUse);

        building.floors.forEach(floor => {
          const layerId = `building-floor-fill-${floor.id}-${building.id}`;

          if (map.current!.getLayer(layerId)) {
            try {
              map.current!.setPaintProperty(layerId, 'fill-extrusion-color', colorToApply);
            } catch (e) {
              console.warn(`[MAP EDITOR] Failed to reset color for ${layerId}`, e);
            }
          }
        });
      });
    });
  };

  // Effect: Run Visual Analysis when mode/date changes or buildings change
  useEffect(() => {
    if (!isMapLoaded) return;

    if (analysisMode === 'none') {
      cleanupOverlays();
      resetBuildingColors();
      if (window.tb) window.tb.repaint();
      return;
    }

    // For analysis modes: small debounce to batch rapid changes
    const timer = setTimeout(async () => {
      // Collect buildings from STORE
      const allBuildings = plots.flatMap(p => p.buildings);

      if (allBuildings.length === 0) {
        console.warn('[MAP EDITOR] No buildings found for analysis');
        return;
      }

      console.log(`[MAP EDITOR] Running ${analysisMode} on ${allBuildings.length} buildings...`);

      cleanupOverlays(); // Clear previous results before adding new ones
      resetBuildingColors('#eeeeee'); // Reset buildings to neutral grey so walls are visible

      // --- PER-FACE WALL ANALYSIS ---
      const wallFeatures = await runWallAnalysis(allBuildings, allBuildings, analysisMode, solarDate, activeGreenRegulations);

      console.log('[MAP EDITOR] Wall Analysis complete, features:', { count: wallFeatures.features.length });

      // Mapbox-native fill-extrusion for building analysis
      const wallLayerId = 'analysis-walls';
      const wallSourceId = 'analysis-walls-source';

      if (map.current) {
        if (map.current.getSource(wallSourceId)) {
          (map.current.getSource(wallSourceId) as mapboxgl.GeoJSONSource).setData(wallFeatures);
        } else {
          map.current.addSource(wallSourceId, {
            type: 'geojson',
            data: wallFeatures
          });
          map.current.addLayer({
            id: wallLayerId,
            type: 'fill-extrusion',
            source: wallSourceId,
            paint: {
              'fill-extrusion-color': ['get', 'color'],
              'fill-extrusion-height': ['get', 'height'],
              'fill-extrusion-base': ['get', 'base_height'],
              'fill-extrusion-opacity': 0.85,
              'fill-extrusion-vertical-gradient': true
            }
          }, LABELS_LAYER_ID); // Place below labels
        }
      }

      // --- GROUND HEATMAP ANALYSIS ---
      if (map.current && plots.length > 0) {
        try {
          console.log('[MAP EDITOR] Running Ground Analysis...');
          // Store results for rendering
          // 1. Run Ground Analysis (Heatmap)
          const groundPoints = await runGroundAnalysis(
            plots[0].geometry,
            allBuildings,
            analysisMode,
            solarDate,
            activeGreenRegulations
          );

          // 2. Run Visual Analysis (Building Stats)
          const buildingResults = await runVisualAnalysis(
            allBuildings,
            allBuildings,
            analysisMode,
            solarDate,
            activeGreenRegulations
          );

          // NEW: Calculate Aggregate Stats and Update Project State
          const stats = calculateAggregateStats(buildingResults, analysisMode, allBuildings, activeGreenRegulations);
          console.log('[MAP EDITOR] Analysis Stats:', stats);

          if (analysisMode === 'wind') {
            actions.updateSimulationResults({ wind: { compliantArea: stats.compliantArea, avgSpeed: stats.avgValue } });
          } else if (analysisMode === 'sun-hours') {
            actions.updateSimulationResults({ sun: { compliantArea: stats.compliantArea, avgHours: stats.avgValue } });
          } else if (analysisMode === 'daylight') {
            actions.updateSimulationResults({ sun: { compliantArea: stats.compliantArea, avgHours: stats.avgValue } });
          }

          // Apply colors to buildings
          const heatmapId = 'solar-ground-heatmap';

          if (groundPoints && groundPoints.features.length > 0) {
            if (map.current.getSource(heatmapId)) {
              (map.current.getSource(heatmapId) as GeoJSONSource).setData(groundPoints);
            } else {
              map.current.addSource(heatmapId, {
                type: 'geojson',
                data: groundPoints
              });
            }

            if (!map.current.getLayer(heatmapId)) {
              // Determine color ramp based on mode
              // For Wind/Sun: Use Compliance Ramp (Red=Bad, Green=Good)
              // This matches the building wall colors for visual consistency
              let colorRamp: any[];

              if (analysisMode === 'wind' || analysisMode === 'sun-hours' || analysisMode === 'daylight') {
                // Compliance Ramp: Red (Low/Bad) -> Yellow (Medium) -> Green (High/Good)
                colorRamp = [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(239, 68, 68, 0)',   // Transparent red
                  0.2, '#ef4444',               // red-500 (Stagnant/Shady/Dark)
                  0.4, '#f59e0b',               // amber-500 (Fair)
                  0.6, '#eab308',               // yellow-500 (Moderate)
                  0.8, '#10b981',               // emerald-500 (Good)
                  1, '#00cc00'                  // bright green (Excellent)
                ];
              } else {
                // Standard Thermal Heatmap: Blue (Low) -> Red (High)
                colorRamp = [
                  'interpolate', ['linear'], ['heatmap-density'],
                  0, 'rgba(0, 0, 255, 0)',
                  0.2, '#3b82f6',               // blue-500
                  0.4, '#10b981',               // emerald-500
                  0.6, '#f59e0b',               // amber-500
                  0.8, '#ef4444',               // red-500
                  1, '#b91c1c'                  // red-700
                ];
              }

              map.current.addLayer({
                id: heatmapId,
                type: 'heatmap',
                source: heatmapId,
                paint: {
                  // Weight based on 'weight' property (0-1)
                  'heatmap-weight': ['get', 'weight'] as any,
                  // Intensity increases with zoom
                  'heatmap-intensity': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 0.7,  // Slightly reduced from 0.8
                    18, 1.8   // Slightly reduced from 2.0
                  ] as any,
                  'heatmap-color': colorRamp as any,
                  'heatmap-radius': [
                    'interpolate', ['linear'], ['zoom'],
                    15, 20,  // Reduced from 30
                    20, 40   // Reduced from 50
                  ] as any,
                  'heatmap-opacity': 0.7
                }
              }, LABELS_LAYER_ID); // Place below labels
            }

            // --- WIND STREAMLINES (Animated) ---
            if (analysisMode === 'wind') {
              // Remove old arrow layer if it exists
              const windDirId = 'wind-direction';
              if (map.current.getLayer(windDirId)) {
                map.current.removeLayer(windDirId);
              }

              // Add streamline layer if not already added
              if (!windStreamlineLayer.current) {
                windStreamlineLayer.current = new WindStreamlineLayer('wind-streamlines');

                // Add layer to map
                if (!map.current.getLayer('wind-streamlines')) {
                  map.current.addLayer(windStreamlineLayer.current as any, LABELS_LAYER_ID);
                }

                // Initialize with buildings and wind direction
                windStreamlineLayer.current.initialize(allBuildings, 45); // Default NE wind
              }

              // Update bounds when map moves
              const updateBounds = () => {
                if (windStreamlineLayer.current) {
                  windStreamlineLayer.current.updateBounds();
                }
              };

              map.current.on('moveend', updateBounds);
              map.current.on('zoomend', updateBounds);
            }
          }
        } catch (e) {
          console.warn('[MAP EDITOR] Ground Analysis Failed', e);
        }
      }

    }, 200);

    return () => clearTimeout(timer);
  }, [analysisMode, solarDate, plots, isMapLoaded, activeGreenRegulations]);

  // Solar Lighting Effect
  useEffect(() => {
    if (!isMapLoaded) return;
    const mapInstance = map.current;
    if (!mapInstance) return;

    // Helper to manage Three.js lights
    const updateThreeLights = (azimuth: number, altitude: number, enabled: boolean) => {
      if (!window.tb) return;
      const scene = window.tb.world; // Use world as root
      if (!scene) return;

      const LIGHT_GROUP_NAME = 'simulation-lights-group';
      let lightGroup = scene.getObjectByName(LIGHT_GROUP_NAME);

      if (!lightGroup) {
        lightGroup = new window.tb.THREE.Group();
        lightGroup.name = LIGHT_GROUP_NAME;
        scene.add(lightGroup);
      }

      lightGroup.clear();

      if (enabled) {
        // Convert to Threebox/Mapbox World coords logic
        // Mapbox World: Z up.
        // Sun Az/Alt -> Vector
        // We use the same logic as Analysis Engine for consistency
        const lat = 28.6; // Dummy, unused for vector direction if we have Az/Alt
        // ... actually we just need normalized vector

        // Azimuth 0 = South, PI/2 = West (from sun-utils)
        // Three.js: X=East, Y=North
        // x = sin(az)*cos(alt)
        // y = -cos(az)*cos(alt)
        // z = sin(alt)

        const dist = 1000;
        const x = dist * Math.sin(azimuth) * Math.cos(altitude);
        const y = dist * -1 * Math.cos(azimuth) * Math.cos(altitude);
        const z = dist * Math.sin(altitude);

        const sunLight = new window.tb.THREE.DirectionalLight(0xffffff, 1.5);
        sunLight.position.set(x, y, z);
        sunLight.target.position.set(0, 0, 0);
        sunLight.castShadow = true;

        // Optimize Shadows
        sunLight.shadow.mapSize.width = 2048;
        sunLight.shadow.mapSize.height = 2048;
        const d = 1000;
        sunLight.shadow.camera.left = -d;
        sunLight.shadow.camera.right = d;
        sunLight.shadow.camera.top = d;
        sunLight.shadow.camera.bottom = -d;

        lightGroup.add(sunLight);
        lightGroup.add(sunLight.target);

        // Ambient
        const ambient = new window.tb.THREE.AmbientLight(0x404040, 0.4);
        lightGroup.add(ambient);

      } else {
        // Default Threebox Lighting (if any?)
        // Usually Threebox has default lights if 'defaultLights' is true.
        // If we want to restore defaults, we might just leave this group empty.
      }

      if (window.tb) window.tb.repaint();
    };


    if (isSimulatorEnabled) {
      const center = mapInstance.getCenter();
      // Dynamically require to avoid top-level import issues if not needed
      const { getSunPosition } = require('@/lib/sun-utils');
      const { azimuth, altitude } = getSunPosition(solarDate, center.lat, center.lng);

      // 1. Sync Mapbox Native Light (for fill-extrusion)
      // Azimuth: Sun 0(S) -> Map 180(S). Sun 90(W) -> Map 270(W).
      // Map = (SunDeg + 180) % 360
      const azDeg = (azimuth * 180 / Math.PI + 180) % 360;

      // Polar: Sun Alt 0 -> Map Polar 90. Sun Alt 90 -> Map Polar 0.
      const polarDeg = 90 - (altitude * 180 / Math.PI);

      // Safety clamp
      // Safety clamp
      const safePolar = Math.max(0, Math.min(90, polarDeg));

      // 1. Sync Mapbox Standard Style Lighting
      // Mapbox Standard style uses 'lightPreset' config and handles sun position automatically based on that preset.
      // We map our solar time to these presets.

      const hour = solarDate.getHours();
      let preset = 'day';
      if (hour >= 5 && hour < 8) preset = 'dawn';
      else if (hour >= 8 && hour < 17) preset = 'day';
      else if (hour >= 17 && hour < 20) preset = 'dusk';
      else preset = 'night';

      if (mapInstance.getStyle()?.name === 'Mapbox Standard') {
        try {
          mapInstance.setConfigProperty('basemap', 'lightPreset', preset);
          // We can also try to enable shadows if not already
          mapInstance.setConfigProperty('basemap', 'show3dObjects', true);
        } catch (e) {
          console.warn('Failed to set lightPreset', e);
        }
      } else {
        // Fallback for non-standard styles (if any)
        try {
          // @ts-ignore - simple check to avoid TS errors if types aren't updated
          if (mapInstance.setLights) {
            // Use new API if needed, but for now just skip to avoid errors
          }
        } catch (e) { }
      }

      // 2. Sync Threebox Lights (for heatmaps/other 3D)
      // Note: We removed Threebox, but this function might still be called?


      // Legacy Threebox Initialization Removed
      // We now rely on pure Mapbox GL JS layers (fill-extrusion) which are more performant and consistent.

      // --- MANAGE SOLAR LIGHTING ---
      // Legacy Solar Lighting (Three.js) Removed
      // TODO: Implement Mapbox Native Solar/Shadow API when needed.

      // 2. Sync Threebox Lights
      updateThreeLights(azimuth, altitude, true);

    } else {
      // Reset Default
      if (mapInstance.getStyle()?.name === 'Mapbox Standard') {
        try {
          mapInstance.setConfigProperty('basemap', 'lightPreset', 'day');
        } catch (e) { }
      }
      updateThreeLights(0, 0, false);
    }

  }, [isSimulatorEnabled, solarDate, isMapLoaded]);

  const vastuObjectsRef = useRef<any[]>([]);

  // Vastu Compass Rendering
  // Legacy Vastu Compass (Three.js) Removed
  // Can be reimplemented with Markers or GL Layers in future.


  const buildingProps = useMemo(() =>
    plots.flatMap(p => p.buildings.map(b => `${b.id}-${b.opacity}-${b.height}-${b.numFloors}`)).join(','),
    [plots]
  );

  // Legacy Threebox Effect specific to markers and trees removed.
  // We are moving to pure Mapbox GL JS rendering for consistency and performance.
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
      let outlineData: Feature<LineString> | FeatureCollection = turf.featureCollection([]);
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
      console.log(`[MapEditor] ðŸ•µï¸ Plots Data Updated. Count: ${plots.length}`);
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
  }, [plots, uiState.ghostMode, componentVisibility]);

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
    // Check if any specific component is focused/visible - Calculated once per render for entire map
    const anyComponentVisible = Object.values(componentVisibility).some(v => v);

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

    const allLabels: Feature<Point, { label: string; id: string }>[] = [];

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
            label: `${plot.area.toFixed(0)} mÂ²`,
            id: `plot-label-${plot.id}`,
            linkedId: plot.id // Link to plot ID for selection highlight
          })
        );
      }

      // Add building labels
      plot.buildings.forEach(building => {
        if (building.centroid) {
          let labelText = `${building.name}\n${building.intendedUse}\n${building.area.toFixed(0)} mÂ²`;

          allLabels.push(
            turf.point(building.centroid.geometry.coordinates, {
              label: labelText,
              id: `building-label-${building.id}`,
              linkedId: building.id // Link to building ID for hover
            })
          );
        }




        // --- RENDER BUILDING FLOORS (NEW) ---
        // --- RENDER BUILDING FLOORS (NEW) ---


        if (building.floors && building.floors.length > 0) {
          // Separate basement and superstructure floors
          const basementFloors = building.floors.filter(f =>
            (f.level !== undefined && f.level < 0) || f.type === 'Parking'
          );
          const superstructureFloors = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || f.type === 'Parking')
          );



          // Determine which floors to render based on Ghost Mode and basement visibility toggle
          let floorsToRender = building.floors.filter(f => {
            // Always hide utility floors
            if (f.type === 'Utility') return false;

            const isBasement = (f.level !== undefined && f.level < 0) || f.type === 'Parking';

            // In Ghost Mode, respect the basement visibility toggle
            if (uiState.ghostMode) {
              if (isBasement) {
                return componentVisibility.basements; // Only show basements if toggled on
              }
              return true; // Show all non-basement floors
            }

            // In normal mode, hide basements
            return !isBasement;
          });

          // CRITICAL: Sort floors so basements (level < 0) render FIRST (at bottom of stack)
          floorsToRender = [...floorsToRender].sort((a, b) => {
            const aLevel = a.level ?? (a.type === 'Parking' ? -1 : 999);
            const bLevel = b.level ?? (b.type === 'Parking' ? -1 : 999);
            return aLevel - bLevel; // Ascending: basements (-2, -1) before ground (0) before upper (1, 2, 3...)
          });

          // --- CALCULATE OFFSETS FOR GHOST MODE ---
          const basementFloorsCalc = building.floors.filter(f =>
            (f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking'
          );
          const totalBasementHeight = basementFloorsCalc.reduce((sum, f) => sum + f.height, 0);

          // Only lift building if basements are actually visible
          const heightOffset = 0; // Always start at 0 (Ground)
          const shouldLiftForBasements = uiState.ghostMode && componentVisibility.basements;
          // Calculate Visual Top
          const superstructureFloorsCalc = building.floors.filter(f =>
            !((f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking')
          );
          const superstructureHeight = superstructureFloorsCalc.reduce((sum, f) => sum + (f.height || 3), 0);
          const visualBuildingTop = (building.baseHeight || 0) + (shouldLiftForBasements ? totalBasementHeight : 0) + superstructureHeight;
          const effectiveBase = (building.baseHeight || 0) + (shouldLiftForBasements ? totalBasementHeight : 0);

          // --- RENDER INTERNAL LAYOUT (UTILITIES -> CORES & UNITS) FIRST ---
          // Render Opaque internals BEFORE Transparent Shell to fix Depth Buffer occlusion

          // Utilities (Render FIRST to be inside)
          if (building.internalUtilities) {
            building.internalUtilities.forEach((util: UtilityArea) => {
              const layerId = `util-${building.id}-${util.id}`;
              renderedIds.add(layerId);

              // Electrical/HVAC Opacity: 0.8 in Ghost Mode (Solid-ish)
              let utilOpacity = 0.0;
              let utilHeight = 0;
              let utilBase = 0;
              let utilColor = '#CCCCCC';

              // Building top calculation (Using shared calculation)
              const buildingTop = visualBuildingTop;

              if (util.type === 'Electrical') {
                const isSelected = selectedObjectId?.id === util.id;
                utilOpacity = componentVisibility.electrical ? 1.0 : (anyComponentVisible ? 0.0 : (uiState.ghostMode ? 0.8 : 0.0));

                utilBase = (building.baseHeight || 0) + heightOffset;
                utilHeight = buildingTop + heightOffset;
                utilColor = '#FFD700';
              } else if (util.type === 'HVAC') {
                utilOpacity = componentVisibility.hvac ? 1.0 : (anyComponentVisible ? 0.0 : (uiState.ghostMode ? 0.8 : 0.0));
                utilBase = buildingTop + heightOffset;
                utilHeight = buildingTop + 3.0 + heightOffset;
                utilColor = '#C0C0C0';
              }

              const utilGeo = {
                ...util.geometry,
                properties: {
                  height: utilHeight,
                  base_height: utilBase,
                  color: utilColor
                }
              };

              let source = mapInstance.getSource(layerId) as GeoJSONSource;
              if (source) source.setData(utilGeo);
              else mapInstance.addSource(layerId, { type: 'geojson', data: utilGeo });

              if (!mapInstance.getLayer(layerId)) {
                mapInstance.addLayer({
                  id: layerId,
                  type: 'fill-extrusion',
                  source: layerId,
                  paint: {
                    'fill-extrusion-color': ['get', 'color'],
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'base_height'],
                    'fill-extrusion-opacity': utilOpacity
                  }
                }, LABELS_LAYER_ID);
              } else {
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', utilOpacity);
              }
            });
          }

          // Cores
          if (building.cores) {
            building.cores.forEach((core: Core) => {
              const layerId = `core-${building.id}-${core.id}`;
              renderedIds.add(layerId);

              const isCoreSelected = selectedObjectId?.id === core.id;
              // Opacity Update: Match Electrical style (0.8) for consistent "Solid" look in Ghost Mode
              let coreOpacity = 0.0;
              if (componentVisibility.cores) {
                coreOpacity = uiState.ghostMode ? 0.8 : 1.0;
              } else if (anyComponentVisible) {
                // If focusing on something else, hide it
                // UNLESS Ghost Mode is active? No, usually 'anyComponentVisible' implies singular focus.
                // But for "X-ray" feel, maybe keep it?
                // Adhering to strict specific focus:
                coreOpacity = 0.0;
              } else if (uiState.ghostMode || isCoreSelected) {
                coreOpacity = isCoreSelected ? 1.0 : 0.8;
              }

              const coreGeo = {
                ...core.geometry,
                properties: {
                  height: visualBuildingTop,
                  base_height: building.baseHeight || 0
                }
              };

              // Texture Logic: Disable texture in ghost mode for clean solid look
              const usePattern = !uiState.ghostMode;
              const patternName = 'texture-Institutional';

              let cSource = mapInstance.getSource(layerId) as GeoJSONSource;
              if (cSource) cSource.setData(coreGeo);
              else mapInstance.addSource(layerId, { type: 'geojson', data: coreGeo });

              if (!mapInstance.getLayer(layerId)) {
                // Initial Layer Add
                const paintProps: any = {
                  'fill-extrusion-color': '#9370DB', // Medium Purple
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-opacity': coreOpacity
                };
                if (usePattern) paintProps['fill-extrusion-pattern'] = patternName;

                mapInstance.addLayer({
                  id: layerId,
                  type: 'fill-extrusion',
                  source: layerId,
                  paint: paintProps
                }, LABELS_LAYER_ID);
              } else {
                // Update Properties
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', coreOpacity);

                if (usePattern) {
                  mapInstance.setPaintProperty(layerId, 'fill-extrusion-pattern', patternName);
                  mapInstance.setPaintProperty(layerId, 'fill-extrusion-color', '#ffffff'); // White base for texture
                } else {
                  mapInstance.setPaintProperty(layerId, 'fill-extrusion-pattern', null as any); // Remove texture
                  mapInstance.setPaintProperty(layerId, 'fill-extrusion-color', '#9370DB'); // Show Purple
                }
              }
            });
          }

          // Units
          if (building.units) {
            building.units.forEach((unit: Unit) => {
              const layerId = `unit-${building.id}-${unit.id}`;
              renderedIds.add(layerId);

              // Unit Opacity: INCREASED to 0.8 (was 0.1) as per user request to look "like electrical"
              let unitOpacity = 0.0;
              if (componentVisibility.units) {
                unitOpacity = uiState.ghostMode ? 0.8 : 1.0;
              } else if (anyComponentVisible) {
                unitOpacity = 0.0;
              } else if (uiState.ghostMode) {
                unitOpacity = 0.8; // Match Electrical/Cores
              }

              const geometry = {
                ...unit.geometry,
                properties: {
                  ...unit.geometry.properties,
                  ...unit.geometry.properties,
                  height: visualBuildingTop,
                  base_height: effectiveBase,
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
                  paint: {
                    'fill-extrusion-color': ['get', 'color'],
                    'fill-extrusion-height': ['get', 'height'],
                    'fill-extrusion-base': ['get', 'base_height'],
                    'fill-extrusion-opacity': unitOpacity
                  }
                }, LABELS_LAYER_ID);
              } else {
                mapInstance.setPaintProperty(layerId, 'fill-extrusion-opacity', unitOpacity);
              }
            });
          }

          // --- RENDER FLOORS (SHELL) LAST (BACKGROUND/CONTEXT) ---
          // Revert "Exploded View" - user rejected it.
          // Render floors upwards from currentBase
          // If basements are HIDDEN, start from ground (0) to keep building grounded
          // If basements are VISIBLE, start from ground (0) and stack basements first
          // NOTE: We do NOT add offsets here because 'floorsToRender' handles the stack order
          let currentBase = building.baseHeight || 0;
          floorsToRender.forEach((floor, fIndex) => {
            // Determine Color: Grey for Parking/Basement, otherwise Building Intended Use
            // Robust check for Parking (case-insensitive) just in case
            const typeLower = (floor.type || '').toLowerCase();
            const isBasementOrParking = (floor.level !== undefined && floor.level < 0) || typeLower === 'parking';

            const builtColor = getBuildingColor(building.intendedUse);
            const intendedColor = isBasementOrParking ? '#555555' : builtColor;

            // --- Slabs & Walls Rendering Strategy ---
            const slabHeight = 0.3; // 30cm Concrete Slab

            // GEOMETRY REFINEMENT: Inset the wall to create balconies/overhangs
            // This relieves the "sharp edge" / blocky look by adding depth
            let wallGeometry = building.geometry;
            try {
              // Inset by 0.5 meters to create a balcony effect
              const buffered = turf.buffer(building.geometry, -0.0005, { units: 'kilometers' }); // 0.5m inset
              if (buffered) wallGeometry = buffered as any;
            } catch (e) {
              console.warn('Failed to buffer wall geometry', e);
            }

            // 1. Render Structural Slab (White Concrete Band) - Uses ORIGINAL Geometry (Outer)
            // UPDATE: Render Slabs even in Ghost Mode to provide "Skeleton" visual
            const slabLayerId = `building-slab-${floor.id}-${building.id}`;
            renderedIds.add(slabLayerId);

            // Slab Opacity: 1.0 in Ordinary Mode. In Ghost Mode, set to 0.0 to avoid gaps in Cores/Units.
            const slabOpacity = uiState.ghostMode ? 0.0 : 1.0;

            const slabGeo = {
              ...building.geometry,
              properties: {
                ...building.geometry.properties,
                height: currentBase + slabHeight,
                base_height: currentBase,
                color: '#EEEEEE' // White/Light Grey Concrete
              }
            };

            let slabSource = mapInstance.getSource(slabLayerId) as GeoJSONSource;
            if (slabSource) slabSource.setData(slabGeo);
            else mapInstance.addSource(slabLayerId, { type: 'geojson', data: slabGeo });

            if (!mapInstance.getLayer(slabLayerId)) {
              mapInstance.addLayer({
                id: slabLayerId,
                type: 'fill-extrusion',
                source: slabLayerId,
                paint: {
                  'fill-extrusion-color': ['get', 'color'],
                  'fill-extrusion-height': ['get', 'height'],
                  'fill-extrusion-base': ['get', 'base_height'],
                  'fill-extrusion-opacity': slabOpacity
                }
              }, LABELS_LAYER_ID);
            } else {
              mapInstance.setPaintProperty(slabLayerId, 'fill-extrusion-opacity', slabOpacity);
            }

            // 2. Render Wall/Glass (Usage Colored) - Uses INSET Geometry (Inner)
            const floorTop = currentBase + floor.height;
            const floorLayerId = `building-floor-fill-${floor.id}-${building.id}`;
            renderedIds.add(floorLayerId);

            // Ghost Mode Logic - Different opacity for basements vs superstructure
            // Superstructure (Normal Floors): 0.0 Opacity (Invisible Skin) to show internal Units clearly
            // Basements: 0.7 Opacity (Visible) - Ensure distinct from 0.0

            // Check if any internal element of THIS building is selected (Granular Ghost Mode)
            const isInternalSelected = selectedObjectId && (
              building.internalUtilities?.some(u => u.id === selectedObjectId.id) ||
              building.cores?.some(c => c.id === selectedObjectId.id) ||
              building.units?.some(u => u.id === selectedObjectId.id)
            );

            // NEW OPACITY LOGIC for Floors - "Skeleton Mode"
            let opacity = 1.0;
            if (anyComponentVisible) {
              // If focused on internals, make WALLS invisible (0.0)
              opacity = 0.0;
              // Exception: If showing basements, basement floors stay visible
              if (componentVisibility.basements && floor.parkingType === 'Basement') {
                opacity = 0.9;
              }
            } else if (uiState.ghostMode) {
              // In Ghost Mode
              if (floor.parkingType === 'Basement') opacity = 0.8; // User requested "add opacity for basement parking"
              else opacity = 0.0; // INVISIBLE WALLS to fix "Glassy Block"
            }

            if (isInternalSelected) opacity = 1.0;

            const floorGeo = {
              ...wallGeometry, // Use the Inset Geometry here!
              properties: {
                ...building.geometry.properties,
                height: floorTop, // Top of floor
                base_height: currentBase + slabHeight, // Start *above* the slab
                color: intendedColor || floor.color || '#cccccc'
              }
            };

            let fSource = mapInstance.getSource(floorLayerId) as GeoJSONSource;
            if (fSource) fSource.setData(floorGeo);
            else mapInstance.addSource(floorLayerId, { type: 'geojson', data: floorGeo });

            if (!mapInstance.getLayer(floorLayerId)) {
              // Determine if we should use a pattern
              const usePattern = !uiState.ghostMode && !isBasementOrParking;
              const patternName = `texture-${building.intendedUse}`;

              const paintProps: any = {
                'fill-extrusion-color': usePattern ? '#ffffff' : ['get', 'color'],
                'fill-extrusion-height': ['get', 'height'],
                'fill-extrusion-base': ['get', 'base_height'],
                'fill-extrusion-opacity': opacity
              };

              // Only add pattern if we intend to use it, to avoid "null/undefined" crash
              if (usePattern) {
                paintProps['fill-extrusion-pattern'] = patternName;
              }

              mapInstance.addLayer({
                id: floorLayerId,
                type: 'fill-extrusion',
                source: floorLayerId,
                paint: paintProps
              }, LABELS_LAYER_ID);
            } else {
              const usePattern = !uiState.ghostMode && !isBasementOrParking;
              const patternName = `texture-${building.intendedUse}`;

              mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-opacity', opacity);
              // Update Pattern & Color
              if (usePattern) {
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', patternName);
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-color', '#ffffff');
              } else {
                // Use null to unset property in strict Mapbox TS/JS
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', null as any);
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-color', ['get', 'color']);
              }

              // Also update pattern opacity/visibility if pattern is used
              if (usePattern && (uiState.ghostMode || anyComponentVisible || isInternalSelected)) {
                // If switching to ghost/internal mode, remove pattern to see inside
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-pattern', null as any);
                mapInstance.setPaintProperty(floorLayerId, 'fill-extrusion-color', ['get', 'color']);
              }
            }

            currentBase += floor.height;
          });
        }


        // Calculate the height of the basement/podium to lift Cores and Units above it
        // This ensures they don't overlap with the parking floors visually in Ghost Mode
        const basementFloors = building.floors.filter(f =>
          (f.level !== undefined && f.level < 0) || (f.type || '').toLowerCase() === 'parking'
        );
        const basementHeight = basementFloors.reduce((sum, f) => sum + f.height, 0);
        const effectiveBase = (building.baseHeight || 0) + basementHeight;

      });

      plot.greenAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} mÂ²`,
              id: `green-area-label-${area.id}`
            })
          )
        }
      });

      plot.parkingAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} mÂ²`,
              id: `parking-area-label-${area.id}`
            })
          )
        }
      });

      plot.buildableAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n${area.area.toFixed(0)} mÂ²`,
              id: `buildable-area-label-${area.id}`
            })
          )
        }
      });
      plot.utilityAreas.forEach(area => {
        if (area.centroid) {
          allLabels.push(
            turf.point(area.centroid.geometry.coordinates, {
              label: `${area.name}\n(${area.type})\n${area.area.toFixed(0)} mÂ²`,
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
        console.warn(`[MapEditor] âŒ Invalid Geometry Object for Plot ${plotId}`, validNormalizedGeometry);
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
          label: `${plot.name}\n${Math.round(plot.area)} mÂ²`,
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
        const isManagedByPlots = layerId.startsWith('plot-') || layerId.startsWith('building-') || layerId.startsWith('green-') || layerId.startsWith('parking-') || layerId.startsWith('buildable-') || layerId.startsWith('util-') || layerId.startsWith('utility-area-') || layerId.startsWith('core-') || layerId.startsWith('unit-') || layerId.startsWith('electrical-') || layerId.startsWith('hvac-');

        if (isManagedByPlots && !renderedIds.has(layerId) && layerId !== LABELS_LAYER_ID) {
          if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
        }
      });
    }

    if (currentStyle && currentStyle.sources) {
      Object.keys(currentStyle.sources).forEach(sourceId => {
        const isManagedByPlots = sourceId.startsWith('plot-') || sourceId.startsWith('building-') || sourceId.startsWith('green-') || sourceId.startsWith('parking-') || sourceId.startsWith('buildable-') || sourceId.startsWith('util-') || sourceId.startsWith('utility-area-') || sourceId.startsWith('core-') || sourceId.startsWith('unit-') || sourceId.startsWith('electrical-') || sourceId.startsWith('hvac-');

        if (isManagedByPlots && !renderedIds.has(sourceId) && sourceId !== LABELS_SOURCE_ID) {
          const style = mapInstance.getStyle();
          const isSourceInUse = style?.layers?.some(layer => (layer as any).source === sourceId);
          if (!isSourceInUse && mapInstance.getSource(sourceId)) {
            mapInstance.removeSource(sourceId);
          }
        }
      });
      mapInstance.triggerRepaint();
    }

  }, [plots, isMapLoaded, selectedObjectId, primaryColor, isLoading, activeProject, styleLoaded, uiState.ghostMode, componentVisibility]);

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

        if (f.layer?.id === 'all-buildings-hit-layer') {
          let dims = '';
          try {
            // @ts-ignore
            const area = props.area || turf.area(f);
            // @ts-ignore
            const line = turf.polygonToLine(f.geometry);
            // @ts-ignore
            const perimeter = turf.length(line, { units: 'meters' });

            if (area && perimeter) {
              const s = perimeter / 2;
              const disc = (s * s) - (4 * area);
              let l = 0, w = 0;
              if (disc >= 0) {
                l = (s + Math.sqrt(disc)) / 2;
                w = (s - Math.sqrt(disc)) / 2;
              } else {
                l = Math.sqrt(area);
                w = l;
              }
              dims = `${Math.round(Math.max(l, w))}m x ${Math.round(Math.min(l, w))}m`;
            }
          } catch (e) { }

          html = `
            <div class="font-bold text-sm text-neutral-900" style="color: #171717;">${props.name || 'Building'}</div>
            <div class="text-xs text-muted-foreground" style="color: #525252;">${props.use || ''}</div>
            <div class="text-xs mt-1 text-neutral-800" style="color: #262626;">${props.floors || 0} Fl • ${Math.round(props.height || 0)}m</div>
            ${dims ? `<div class="text-xs text-neutral-600 mt-0.5" style="color: #525252;">Size: ${dims}</div>` : ''}
          `;
        } else if (f.layer?.id.startsWith('utility-area-')) {
          const typeLabel = props.type || 'Utility';
          const areaLabel = props.area ? `${Math.round(props.area)} mÂ²` : '';

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
      {/* Threebox Script Removed */}
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
              // window.tb.repaint(); // Removed
              // Force React re-render or effect re-run if needed for building height updates? 
              // Actually the building effect depends on 'isTerrainEnabled' if we add it to dependency
            }
          }}
          className={`p-2 rounded-sm text-xs font-medium transition-colors ${isTerrainEnabled ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'}`}
          title="Toggle 3D Terrain"
        >
          {isTerrainEnabled ? 'â›°ï¸ Terrain ON' : 'Analytic Flat'}
        </button>
      </div>

    </div >
  );
}
