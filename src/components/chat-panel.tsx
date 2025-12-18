'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Bot, Send, X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useSelectedBuilding } from '@/hooks/use-building-store';
import type { Message } from '@/lib/types';
import { ScrollArea } from './ui/scroll-area';
import { Avatar, AvatarFallback } from './ui/avatar';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from './ui/card';
import {estimateBuildingCost} from '@/ai/ai-building-cost-estimator';

export function ChatPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const selectedBuilding = useSelectedBuilding();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollAreaRef.current) {
        scrollAreaRef.current.scrollTo({ top: scrollAreaRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [messages])
  
   useEffect(() => {
    if(messages.length === 0) {
        setMessages([{id: 'initial', role: 'assistant', content: 'Hello! Select a building and ask me about its feasibility.'}])
    }
  }, [messages.length])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    if (!selectedBuilding) {
        const systemMessage: Message = {
            id: Date.now().toString(),
            role: 'system',
            content: 'Please select a building before using the chat.',
        };
        setMessages(prev => [...prev, systemMessage]);
        return;
    }

    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const buildingDataString = JSON.stringify({
        ...selectedBuilding,
        geometry: 'omitted for brevity', // Avoid sending large geometry
        centroid: 'omitted for brevity'
      })
      const result = await estimateBuildingCost({
        buildingData: buildingDataString,
        query: input,
      });

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.answer,
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

  const isChatDisabled = isLoading || !selectedBuilding;

  return (
    <Card className="h-full flex flex-col bg-background/80 backdrop-blur-sm border-0 rounded-none">
        <CardHeader className="border-b border-border">
          <CardTitle className="flex items-center gap-2 font-headline">
            <Bot className="text-primary" />
            AI Assistant
          </CardTitle>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col p-0">
            <ScrollArea className="flex-1 p-4" ref={scrollAreaRef}>
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
                            <Bot className="text-primary"/>
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
                            <AvatarFallback className="bg-transparent"><Bot className="text-primary"/></AvatarFallback>
                        </Avatar>
                        <div className="rounded-lg px-3 py-2 bg-secondary flex items-center">
                            <Loader2 className="h-5 w-5 animate-spin text-primary"/>
                        </div>
                     </div>
                 )}
                </div>
            </ScrollArea>
        </CardContent>
        <CardFooter className="p-4 border-t bg-background/80 border-border">
            <form onSubmit={handleSubmit} className="relative w-full">
            <Textarea
                placeholder={selectedBuilding ? `Ask about '${selectedBuilding.name}'...` : "Select a building first..."}
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
