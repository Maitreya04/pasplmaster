import { useMemo } from 'react';
import Map, { Marker, Source, Layer } from 'react-map-gl/maplibre';
import type { LineLayerSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { FieldActivityWorkdayRow, VisitRoutePoint } from '../../types/visit';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

function markerColor(lastVisitAt: string | null): string {
  if (!lastVisitAt) return '#94a3b8';
  const ageMs = Date.now() - new Date(lastVisitAt).getTime();
  if (ageMs < 30 * 60 * 1000) return '#16a34a';
  if (ageMs < 2 * 60 * 60 * 1000) return '#ca8a04';
  return '#64748b';
}

export function SalespersonMap({
  workdays,
  selectedSalesmanId,
  onSelectSalesman,
}: {
  workdays: FieldActivityWorkdayRow[];
  selectedSalesmanId: number | null;
  onSelectSalesman: (id: number) => void;
}): React.JSX.Element {
  const markers = useMemo(
    () =>
      workdays
        .map((row) => {
          const lat = row.last_visit_lat ?? row.start_gps_lat;
          const lng = row.last_visit_lng ?? row.start_gps_lng;
          if (lat == null || lng == null) return null;
          return { ...row, lat, lng };
        })
        .filter(Boolean) as Array<FieldActivityWorkdayRow & { lat: number; lng: number }>,
    [workdays],
  );

  const initialView = useMemo(() => {
    if (markers.length === 0) {
      return { latitude: 22.7196, longitude: 75.8577, zoom: 10 };
    }
    const lat =
      markers.reduce((sum, m) => sum + m.lat, 0) / Math.max(markers.length, 1);
    const lng =
      markers.reduce((sum, m) => sum + m.lng, 0) / Math.max(markers.length, 1);
    return { latitude: lat, longitude: lng, zoom: 11 };
  }, [markers]);

  return (
    <div className="h-80 w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
      <Map
        initialViewState={initialView}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        {markers.map((row) => (
          <Marker
            key={row.salesman_user_id}
            latitude={row.lat}
            longitude={row.lng}
            anchor="bottom"
            onClick={(e) => {
              e.originalEvent.stopPropagation();
              onSelectSalesman(row.salesman_user_id);
            }}
          >
            <div
              className={`cursor-pointer rounded-full border-2 border-white px-2 py-1 text-[10px] font-semibold text-white shadow ${
                selectedSalesmanId === row.salesman_user_id ? 'ring-2 ring-white' : ''
              }`}
              style={{ backgroundColor: markerColor(row.last_visit_at) }}
            >
              {row.salesman_name.split(' ')[0]}
            </div>
          </Marker>
        ))}
      </Map>
    </div>
  );
}

export function TourHistoryMap({ points }: { points: VisitRoutePoint[] }): React.JSX.Element | null {
  const lineGeoJson = useMemo(() => {
    if (points.length < 2) return null;
    return {
      type: 'Feature' as const,
      geometry: {
        type: 'LineString' as const,
        coordinates: points.map((p) => [p.lng, p.lat]),
      },
      properties: {},
    };
  }, [points]);

  const initialView = useMemo(() => {
    if (points.length === 0) {
      return { latitude: 22.7196, longitude: 75.8577, zoom: 10 };
    }
    const first = points[0];
    return { latitude: first.lat, longitude: first.lng, zoom: 12 };
  }, [points]);

  const lineLayer: Omit<LineLayerSpecification, 'source'> = {
    id: 'route-line',
    type: 'line',
    paint: {
      'line-color': '#2563eb',
      'line-width': 3,
    },
  };

  if (points.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] text-sm text-[var(--content-tertiary)]">
        No GPS visit points for this day.
      </div>
    );
  }

  return (
    <div className="h-64 w-full overflow-hidden rounded-2xl border border-[var(--border-subtle)]">
      <Map
        initialViewState={initialView}
        mapStyle={MAP_STYLE}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
      >
        {lineGeoJson && (
          <Source id="route" type="geojson" data={lineGeoJson}>
            <Layer {...lineLayer} />
          </Source>
        )}
        {points.map((point, index) => (
          <Marker key={point.id} latitude={point.lat} longitude={point.lng} anchor="bottom">
            <div className="rounded-full bg-[var(--role-primary)] px-1.5 py-0.5 text-[10px] font-bold text-white shadow">
              {index + 1}
            </div>
          </Marker>
        ))}
      </Map>
    </div>
  );
}
