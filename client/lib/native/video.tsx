/**
 * Video shim (replaces expo-video).
 */
import { useEffect } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Video from 'react-native-video';

type VideoViewProps = {
  player?: { uri: string };
  style?: StyleProp<ViewStyle>;
  contentFit?: 'cover' | 'contain';
  nativeControls?: boolean;
};

export function VideoView({
  player,
  style,
  contentFit = 'cover',
  nativeControls = false,
}: VideoViewProps) {
  if (!player?.uri) return null;
  return (
    <Video
      source={{ uri: player.uri }}
      style={style}
      resizeMode={contentFit === 'cover' ? 'cover' : 'contain'}
      repeat
      muted
      controls={nativeControls}
    />
  );
}

export function useVideoPlayer(
  uri: string,
  setup?: (player: { loop: boolean; muted: boolean; play: () => void; uri: string }) => void,
) {
  useEffect(() => {
    if (setup) {
      setup({
        uri,
        loop: true,
        muted: true,
        play: () => {},
      });
    }
  }, [uri, setup]);
  return { uri };
}
