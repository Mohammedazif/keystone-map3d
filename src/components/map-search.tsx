
'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { Input } from './ui/input';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import { useDebounce } from '@/hooks/use-debounce';

import { useBuildingStore } from '@/hooks/use-building-store';

const MAPBOX_GEOCODING_API = 'https://api.mapbox.com/geocoding/v5/mapbox.places/';

interface GeocodingFeature {
  id: string;
  place_name: string;
  center: [number, number];
}

export function MapSearch() {
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodingFeature[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const debouncedTerm = useDebounce(searchTerm, 300);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const setMapLocation = useBuildingStore(state => state.actions.setMapLocation);

  const handleSelectPlace = useCallback((feature: GeocodingFeature) => {
    setSearchTerm(feature.place_name);
    setSuggestions([]);
    setShowDropdown(false);
    setMapLocation(feature.place_name);
    window.dispatchEvent(new CustomEvent('flyTo', { detail: { center: feature.center } }));
  }, [setMapLocation]);

  useEffect(() => {
    if (debouncedTerm.length < 3) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const fetchSuggestions = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(
          `${MAPBOX_GEOCODING_API}${encodeURIComponent(debouncedTerm)}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}&autocomplete=true&limit=5`
        );
        const data = await response.json();
        if (!cancelled) {
          setSuggestions(data.features || []);
          setShowDropdown(true);
        }
      } catch (error) {
        console.error('Geocoding error:', error);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    fetchSuggestions();
    return () => { cancelled = true; };
  }, [debouncedTerm]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative w-full max-w-lg" ref={dropdownRef}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search location..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          className="pl-8 h-8 text-xs"
          aria-label="Search for a location"
        />
        {isLoading && <Loader2 className="absolute right-8 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        {searchTerm && !isLoading && (
          <button
            onClick={() => { setSearchTerm(''); setSuggestions([]); setShowDropdown(false); }}
            className="absolute right-2.5 top-1/2 -translate-y-1/2"
            aria-label="Clear search"
          >
            <X className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-popover border rounded-md shadow-lg z-50 overflow-hidden">
          {suggestions.map((feature) => (
            <button
              key={feature.id}
              onClick={() => handleSelectPlace(feature)}
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-center gap-2 transition-colors"
            >
              <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
              <span className="truncate">{feature.place_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
