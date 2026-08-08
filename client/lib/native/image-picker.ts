/**
 * Image picker shim (replaces expo-image-picker).
 */
import { PermissionsAndroid, Platform } from 'react-native';
import {
  launchImageLibrary,
  type ImagePickerResponse,
} from 'react-native-image-picker';

type Asset = {
  uri: string;
  mimeType?: string;
  type?: 'image' | 'video';
  duration?: number;
};

type PickerResult = {
  canceled: boolean;
  assets: Asset[];
};

export async function requestMediaLibraryPermissionsAsync(): Promise<{
  granted: boolean;
}> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES,
    );
    return { granted: granted === PermissionsAndroid.RESULTS.GRANTED };
  }
  return { granted: true };
}

function mapResponse(response: ImagePickerResponse): PickerResult {
  if (response.didCancel || !response.assets?.length) {
    return { canceled: true, assets: [] };
  }
  return {
    canceled: false,
    assets: response.assets.map((a) => ({
      uri: a.uri ?? '',
      mimeType: a.type,
      type: a.type?.startsWith('video') ? 'video' : 'image',
      duration: a.duration,
    })),
  };
}

export async function launchImageLibraryAsync(options: {
  mediaTypes?: string[];
  allowsEditing?: boolean;
  aspect?: [number, number];
  quality?: number;
  videoMaxDuration?: number;
}): Promise<PickerResult> {
  const mediaType =
    options.mediaTypes?.includes('videos') &&
    options.mediaTypes?.includes('images')
      ? 'mixed'
      : options.mediaTypes?.includes('videos')
        ? 'video'
        : 'photo';

  const response = await launchImageLibrary({
    mediaType,
    quality: (options.quality ?? 0.85) as 0 | 0.1 | 0.2 | 0.3 | 0.4 | 0.5 | 0.6 | 0.7 | 0.8 | 0.9 | 1,
    selectionLimit: 1,
    videoQuality: 'medium',
  });
  return mapResponse(response);
}
