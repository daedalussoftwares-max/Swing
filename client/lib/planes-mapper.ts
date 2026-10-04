import type {
  ApiOutboxUpdate,
  ApiPlane,
  ApiPlaneState,
  ApiPlaneStatus,
  ApiRecipientPreview,
  ApiSenderPreview,
} from '@/lib/api/planes-types';
import type { Plane, Sender } from '@/types/plane';
import type {
  SentPlane,
  SentPlaneRecipient,
  SentPlaneStatus,
} from '@/types/sent-plane';

/**
 * A sent plane plus the live-delivery fields the outbox API now returns.
 * Structurally a `SentPlane`, so it can be passed anywhere one is expected.
 */
export type LiveSentPlane = SentPlane & {
  /** Recipients who passed the plane on. */
  rejections?: number;
  /** Deliveries so far. */
  hops?: number;
  expiresAt?: string;
  chatId?: string;
  /** True for the local placeholder inserted before POST /v1/planes returns. */
  optimistic?: boolean;
};

type SentFilters = NonNullable<SentPlane['filters']>;

const GENDERS = new Set(['any', 'female', 'male', 'non-binary']);

export function senderFromPreview(p: ApiSenderPreview): Sender {
  return {
    id: p.id,
    name: p.name,
    avatarUrl: p.avatarUrl,
    distanceKm: 0,
    ageBadge: '',
    city: p.city,
    country: p.country,
  };
}

export function inboxPlaneFromApi(p: ApiPlane): Plane | null {
  if (!p.id?.trim()) return null;
  const senderPreview: ApiSenderPreview = p.sender ?? {
    id: 'unknown',
    name: 'Someone',
  };
  return {
    id: p.id,
    message: p.message,
    sentAt: p.sentAt,
    sender: senderFromPreview(senderPreview),
  };
}

/**
 * Map server state → client status.
 *   searching → flying, delivered → pending, accepted → accepted,
 *   expired → expired. Falls back to the legacy `status` when `state`
 *   is absent (older servers).
 */
export function sentStatusFrom(
  state: ApiPlaneState | undefined,
  status: ApiPlaneStatus | undefined,
  hasRecipient: boolean,
): SentPlaneStatus {
  switch (state) {
    case 'searching':
      return 'flying';
    case 'delivered':
      return 'pending';
    case 'accepted':
      return 'accepted';
    case 'expired':
      return 'expired';
    default:
      break;
  }
  if (status === 'accepted') return 'accepted';
  if (status === 'expired') return 'expired';
  return hasRecipient ? 'pending' : 'flying';
}

function recipientFromApi(
  r: ApiRecipientPreview | null | undefined,
): SentPlaneRecipient | undefined {
  if (!r || !r.id) return undefined;
  return {
    id: r.id,
    name: r.name,
    avatarUrl: r.avatarUrl,
    location: r.location,
    age: r.age,
  };
}

export function filtersFromApi(
  f: ApiPlane['filters'],
): SentPlane['filters'] | undefined {
  if (!f) return undefined;
  const out: SentFilters = {};
  if (typeof f.radiusKm === 'number' && f.radiusKm > 0) out.radiusKm = f.radiusKm;
  if (f.country) out.country = f.country;
  if (f.gender && GENDERS.has(f.gender)) {
    out.gender = f.gender as SentFilters['gender'];
  }
  if (Array.isArray(f.ageRange) && f.ageRange.length === 2) {
    out.ageRange = [f.ageRange[0], f.ageRange[1]];
  }
  return out;
}

export function outboxPlaneFromApi(p: ApiPlane): LiveSentPlane {
  const recipient = recipientFromApi(p.recipient);
  const status = sentStatusFrom(p.state, p.status, !!recipient);
  // A plane that's back to searching has no current recipient.
  const showRecipient = status !== 'flying' ? recipient : undefined;
  return {
    id: p.id,
    message: p.message,
    sentAt: p.sentAt,
    status,
    respondedAt: p.respondedAt,
    recipientName: showRecipient?.name,
    recipient: showRecipient,
    filters: filtersFromApi(p.filters),
    rejections: p.rejections ?? 0,
    hops: p.hops ?? 0,
    expiresAt: p.expiresAt,
    chatId: p.chatId,
  };
}

/** Apply a realtime `plane.outbox.updated` payload to a known plane. */
export function applyOutboxUpdate(
  plane: LiveSentPlane,
  u: ApiOutboxUpdate,
): LiveSentPlane {
  const recipient =
    u.recipient === undefined ? plane.recipient : recipientFromApi(u.recipient);
  const status = sentStatusFrom(u.state, u.status, !!recipient);
  const showRecipient = status === 'flying' ? undefined : recipient;
  return {
    ...plane,
    status,
    rejections: typeof u.rejections === 'number' ? u.rejections : plane.rejections,
    recipient: showRecipient,
    recipientName: showRecipient?.name,
    respondedAt:
      status === 'accepted' && !plane.respondedAt
        ? new Date().toISOString()
        : plane.respondedAt,
  };
}

export function parseOutboxUpdate(data: unknown): ApiOutboxUpdate | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Partial<ApiOutboxUpdate>;
  if (typeof d.planeId !== 'string' || !d.planeId) return null;
  return d as ApiOutboxUpdate;
}

/** Cache for profile screen — keyed by account id. */
export type ProfileCache = Map<string, Sender>;

export function rememberSender(cache: ProfileCache, sender: Sender) {
  cache.set(sender.id, sender);
}

export function lookupSender(cache: ProfileCache, userId: string): Sender | undefined {
  return cache.get(userId);
}
