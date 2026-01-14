import type { ParkingArea, Plot } from './types';

/**
 * Calculate parking capacity based on area and parking space size
 * @param area - Total parking area in m²
 * @param spaceSize - Area per parking space in m² (from regulation or default 12.5)
 * @param efficiency - Usable area ratio (default 0.75 to account for driveways/circulation)
 * @returns Number of parking spaces
 */
export function calculateParkingCapacity(
    area: number,
    spaceSize: number = 12.5,
    efficiency: number = 0.75
): number {
    if (area <= 0 || spaceSize <= 0 || efficiency <= 0) return 0;
    return Math.floor((area * efficiency) / spaceSize);
}

/**
 * Get parking space size from regulation or use default
 * @param plot - Plot with regulation data
 * @returns Parking space size in m²
 */
export function getParkingSpaceSize(plot?: Plot): number {
    // Check if regulation has parking space size requirement
    const regulationSize = plot?.regulation?.parking?.spaceSize;
    return regulationSize || 12.5; // Default: 2.5m × 5m = 12.5 m²
}

/**
 * Calculate total parking spaces across all parking areas and building floors
 * @param plots - Array of plots
 * @returns Total number of parking spaces
 */
export function calculateTotalParkingSpaces(plots: Plot[]): {
    total: number;
    surface: number;
    basement: number;
    stilt: number;
    podium: number;
} {
    let surface = 0;
    let basement = 0;
    // let stilt = 0; // DISABLED
    let podium = 0;

    for (const plot of plots) {
        // Surface Parking Areas
        plot.parkingAreas.forEach(pa => {
            const efficiency = pa.efficiency || 0.75; // Default 30sqm/car -> ~350sqm per 10 cars? No, usually 75% efficiency
            // precise capacity override or calculate
            let capacity = pa.capacity;
            if (!capacity) {
                // Approximate: Area * Efficiency / 25sqm per car
                capacity = Math.floor((pa.area * efficiency) / 25);
            }

            if (pa.type === 'Surface' || !pa.type) {
                surface += capacity;
            } else if (pa.type === 'Basement') {
                basement += capacity;
            } /* else if (pa.type === 'Stilt') {
                stilt += capacity;
            } else if (pa.type === 'Podium') {
                podium += capacity;
            } */
        });

        // Building-integrated parking (basement/stilt floors)
        plot.buildings.forEach(b => {
            if (b.floors) {
                b.floors.forEach(floor => {
                    if (floor.type === 'Parking' && floor.parkingCapacity) {
                        if (floor.parkingType === 'Basement') {
                            basement += floor.parkingCapacity;
                        } /* else if (floor.parkingType === 'Stilt') {
                            stilt += floor.parkingCapacity;
                        } else if (floor.parkingType === 'Podium') {
                            podium += floor.parkingCapacity;
                        } */
                    }
                });
            }
        });
    }

    return {
        total: surface + basement /* + stilt + podium */,
        surface,
        basement,
        stilt: 0, // DISABLED
        podium: 0, // DISABLED
    };
}
