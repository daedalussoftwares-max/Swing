import { authedFetch } from '@/lib/api/authed-fetch';
import { ApiError } from '@/lib/api/client';

export type UploadSlot = {
  uploadUrl: string;
  mediaKey: string;
  contentType: string;
  publicUrl?: string;
  avatarUrl?: string;
};

export type StatusItemResponse = {
  id: string;
  accountId: string;
  kind: 'image' | 'video';
  mediaKey: string;
  contentType: string;
  viewUrl?: string;
  postedAt: string;
  expiresAt: string;
};

export async function requestAvatarUploadUrl(
  contentType = 'image/jpeg',
): Promise<UploadSlot> {
  return authedFetch<UploadSlot>('/v1/me/avatar/upload-url', {
    method: 'POST',
    body: JSON.stringify({ contentType }),
  });
}

export async function requestStatusUploadUrl(
  contentType: string,
): Promise<UploadSlot> {
  return authedFetch<UploadSlot>('/v1/me/status/upload-url', {
    method: 'POST',
    body: JSON.stringify({ contentType }),
  });
}

export async function requestChatUploadUrl(
  chatId: string,
  contentType: string,
): Promise<UploadSlot> {
  return authedFetch<UploadSlot>('/v1/media/chat/upload-url', {
    method: 'POST',
    body: JSON.stringify({ chatId, contentType }),
  });
}

export async function requestMediaReadUrl(
  mediaKey: string,
): Promise<string> {
  const res = await authedFetch<{ viewUrl: string }>('/v1/media/read-url', {
    method: 'POST',
    body: JSON.stringify({ mediaKey }),
  });
  return res.viewUrl;
}

export async function putLocalFile(
  uploadUrl: string,
  localUri: string,
  contentType: string,
): Promise<void> {
  const fileRes = await fetch(localUri);
  if (!fileRes.ok) {
    throw new ApiError('UPLOAD_FAILED', 'Could not read the selected file.');
  }
  const fileBlob = await fileRes.blob();
  if (fileBlob.size === 0) {
    throw new ApiError('UPLOAD_FAILED', 'The file is empty. Try again.');
  }
  // Android's networking layer sends the BLOB's MIME type (guessed from the
  // file extension, e.g. ".mp4" → video/mp4 for voice notes) instead of our
  // Content-Type header. The presigned URL signs Content-Type, so a mismatch
  // makes R2 reject the PUT — re-label the same bytes (no copy) with the
  // signed type.
  const blob =
    fileBlob.type === contentType
      ? fileBlob
      : fileBlob.slice(0, fileBlob.size, contentType);

  let putRes: Response;
  try {
    putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: blob,
    });
  } catch {
    throw new ApiError('UPLOAD_FAILED', 'Could not upload. Check your connection.');
  }
  if (!putRes.ok) {
    throw new ApiError('UPLOAD_FAILED', 'Could not upload. Try again.');
  }
}

export async function listMyStatus(
): Promise<StatusItemResponse[]> {
  const res = await authedFetch<{ items: StatusItemResponse[] }>('/v1/me/status', {
  });
  return res.items ?? [];
}

export async function createStatusItem(
  body: { mediaKey: string; contentType: string; kind: 'image' | 'video' },
): Promise<StatusItemResponse> {
  const res = await authedFetch<{ item: StatusItemResponse }>('/v1/me/status', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return res.item;
}

export async function deleteStatusItem(
  id: string,
): Promise<void> {
  await authedFetch<void>(`/v1/me/status/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

export async function listAccountStatus(
  accountId: string,
): Promise<StatusItemResponse[]> {
  const res = await authedFetch<{ items: StatusItemResponse[] }>(
    `/v1/status/${encodeURIComponent(accountId)}`,
    {},
  );
  return res.items ?? [];
}
