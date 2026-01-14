import { useMemo } from 'react';
import * as turf from '@turf/turf';
import { Feature, Polygon, MultiPolygon } from 'geojson';

interface ScenarioThumbnailProps {
    features: Feature<Polygon | MultiPolygon>[];
    plotGeometry?: Feature<Polygon>;
    setback?: number;
    className?: string;
}

export function ScenarioThumbnail({ features, plotGeometry, setback = 0, className }: ScenarioThumbnailProps) {
    const { viewBox, plotPath, setbackPath, buildingPaths } = useMemo(() => {
        // Calculate bounding box - use plot if available, otherwise use buildings
        const geometryForBbox = plotGeometry ? [plotGeometry, ...features] : features;

        if (!geometryForBbox || geometryForBbox.length === 0) {
            return { viewBox: "0 0 100 100", plotPath: null, setbackPath: null, buildingPaths: [] };
        }

        const bbox = turf.bbox(turf.featureCollection(geometryForBbox as any));
        const [minX, minY, maxX, maxY] = bbox;

        const width = maxX - minX;
        const height = maxY - minY;

        // Helper function to convert coordinates to SVG space
        const toSVG = (pos: number[]) => {
            const x = ((pos[0] - minX) / width) * 100;
            const y = 100 - ((pos[1] - minY) / height) * 100; // Flip Y for SVG
            return { x, y };
        };

        // Helper to create path from polygon coordinates
        const createPath = (coords: number[][]) => {
            return coords.map((pos, k) => {
                const { x, y } = toSVG(pos);
                return `${k === 0 ? 'M' : 'L'} ${x} ${y}`;
            }).join(' ') + ' Z';
        };

        // Render plot boundary
        let plotPath = null;
        if (plotGeometry?.geometry) {
            const coords = plotGeometry.geometry.coordinates[0];
            const d = createPath(coords);
            plotPath = <path key="plot" d={d} className="fill-muted/10 stroke-border stroke-[0.5]" />;
        }

        // Render setback margin
        let setbackPath = null;
        if (plotGeometry?.geometry && setback > 0) {
            try {
                const buffered = turf.buffer(plotGeometry, -setback / 1000, { units: 'kilometers' });
                if (buffered?.geometry) {
                    const coords = buffered.geometry.type === 'Polygon'
                        ? buffered.geometry.coordinates[0]
                        : buffered.geometry.coordinates[0][0];
                    const d = createPath(coords);
                    setbackPath = <path key="setback" d={d} className="fill-none stroke-primary/40 stroke-[0.8] stroke-dasharray-2" />;
                }
            } catch (e) {
                // Setback might be too large for plot, skip it
                console.warn('Could not create setback:', e);
            }
        }

        // Render buildings
        const buildingPaths = features.map((f, i) => {
            if (!f.geometry) return null;

            const coordinates = f.geometry.type === 'Polygon'
                ? [f.geometry.coordinates]
                : f.geometry.coordinates;

            return coordinates.map((polyCoords: any, j: number) => {
                const d = createPath(polyCoords[0]);
                return <path key={`building-${i}-${j}`} d={d} className="fill-primary/30 stroke-primary stroke-[1]" />;
            });
        });

        return { viewBox: "0 0 100 100", plotPath, setbackPath, buildingPaths };

    }, [features, plotGeometry, setback]);

    return (
        <div className={`aspect-video bg-muted/30 rounded-md overflow-hidden p-2 flex items-center justify-center ${className}`}>
            {(features.length > 0 || plotGeometry) ? (
                <svg viewBox="0 0 100 100" className="w-full h-full">
                    {plotPath}
                    {setbackPath}
                    {buildingPaths}
                </svg>
            ) : (
                <span className="text-xs text-muted-foreground">No Preview</span>
            )}
        </div>
    );
}
