'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Loader2, Globe, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSelectedBuilding, useSelectedPlot, useBuildingStore } from '@/hooks/use-building-store';
import type { Message } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback } from './ui/avatar';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import ReactMarkdown from 'react-markdown';

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneralMode, setIsGeneralMode] = useState(false);
  const selectedBuilding = useSelectedBuilding();
  const selectedPlot = useSelectedPlot();
  const mapLocation = useBuildingStore(state => state.mapLocation);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages])

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ id: 'initial', role: 'assistant', content: 'Hello! Select a building or plot and ask me about its feasibility.' }])
    }
  }, [messages.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: input,
          isGeneralMode,
          buildingContext: {
            location: mapLocation,
            selectedBuilding: selectedBuilding ? {
              ...selectedBuilding,
              geometry: 'omitted',
              centroid: 'omitted'
            } : null,
            selectedPlot: selectedPlot ? {
              ...selectedPlot,
              geometry: 'omitted',
              centroid: 'omitted',
              buildings: selectedPlot.buildings.map(b => ({
                id: b.id,
                name: b.name,
                type: b.intendedUse,
                footprintArea: b.area,
                height: b.height,
                floors: b.numFloors,
                totalFloors: b.totalFloors,
                unitsCount: b.units?.length || 0,
                coresCount: b.cores?.length || 0,
                basementsCount: b.floors.filter(f => (f.level || 0) < 0).length,
                basementParkingCapacity: b.floors.filter(f => f.type === 'Parking').reduce((sum, f) => sum + (f.parkingCapacity || 0), 0),
                internalUtilities: b.internalUtilities?.map(u => ({
                  type: u.type,
                  area: u.area
                })) || []
              })),
              siteUtilities: selectedPlot.utilityAreas.map(u => ({
                name: u.name,
                type: u.type,
                area: u.area
              })),
              parkingAreas: selectedPlot.parkingAreas.map(p => ({
                id: p.id,
                name: p.name,
                area: p.area,
                capacity: p.capacity
              })),
              greenAreas: selectedPlot.greenAreas.map(g => ({
                id: g.id,
                area: g.area
              }))
            } : null
          }
        }),
      });

      if (!response.ok) throw new Error('Failed to fetch response');

      const data = await response.json();

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.text,
      };
      setMessages(prev => [...prev, assistantMessage]);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred.';
      const systemMessage: Message = { id: (Date.now() + 1).toString(), role: 'system', content: `Error: ${errorMessage}` };
      setMessages(prev => [...prev, systemMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const hasSelection = !!selectedBuilding || !!selectedPlot;
  const isChatDisabled = isLoading || (!hasSelection && !isGeneralMode);

  let placeholderText = "Select a building or plot...";
  if (isGeneralMode) placeholderText = "Ask general regulation questions...";
  else if (selectedBuilding) placeholderText = `Ask about '${selectedBuilding.name}'...`;
  else if (selectedPlot) placeholderText = `Ask about ${selectedPlot.name || `Plot ${selectedPlot.id.substring(0, 4)}`}...`;

  return (
    <Card className="h-full flex flex-col bg-background/80 backdrop-blur-sm border-0 rounded-none">
      <CardHeader className="border-b border-border py-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 font-headline text-base">
            <Bot className="text-primary h-5 w-5" />
            AI Assistant
          </CardTitle>

          <Button
            variant={isGeneralMode ? "default" : "outline"}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setIsGeneralMode(!isGeneralMode)}
            title={isGeneralMode ? 'Answering from General Knowledge/NBC' : 'Answering based on Selected Location'}
          >
            {isGeneralMode ? <Globe className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}
            {isGeneralMode ? 'General' : 'Location'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex-1 p-0 overflow-hidden">
        <ScrollArea className="h-full w-full p-4" ref={scrollAreaRef}>
          <div className="space-y-6">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex items-start gap-3',
                  message.role === 'user' ? 'justify-end' : 'justify-start'
                )}
              >
                {message.role !== 'user' && (
                  <Avatar className="h-8 w-8 border border-primary/50">
                    <AvatarFallback className="bg-transparent">
                      <Bot className="text-primary" />
                    </AvatarFallback>
                  </Avatar>
                )}
                <div
                  className={cn(
                    'rounded-lg px-4 py-3 max-w-sm text-sm',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground whitespace-pre-wrap'
                      : 'bg-secondary',
                    message.role === 'system' && 'bg-destructive/20 text-destructive-foreground'
                  )}
                >
                  {message.role === 'user' ? (
                    message.content
                  ) : (
                    <div className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:p-0">
                      <ReactMarkdown
                        components={{
                          p: ({ node: _, ...props }) => <p className="mb-2 last:mb-0" {...props} />,
                          ul: ({ node: _, ...props }) => <ul className="list-disc pl-4 mb-2 space-y-1" {...props} />,
                          li: ({ node: _, ...props }) => <li className="pl-1" {...props} />,
                          strong: ({ node: _, ...props }) => <strong className="font-semibold text-foreground" {...props} />,
                          h3: ({ node: _, ...props }) => <h3 className="text-sm font-bold mt-3 mb-1 text-foreground" {...props} />,
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </div>
                {message.role === 'user' && (
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>U</AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}
            {isLoading && (
              <div className='flex items-start gap-3 justify-start'>
                <Avatar className="h-8 w-8 border border-primary/50">
                  <AvatarFallback className="bg-transparent"><Bot className="text-primary" /></AvatarFallback>
                </Avatar>
                <div className="rounded-lg px-3 py-2 bg-secondary flex items-center">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              </div>
            )}
            <div className="h-4" /> {/* Spacer for bottom scroll */}
          </div>
        </ScrollArea>
      </CardContent>
      <CardFooter className="p-4 border-t bg-background/80 border-border">
        <form onSubmit={handleSubmit} className="relative w-full">
          <Textarea
            placeholder={placeholderText}
            className="pr-16 resize-none bg-secondary/80 border-border focus:ring-primary"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            disabled={isChatDisabled}
          />
          <Button
            type="submit"
            size="icon"
            className="absolute top-1/2 right-3 -translate-y-1/2"
            disabled={isChatDisabled || !input.trim()}
          >
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </CardFooter>
    </Card>
  );
}
