
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
  const [isLoading, setIsLoading] = useState(false);
  const setMapLocation = useBuildingStore(state => state.actions.setMapLocation);

  const handleSelectPlace = (feature: GeocodingFeature) => {
    setSearchTerm(feature.place_name);
    setMapLocation(feature.place_name);
    window.dispatchEvent(new CustomEvent('flyTo', { detail: { center: feature.center } }));
  };

  const searchPlaces = useCallback(async (term: string) => {
    if (term.length < 3) {
      return;
    }
    setIsLoading(true);
    try {
      const response = await fetch(
        `${MAPBOX_GEOCODING_API}${encodeURIComponent(term)}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN}&autocomplete=true&limit=1`
      );
      const data = await response.json();
      const features = data.features || [];
      if (features.length > 0) {
        handleSelectPlace(features[0]);
      }
    } catch (error) {
      console.error('Geocoding error:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      searchPlaces(searchTerm);
    }
  }

  return (
    <div className="relative w-full max-w-lg">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search for a location and press Enter..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleKeyDown}
          className="pl-10"
        />
        {isLoading && <Loader2 className="absolute right-10 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
        {searchTerm && !isLoading && (
          <button
            onClick={() => setSearchTerm('')}
            className="absolute right-3 top-1/2 -translate-y-1/2"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
    </div>
  );
}
