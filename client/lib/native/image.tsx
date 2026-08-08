/**
 * Image shim (replaces expo-image).
 */
import {
  Image as RNImage,
  type ImageProps as RNImageProps,
  type ImageStyle,
} from 'react-native';

type ContentFit = 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';

type Props = Omit<RNImageProps, 'resizeMode'> & {
  contentFit?: ContentFit;
};

const fitToResizeMode: Record<ContentFit, RNImageProps['resizeMode']> = {
  cover: 'cover',
  contain: 'contain',
  fill: 'stretch',
  none: 'center',
  'scale-down': 'contain',
};

export function Image({ contentFit = 'cover', style, ...rest }: Props) {
  return (
    <RNImage
      resizeMode={fitToResizeMode[contentFit]}
      style={style}
      {...rest}
    />
  );
}

export type { ImageStyle };
