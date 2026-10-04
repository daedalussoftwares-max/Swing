import * as authApi from '@/lib/api/auth-api';
import type { AuthUser } from '@/lib/api/auth-types';
import {
  createStatusItem,
  putLocalFile,
  requestAvatarUploadUrl,
  requestChatUploadUrl,
  requestMediaReadUrl,
  requestStatusUploadUrl,
  type StatusItemResponse,
} from '@/lib/api/media-api';

/** True when the URI is on-device storage, not already on the CDN. */
export function isLocalMediaUri(uri: string | undefined): boolean {
  if (!uri) return false;
  return (
    uri.startsWith('file://') ||
    uri.startsWith('content://') ||
    uri.startsWith('ph://') ||
    uri.startsWith('assets-library://')
  );
}

/** @deprecated use isLocalMediaUri */
export const isLocalImageUri = isLocalMediaUri;

function guessImageContentType(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function guessStatusContentType(uri: string, kind: 'image' | 'video'): string {
  if (kind === 'video') return 'video/mp4';
  return guessImageContentType(uri);
}

function guessChatContentType(uri: string, kind: 'image' | 'audio'): string {
  if (kind === 'audio') return 'audio/mp4';
  return guessImageContentType(uri);
}

export async function uploadAndSaveAvatar(
  localUri: string,
  mimeType?: string,
): Promise<AuthUser> {
  const contentType = mimeType ?? guessImageContentType(localUri);
  const slot = await requestAvatarUploadUrl(contentType);
  await putLocalFile(slot.uploadUrl, localUri, slot.contentType);
  const avatarUrl = slot.avatarUrl ?? slot.publicUrl ?? '';
  return authApi.updateProfile({ avatarUrl });
}

export type UploadedChatMedia = {
  mediaKey: string;
  contentType: string;
};

export async function uploadChatMedia(
  chatId: string,
  localUri: string,
  kind: 'image' | 'audio',
  mimeType?: string,
): Promise<UploadedChatMedia> {
  const contentType = mimeType ?? guessChatContentType(localUri, kind);
  const slot = await requestChatUploadUrl(chatId, contentType);
  await putLocalFile(slot.uploadUrl, localUri, slot.contentType);
  // The sender keeps showing the local file; no read URL needed here.
  return { mediaKey: slot.mediaKey, contentType: slot.contentType };
}

export async function uploadStatusDraft(
  localUri: string,
  kind: 'image' | 'video',
  mimeType?: string,
): Promise<StatusItemResponse> {
  const contentType = mimeType ?? guessStatusContentType(localUri, kind);
  const slot = await requestStatusUploadUrl(contentType);
  await putLocalFile(slot.uploadUrl, localUri, slot.contentType);
  return createStatusItem({
    mediaKey: slot.mediaKey,
    contentType: slot.contentType,
    kind,
  });
}

export async function refreshMediaViewUrl(
  mediaKey: string,
): Promise<string> {
  return requestMediaReadUrl(mediaKey);
}
