'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { useBuildingStore } from '@/hooks/use-building-store';
import { Download, Image, FileText, ChevronDown, Minus, Maximize2, X, GripVertical, RefreshCw } from 'lucide-react';
import type { RenderingBuildingInfo, RenderingPlotInfo, RenderingProjectSummary } from '@/lib/types';

function InfoCard({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className={`bg-muted/50 rounded p-2 ${className ?? ''}`}>
      <div className="text-muted-foreground text-[10px] leading-tight">{label}</div>
      <div className="font-medium text-xs mt-0.5">{value}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{children}</h4>;
}

export function AiRenderingModal() {
  const { aiRenderingUrl, aiRenderingResult, aiRenderingMinimized, isGeneratingRendering, actions } = useBuildingStore(s => ({
    aiRenderingUrl: s.aiRenderingUrl,
    aiRenderingResult: s.aiRenderingResult,
    aiRenderingMinimized: s.aiRenderingMinimized,
    isGeneratingRendering: s.isGeneratingRendering,
    actions: s.actions,
  }));

  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);

  // Draggable PiP position (default: bottom-right)
  const [pipPos, setPipPos] = useState<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const pipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      const newX = Math.max(0, Math.min(window.innerWidth - 224, dragRef.current.origX + dx));
      const newY = Math.max(0, Math.min(window.innerHeight - 60, dragRef.current.origY + dy));
      setPipPos({ x: newX, y: newY });
    };
    const onMouseUp = () => { dragRef.current = null; };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  // Reset load state when URL changes
  const [prevUrl, setPrevUrl] = useState(aiRenderingUrl);
  if (aiRenderingUrl && aiRenderingUrl !== prevUrl) {
    setPrevUrl(aiRenderingUrl);
    setImgLoaded(false);
    setImgError(false);
  }

  const downloadFilename = useCallback((suffix: string) => {
    const p = aiRenderingResult?.plot;
    const b = aiRenderingResult?.buildings;
    const location = p?.location?.replace(/[^a-zA-Z0-9]+/g, '-').replace(/-+$/, '') || 'Site';
    const use = b?.[0]?.intendedUse?.replace(/[^a-zA-Z0-9]+/g, '-') || 'Mixed';
    const date = new Date().toISOString().slice(0, 10);
    return `${location}_${use}_ArchViz${suffix}_${date}.png`;
  }, [aiRenderingResult]);

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadImage = useCallback(async () => {
    if (!aiRenderingUrl) return;
    try {
      const res = await fetch(aiRenderingUrl);
      const blob = await res.blob();
      downloadBlob(blob, downloadFilename(''));
    } catch {
      window.open(aiRenderingUrl, '_blank');
    }
  }, [aiRenderingUrl, downloadBlob, downloadFilename]);

  const handleDownloadWithDetails = useCallback(async () => {
    if (!aiRenderingUrl) return;
    try {
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.src = aiRenderingUrl;
      await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; });

      const b = aiRenderingResult?.buildings ?? [];
      const p = aiRenderingResult?.plot;
      const s = aiRenderingResult?.summary;

      // Collect detail lines
      const lines: string[] = [];
      if (p) {
        lines.push('── PLOT & LAND ──');
        lines.push(`Location: ${p.location}  |  Plot Area: ${Math.round(p.plotArea).toLocaleString()} sqm  |  Setback: ${p.setback}m`);
        if (p.far != null) lines.push(`FAR: ${p.far}  |  Max Coverage: ${p.maxCoverage != null ? Math.round(p.maxCoverage * 100) + '%' : '–'}  |  Max Height: ${p.maxBuildingHeight != null ? p.maxBuildingHeight + 'm' : '–'}`);
        if (p.roadAccessSides?.length) lines.push(`Road Access: ${p.roadAccessSides.join(', ')}`);
        lines.push('');
      }
      if (s && s.totalBuiltUpArea != null) {
        lines.push('── KPIs ──');
        lines.push(`GFA: ${Math.round(s.totalBuiltUpArea).toLocaleString()} sqm  |  FAR: ${s.achievedFAR ?? 0}  |  Coverage: ${s.groundCoveragePct ?? 0}%  |  Efficiency: ${Math.round((s.efficiency ?? 0) * 100)}%`);
        lines.push(`Sellable: ${(s.sellableArea ?? 0).toLocaleString()} sqm  |  Open Space: ${(s.openSpace ?? 0).toLocaleString()} sqm  |  Units: ${s.totalUnits ?? 0}`);
        lines.push('');
      }
      if (s?.compliance) {
        lines.push('── COMPLIANCE ──');
        lines.push(`Bylaws: ${s.compliance.bylaws}%  |  Green: ${s.compliance.green}%  |  Vastu: ${s.compliance.vastu}%`);
        lines.push('');
      }
      if (b.length > 0) {
        lines.push(`── BUILDINGS (${b.length}) ──`);
        b.forEach((bld, i) => {
          lines.push(`${b.length > 1 ? `[${i + 1}] ` : ''}${bld.name}: ${bld.intendedUse}, ${bld.typology}, ${Math.round(bld.height)}m, ${bld.numFloors}F above + ${bld.basementFloors}B, ${bld.footprintWidth}×${bld.footprintDepth}m, GFA ${Math.round(bld.gfa).toLocaleString()} sqm`);
        });
        lines.push('');
      }
      if (s?.designStrategy) {
        lines.push('── DESIGN STRATEGY ──');
        const ds = s.designStrategy;
        lines.push(`Land Use: ${ds.landUse}  |  Typology: ${ds.typology}${ds.hasPodium ? `  |  Podium: ${ds.podiumFloors}F` : ''}`);
        if (ds.parkingTypes?.length) lines.push(`Parking: ${ds.parkingTypes.join(', ')}`);
      }

      // Draw canvas
      const padding = 40;
      const lineHeight = 22;
      const fontSize = 14;
      const detailsHeight = padding * 2 + lines.length * lineHeight + 20;
      const canvasW = img.width;
      const canvasH = img.height + detailsHeight;

      const canvas = document.createElement('canvas');
      canvas.width = canvasW;
      canvas.height = canvasH;
      const ctx = canvas.getContext('2d')!;

      // White background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Draw image
      ctx.drawImage(img, 0, 0);

      // Draw details text
      ctx.fillStyle = '#1a1a1a';
      ctx.font = `${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
      let y = img.height + padding;
      for (const line of lines) {
        if (line.startsWith('──')) {
          ctx.font = `bold ${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = '#555555';
          ctx.fillText(line, padding, y);
          ctx.font = `${fontSize}px "Segoe UI", system-ui, -apple-system, sans-serif`;
          ctx.fillStyle = '#1a1a1a';
        } else {
          ctx.fillText(line, padding, y);
        }
        y += lineHeight;
      }

      canvas.toBlob(blob => {
        if (blob) downloadBlob(blob, downloadFilename('_Report'));
      }, 'image/png');
    } catch {
      window.open(aiRenderingUrl, '_blank');
    }
  }, [aiRenderingUrl, aiRenderingResult, downloadBlob, downloadFilename]);

  if (!aiRenderingUrl) return null;

  const handleClose = () => {
    setImgLoaded(false);
    setImgError(false);
    actions.clearAiRendering();
  };

  const handleMinimize = () => {
    actions.toggleAiRenderingMinimized(true);
  };

  const handleRestore = () => {
    actions.toggleAiRenderingMinimized(false);
    actions.refreshAiRenderingData();
  };

  const handleRefresh = () => {
    setImgLoaded(false);
    setImgError(false);
    actions.refreshAiRenderingData(true);
  };

  const buildings = aiRenderingResult?.buildings ?? [];
  const plot = aiRenderingResult?.plot;
  const summary = aiRenderingResult?.summary;

  // Minimized floating PiP thumbnail (draggable)
  if (aiRenderingMinimized) {
    const defaultX = typeof window !== 'undefined' ? window.innerWidth - 240 : 0;
    const defaultY = typeof window !== 'undefined' ? window.innerHeight - 220 : 0;
    const pos = pipPos ?? { x: defaultX, y: defaultY };

    const onDragStart = (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
    };

    return (
      <div
        ref={pipRef}
        className="fixed z-50 group"
        style={{ left: pos.x, top: pos.y }}
      >
        <div className="relative w-56 rounded-lg overflow-hidden shadow-2xl border bg-background ring-1 ring-black/10">
          {/* Drag handle + controls bar */}
          <div
            className="flex items-center justify-between px-2 py-1 bg-muted/80 cursor-grab active:cursor-grabbing select-none"
            onMouseDown={onDragStart}
          >
            <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <GripVertical className="h-3 w-3" />
              AI Rendering
            </div>
            <div className="flex items-center gap-0.5">
              <button
                onClick={handleRestore}
                className="hover:bg-accent rounded p-0.5 transition-colors"
                title="Restore"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleClose}
                className="hover:bg-destructive/20 rounded p-0.5 transition-colors"
                title="Close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          {/* Thumbnail image */}
          <img
            src={aiRenderingUrl}
            alt="AI rendering preview"
            className="w-full h-32 object-cover cursor-pointer"
            onClick={handleRestore}
          />
        </div>
      </div>
    );
  }

  return (
    <Dialog open={true} onOpenChange={open => { if (!open) handleClose(); }}>
      <DialogContent className="max-w-5xl w-full max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-start justify-between space-y-0 pr-8">
          <div>
            <DialogTitle>AI Architectural Rendering</DialogTitle>
            <DialogDescription>
              Photorealistic rendering based on your design parameters.
            </DialogDescription>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleMinimize} title="Minimize">
            <Minus className="h-4 w-4" />
          </Button>
        </DialogHeader>

        {/* Image section */}
        <div className="mt-2">
          {imgError && (
            <p className="text-sm text-destructive">Failed to load image.</p>
          )}
          {!imgLoaded && !imgError && (
            <div className="flex items-center justify-center h-48 bg-muted rounded">
              <p className="text-sm text-muted-foreground animate-pulse">Loading image…</p>
            </div>
          )}
          <img
            src={aiRenderingUrl}
            alt="AI architectural rendering"
            className={`w-full h-auto rounded ${!imgLoaded ? 'hidden' : ''}`}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        </div>

        {/* ═══ PROJECT DETAILS ═══════════════════════════════════════ */}
        {(buildings.length > 0 || plot || summary) && (
          <div className="mt-4 space-y-4 border-t pt-3">
            <h3 className="text-sm font-bold">Project Details</h3>

            {/* ── PLOT & LAND ────────────────────────────────────────── */}
            {plot && (
              <div className="space-y-1.5">
                <SectionTitle>Plot &amp; Land</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <InfoCard label="Location" value={plot.location} />
                  <InfoCard label="Plot Area" value={`${Math.round(plot.plotArea).toLocaleString()} sqm`} />
                  {plot.subPlotCount > 1 && <InfoCard label="Sub-Plots" value={plot.subPlotCount} />}
                  <InfoCard label="Setback" value={`${plot.setback}m`} />
                  {plot.far != null && <InfoCard label="FAR (Allowed)" value={plot.far} />}
                  {plot.maxCoverage != null && <InfoCard label="Max Coverage" value={`${Math.round(plot.maxCoverage * 100)}%`} />}
                  {plot.maxBuildingHeight != null && <InfoCard label="Max Height" value={`${plot.maxBuildingHeight}m`} />}
                  {plot.regulationType && <InfoCard label="Regulation" value={plot.regulationType} />}
                  {plot.greenAreas > 0 && <InfoCard label="Green Areas" value={plot.greenAreas} />}
                  {plot.parkingAreas > 0 && <InfoCard label="Parking Zones" value={plot.parkingAreas} />}
                  {plot.roadAccessSides && plot.roadAccessSides.length > 0 && (
                    <InfoCard label="Road Access" value={plot.roadAccessSides.join(', ')} />
                  )}
                </div>
              </div>
            )}

            {/* ── KPIs & REGULATIONS ─────────────────────────────────── */}
            {summary && summary.totalBuiltUpArea != null && (
              <div className="space-y-1.5">
                <SectionTitle>KPIs &amp; Regulations</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <InfoCard label="Total Built-up (GFA)" value={`${Math.round(summary.totalBuiltUpArea).toLocaleString()} sqm`} />
                  <InfoCard label="Achieved FAR" value={summary.achievedFAR ?? 0} />
                  <InfoCard label="Ground Coverage" value={`${summary.groundCoveragePct ?? 0}%`} />
                  <InfoCard label="Sellable Area" value={`${(summary.sellableArea ?? 0).toLocaleString()} sqm`} />
                  <InfoCard label="Open Space" value={`${(summary.openSpace ?? 0).toLocaleString()} sqm`} />
                  <InfoCard label="Efficiency" value={`${Math.round((summary.efficiency ?? 0) * 100)}%`} />
                  {(summary.totalUnits ?? 0) > 0 && <InfoCard label="Total Units" value={summary.totalUnits} />}
                </div>
              </div>
            )}

            {/* ── COMPLIANCE SCORES ──────────────────────────────────── */}
            {summary?.compliance && (
              <div className="space-y-1.5">
                <SectionTitle>Compliance Scores</SectionTitle>
                <div className="grid grid-cols-3 gap-2">
                  <div className="bg-muted/50 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">Bylaws</div>
                    <div className={`text-lg font-bold ${(summary.compliance.bylaws ?? 0) >= 75 ? 'text-green-600' : (summary.compliance.bylaws ?? 0) >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {summary.compliance.bylaws ?? 0}%
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">Green</div>
                    <div className={`text-lg font-bold ${(summary.compliance.green ?? 0) >= 75 ? 'text-green-600' : (summary.compliance.green ?? 0) >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {summary.compliance.green ?? 0}%
                    </div>
                  </div>
                  <div className="bg-muted/50 rounded p-2 text-center">
                    <div className="text-[10px] text-muted-foreground">Vastu</div>
                    <div className={`text-lg font-bold ${(summary.compliance.vastu ?? 0) >= 75 ? 'text-green-600' : (summary.compliance.vastu ?? 0) >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {summary.compliance.vastu ?? 0}%
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── BUILDINGS ──────────────────────────────────────────── */}
            <div className="space-y-2">
              <SectionTitle>
                {buildings.length === 1 ? 'Building' : `Buildings (${buildings.length})`}
              </SectionTitle>
              <div className="grid gap-2">
                {buildings.map((b, i) => (
                  <div key={i} className="border rounded p-3 text-xs space-y-2">
                    <div className="font-semibold text-sm">{b.name}</div>

                    {/* Row 1: Core dimensions */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <InfoCard label="Intended Use" value={b.intendedUse} />
                      <InfoCard label="Typology" value={b.typology} className="capitalize" />
                      <InfoCard label="Height" value={`${Math.round(b.height)}m`} />
                      <InfoCard label="Floor Height" value={`${b.floorHeight.toFixed(1)}m`} />
                    </div>

                    {/* Row 2: Floor breakdown */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <InfoCard label="Above-Ground Floors" value={b.numFloors} />
                      <InfoCard label="Basement Floors" value={b.basementFloors} />
                      <InfoCard label="Total Floors" value={b.totalFloors} />
                      <InfoCard label="GFA" value={`${Math.round(b.gfa).toLocaleString()} sqm`} />
                    </div>

                    {/* Row 3: Footprint dimensions */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <InfoCard label="Footprint Area" value={`${Math.round(b.footprintArea)} sqm`} />
                      <InfoCard label="Dimensions (W×D)" value={`${b.footprintWidth}m × ${b.footprintDepth}m`} />
                      {b.parkingFloors > 0 && <InfoCard label="Parking Floors" value={b.parkingFloors} />}
                      {b.parkingCapacity > 0 && <InfoCard label="Parking Spots" value={b.parkingCapacity} />}
                    </div>

                    {/* Row 4: Cores & Units */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {(b.cores.lifts + b.cores.stairs + b.cores.service + b.cores.lobbies) > 0 && (
                        <InfoCard label="Cores" value={
                          [b.cores.lifts > 0 && `${b.cores.lifts} Lift`, b.cores.stairs > 0 && `${b.cores.stairs} Stair`, b.cores.service > 0 && `${b.cores.service} Svc`, b.cores.lobbies > 0 && `${b.cores.lobbies} Lobby`].filter(Boolean).join(', ')
                        } />
                      )}
                      {b.unitCount > 0 && (
                        <InfoCard label="Units" value={`${b.unitCount} total`} />
                      )}
                      {b.unitCount > 0 && Object.keys(b.unitBreakdown).length > 0 && (
                        <InfoCard label="Unit Breakdown" value={
                          Object.entries(b.unitBreakdown).map(([k, v]) => `${k}: ${v}`).join(', ')
                        } className="col-span-2" />
                      )}
                      {b.evStations > 0 && <InfoCard label="EV Stations" value={b.evStations} />}
                    </div>

                    {/* Program Mix */}
                    {b.programMix && Object.values(b.programMix).some(v => v > 0) && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <InfoCard label="Program Mix" value={
                          Object.entries(b.programMix).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}%`).join(', ')
                        } className="col-span-2 sm:col-span-4" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* ── CUSTOM ZONES ───────────────────────────────────────── */}
            {summary?.zones && (summary.zones.buildable?.length > 0 || summary.zones.green?.length > 0 || summary.zones.parking?.length > 0 || summary.zones.utility?.length > 0) && (
              <div className="space-y-1.5">
                <SectionTitle>Zones</SectionTitle>
                <div className="grid gap-2">
                  {summary.zones.buildable?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground font-medium uppercase">Buildable Zones</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {summary.zones.buildable.map((z, i) => (
                          <InfoCard key={i} label={z.name} value={`${z.area.toLocaleString()} sqm · ${z.intendedUse}`} />
                        ))}
                      </div>
                    </div>
                  )}
                  {summary.zones.green?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground font-medium uppercase">Green Zones</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {summary.zones.green.map((z, i) => (
                          <InfoCard key={i} label={z.name} value={`${z.area.toLocaleString()} sqm`} />
                        ))}
                      </div>
                    </div>
                  )}
                  {summary.zones.parking?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground font-medium uppercase">Parking Zones</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {summary.zones.parking.map((z, i) => (
                          <InfoCard key={i} label={z.name} value={`${z.area.toLocaleString()} sqm${z.type ? ` · ${z.type}` : ''}${z.capacity ? ` · ${z.capacity} spots` : ''}`} />
                        ))}
                      </div>
                    </div>
                  )}
                  {summary.zones.utility?.length > 0 && (
                    <div className="space-y-1">
                      <div className="text-[10px] text-muted-foreground font-medium uppercase">Utility Zones</div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {summary.zones.utility.map((z, i) => (
                          <InfoCard key={i} label={z.name} value={`${z.area.toLocaleString()} sqm · ${z.type}`} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── PARKING SUMMARY ────────────────────────────────────── */}
            {summary?.parkingSummary && summary.parkingSummary.length > 0 && (
              <div className="space-y-1.5">
                <SectionTitle>Parking</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {summary.parkingSummary.map(p => (
                    <InfoCard key={p.type} label={p.type} value={`${p.count} spots`} />
                  ))}
                </div>
              </div>
            )}

            {/* ── UTILITIES ──────────────────────────────────────────── */}
            {summary?.utilities && summary.utilities.length > 0 && (
              <div className="space-y-1.5">
                <SectionTitle>Utilities &amp; Infrastructure</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {summary.utilities.map(u => (
                    <span key={u} className="bg-muted/50 border rounded px-2 py-1 text-xs">{u}</span>
                  ))}
                </div>
              </div>
            )}

            {/* ── DESIGN STRATEGY ────────────────────────────────────── */}
            {summary?.designStrategy && (
              <div className="space-y-1.5">
                <SectionTitle>Design Strategy</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <InfoCard label="Land Use" value={summary.designStrategy.landUse} className="capitalize" />
                  <InfoCard label="Typology" value={summary.designStrategy.typology} className="capitalize" />
                  {summary.designStrategy.hasPodium && (
                    <InfoCard label="Podium" value={`${summary.designStrategy.podiumFloors} floors`} />
                  )}
                  {summary.designStrategy.parkingTypes?.length > 0 && (
                    <InfoCard label="Parking Types" value={summary.designStrategy.parkingTypes.join(', ')} />
                  )}
                </div>
                {summary.designStrategy.unitMix && Object.keys(summary.designStrategy.unitMix).length > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2">
                    {Object.entries(summary.designStrategy.unitMix).filter(([, v]) => v > 0).map(([k, v]) => (
                      <InfoCard key={k} label={k} value={`${v}%`} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="flex gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleRefresh} disabled={isGeneratingRendering} title="Regenerate 3D rendering with latest data">
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isGeneratingRendering ? 'animate-spin' : ''}`} />
            {isGeneratingRendering ? 'Regenerating…' : 'Refresh'}
          </Button>
          {imgLoaded && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Download className="h-4 w-4 mr-1.5" />
                  Download
                  <ChevronDown className="h-3 w-3 ml-1.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleDownloadImage}>
                  <Image className="h-4 w-4 mr-2" />
                  Image Only
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDownloadWithDetails}>
                  <FileText className="h-4 w-4 mr-2" />
                  Image with Details
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button onClick={handleClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
