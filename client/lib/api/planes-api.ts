import { authedFetch } from '@/lib/api/authed-fetch';
import type {
  ApiMyLocation,
  ApiPlane,
  ApiPlaneFilters,
  ApiSendPlaneResponse,
} from '@/lib/api/planes-types';

/**
 * POST /v1/planes — accepted instantly (HTTP 202); matching happens async
 * and progress arrives via `plane.outbox.updated`.
 */
export async function sendPlane(
  message: string,
  filters: ApiPlaneFilters = {},
): Promise<ApiSendPlaneResponse> {
  const res = await authedFetch<ApiSendPlaneResponse>('/v1/planes', {
    method: 'POST',
    body: JSON.stringify({ message, filters }),
  });
  return {
    plane: res.plane,
    planesRemaining:
      typeof res.planesRemaining === 'number' ? res.planesRemaining : undefined,
  };
}

export async function listInboxPlanes(): Promise<ApiPlane[]> {
  const res = await authedFetch<{ planes: ApiPlane[] }>('/v1/planes/inbox');
  return res.planes ?? [];
}

export async function listOutboxPlanes(): Promise<ApiPlane[]> {
  const res = await authedFetch<{ planes: ApiPlane[] }>('/v1/planes/outbox');
  return res.planes ?? [];
}

export async function acceptPlaneApi(planeId: string): Promise<ApiPlane> {
  const res = await authedFetch<{ plane: ApiPlane }>(
    `/v1/planes/${encodeURIComponent(planeId)}/accept`,
    { method: 'POST' },
  );
  return res.plane;
}

export async function rejectPlaneApi(planeId: string): Promise<ApiPlane> {
  const res = await authedFetch<{ plane: ApiPlane }>(
    `/v1/planes/${encodeURIComponent(planeId)}/reject`,
    { method: 'POST' },
  );
  return res.plane;
}

/** PUT /v1/me/location — server rounds to ~1 km. */
export async function updateMyLocation(
  lat: number,
  lng: number,
): Promise<ApiMyLocation> {
  const res = await authedFetch<{ location: ApiMyLocation }>(
    '/v1/me/location',
    { method: 'PUT', body: JSON.stringify({ lat, lng }) },
  );
  return res.location;
}
