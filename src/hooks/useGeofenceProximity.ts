import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { captureCurrentPosition } from '../lib/geo/geolocation';
import { fetchNearbyGeofencedCustomers } from '../lib/visit/visitService';
import type { NearbyGeofencedCustomer } from '../types/visit';
import { useActiveVisit, useWorkday } from './useWorkday';

const PROXIMITY_INTERVAL_MS = 5 * 60 * 1000;

/** Polls GPS while workday is active and suggests visits when entering a learned geofence. */
export function useGeofenceProximity(onNearby?: (customer: NearbyGeofencedCustomer) => void) {
  const { userId, role } = useAuth();
  const { workday } = useWorkday();
  const { activeVisit } = useActiveVisit();
  const [nearbyCustomer, setNearbyCustomer] = useState<NearbyGeofencedCustomer | null>(null);
  const dismissedRef = useRef<Set<number>>(new Set());
  const lastCheckRef = useRef<number>(0);

  useEffect(() => {
    if (role !== 'sales' || !workday.active || activeVisit || userId == null) {
      setNearbyCustomer(null);
      return;
    }

    let cancelled = false;

    const checkProximity = async () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastCheckRef.current < PROXIMITY_INTERVAL_MS) return;
      lastCheckRef.current = now;

      try {
        const pos = await captureCurrentPosition({ maximumAge: 120_000, timeout: 8000 });
        const nearby = await fetchNearbyGeofencedCustomers(
          userId,
          pos.latitude,
          pos.longitude,
          200,
        );
        if (cancelled || nearby.length === 0) return;

        const candidate = nearby.find((c) => !dismissedRef.current.has(c.customer_id));
        if (candidate) {
          setNearbyCustomer(candidate);
          onNearby?.(candidate);
        }
      } catch {
        // Silent — proximity is optional enrichment.
      }
    };

    void checkProximity();
    const interval = window.setInterval(() => {
      void checkProximity();
    }, PROXIMITY_INTERVAL_MS);

    const onVisible = () => {
      void checkProximity();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [activeVisit, onNearby, role, userId, workday.active]);

  const dismissNearby = () => {
    if (nearbyCustomer) {
      dismissedRef.current.add(nearbyCustomer.customer_id);
    }
    setNearbyCustomer(null);
  };

  return { nearbyCustomer, dismissNearby, clearNearby: () => setNearbyCustomer(null) };
}
