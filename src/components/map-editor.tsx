import { useBuildingStore } from '@/hooks/use-building-store';
import { useToast } from '@/hooks/use-toast';
import { BuildingIntendedUse } from '@/lib/types';
import * as turf from '@turf/turf';
import mapboxgl, { GeoJSONSource, LngLatLike, Map, Marker } from 'mapbox-gl';
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import Script from 'next/script';

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
  onMapReady: () => void;
}

export function MapEditor({ onMapReady }: MapEditorProps) {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const map = useRef<Map | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const [isThreeboxLoaded, setIsThreeboxLoaded] = useState(false);
  const markers = useRef<Marker[]>([]);
  const [primaryColor, setPrimaryColor] = useState('hsl(210, 40%, 50%)'); // Default primary color

  const { actions, drawingPoints, drawingState, selectedObjectId, isLoading, plots } = useBuildingStore();

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
            ...p.buildableAreas.map(b => `buildable-area-${b.id}`)
          ]
        ).filter(id => allMapLayers.includes(id));

        if (clickableLayers.length === 0) return;

        const features = map.current.queryRenderedFeatures(e.point, {
          layers: clickableLayers,
        });

        if (features && features.length > 0) {
          const feature = features[0];
          const layerId = feature.layer.id;

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
          ...p.buildableAreas.map(b => `buildable-area-${b.id}`)
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
      onMapReady();
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
          }

          console.log('Threebox initialized with shared depth buffer');
        }
      },
      render: function (gl, matrix) {
        if (window.tb) {
          window.tb.update();
        }
      },
    });

  }, [isMapLoaded, isThreeboxLoaded]);


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
          const opacityVal = Number(building.opacity);
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
          const isCommercial = building.intendedUse === BuildingIntendedUse.Commercial || building.intendedUse === BuildingIntendedUse.MixedUse;

          const floorColor = new THREE.Color(isCommercial ? '#E8E8E8' : '#F0EAD6'); // White/Beige
          const glassColor = new THREE.Color(isCommercial ? '#8DA3B4' : '#7D8B96'); // Blue-Grey
          const roofColor = new THREE.Color('#E6E6E6');

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

          // 1. Glass Core (The main volume, slightly recessed)
          const glassExtrudeSettings = {
            depth: building.height,
            bevelEnabled: false,
          };
          const glassGeometry = new THREE.ExtrudeGeometry(glassShape, glassExtrudeSettings);
          const glassMesh = new THREE.Mesh(glassGeometry, glassMaterial);
          glassMesh.castShadow = true;
          glassMesh.receiveShadow = true;
          buildingGroup.add(glassMesh);

          // 2. Floor Slabs (Protruding rings)
          const floorCount = building.numFloors || Math.max(1, Math.floor(building.height / 3.5));
          const floorHeight = building.height / floorCount;
          const slabThickness = 0.25; // meters

          const slabGeometry = new THREE.ExtrudeGeometry(shape, {
            depth: slabThickness,
            bevelEnabled: false
          });

          for (let i = 1; i <= floorCount; i++) {
            const slab = new THREE.Mesh(slabGeometry, floorMaterial);
            slab.position.z = i * floorHeight - slabThickness;
            slab.castShadow = true;
            slab.receiveShadow = true;
            buildingGroup.add(slab);
          }

          // Base slab
          const baseSlab = new THREE.Mesh(slabGeometry, floorMaterial);
          baseSlab.position.z = 0;
          buildingGroup.add(baseSlab);


          // 3. Roof Parapet (Wall around the top)
          const parapetHeight = 1.2;
          const parapetThickness = 0.3;

          // Create a shape with a hole for the parapet
          const parapetShape = new THREE.Shape();
          localCoords.forEach((pt, index) => {
            if (index === 0) parapetShape.moveTo(pt[0], pt[1]);
            else parapetShape.lineTo(pt[0], pt[1]);
          });

          // Use the glass shape (inner) as the hole
          const holePath = new THREE.Path();
          // We need to reverse the hole points for Three.js shape holes
          // Actually Three.js handles holes in Shape automatically if winding order is correct, 
          // but Shape.holes is explicit.
          // Let's just use the glassShape points.
          // Note: glassShape is a Shape, we need its points.
          // A simpler way for parapet is to extrude the outer shape and subtract inner, 
          // but Three.js ExtrudeGeometry supports holes.

          if (glassShape.curves.length > 0) {
            // Extract points from glass shape to create a hole path
            // This is a bit complex to extract back from shape commands.
            // Easier to just re-use the logic we used to create glassShape.
            // Let's assume glassShape is simple polygon.

            // Re-calculate inner points for the hole
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
                parapetShape.holes.push(hole);
              }
            } catch (e) { }
          }

          const parapetGeometry = new THREE.ExtrudeGeometry(parapetShape, {
            depth: parapetHeight,
            bevelEnabled: false
          });
          const parapet = new THREE.Mesh(parapetGeometry, floorMaterial);
          parapet.position.z = building.height;
          parapet.castShadow = true;
          parapet.receiveShadow = true;
          buildingGroup.add(parapet);

          // Roof Penthouse (Mechanical structure)
          // Simple box at 0,0 (centroid)
          // Check if building is large enough
          // if (building.area > 100) {
          //   const penthouseSize = Math.sqrt(building.area) * 0.3;
          //   const penthouseHeight = 2.5;
          //   const penthouseGeo = new THREE.BoxGeometry(penthouseSize, penthouseSize, penthouseHeight);
          //   const penthouse = new THREE.Mesh(penthouseGeo, floorMaterial);
          //   penthouse.position.z = building.height + penthouseHeight / 2;
          //   penthouse.castShadow = true;
          //   penthouse.receiveShadow = true;
          //   buildingGroup.add(penthouse);
          // }

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

          window.tb.add(tbObject);
        } catch (error) {
          console.error(`Error rendering building ${building.id}:`, error);
          console.warn(`Skipping building ${building.id} due to rendering error`);
        }
      });
    });

    // Force repaint
    map.current?.triggerRepaint();

  }, [isMapLoaded, isThreeboxLoaded, buildingProps]);

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
          allLabels.push(
            turf.point(building.centroid.geometry.coordinates, {
              label: `${building.name}\n${building.intendedUse}\n${building.area.toFixed(0)} m²`,
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
    });

    const currentStyle = mapInstance.getStyle();
    if (currentStyle && currentStyle.layers) {
      currentStyle.layers.forEach(layer => {
        const layerId = layer.id;
        const isManagedByPlots = layerId.startsWith('plot-') || layerId.startsWith('building-') || layerId.startsWith('green-') || layerId.startsWith('parking-') || layerId.startsWith('buildable-');

        if (isManagedByPlots && !renderedIds.has(layerId) && layerId !== LABELS_LAYER_ID) {
          if (mapInstance.getLayer(layerId)) mapInstance.removeLayer(layerId);
        }
      });
    }

    if (currentStyle && currentStyle.sources) {
      Object.keys(currentStyle.sources).forEach(sourceId => {
        const isManagedByPlots = sourceId.startsWith('plot-') || sourceId.startsWith('building-') || sourceId.startsWith('green-') || sourceId.startsWith('parking-') || sourceId.startsWith('buildable-');

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
    </div>
  );
}
