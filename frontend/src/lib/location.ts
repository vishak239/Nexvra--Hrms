/**
 * Browser geolocation for office attendance. Location is read only while it is needed (to
 * check in at the office, and while an office session is open) and is sent only to this
 * company's server. Errors are reported as a status, never guessed.
 */
import type { Fix } from "./geo";

export type LocationStatus = "idle" | "locating" | "ok" | "denied" | "unavailable" | "timeout" | "unsupported";

const OPTIONS: PositionOptions = { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 };

function toFix(p: GeolocationPosition): Fix {
  return { latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy, at: p.timestamp };
}

function statusFor(err: GeolocationPositionError): LocationStatus {
  if (err.code === err.PERMISSION_DENIED) return "denied";
  if (err.code === err.TIMEOUT) return "timeout";
  return "unavailable";
}

export function geolocationSupported() {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

/** Continuous updates; returns a stop function. */
export function watchLocation(onFix: (fix: Fix) => void, onStatus: (s: LocationStatus) => void) {
  if (!geolocationSupported()) {
    onStatus("unsupported");
    return () => undefined;
  }
  onStatus("locating");
  const id = navigator.geolocation.watchPosition(
    (p) => {
      onStatus("ok");
      onFix(toFix(p));
    },
    (err) => onStatus(statusFor(err)),
    OPTIONS,
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** One fresh reading (for the check-in request itself). */
export function currentLocation(): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!geolocationSupported()) {
      reject(new Error("unsupported"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(toFix(p)),
      (err) => reject(new Error(statusFor(err))),
      { ...OPTIONS, maximumAge: 5_000 },
    );
  });
}
