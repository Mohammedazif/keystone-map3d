'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Loader2, Globe, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSelectedBuilding, useBuildingStore } from '@/hooks/use-building-store';
import type { Message } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback } from './ui/avatar';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isGeneralMode, setIsGeneralMode] = useState(false);
  const selectedBuilding = useSelectedBuilding();
  const mapLocation = useBuildingStore(state => state.mapLocation);
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
      scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages])

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ id: 'initial', role: 'assistant', content: 'Hello! Select a building and ask me about its feasibility.' }])
    }
  }, [messages.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    // Allow chatting even without selected building if just asking about location/regulations
    // if (!selectedBuilding) {
    //   const systemMessage: Message = {
    //     id: Date.now().toString(),
    //     role: 'system',
    //     content: 'Please select a building before using the chat.',
    //   };
    //   setMessages(prev => [...prev, systemMessage]);
    //   return;
    // }

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

  const isChatDisabled = isLoading || (!selectedBuilding && !isGeneralMode);

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
                    'rounded-lg px-4 py-3 max-w-sm whitespace-pre-wrap text-sm',
                    message.role === 'user'
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-secondary',
                    message.role === 'system' && 'bg-destructive/20 text-destructive-foreground'
                  )}
                >
                  {message.content}
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
            placeholder={isGeneralMode ? "Ask general regulation questions..." : (selectedBuilding ? `Ask about '${selectedBuilding.name}'...` : "Select a building or ask about location...")}
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
