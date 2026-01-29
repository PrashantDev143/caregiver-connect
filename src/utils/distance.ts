/**
 * Haversine formula to calculate the distance between two coordinates
 * Returns distance in meters
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Check if a location is within a geofence
 */
export function isWithinGeofence(
  currentLat: number,
  currentLng: number,
  homeLat: number,
  homeLng: number,
  radiusMeters: number
): boolean {
  const distance = calculateDistance(currentLat, currentLng, homeLat, homeLng);
  return distance <= radiusMeters;
}
