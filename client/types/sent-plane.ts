/**
 * A plane the local user has SENT (vs. the inbound planes in `types/plane.ts`).
 *
 * Status reflects what happened after delivery:
 *   - 'flying'    → still in transit, hasn't reached a recipient yet
 *   - 'pending'   → delivered, awaiting recipient action
 *   - 'accepted'  → recipient accepted; a chat exists
 *   - 'rejected'  → recipient declined
 *   - 'expired'   → 24h passed with no action
 */

export type SentPlaneStatus =
  | 'flying'
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'expired';

/**
 * The recipient a plane was delivered to. Every sent plane has one —
 * the system always pairs the message with a real user that matches the
 * filters at send time, even before they accept / reject it.
 */
export type SentPlaneRecipient = {
  id: string;
  name: string;
  avatarUrl?: string;
  /** Optional short location string for the detail view. */
  location?: string;
  age?: number;
};

export type SentPlane = {
  id: string;
  /** Body of the message the user wrote. */
  message: string;
  /** ISO timestamp the plane was launched. */
  sentAt: string;
  status: SentPlaneStatus;

  /** Convenience name shown in lists. Always equal to `recipient.name`
   *  when `recipient` is present — kept as a top-level field for
   *  backwards compat with older mock entries. */
  recipientName?: string;
  /** Full recipient details, used to render the detail screen like an
   *  inbound plane card. */
  recipient?: SentPlaneRecipient;
  /** When the recipient acted (ISO). Drives the "X ago" subtitle. */
  respondedAt?: string;

  /** Filters that were active at send-time (radius, country, etc.). */
  filters?: {
    radiusKm?: number;
    country?: string;
    gender?: 'any' | 'female' | 'male' | 'non-binary';
    ageRange?: [number, number];
  };
};
