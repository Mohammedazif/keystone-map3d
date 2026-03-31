'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { RenderingBuildingInfo, RenderingPlotInfo } from '@/lib/types';

type NormalizedPolygon = number[][][];

type BuildingPartType = 'podium' | 'tower' | 'main';

export interface ThreePlotSceneBuilding extends RenderingBuildingInfo {
  id?: string;
  parts?: Array<{
    type: BuildingPartType;
    footprint: NormalizedPolygon;
    height: number;
  }>;
}

interface ThreePlotSceneProps {
  plot: Pick<RenderingPlotInfo, 'footprint' | 'origin'>;
  buildings: ThreePlotSceneBuilding[];
  className?: string;
  cameraPadding?: number;
}

interface RenderVolume {
  key: string;
  type: BuildingPartType;
  footprint: NormalizedPolygon;
  height: number;
}

interface SceneBounds {
  centerX: number;
  centerZ: number;
  sizeX: number;
  sizeZ: number;
  radius: number;
}

const PART_COLORS: Record<BuildingPartType, string> = {
  podium: '#c9733d',
  tower: '#5c7fa3',
  main: '#7a8f76',
};

const MIN_HEIGHT = 0.5;

function inferPartType(id?: string): BuildingPartType {
  if (!id) return 'main';
  if (id.endsWith('-podium')) return 'podium';
  if (id.endsWith('-tower')) return 'tower';
  return 'main';
}

function getBaseBuildingId(id?: string) {
  if (!id) return undefined;
  return id.replace(/-(podium|tower)$/, '');
}

function isValidPolygon(footprint: NormalizedPolygon | undefined): footprint is NormalizedPolygon {
  return !!footprint?.length && !!footprint[0]?.length && footprint[0].length >= 4;
}

function normalizeRing(ring: number[][]) {
  if (ring.length < 2) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  const isClosed = first[0] === last[0] && first[1] === last[1];
  return isClosed ? ring.slice(0, -1) : ring;
}

function toShape(footprint: NormalizedPolygon) {
  const [outerRing, ...holes] = footprint;
  const outerPoints = normalizeRing(outerRing).map(
    ([x, y]) => new THREE.Vector2(x, -y)
  );
  const shape = new THREE.Shape(outerPoints);

  holes.forEach((ring) => {
    const holePoints = normalizeRing(ring).map(
      ([x, y]) => new THREE.Vector2(x, -y)
    );
    shape.holes.push(new THREE.Path(holePoints));
  });

  return shape;
}

function toLinePoints(ring: number[][], elevation = 0) {
  return ring.map(
    ([x, y]) => new THREE.Vector3(x, elevation, y)
  );
}

function collectRenderableVolumes(buildings: ThreePlotSceneBuilding[]): RenderVolume[] {
  const volumes: RenderVolume[] = [];
  const availableIds = new Set(
    buildings.map((building) => building.id).filter((id): id is string => !!id)
  );
  const renderedCompositeRoots = new Set<string>();

  buildings.forEach((building, index) => {
    const explicitParts = (building.parts || []).filter(
      (part) => isValidPolygon(part.footprint) && Number.isFinite(part.height)
    );
    const baseId = getBaseBuildingId(building.id);
    const hasSiblingParts = !!baseId && (
      availableIds.has(`${baseId}-podium`) ||
      availableIds.has(`${baseId}-tower`) ||
      (building.id !== baseId && availableIds.has(baseId))
    );

    if (explicitParts.length > 1 && (!baseId || !renderedCompositeRoots.has(baseId))) {
      if (baseId && hasSiblingParts) {
        renderedCompositeRoots.add(baseId);
      }

      explicitParts.forEach((part, partIndex) => {
        volumes.push({
          key: `${baseId || building.name || index}:${part.type}:${partIndex}`,
          type: part.type,
          footprint: part.footprint,
          height: Math.max(part.height, MIN_HEIGHT),
        });
      });

      return;
    }

    if (baseId && renderedCompositeRoots.has(baseId)) {
      return;
    }

    const rawFootprint = isValidPolygon(building.footprint)
      ? building.footprint
      : explicitParts[0]?.footprint;

    const height = Math.max(
      explicitParts[0]?.height ?? building.height ?? MIN_HEIGHT,
      MIN_HEIGHT
    );

    if (!isValidPolygon(rawFootprint)) {
      return;
    }

    const footprint = rawFootprint;

    volumes.push({
      key: `${building.id || building.name || index}:${inferPartType(building.id)}`,
      type: inferPartType(building.id),
      footprint,
      height,
    });
  });

  return volumes;
}

