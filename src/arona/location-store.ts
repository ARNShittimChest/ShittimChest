export interface UserLocation {
  lat: number;
  lon: number;
  updatedAt: Date;
}

let currentUserLocation: UserLocation | null = null;

export function getUserLocation(): UserLocation | null {
  return currentUserLocation;
}

export function setUserLocation(lat: number, lon: number) {
  currentUserLocation = {
    lat,
    lon,
    updatedAt: new Date(),
  };
}
