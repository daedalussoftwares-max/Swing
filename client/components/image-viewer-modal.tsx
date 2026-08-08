/**
 * Full-screen image preview — tap anywhere (or X) to close.
 * Profile photos align to the top; chat images stay centred.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import { Image } from '@/lib/native/image';
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  uri: string;
  onClose: () => void;
  /** Profile avatars sit at the top; chat photos stay centred. */
  align?: 'top' | 'center';
};

export function ImageViewerModal({
  uri,
  onClose,
  align = 'center',
}: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const imageSize = align === 'top' ? width : width;
  const imageHeight =
    align === 'top' ? width : Math.min(height * 0.85, width * 1.2);

  return (
    <Modal transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        style={[
          styles.backdrop,
          align === 'top' ? styles.backdropTop : styles.backdropCenter,
        ]}
        onPress={onClose}
      >
        <Image
          source={{ uri }}
          style={{
            width: imageSize,
            height: imageHeight,
            marginTop: align === 'top' ? insets.top + 8 : 0,
          }}
          contentFit="contain"
        />
        <View style={[styles.closeBtn, { top: insets.top + 12 }]}>
          <Ionicons name="close" size={28} color="#fff" />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.92)',
    alignItems: 'center',
  },
  backdropCenter: {
    justifyContent: 'center',
  },
  backdropTop: {
    justifyContent: 'flex-start',
  },
  closeBtn: {
    position: 'absolute',
    right: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
