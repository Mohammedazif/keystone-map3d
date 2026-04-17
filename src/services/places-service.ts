import { Amenity, AmenityCategory } from './mapbox-places-service';
import { GooglePlacesService } from './google-places-service';

export const PlacesService = {
    async searchNearby(
        center: [number, number],
        categories: AmenityCategory | AmenityCategory[],
        radius: number = 2000,
        limit: number = 10
    ): Promise<Amenity[]> {
        return GooglePlacesService.searchNearby(center, categories, radius, limit);
    },

    getProviderLabel(): string {
        return 'Google Maps Platform';
    },
};
