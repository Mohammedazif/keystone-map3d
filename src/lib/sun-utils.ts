/**
 * Simple solar position calculator
 * Based on NOAA Solar Calculator algorithms
 */

export interface SunPosition {
    azimuth: number;
    altitude: number;
}

export function getSunPosition(date: Date, lat: number, lng: number): SunPosition {
    const PI = Math.PI;
    const rad = PI / 180;

    const m = date.getMonth() + 1;
    const y = date.getFullYear();
    const d = date.getDate();
    const h = date.getHours() + date.getMinutes() / 60;
    
    const start = new Date(date.getFullYear(), 0, 0);
    const diff = date.getTime() - start.getTime();
    const oneDay = 1000 * 60 * 60 * 24;
    const dayOfYear = Math.floor(diff / oneDay);

    const declination = 23.45 * Math.sin(rad * (360 / 365) * (dayOfYear - 81));

    const B = (360 / 365) * (dayOfYear - 81) * rad;
    const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const timeOffset = (4 * (lng - 15 * Math.round(lng / 15))) + eot; // Local Standard Time Meridian approx
    const tst = h * 60 + timeOffset;
    const solarHourAngle = (tst / 4) - 180; // degrees

    const latRad = lat * rad;
    const decRad = declination * rad;
    const shaRad = solarHourAngle * rad;

    const altRad = Math.asin(
        Math.sin(latRad) * Math.sin(decRad) +
        Math.cos(latRad) * Math.cos(decRad) * Math.cos(shaRad)
    );

    // Azimuth
    let aziRad = Math.acos(
        (Math.sin(decRad) * Math.cos(latRad) - Math.cos(decRad) * Math.sin(latRad) * Math.cos(shaRad)) /
        Math.cos(altRad)
    );

    if (solarHourAngle > 0) {
        aziRad = 2 * PI - aziRad;
    }

    return {
        azimuth: aziRad,
        altitude: altRad
    };
}
