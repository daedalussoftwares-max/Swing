export type ApiGenderFilter = 'any' | 'female' | 'male' | 'non-binary';

/**
 * Send-time filters. Omit a key for "Anywhere / Any".
 *   - radiusKm  > 0 → only people within this many km (needs the sender's
 *                     location on the server — see `lib/location.ts`)
 *   - country   one of `lib/countries.ts`
 *   - ageRange  [min, max] in 18..99 (99 = no upper bound)
 */
export type ApiPlaneFilters = {
  radiusKm?: number;
  country?: string;
  gender?: ApiGenderFilter | string;
  ageRange?: [number, number];
};

export type ApiSenderPreview = {
  id: string;
  name: string;
  avatarUrl?: string;
  city?: string;
  country?: string;
};

export type ApiRecipientPreview = {
  id: string;
  name: string;
  avatarUrl?: string;
  location?: string;
};

/** Live delivery state (async matching). */
export type ApiPlaneState = 'searching' | 'delivered' | 'accepted' | 'expired';

export type ApiPlaneStatus = 'pending' | 'accepted' | 'expired';

export type ApiPlane = {
  id: string;
  message: string;
  status: ApiPlaneStatus;
  /** Optional for backward compat — derive from `status` when missing. */
  state?: ApiPlaneState;
  /** Number of deliveries so far. */
  hops?: number;
  /** Number of recipients who passed the plane on. */
  rejections?: number;
  filters?: ApiPlaneFilters;
  sentAt: string;
  expiresAt: string;
  respondedAt?: string;
  recipientIsDummy?: boolean;
  chatId?: string;
  /** Present only while state is delivered / accepted. */
  recipient?: ApiRecipientPreview;
  sender?: ApiSenderPreview;
};

/** POST /v1/planes → 202. */
export type ApiSendPlaneResponse = {
  plane: ApiPlane;
  planesRemaining?: number;
};

/** Realtime `plane.outbox.updated` payload (sent to the plane's sender). */
export type ApiOutboxUpdate = {
  planeId: string;
  state?: ApiPlaneState;
  status?: ApiPlaneStatus;
  rejections?: number;
  recipient?: ApiRecipientPreview | null;
};

/** PUT /v1/me/location → 200. */
export type ApiMyLocation = {
  lat: number;
  lng: number;
  updatedAt: string;
};
