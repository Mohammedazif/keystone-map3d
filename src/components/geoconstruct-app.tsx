'use client';

import dynamic from 'next/dynamic';
import { MapEditor } from '@/components/map-editor';
import { Toaster } from '@/components/ui/toaster';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Bot, MapPin, PanelRight, ArrowLeft, Save, Layers, PanelLeft, Loader2, BookCopy, Sparkles, Bookmark, Leaf, Globe, Wand2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, TrendingUp } from 'lucide-react';
import { useGreenRegulations } from '@/hooks/use-green-regulations';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect, useRef } from 'react';
import { useBuildingStore, useSelectedPlot } from '@/hooks/use-building-store';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import { DrawingToolbar } from './drawing-toolbar';
import { DrawingStatus } from './drawing-status';
import { ProjectInfoPanel } from './project-info-panel';
import { ParametricToolbar } from './parametric-toolbar';
import { MapSearch } from './map-search';
import { AnalysisMode } from './solar-controls';
import { Sun } from 'lucide-react';

// Lazy-loaded panels & modals (not needed on initial render)
const ChatPanel = dynamic(() => import('./chat-panel').then(m => ({ default: m.ChatPanel })), { ssr: false });
const FeasibilityDashboard = dynamic(() => import('./feasibility-dashboard').then(m => ({ default: m.FeasibilityDashboard })), { ssr: false });
const PropertiesPanel = dynamic(() => import('./properties-panel').then(m => ({ default: m.PropertiesPanel })), { ssr: false });
const ProjectExplorer = dynamic(() => import('./project-explorer').then(m => ({ default: m.ProjectExplorer })), { ssr: false });
const SavedScenariosPanel = dynamic(() => import('./saved-scenarios-panel').then(m => ({ default: m.SavedScenariosPanel })), { ssr: false });
const SimulationTab = dynamic(() => import('./simulation-tab').then(m => ({ default: m.SimulationTab })), { ssr: false });
const SimulationDataPanel = dynamic(() => import('./simulation-data-panel').then(m => ({ default: m.SimulationDataPanel })), { ssr: false });
const LocationConnectivityPanel = dynamic(() => import('./location-connectivity-panel').then(m => ({ default: m.LocationConnectivityPanel })), { ssr: false });
const GreenScorecardPanel = dynamic(() => import('./green-scorecard-panel').then(m => ({ default: m.GreenScorecardPanel })), { ssr: false });
const BhuvanPanel = dynamic(() => import('./bhuvan-panel').then(m => ({ default: m.BhuvanPanel })), { ssr: false });
const LandIntelligencePanel = dynamic(() => import('./land-intelligence-panel').then(m => ({ default: m.LandIntelligencePanel })), { ssr: false });
const DefineZoneModal = dynamic(() => import('./define-zone-modal').then(m => ({ default: m.DefineZoneModal })), { ssr: false });
const AiScenarioViewerModal = dynamic(() => import('./ai-scenario-viewer-modal').then(m => ({ default: m.AiScenarioViewerModal })), { ssr: false });
const RegulationViewerModal = dynamic(() => import('./regulation-viewer-modal').then(m => ({ default: m.RegulationViewerModal })), { ssr: false });
const ScenarioSelectorModal = dynamic(() => import('./scenario-selector-modal').then(m => ({ default: m.ScenarioSelectorModal })), { ssr: false });
const AiRenderingModal = dynamic(() => import('./ai-rendering-modal').then(m => ({ default: m.AiRenderingModal })), { ssr: false });