function getSceneBounds(
  plotFootprint: NormalizedPolygon | undefined,
  volumes: RenderVolume[]
): SceneBounds {
  const points: Array<[number, number]> = [];

  if (plotFootprint) {
    plotFootprint.forEach((ring) => {
      ring.forEach(([x, y]) => points.push([x, y]));
    });
  }

  volumes.forEach((volume) => {
    volume.footprint.forEach((ring) => {
      ring.forEach(([x, y]) => points.push([x, y]));
    });
  });

  if (points.length === 0) {
    return {
      centerX: 0,
      centerZ: 0,
      sizeX: 10,
      sizeZ: 10,
      radius: 10,
    };
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  points.forEach(([x, y]) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  const sizeX = Math.max(maxX - minX, 1);
  const sizeZ = Math.max(maxY - minY, 1);

  return {
    centerX: (minX + maxX) / 2,
    centerZ: (minY + maxY) / 2,
    sizeX,
    sizeZ,
    radius: Math.max(sizeX, sizeZ) / 2,
  };
}

function CameraController({
  bounds,
  padding,
}: {
  bounds: SceneBounds;
  padding: number;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);

  useEffect(() => {
    const radius = Math.max(bounds.radius * padding, 10);
    const distance = radius * 2.4;

    camera.position.set(
      bounds.centerX + distance * 0.9,
      distance * 0.9,
      bounds.centerZ + distance * 0.9
    );
    camera.near = 0.1;
    camera.far = Math.max(2000, distance * 20);
    camera.lookAt(bounds.centerX, 0, bounds.centerZ);
    camera.updateProjectionMatrix();

    if (controlsRef.current) {
      controlsRef.current.target.set(bounds.centerX, 0, bounds.centerZ);
      controlsRef.current.update();
    }
  }, [bounds, camera, padding]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.08}
      minDistance={5}
      maxDistance={Math.max(bounds.radius * 8, 50)}
      maxPolarAngle={Math.PI / 2.02}
    />
  );
}

function PlotBoundary({ footprint }: { footprint?: NormalizedPolygon }) {
  const rings = useMemo(() => {
    if (!footprint) return [];

    return footprint
      .filter((ring) => ring.length >= 2)
      .map((ring) => {
        const geometry = new THREE.BufferGeometry().setFromPoints(
          toLinePoints(ring, 0.05)
        );
        return geometry;
      });
  }, [footprint]);

  useEffect(() => {
    return () => {
      rings.forEach((geometry) => geometry.dispose());
    };
  }, [rings]);

  return (
    <>
      {rings.map((geometry, index) => (
        <lineLoop key={`plot-ring-${index}`} geometry={geometry}>
          <lineBasicMaterial color="#111827" linewidth={1} />
        </lineLoop>
      ))}
    </>
  );
}

function ExtrudedPart({
  footprint,
  height,
  type,
}: {
  footprint: NormalizedPolygon;
  height: number;
  type: BuildingPartType;
}) {
  const geometry = useMemo(() => {
    const shape = toShape(footprint);
    const extruded = new THREE.ExtrudeGeometry(shape, {
      depth: Math.max(height, MIN_HEIGHT),
      bevelEnabled: false,
      steps: 1,
    });

    extruded.rotateX(-Math.PI / 2);
    extruded.computeVertexNormals();
    return extruded;
  }, [footprint, height]);

  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial
        color={PART_COLORS[type]}
        metalness={0.15}
        roughness={0.72}
      />
    </mesh>
  );
}

function SceneContent({
  plotFootprint,
  volumes,
  cameraPadding,
}: {
  plotFootprint?: NormalizedPolygon;
  volumes: RenderVolume[];
  cameraPadding: number;
}) {
  const bounds = useMemo(
    () => getSceneBounds(plotFootprint, volumes),
    [plotFootprint, volumes]
  );

  return (
    <>
      <color attach="background" args={['#f7f5ef']} />
      <ambientLight intensity={0.7} />
      <directionalLight
        position={[bounds.centerX + 40, 80, bounds.centerZ + 30]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <hemisphereLight intensity={0.35} groundColor="#d6d3d1" />

      <group>
        <PlotBoundary footprint={plotFootprint} />
        {volumes.map((volume) => (
          <ExtrudedPart
            key={volume.key}
            footprint={volume.footprint}
            height={volume.height}
            type={volume.type}
          />
        ))}
      </group>

      <CameraController bounds={bounds} padding={cameraPadding} />
    </>
  );
}

export function ThreePlotScene({
  plot,
  buildings,
  className,
  cameraPadding = 1.35,
}: ThreePlotSceneProps) {
  const renderVolumes = useMemo(
    () => collectRenderableVolumes(buildings),
    [buildings]
  );

  if (!plot.footprint || renderVolumes.length === 0) {
    return (
      <div
        className={className}
      />
    );
  }

  return (
    <div className={className}>
      <Canvas
        camera={{ fov: 42, near: 0.1, far: 4000 }}
        shadows
      >
        <SceneContent
          plotFootprint={plot.footprint}
          volumes={renderVolumes}
          cameraPadding={cameraPadding}
        />
      </Canvas>
    </div>
  );
}
