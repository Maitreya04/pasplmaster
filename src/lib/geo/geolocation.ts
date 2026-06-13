export interface GeoPosition {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export type GeolocationErrorCode = 'unsupported' | 'denied' | 'unavailable' | 'timeout';

export class GeolocationCaptureError extends Error {
  code: GeolocationErrorCode;

  constructor(code: GeolocationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 60000,
};

export function captureCurrentPosition(
  options: PositionOptions = DEFAULT_OPTIONS,
): Promise<GeoPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeolocationCaptureError('unsupported', 'Location is not supported on this device.'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy ?? null,
        });
      },
      (error) => {
        const code: GeolocationErrorCode =
          error.code === error.PERMISSION_DENIED
            ? 'denied'
            : error.code === error.TIMEOUT
              ? 'timeout'
              : 'unavailable';
        reject(new GeolocationCaptureError(code, error.message || 'Could not get location.'));
      },
      options,
    );
  });
}