export function GeoConstructApp({ projectId }: { projectId: string }) {
  const isMobile = useIsMobile();
  const [isClient, setIsClient] = useState(false);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("design");
  const [isMapReady, setIsMapReady] = useState(false);
  const [isRegulationViewerOpen, setIsRegulationViewerOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);

  // Simulation State
  const [isSimulatorEnabled, setIsSimulatorEnabled] = useState(false);
  const [solarDate, setSolarDate] = useState<Date>(() => new Date());
  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>('none');
  const [isDataPanelOpen, setIsDataPanelOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const isResizing = useRef(false);

  const selectedObjectId = useBuildingStore(s => s.selectedObjectId);
  const actions = useBuildingStore(s => s.actions);
  const projects = useBuildingStore(s => s.projects);
  const activeProjectId = useBuildingStore(s => s.activeProjectId);
  const drawingState = useBuildingStore(s => s.drawingState);
  const zoneDefinition = useBuildingStore(s => s.zoneDefinition);
  const aiScenarios = useBuildingStore(s => s.aiScenarios);
  const isLoading = useBuildingStore(s => s.isLoading);
  const isSaving = useBuildingStore(s => s.isSaving);
  const isGeneratingRendering = useBuildingStore(s => s.isGeneratingRendering);
  const renderingDesignParams = useBuildingStore(s => s.renderingDesignParams);
  const plots = useBuildingStore(s => s.plots);
  const uiState = useBuildingStore(s => s.uiState);

  const kpiOpen = !!selectedObjectId && (uiState.isFeasibilityPanelOpen ?? true);
  const kpiBottom = kpiOpen ? 'calc(45vh + 8px)' : '52px';

  const project = projects.find(p => p.id === projectId);

  const selectedPlot = useSelectedPlot();

  const { regulations: greenRegulations } = useGreenRegulations(project);

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
    if (isSimulatorEnabled) {
      setActiveTab('simulation');
      setIsDataPanelOpen(true);
      if (selectedObjectId && selectedObjectId.type !== 'Plot') {
        actions.selectObject(null, null);
      }
    }
  }, [isSimulatorEnabled]);

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

  // Sidebar Resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const newWidth = Math.min(Math.max(320, e.clientX - 16), 560);
      setSidebarWidth(newWidth);
      window.dispatchEvent(new CustomEvent('resizeMap'));
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = 'default';
      window.dispatchEvent(new CustomEvent('resizeMap'));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
  };


  const locateMeButton = (
    <Button
      variant="secondary"
      size="icon"
      onClick={() => window.dispatchEvent(new CustomEvent('locateUser'))}
      className={cn("absolute right-4 z-10 rounded-full h-9 w-9 shadow-md transition-all duration-300 print:hidden",
        uiState.isFeasibilityPanelOpen ? "scrollbar-hide translate-y-20 opacity-0 pointer-events-none" : "translate-y-0 opacity-100",
        selectedObjectId ? "bottom-[70px]" : "bottom-4")}
      title="Locate Me"
    >
      <MapPin className="h-4 w-4" />
    </Button>
  );

  const mobileChatPanel = (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary" className="absolute top-2 right-2 z-10 rounded-full">
          <Bot className="mr-1.5 h-4 w-4" />
          AI
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[80vw] p-0 border-l-0 bg-transparent">
        <ChatPanel />
      </SheetContent>
    </Sheet>
  )

  const header = (
    <div className="px-3 py-1.5 border-b border-border/60 flex items-center justify-between gap-3 bg-background/90 backdrop-blur-sm z-30 relative print:hidden">
      <div className="flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link href="/"><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-sm font-semibold truncate max-w-[200px]">
          {project?.name || 'Loading...'}
        </h1>
      </div>
      <div className="flex-1 flex justify-center max-w-md">
        <MapSearch />
      </div>
      <div className='flex items-center gap-1.5 shrink-0'>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                onClick={() => {
                  if (!selectedPlot || !renderingDesignParams) return;
                  actions.generateArchitecturalRendering(selectedPlot.id, renderingDesignParams);
                }}
                disabled={isGeneratingRendering || !selectedPlot || !renderingDesignParams}
              >
                {isGeneratingRendering ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1.5 h-3.5 w-3.5" />}
                {isGeneratingRendering ? 'Rendering…' : '3D Render'}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>Generate AI 3D rendering</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsChatOpen(!isChatOpen)}>
                <Bot className={cn("h-4 w-4", isChatOpen && "text-primary")} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{isChatOpen ? 'Close' : 'Open'} AI Assistant</p></TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setIsRegulationViewerOpen(true)} disabled={!selectedPlot || !selectedPlot.availableRegulations || selectedPlot.availableRegulations.length === 0}>
                <BookCopy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>Regulations</p></TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <Button size="sm" className="h-8 px-3 text-xs" onClick={() => actions.saveCurrentProject()} disabled={isSaving}>
          {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
          {isSaving ? 'Saving' : 'Save'}
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
            <MapEditor
              activeGreenRegulations={greenRegulations}
              onMapReady={() => setIsMapReady(true)}
              solarDate={solarDate}
              setSolarDate={setSolarDate}
              isSimulatorEnabled={isSimulatorEnabled}
              setIsSimulatorEnabled={setIsSimulatorEnabled}
              analysisMode={analysisMode}
              setAnalysisMode={setAnalysisMode}
            >
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
    <div className="h-dvh print:h-auto print:block w-screen bg-background text-foreground flex flex-col overflow-hidden print:overflow-visible">
      {header}
      <div className="flex-1 relative print:static print:h-auto print:overflow-visible">
        {showLoader && (
          <div className="absolute inset-0 flex items-center justify-center bg-background z-50">
            <div className="flex items-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-lg">Loading Project...</span>
            </div>
          </div>
        )}
        <div className={cn('h-full print:h-auto print:overflow-visible w-full', showLoader && 'opacity-0')}>
          <MapEditor
            activeGreenRegulations={greenRegulations}
            onMapReady={() => setIsMapReady(true)}
            solarDate={solarDate}
            setSolarDate={setSolarDate}
            isSimulatorEnabled={isSimulatorEnabled}
            setIsSimulatorEnabled={setIsSimulatorEnabled}
            analysisMode={analysisMode}
            setAnalysisMode={setAnalysisMode}
          >
          </MapEditor>

          {drawingState.isDrawing && <DrawingStatus />}

          <DrawingToolbar />

          {/* Sidebar collapse toggle */}
          {isSidebarCollapsed && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-3 left-3 z-20 h-9 w-9 rounded-lg shadow-md print:hidden"
              onClick={() => setIsSidebarCollapsed(false)}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          )}

          {/*Sidebar */}
          <div className={cn("absolute top-3 left-3 z-20 flex flex-col gap-2 pointer-events-none group print:hidden transition-all duration-300", isSidebarCollapsed && "-translate-x-[calc(100%+24px)] opacity-0 pointer-events-none")} style={{ bottom: kpiBottom, width: sidebarWidth }}>
            <div className="pointer-events-auto min-h-0 w-full flex flex-row bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-xl border shadow-lg overflow-hidden text-clip shrink max-h-full relative">
              {/* Resize Handle */}
              <div 
                className="absolute right-0 top-0 w-1.5 h-full cursor-col-resize hover:bg-primary/30 transition-colors z-50 pointer-events-auto"
                onMouseDown={startResizing}
              />
              
              <Tabs value={activeTab} onValueChange={setActiveTab} orientation="vertical" className="flex flex-row h-auto max-h-full w-full min-h-0">
                <div className="w-11 bg-muted/20 border-r flex flex-col items-center py-2 gap-1 shrink-0">
                  {/* Collapse sidebar button */}
                  <button
                    onClick={() => setIsSidebarCollapsed(true)}
                    className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted transition-colors mb-1"
                    title="Collapse sidebar"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                  <TabsList className="bg-transparent flex flex-col h-auto p-0 gap-1 w-full items-center">
                    <TabsTrigger value="design" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Design">
                      <Sparkles className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="explorer" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Explorer">
                      <Layers className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="saved" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Saved Scenarios">
                      <Bookmark className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="simulation" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Solar Simulation">
                      <Sun className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="bhuvan" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Thematic Services">
                      <Globe className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="scorecard" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Green Scorecard">
                      <Leaf className="h-4 w-4" />
                    </TabsTrigger>
                    <TabsTrigger value="location" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Location">
                      <MapPin className="h-4 w-4" />
                    </TabsTrigger>
                    {/* <TabsTrigger value="intelligence" className="justify-center w-8 h-8 p-0 rounded-md data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-muted-foreground hover:bg-muted transition-all" title="Land Intelligence">
                      <TrendingUp className="h-4 w-4" />
                    </TabsTrigger> */}
                  </TabsList>
                </div>

                <div className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
                  {/* Frozen project metrics - always visible */}
                  <div className="shrink-0 border-b border-border/40">
                    <ProjectInfoPanel embedded={true} />
                  </div>

                  {/* Scrollable tab content */}
                  <TabsContent
                    value="design"
                    className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin m-0 p-0 data-[state=active]:block h-full min-h-0"
                  >
                    <ParametricToolbar embedded={true} />
                  </TabsContent>

                  <TabsContent value="explorer" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <ProjectExplorer className="h-full" embedded={true} />
                  </TabsContent>

                  <TabsContent value="simulation" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <SimulationTab
                      activeGreenRegulations={greenRegulations}
                      date={solarDate}
                      setDate={setSolarDate}
                      enabled={isSimulatorEnabled}
                      setEnabled={setIsSimulatorEnabled}
                      analysisMode={analysisMode}
                      setAnalysisMode={setAnalysisMode}
                    />
                  </TabsContent>

                  <TabsContent value="saved" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <SavedScenariosPanel embedded={true} />
                  </TabsContent>

                  <TabsContent forceMount value="scorecard" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block data-[state=inactive]:hidden h-full">
                    <GreenScorecardPanel />
                  </TabsContent>
                  <TabsContent value="location" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <LocationConnectivityPanel />
                  </TabsContent>
                  <TabsContent value="bhuvan" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <BhuvanPanel embedded={true} />
                  </TabsContent>
                  <TabsContent value="intelligence" className="flex-1 overflow-hidden m-0 p-0 data-[state=active]:block h-full">
                    <LandIntelligencePanel />
                  </TabsContent>
                </div>
              </Tabs>
            </div>
          </div>

          <div className={cn("absolute top-4 right-4 w-96 z-20 transition-transform duration-300 ease-in-out print:hidden", 
            isSimulatorEnabled && analysisMode !== 'none' && isDataPanelOpen ? "translate-x-0" : "translate-x-[calc(100%+2rem)]")}>
            <SimulationDataPanel
              analysisMode={analysisMode}
              isOpen={isDataPanelOpen}
              onClose={() => setIsDataPanelOpen(false)}
              date={solarDate}
            />
          </div>

          {/* Right panel collapse toggle */}
          {isRightPanelCollapsed && selectedObjectId && !isSimulatorEnabled && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute top-3 right-3 z-20 h-9 w-9 rounded-lg shadow-md print:hidden"
              onClick={() => setIsRightPanelCollapsed(false)}
            >
              <PanelRightOpen className="h-4 w-4" />
            </Button>
          )}

          {/* Right properties sidebar */}
          <div className={cn("absolute top-3 right-3 z-20 transition-all duration-300 ease-in-out flex flex-col items-end pointer-events-none print:hidden", 
            selectedObjectId && !isSimulatorEnabled && !isRightPanelCollapsed ? "translate-x-0 opacity-100" : "translate-x-[calc(100%+2rem)] opacity-0")} 
            style={{ 
              bottom: kpiBottom,
              width: '340px',
            }}>
            <div className="pointer-events-auto w-full max-h-full flex flex-col bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 rounded-xl border shadow-lg overflow-hidden">
              <PropertiesPanel onCollapse={() => setIsRightPanelCollapsed(true)} />
            </div>
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

          <div className={cn("fixed top-[45px] right-0 h-[calc(100vh-45px)] bg-background/95 backdrop-blur-sm border-l border-border z-50 transition-transform duration-300 ease-in-out print:hidden", isChatOpen ? "translate-x-0" : "translate-x-full")}>
            <div className="h-full w-[380px] relative">
              {isChatOpen && <ChatPanel />}
            </div>
          </div>
        </div>

      </div>
      <DefineZoneModal />
      <AiScenarioViewerModal />
      {
        selectedPlot && (
          <RegulationViewerModal
            isOpen={isRegulationViewerOpen}
            onOpenChange={setIsRegulationViewerOpen}
            plot={selectedPlot}
          />
        )
      }
      <Toaster />
      <ScenarioSelectorModal />
      <AiRenderingModal />
    </div >
  );
}
