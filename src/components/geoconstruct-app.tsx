'use client';

import { MapEditor } from '@/components/map-editor';
import { ChatPanel } from '@/components/chat-panel';
import { Toaster } from '@/components/ui/toaster';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Bot, MapPin, PanelRight, ArrowLeft, Save, Layers, PanelLeft, Loader2, BookCopy } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { useState, useEffect, useRef } from 'react';
import { FeasibilityDashboard } from './feasibility-dashboard';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { PropertiesPanel } from './properties-panel';
import { ProjectExplorer } from './project-explorer';
import { DrawingToolbar } from './drawing-toolbar';
import { DrawingStatus } from './drawing-status';
import { ProjectInfoPanel } from './project-info-panel';
import { DefineZoneModal } from './define-zone-modal';
import { AiScenarioViewerModal } from './ai-scenario-viewer-modal';
import { MapSearch } from './map-search';
import { RegulationViewerModal } from './regulation-viewer-modal';


export function GeoConstructApp({ projectId }: { projectId: string }) {
  const isMobile = useIsMobile();
  const [isClient, setIsClient] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isExplorerOpen, setIsExplorerOpen] = useState(true);
  const [isMapReady, setIsMapReady] = useState(false);
  const [isRegulationViewerOpen, setIsRegulationViewerOpen] = useState(false);

  const { selectedObjectId, actions, project, drawingState, zoneDefinition, aiScenarios, isLoading, isSaving, plots } = useBuildingStore(s => ({
    selectedObjectId: s.selectedObjectId,
    actions: s.actions,
    project: s.projects.find(p => p.id === projectId),
    drawingState: s.drawingState,
    zoneDefinition: s.zoneDefinition,
    aiScenarios: s.aiScenarios,
    isLoading: s.isLoading,
    isSaving: s.isSaving,
    plots: s.plots,
  }));
  
  const selectedPlot = useSelectedPlot();

  useEffect(() => {
    setIsClient(true);
    if (projectId) {
      actions.loadProject(projectId);
    }
  }, [projectId, actions]);

  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('resizeMap'));
    }, 350);
    return () => clearTimeout(timer);
  }, [isChatOpen, selectedObjectId]);
  
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (drawingState.isDrawing) {
          actions.resetDrawing();
        } else if (selectedObjectId) {
          actions.selectObject(null, null);
        } else if (zoneDefinition.isDefining) {
          actions.cancelDefineZone();
        }
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    }
  }, [actions, drawingState.isDrawing, selectedObjectId, zoneDefinition.isDefining]);


  const locateMeButton = (
      <Button
        variant="secondary"
        size="icon"
        onClick={() => window.dispatchEvent(new CustomEvent('locateUser'))}
        className="absolute bottom-4 right-4 z-10 rounded-full h-12 w-12 shadow-lg"
      >
        <MapPin className="h-6 w-6" />
      </Button>
  );
  
  const mobileChatPanel = (
    <Sheet>
        <SheetTrigger asChild>
            <Button variant="secondary" className="absolute top-2 right-2 z-10 rounded-full">
                <Bot className="mr-2 h-5 w-5" />
                AI Assistant
            </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-[80vw] p-0 border-l-0 bg-transparent">
            <ChatPanel />
        </SheetContent>
    </Sheet>
  )

  const header = (
     <div className="p-2 border-b border-border flex items-center justify-between gap-4 bg-background/80 backdrop-blur-sm z-10">
        <div className="flex items-center gap-4 flex-1">
            <Button variant="outline" size="icon" asChild>
                <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
            </Button>
            <div>
                <h1 className="text-xl font-headline font-bold">
                {project?.name || 'Loading Project...'}
                </h1>
                <p className="text-sm text-muted-foreground">
                Urban Planning & Feasibility
                </p>
            </div>
        </div>
        <div className="flex-1 flex justify-center">
          <MapSearch />
        </div>
        <div className='flex items-center gap-2 flex-1 justify-end'>
            <Button variant="outline" onClick={() => setIsExplorerOpen(!isExplorerOpen)}>
                <Layers className="mr-2 h-4 w-4" />
                Explorer
            </Button>
             <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Button variant="outline" size="icon" onClick={() => setIsChatOpen(!isChatOpen)}>
                            <Bot className={cn("transition-transform h-5 w-5", isChatOpen && "text-primary")}/>
                        </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                        <p>{isChatOpen ? "Collapse" : "Expand"} AI Assistant</p>
                    </TooltipContent>
                </Tooltip>
            </TooltipProvider>
             <Button variant="outline" onClick={() => setIsRegulationViewerOpen(true)} disabled={!selectedPlot || !selectedPlot.availableRegulations || selectedPlot.availableRegulations.length === 0}>
                <BookCopy className="mr-2 h-4 w-4"/>
                Regulations
             </Button>
            <Button onClick={() => actions.saveCurrentProject()} disabled={isSaving}>
                {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                {isSaving ? 'Saving...' : 'Save'}
            </Button>
        </div>
      </div>
  )

  const showLoader = isLoading || !isMapReady;

  if (isClient && isMobile) {
    return (
      <div className="h-dvh w-screen bg-background text-foreground flex flex-col">
        {header}
        <main className="h-full w-full relative flex-1">
          {showLoader && (
             <div className="absolute inset-0 flex items-center justify-center bg-background z-50">
                <div className="flex items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-lg">Loading Project...</span>
                </div>
            </div>
          )}
          <div className={cn('h-full w-full', showLoader && 'opacity-0')}>
            <MapEditor onMapReady={() => setIsMapReady(true)}>
            </MapEditor>
            <DrawingToolbar />
            {locateMeButton}
            {selectedObjectId && <FeasibilityDashboard />}
          </div>
        </main>
        {mobileChatPanel}
        <Toaster />
      </div>
    );
  }
  
  return (
    <div className="h-dvh w-screen bg-background text-foreground flex flex-col overflow-hidden">
      {header}
      <div className="flex-1 relative">
        {showLoader && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-50">
                <div className="flex items-center gap-2">
                    <Loader2 className="h-6 w-6 animate-spin" />
                    <span className="text-lg">Loading Project...</span>
                </div>
            </div>
        )}
        <div className={cn('h-full w-full', showLoader && 'opacity-0')}>
          <MapEditor onMapReady={() => setIsMapReady(true)}>
          </MapEditor>
          
          {drawingState.isDrawing && <DrawingStatus />}

          <DrawingToolbar />
          
          <div className="absolute top-4 left-4 z-20">
            <ProjectInfoPanel />
          </div>

          <div className={cn("absolute top-4 right-4 w-96 z-20 transition-transform duration-300 ease-in-out", selectedObjectId ? "translate-x-0" : "translate-x-[calc(100%+2rem)]")}>
              <PropertiesPanel />
          </div>
          
          <div className={cn("absolute bottom-4 left-4 z-20 transition-opacity duration-300 ease-in-out", isExplorerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none')}>
            <ProjectExplorer />
          </div>

          <TooltipProvider>
              <Tooltip>
                  <TooltipTrigger asChild>
                      {locateMeButton}
                  </TooltipTrigger>
                  <TooltipContent side="left">
                      <p>Locate Me</p>
                  </TooltipContent>
              </Tooltip>
          </TooltipProvider>

          {selectedObjectId && <FeasibilityDashboard />}
          
          <div className={cn("fixed top-[65px] right-0 h-[calc(100vh-65px)] bg-background/80 backdrop-blur-sm border-l border-border z-30 transition-transform duration-300 ease-in-out", isChatOpen ? "translate-x-0" : "translate-x-full")}>
              <div className="h-full w-[440px] relative">
                  {isChatOpen && <ChatPanel />}
              </div>
          </div>
        </div>
        
      </div>
      <DefineZoneModal />
      <AiScenarioViewerModal />
      {selectedPlot && (
        <RegulationViewerModal 
            isOpen={isRegulationViewerOpen}
            onOpenChange={setIsRegulationViewerOpen}
            plot={selectedPlot}
        />
      )}
      <Toaster />
    </div>
  );
}
