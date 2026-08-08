/**
 * 1-on-1 chat thread — Instagram-DM inspired.
 *
 * Composer:
 *   - Curved (not pill) rounded input with proper padding and a max
 *     height (`MAX_INPUT_HEIGHT`) so a long paragraph never hides
 *     existing chat history — the input grows up to that ceiling, then
 *     scrolls internally.
 *   - Bottom padding shrinks while the keyboard is open so the bar sits
 *     snug above it (no big gap).
 *   - Left:  image-picker button (opens device gallery)
 *   - Right: mic 🎤 when idle, send ➤ when there's a draft, stop+send
 *            when recording.
 *
 * Per-message interactions:
 *   - Tap            → opens images full-screen (`ImageViewerModal`)
 *   - Long-press     → action menu: Reply / Copy / Edit / Delete +
 *                      a quick-reaction emoji row at the top.
 *   - Swipe          → "slide-to-reply" (right for partner, left for
 *                      me, à la WhatsApp). A reply icon fades in
 *                      behind the bubble; released past the threshold
 *                      triggers the reply state.
 *   - Status flow    → Sending… → Sent → Delivered → Seen, shown ONLY
 *                      under the most recent message I sent.
 *
 * Reply / Edit / Delete:
 *   - Reply: a quoted preview pill is rendered ABOVE the composer with
 *     a ✕ cancel button; when sending, the new message carries a
 *     `replyToMessageId` and the bubble shows a quote header.
 *   - Edit: the composer turns into "edit mode" — draft prefilled with
 *     the original text, send button becomes ✓, a cancel button (✕)
 *     aborts. Edited messages render a small "edited" label.
 *   - Delete: soft-deletes the message. The bubble is replaced with an
 *     "Unsent" placeholder so reply-chains pointing at it stay coherent.
 *
 * Robustness:
 *   - When the app goes to background, the keyboard is dismissed so the
 *     multiline input can't get stuck at an over-grown height on resume.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from '@/lib/native/audio';
import * as Clipboard from '@/lib/native/clipboard';
import * as Haptics from '@/lib/native/haptics';
import { Image } from '@/lib/native/image';
import * as ImagePicker from '@/lib/native/image-picker';
import { useLocalSearchParams, useRouter } from '@/lib/router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ActionSheet,
  type ActionSheetItem,
} from '@/components/action-sheet';
import { BlockingLoader } from '@/components/blocking-loader';
import { ChatActionMenu } from '@/components/chat-action-menu';
import { ImageViewerModal } from '@/components/image-viewer-modal';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { readTokens } from '@/lib/api/token-storage';
import { humanizeAuthError, useAuth } from '@/lib/auth-context';
import { useChats } from '@/lib/chats-context';
import {
  isLocalMediaUri,
  uploadChatMedia,
} from '@/lib/upload-media';
import type { ChatMessage } from '@/types/chat';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '🙏'];

/** Cap on the multiline input's height. Past this the input scrolls
 *  internally so the chat list above stays visible. */
const MAX_INPUT_HEIGHT = 110;
/** Horizontal drag distance (px) past which a swipe commits to a reply. */
const SWIPE_REPLY_THRESHOLD = 60;
/** Maximum visual translation the bubble can travel during a swipe. */
const SWIPE_MAX_TRAVEL = 80;

type ActiveMessage = { id: string; isMine: boolean } | null;
type EditingMessage = { id: string; originalText: string } | null;

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const [sendingMedia, setSendingMedia] = useState(false);
  const {
    getChat,
    sendMessage,
    editMessage,
    deleteMessage,
    markChatOpened,
    addReaction,
    markViewed,
  } = useChats();

  const chat = chatId ? getChat(chatId) : undefined;
  const [draft, setDraft] = useState('');
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  // Long-press menu target. `null` hides the menu.
  const [activeMessage, setActiveMessage] = useState<ActiveMessage>(null);
  // Message currently being replied to (`null` means no reply).
  const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null);
  // Message currently being edited (`null` means normal send mode).
  const [editing, setEditing] = useState<EditingMessage>(null);
  // Image full-screen preview (URI of the image, or null).
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  // Show the chat-level action sheet (three-dots in header).
  const [showChatActions, setShowChatActions] = useState(false);
  /** Pending media awaiting "Send / Send once" choice. Null while idle. */
  const [pendingMedia, setPendingMedia] = useState<
    | { kind: 'image'; imageUri: string }
    | { kind: 'audio'; audioUri: string; audioDurationMs: number }
    | null
  >(null);
  // Voice-recording state.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recordingState, setRecordingState] = useState<'idle' | 'recording'>(
    'idle',
  );
  const [recordMs, setRecordMs] = useState(0);
  const recordStartRef = useRef<number>(0);
  const recordTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const listRef = useRef<FlatList<ChatMessage>>(null);
  const inputRef = useRef<TextInput>(null);

  // Lookup helper used by `QuotedMessage`: given a message id, return the
  // message it references (if any) so we can render the quoted preview.
  const messageById: Record<string, ChatMessage> = {};
  if (chat) for (const m of chat.messages) messageById[m.id] = m;

  // Index of the last "me" message — drives the Insta-style status label.
  const lastMineIndex = (() => {
    if (!chat) return -1;
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].authorId === 'me') return i;
    }
    return -1;
  })();

  useEffect(() => {
    if (chatId) markChatOpened(chatId);
  }, [chatId, markChatOpened]);

  // Auto-scroll to bottom on new message / typing change.
  useEffect(() => {
    if (!chat) return;
    const timer = setTimeout(() => {
      listRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [chat?.messages.length, chat?.partnerTyping, chat]);

  // Track keyboard state — used to tighten composer padding while open.
  useEffect(() => {
    const showEvt =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const s = Keyboard.addListener(showEvt, () => setKeyboardOpen(true));
    const h = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false));
    return () => {
      s.remove();
      h.remove();
    };
  }, []);

  // When the app goes to background / inactive, drop the keyboard AND
  // reset our tracked `keyboardOpen` flag. Without the explicit reset
  // we'd sometimes return to the app with stale state because iOS
  // doesn't always fire `keyboardWillHide` when the OS yanks the
  // keyboard for an app switch.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        Keyboard.dismiss();
        inputRef.current?.blur();
        setKeyboardOpen(false);
      }
    });
    return () => sub.remove();
  }, []);

  if (!chat) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <View style={styles.notFound}>
          <ThemedText style={styles.notFoundText}>Chat not found.</ThemedText>
          <Pressable onPress={() => router.back()}>
            <ThemedText style={{ color: c.tint, marginTop: Spacing.md }}>
              Go back
            </ThemedText>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ───── Sending ─────────────────────────────────────────────────────────

  const handleSend = () => {
    if (!draft.trim()) return;
    Haptics.selectionAsync();

    if (editing) {
      editMessage(chat.id, editing.id, draft);
      setEditing(null);
      setDraft('');
      return;
    }

    sendMessage(chat.id, {
      kind: 'text',
      text: draft,
      replyToMessageId: replyTarget?.id,
    });
    setDraft('');
    setReplyTarget(null);
  };

  const handlePickImage = async () => {
    Haptics.selectionAsync();
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(
        'Permission needed',
        'Allow Swing to access your photos to send images in chats.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.8,
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    // Park the picked image and let the user choose Send vs Send once.
    setPendingMedia({ kind: 'image', imageUri: asset.uri });
  };

  // ───── Voice recording ─────────────────────────────────────────────────

  const startRecording = async () => {
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(
          'Permission needed',
          'Allow Swing to use the microphone to record voice messages.',
        );
        return;
      }
      // iOS refuses to record unless the audio session is explicitly
      // switched into a recording-allowed mode first. `playsInSilentMode`
      // is also flipped so we can play back the clip even when the user's
      // ringer is off (same behaviour as WhatsApp / Insta).
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await recorder.prepareToRecordAsync();
      recorder.record();
      recordStartRef.current = Date.now();
      setRecordMs(0);
      setRecordingState('recording');
      recordTickRef.current = setInterval(() => {
        setRecordMs(Date.now() - recordStartRef.current);
      }, 200);
    } catch (e) {
      console.warn('Failed to start recording', e);
      setRecordingState('idle');
    }
  };

  const stopAndSendRecording = async () => {
    if (recordingState !== 'recording') return;
    if (recordTickRef.current) {
      clearInterval(recordTickRef.current);
      recordTickRef.current = null;
    }
    Haptics.selectionAsync();
    try {
      await recorder.stop();
      const uri = recorder.uri;
      const duration = Date.now() - recordStartRef.current;
      setRecordingState('idle');
      // Drop back out of recording mode so AVAudioSession releases the
      // mic and the player can speak through the loudspeaker.
      setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      if (uri && duration > 400) {
        // Same "Send / Send once" picker as for images.
        setPendingMedia({
          kind: 'audio',
          audioUri: uri,
          audioDurationMs: duration,
        });
      }
    } catch (e) {
      console.warn('Failed to stop recording', e);
      setRecordingState('idle');
    }
  };

  /**
   * Commits the pending media (image or voice) to the chat, honouring the
   * user's "view once" choice from the action sheet.
   */
  const commitPendingMedia = async (viewOnce: boolean) => {
    if (!pendingMedia || !chat) return;
    Haptics.selectionAsync();

    const base = {
      text: '',
      replyToMessageId: replyTarget?.id,
      viewOnce,
    };

    const sendLocal = () => {
      if (pendingMedia.kind === 'image') {
        sendMessage(chat.id, {
          ...base,
          kind: 'image',
          imageUri: pendingMedia.imageUri,
        });
      } else {
        sendMessage(chat.id, {
          ...base,
          kind: 'audio',
          audioUri: pendingMedia.audioUri,
          audioDurationMs: pendingMedia.audioDurationMs,
        });
      }
      setPendingMedia(null);
      setReplyTarget(null);
    };

    const uri =
      pendingMedia.kind === 'image'
        ? pendingMedia.imageUri
        : pendingMedia.audioUri;

    if (auth.status !== 'signed-in' || !isLocalMediaUri(uri)) {
      sendLocal();
      return;
    }

    setSendingMedia(true);
    try {
      const { accessToken } = await readTokens();
      if (!accessToken) {
        sendLocal();
        return;
      }
      const uploaded = await uploadChatMedia(
        accessToken,
        chat.id,
        uri,
        pendingMedia.kind,
      );
      if (pendingMedia.kind === 'image') {
        sendMessage(chat.id, {
          ...base,
          kind: 'image',
          imageUri: uploaded.viewUrl,
          mediaKey: uploaded.mediaKey,
        });
      } else {
        sendMessage(chat.id, {
          ...base,
          kind: 'audio',
          audioUri: uploaded.viewUrl,
          audioDurationMs: pendingMedia.audioDurationMs,
          mediaKey: uploaded.mediaKey,
        });
      }
      setPendingMedia(null);
      setReplyTarget(null);
    } catch (e) {
      Alert.alert(
        'Could not send',
        humanizeAuthError(e, 'Something went wrong. Try again.'),
      );
    } finally {
      setSendingMedia(false);
    }
  };

  const cancelRecording = async () => {
    if (recordTickRef.current) {
      clearInterval(recordTickRef.current);
      recordTickRef.current = null;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await recorder.stop();
    } catch {
      // ignore — already stopped
    }
    setRecordingState('idle');
    setAudioModeAsync({ allowsRecording: false }).catch(() => {});
  };

  // ───── Per-message actions ─────────────────────────────────────────────

  const openLongPress = (m: ChatMessage) => {
    if (m.deletedAt) return; // can't act on unsent messages
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActiveMessage({ id: m.id, isMine: m.authorId === 'me' });
  };

  const closeLongPress = () => setActiveMessage(null);

  const handleReply = (m: ChatMessage) => {
    Haptics.selectionAsync();
    setReplyTarget(m);
    closeLongPress();
    // Focus the input so the user can start typing immediately.
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleCopy = async (m: ChatMessage) => {
    Haptics.selectionAsync();
    await Clipboard.setStringAsync(m.text || '');
    closeLongPress();
  };

  const handleEdit = (m: ChatMessage) => {
    if (m.kind !== 'text' || m.authorId !== 'me') return;
    Haptics.selectionAsync();
    setEditing({ id: m.id, originalText: m.text });
    setDraft(m.text);
    setReplyTarget(null);
    closeLongPress();
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const handleDelete = (m: ChatMessage) => {
    Haptics.selectionAsync();
    Alert.alert('Unsend message?', 'This will hide the message for everyone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Unsend',
        style: 'destructive',
        onPress: () => {
          deleteMessage(chat.id, m.id);
          closeLongPress();
        },
      },
    ]);
  };

  const handlePickReaction = (m: ChatMessage, emoji: string) => {
    Haptics.selectionAsync();
    addReaction(chat.id, m.id, emoji);
    closeLongPress();
  };

  const cancelReply = () => setReplyTarget(null);
  const cancelEdit = () => {
    setEditing(null);
    setDraft('');
  };

  const openPartnerProfile = () => {
    router.push(`/profile/${chat.partner.id}`);
  };

  const activeMessageObj = activeMessage
    ? chat.messages.find((m) => m.id === activeMessage.id)
    : null;

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.root, { backgroundColor: c.background }]}
    >
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="chevron-back" size={26} color={c.text} />
        </Pressable>

        <Pressable onPress={openPartnerProfile} style={styles.headerCenter}>
          <View style={[styles.headerAvatar, { backgroundColor: c.tintMuted }]}>
            <ThemedText style={[styles.headerAvatarInitial, { color: c.tintPressed }]}>
              {chat.partner.name.charAt(0).toUpperCase()}
            </ThemedText>
            {chat.partner.onlineNow ? (
              <View
                style={[
                  styles.headerOnlineDot,
                  { backgroundColor: c.success, borderColor: c.background },
                ]}
              />
            ) : null}
          </View>
          <View style={styles.headerNameWrap}>
            <ThemedText style={styles.headerName} numberOfLines={1}>
              {chat.partner.name}
            </ThemedText>
            <ThemedText style={[styles.headerSub, { color: c.textMuted }]}>
              {chat.partnerTyping
                ? 'typing…'
                : chat.partner.onlineNow
                  ? 'Active now'
                  : 'Active recently'}
            </ThemedText>
          </View>
        </Pressable>

        <Pressable hitSlop={12} onPress={() => setShowChatActions(true)}>
          <Ionicons name="ellipsis-vertical" size={22} color={c.text} />
        </Pressable>
      </View>

      {/* Body: messages + composer share the KAV so the composer rides up
          with the keyboard. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
        style={styles.flex}
      >
        <FlatList
          ref={listRef}
          style={styles.flex}
          data={chat.messages}
          keyExtractor={(m) => m.id}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => (
            <SwipeableBubble
              isMe={item.authorId === 'me'}
              onReply={() => setReplyTarget(item)}
              accentColor={c.tint}
              mutedColor={c.textMuted}
              disabled={!!item.deletedAt}
            >
              <MessageBubble
                message={item}
                prevAuthorId={chat.messages[index - 1]?.authorId}
                isLastMine={index === lastMineIndex}
                quoted={
                  item.replyToMessageId
                    ? messageById[item.replyToMessageId]
                    : undefined
                }
                onLongPress={() => openLongPress(item)}
                onTapImage={(uri) => setPreviewUri(uri)}
                onMarkViewed={() => markViewed(chat.id, item.id)}
              />
            </SwipeableBubble>
          )}
          ListFooterComponent={chat.partnerTyping ? <TypingBubble /> : null}
        />

        {/* Composer */}
        <View
          style={[
            styles.composer,
            {
              borderTopColor: c.border,
              backgroundColor: c.surface,
              paddingBottom: keyboardOpen
                ? Spacing.xs
                : insets.bottom + Spacing.sm,
            },
          ]}
        >
          {replyTarget ? (
            <ReplyPreviewBar
              message={replyTarget}
              partnerName={chat.partner.name}
              onCancel={cancelReply}
              tint={c.tint}
              surface={c.surfaceAlt}
              border={c.border}
              text={c.text}
              muted={c.textMuted}
            />
          ) : null}

          {editing ? (
            <View
              style={[
                styles.editingBar,
                { backgroundColor: c.surfaceAlt, borderColor: c.border },
              ]}
            >
              <Ionicons name="create-outline" size={16} color={c.tint} />
              <ThemedText style={[styles.editingText, { color: c.text }]}>
                Editing message
              </ThemedText>
              <Pressable onPress={cancelEdit} hitSlop={8}>
                <Ionicons name="close" size={18} color={c.textMuted} />
              </Pressable>
            </View>
          ) : null}

          {recordingState === 'recording' ? (
            <RecordingComposer
              ms={recordMs}
              onCancel={cancelRecording}
              onSend={stopAndSendRecording}
              cancelColor={c.danger}
              sendColor={c.tint}
              barColor={c.surfaceAlt}
              borderColor={c.border}
              textColor={c.text}
              mutedColor={c.textMuted}
            />
          ) : (
            <View style={styles.composerRow}>
              <Pressable
                onPress={handlePickImage}
                hitSlop={8}
                style={styles.composerIcon}
              >
                <Ionicons name="image-outline" size={26} color={c.textMuted} />
              </Pressable>

              <View
                style={[
                  styles.inputWrap,
                  { backgroundColor: c.surfaceAlt, borderColor: c.border },
                ]}
              >
                <TextInput
                  ref={inputRef}
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={editing ? 'Edit message…' : 'Message…'}
                  placeholderTextColor={c.textSubtle}
                  style={[styles.input, { color: c.text }]}
                  multiline
                  scrollEnabled
                  maxLength={1000}
                />
              </View>

              {draft.trim() ? (
                <Pressable
                  onPress={handleSend}
                  hitSlop={8}
                  style={[
                    styles.sendButton,
                    { backgroundColor: c.tint },
                  ]}
                >
                  <Ionicons
                    name={editing ? 'checkmark' : 'send'}
                    size={18}
                    color="#fff"
                  />
                </Pressable>
              ) : (
                <Pressable
                  onPress={startRecording}
                  hitSlop={8}
                  style={[
                    styles.sendButton,
                    { backgroundColor: c.surfaceAlt },
                  ]}
                >
                  <Ionicons name="mic" size={20} color={c.tint} />
                </Pressable>
              )}
            </View>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Long-press action menu (modal). */}
      {activeMessageObj ? (
        <LongPressActionMenu
          message={activeMessageObj}
          isMine={activeMessage!.isMine}
          onDismiss={closeLongPress}
          onReact={(emoji) => handlePickReaction(activeMessageObj, emoji)}
          onReply={() => handleReply(activeMessageObj)}
          onCopy={() => handleCopy(activeMessageObj)}
          onEdit={() => handleEdit(activeMessageObj)}
          onDelete={() => handleDelete(activeMessageObj)}
        />
      ) : null}

      {/* Full-screen image viewer */}
      {previewUri ? (
        <ImageViewerModal
          uri={previewUri}
          onClose={() => setPreviewUri(null)}
        />
      ) : null}

      {/* "Send / Send once" picker shown after picking an image OR after
          stopping a voice recording. */}
      <ActionSheet
        visible={pendingMedia !== null}
        title={
          pendingMedia?.kind === 'audio'
            ? 'Send voice message'
            : 'Send photo'
        }
        onClose={() => setPendingMedia(null)}
        items={
          pendingMedia
            ? ([
                {
                  id: 'send',
                  icon: 'send',
                  label: 'Send',
                  primary: true,
                  subtitle: 'Stays in chat history',
                  onPress: () => void commitPendingMedia(false),
                } as ActionSheetItem,
                {
                  id: 'once',
                  icon:
                    pendingMedia.kind === 'audio'
                      ? 'volume-mute-outline'
                      : 'eye-outline',
                  label:
                    pendingMedia.kind === 'audio'
                      ? 'Listen once'
                      : 'View once',
                  subtitle:
                    'Destroys itself after being opened, leaving only a history line',
                  onPress: () => void commitPendingMedia(true),
                } as ActionSheetItem,
              ])
            : []
        }
      />

      {/* Chat-level action menu (Pin / Block / Report / Delete) */}
      <ChatActionMenu
        chatId={chat.id}
        visible={showChatActions}
        onClose={() => setShowChatActions(false)}
        popOnDelete
      />

      <BlockingLoader visible={sendingMedia} message="Sending…" />
    </SafeAreaView>
  );
}

// ===========================================================================
// SwipeableBubble — slide-to-reply gesture wrapper.
// ===========================================================================

function SwipeableBubble({
  isMe: _isMe,
  onReply,
  accentColor,
  mutedColor,
  disabled,
  children,
}: {
  isMe: boolean;
  onReply: () => void;
  accentColor: string;
  mutedColor: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const translateX = useSharedValue(0);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          !disabled && g.dx > 14 && Math.abs(g.dy) < 10,
        onPanResponderMove: (_, g) => {
          const dx = Math.max(0, g.dx);
          translateX.value = Math.min(dx, SWIPE_MAX_TRAVEL);
        },
        onPanResponderRelease: (_, g) => {
          if (g.dx > SWIPE_REPLY_THRESHOLD) {
            onReply();
          }
          translateX.value = withTiming(0, { duration: 220 });
        },
        onPanResponderTerminate: () => {
          translateX.value = withTiming(0, { duration: 220 });
        },
      }),
    [disabled, onReply, translateX],
  );

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const iconStyle = useAnimatedStyle(() => {
    const progress = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_REPLY_THRESHOLD, SWIPE_MAX_TRAVEL],
      [0, 0.85, 1],
      Extrapolation.CLAMP,
    );
    const scale = interpolate(
      Math.abs(translateX.value),
      [0, SWIPE_REPLY_THRESHOLD],
      [0.4, 1],
      Extrapolation.CLAMP,
    );
    return {
      opacity: progress,
      transform: [{ scale }],
    };
  });

  return (
    <View style={styles.swipeRow}>
      <Animated.View
        pointerEvents="none"
        style={[styles.swipeIcon, styles.swipeIconLeft, iconStyle]}
      >
        <View
          style={[
            styles.swipeIconCircle,
            { backgroundColor: accentColor + '22', borderColor: mutedColor },
          ]}
        >
          <Ionicons name="arrow-undo" size={16} color={accentColor} />
        </View>
      </Animated.View>

      <Animated.View style={bubbleStyle} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// ===========================================================================
// MessageBubble — actual bubble visuals.
// ===========================================================================

type MessageBubbleProps = {
  message: ChatMessage;
  prevAuthorId?: string;
  isLastMine: boolean;
  quoted?: ChatMessage;
  onLongPress: () => void;
  onTapImage: (uri: string) => void;
  /** Fires when a view-once media is opened (image tapped, or audio finished
   *  playing) so the host can mark the message destroyed. */
  onMarkViewed: () => void;
};

function MessageBubble({
  message,
  prevAuthorId,
  isLastMine,
  quoted,
  onLongPress,
  onTapImage,
  onMarkViewed,
}: MessageBubbleProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const isMe = message.authorId === 'me';
  const isFirstInGroup = prevAuthorId !== message.authorId;
  const isDeleted = !!message.deletedAt;

  // View-once states:
  //   - sender: closed lock (top-left) until opened → open lock
  //   - receiver locked: "Tap to view" tile
  //   - both, viewed: tombstone + open lock on sender bubble
  const isViewOnce = !!message.viewOnce;
  const isViewed = !!message.viewedAt;
  const isLocked = isViewOnce && !isViewed && !isMe;
  const isDestroyed = isViewOnce && isViewed;
  const showViewOnceLock = isViewOnce && isMe && !isDeleted;
  const viewOnceLockIcon = isViewed
    ? 'lock-open-outline'
    : 'lock-closed-outline';
  const hasReaction = !!message.reaction;
  const showStatus = isMe && isLastMine && !isDeleted;

  const handlePress = () => {
    if (isDeleted || isDestroyed) return;
    if (isLocked && message.kind === 'image' && message.imageUri) {
      // Recipient opens a view-once photo — first burn it, then show it.
      // The image stays in the modal for as long as they keep it open
      // and the destroyed placeholder takes over once they dismiss.
      onMarkViewed();
      onTapImage(message.imageUri);
      return;
    }
    if (message.kind === 'image' && message.imageUri) {
      onTapImage(message.imageUri);
    }
  };

  return (
    <View
      style={[
        styles.bubbleRow,
        isMe ? styles.bubbleRowMe : styles.bubbleRowThem,
        {
          marginTop: isFirstInGroup ? Spacing.md : 2,
          marginBottom: hasReaction ? 4 : 0,
        },
      ]}
    >
      <View
        style={[
          styles.bubbleWrap,
          isMe ? styles.bubbleWrapMe : styles.bubbleWrapThem,
          hasReaction && styles.bubbleWrapWithReaction,
          showViewOnceLock && styles.bubbleWrapWithLock,
        ]}
      >
        {showViewOnceLock ? (
          <View
            style={[
              styles.attachPill,
              styles.viewOnceLockPill,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <Ionicons
              name={viewOnceLockIcon}
              size={13}
              color={c.textMuted}
            />
          </View>
        ) : null}

        <Pressable
        onPress={handlePress}
        onLongPress={onLongPress}
        delayLongPress={280}
        style={[
          // Use the photo-shape bubble ONLY for plain image messages that
          // still have a visible image. Deleted / locked / destroyed
          // states fall back to the regular padded text-bubble shape.
          message.kind === 'image' && !isDeleted && !isLocked && !isDestroyed
            ? styles.imageBubble
            : styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          (message.kind !== 'image' || isDeleted || isLocked || isDestroyed) && {
            backgroundColor: isDeleted
              ? c.surfaceAlt
              : isMe
                ? c.tint
                : c.surface,
            borderColor: c.border,
            borderWidth: isDeleted || !isMe ? StyleSheet.hairlineWidth : 0,
          },
        ]}
      >
        {/* Quoted message header (only for non-deleted replies). */}
        {!isDeleted && quoted ? (
          <QuotedMessage
            quoted={quoted}
            isMe={isMe}
            accentColor={isMe ? '#fff' : c.tint}
            mutedColor={isMe ? 'rgba(255,255,255,0.7)' : c.textMuted}
          />
        ) : null}

        {isDeleted ? (
          <View style={styles.deletedRow}>
            <Ionicons name="ban-outline" size={14} color={c.textMuted} />
            <ThemedText style={[styles.deletedText, { color: c.textMuted }]}>
              Unsent
            </ThemedText>
          </View>
        ) : isDestroyed ? (
          /* Both sides see this once a view-once message has been viewed:
             a tombstone bubble that proves the media was sent without
             surfacing the content. */
          <ViewOnceTombstone
            kind={message.kind === 'audio' ? 'audio' : 'image'}
            isMe={isMe}
            textColor={isMe ? 'rgba(255,255,255,0.85)' : c.textMuted}
            iconColor={isMe ? '#fff' : c.tint}
          />
        ) : isLocked ? (
          /* Receiver-side locked tile — tap reveals the media one time. */
          <ViewOnceLocked
            kind={message.kind === 'audio' ? 'audio' : 'image'}
            tint={c.tint}
            mutedColor={c.textMuted}
            borderColor={c.border}
          />
        ) : message.kind === 'image' && message.imageUri ? (
          <Image
            source={{ uri: message.imageUri }}
            style={styles.bubbleImage}
            contentFit="cover"
          />
        ) : message.kind === 'audio' && message.audioUri ? (
          <AudioBubble
            uri={message.audioUri}
            durationMs={message.audioDurationMs ?? 0}
            tint={isMe ? '#fff' : c.tint}
            mutedTint={isMe ? 'rgba(255,255,255,0.7)' : c.textMuted}
            barBg={isMe ? 'rgba(255,255,255,0.25)' : c.borderStrong}
            onPlaybackEnd={isViewOnce && !isMe ? onMarkViewed : undefined}
          />
        ) : (
          <ThemedText
            style={[styles.bubbleText, { color: isMe ? '#fff' : c.text }]}
          >
            {message.text}
          </ThemedText>
        )}
      </Pressable>

        {hasReaction ? (
          <View
            style={[
              styles.attachPill,
              isMe ? styles.reactionPillMe : styles.reactionPillThem,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            <ThemedText style={styles.reactionEmoji}>
              {message.reaction}
            </ThemedText>
          </View>
        ) : null}
      </View>

      {/* "edited" tag — kept subtle. */}
      {!isDeleted && message.editedAt && message.kind === 'text' ? (
        <ThemedText style={[styles.editedTag, { color: c.textMuted }]}>
          edited
        </ThemedText>
      ) : null}

      {/* Status label under last me-message only. */}
      {showStatus ? (
        <StatusLabel
          status={message.status}
          mutedColor={c.textMuted}
          hasReaction={hasReaction}
        />
      ) : null}
    </View>
  );
}

// ===========================================================================
// ViewOnceLocked — receiver-side "Tap to view" tile for view-once media.
// ===========================================================================

function ViewOnceLocked({
  kind,
  tint,
  mutedColor,
  borderColor,
}: {
  kind: 'image' | 'audio';
  tint: string;
  mutedColor: string;
  borderColor: string;
}) {
  return (
    <View style={styles.viewOnceLocked}>
      <View
        style={[
          styles.viewOnceLockedIcon,
          { borderColor, backgroundColor: 'transparent' },
        ]}
      >
        <Ionicons
          name={kind === 'audio' ? 'mic-outline' : 'eye-outline'}
          size={20}
          color={tint}
        />
      </View>
      <View style={styles.viewOnceLockedText}>
        <ThemedText style={[styles.viewOnceLockedTitle, { color: tint }]}>
          Tap to {kind === 'audio' ? 'listen' : 'view'}
        </ThemedText>
        <ThemedText style={[styles.viewOnceLockedSub, { color: mutedColor }]}>
          {kind === 'audio' ? 'Listen once' : 'View once'}
        </ThemedText>
      </View>
    </View>
  );
}

// ===========================================================================
// ViewOnceTombstone — replaces the message body once view-once has been
// consumed. Shown to BOTH sides so the history line stays consistent.
// ===========================================================================

function ViewOnceTombstone({
  kind,
  isMe,
  textColor,
  iconColor,
}: {
  kind: 'image' | 'audio';
  isMe: boolean;
  textColor: string;
  iconColor: string;
}) {
  const label =
    kind === 'audio'
      ? isMe
        ? 'Voice message · Opened'
        : 'Voice message · Listened'
      : isMe
        ? 'Photo · Opened'
        : 'Photo · Viewed';
  return (
    <View style={styles.tombstoneRow}>
      <Ionicons
        name={kind === 'audio' ? 'mic-off-outline' : 'eye-off-outline'}
        size={14}
        color={iconColor}
      />
      <ThemedText style={[styles.tombstoneText, { color: textColor }]}>
        {label}
      </ThemedText>
    </View>
  );
}

// ===========================================================================
// QuotedMessage — small quote header rendered inside a reply bubble.
// ===========================================================================

function QuotedMessage({
  quoted,
  isMe,
  accentColor,
  mutedColor,
}: {
  quoted: ChatMessage;
  isMe: boolean;
  accentColor: string;
  mutedColor: string;
}) {
  const preview = quoted.deletedAt
    ? 'Unsent message'
    : quoted.kind === 'image'
      ? '📷 Photo'
      : quoted.kind === 'audio'
        ? '🎤 Voice message'
        : quoted.text;
  const author = quoted.authorId === 'me' ? 'You' : 'Them';

  return (
    <View
      style={[
        styles.quoteWrap,
        {
          borderLeftColor: accentColor,
          backgroundColor: isMe
            ? 'rgba(255,255,255,0.15)'
            : 'rgba(0,0,0,0.04)',
        },
      ]}
    >
      <ThemedText style={[styles.quoteAuthor, { color: accentColor }]}>
        {author}
      </ThemedText>
      <ThemedText
        numberOfLines={2}
        style={[styles.quoteText, { color: mutedColor }]}
      >
        {preview}
      </ThemedText>
    </View>
  );
}

// ===========================================================================
// AudioBubble — voice-message playback with fake-waveform progress.
// ===========================================================================

function AudioBubble({
  uri,
  durationMs,
  tint,
  mutedTint,
  barBg,
  onPlaybackEnd,
}: {
  uri: string;
  durationMs: number;
  tint: string;
  mutedTint: string;
  barBg: string;
  /** Fired once playback reaches the end. Used by view-once to burn the
   *  clip after the recipient hears it. */
  onPlaybackEnd?: () => void;
}) {
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);

  const isPlaying = status.playing;
  const elapsedMs = status.currentTime ? status.currentTime * 1000 : 0;
  const totalMs =
    status.duration && status.duration > 0
      ? status.duration * 1000
      : durationMs;

  // Fire `onPlaybackEnd` exactly once when the player finishes.
  const endedRef = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !endedRef.current) {
      endedRef.current = true;
      onPlaybackEnd?.();
    }
  }, [status.didJustFinish, onPlaybackEnd]);

  const toggle = () => {
    if (isPlaying) {
      player.pause();
    } else {
      if (status.didJustFinish || elapsedMs >= totalMs - 50) {
        player.seekTo(0);
      }
      player.play();
    }
  };

  const bars = Array.from({ length: 12 }).map((_, i) => 6 + ((i * 13) % 14));
  const playedFraction = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0;

  return (
    <View style={styles.audioRow}>
      <Pressable onPress={toggle} hitSlop={6}>
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={20} color={tint} />
      </Pressable>
      <View style={styles.audioBars}>
        {bars.map((h, i) => {
          const filled = i / bars.length <= playedFraction;
          return (
            <View
              key={i}
              style={[
                styles.audioBar,
                { height: h, backgroundColor: filled ? tint : barBg },
              ]}
            />
          );
        })}
      </View>
      <ThemedText style={[styles.audioDuration, { color: mutedTint }]}>
        {formatDuration(isPlaying ? elapsedMs : totalMs)}
      </ThemedText>
    </View>
  );
}

// ===========================================================================
// StatusLabel — Insta-style "Sent / Delivered / Seen" under last me-msg.
// ===========================================================================

function StatusLabel({
  status,
  mutedColor,
  hasReaction = false,
}: {
  status: ChatMessage['status'];
  mutedColor: string;
  hasReaction?: boolean;
}) {
  let label: string;
  let icon: keyof typeof Ionicons.glyphMap;
  let color = mutedColor;

  switch (status) {
    case 'sending':
      label = 'Sending…';
      icon = 'time-outline';
      break;
    case 'sent':
      label = 'Sent';
      icon = 'checkmark';
      break;
    case 'delivered':
      label = 'Delivered';
      icon = 'checkmark-done';
      break;
    case 'seen':
    default:
      label = 'Seen';
      icon = 'checkmark-done';
      color = '#3B82F6';
      break;
  }

  return (
    <View
      style={[
        styles.statusLabelRow,
        hasReaction && styles.statusLabelRowWithReaction,
      ]}
    >
      <Ionicons name={icon} size={12} color={color} />
      <ThemedText style={[styles.statusLabelText, { color }]}>{label}</ThemedText>
    </View>
  );
}

// ===========================================================================
// Typing bubble (partner) — animated three pulsing dots.
// ===========================================================================

function TypingBubble() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.bubbleRow, styles.bubbleRowThem]}>
      <View
        style={[
          styles.bubble,
          styles.bubbleThem,
          styles.typingBubble,
          {
            backgroundColor: c.surface,
            borderColor: c.border,
            borderWidth: StyleSheet.hairlineWidth,
          },
        ]}
      >
        <TypingDot delay={0} color={c.textMuted} />
        <TypingDot delay={150} color={c.textMuted} />
        <TypingDot delay={300} color={c.textMuted} />
      </View>
    </View>
  );
}

function TypingDot({ delay, color }: { delay: number; color: string }) {
  const opacity = useSharedValue(0.3);
  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 350, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.3, { duration: 350, easing: Easing.inOut(Easing.ease) }),
        ),
        -1,
        false,
      ),
    );
  }, [opacity, delay]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[styles.typingDot, { backgroundColor: color }, style]} />
  );
}

// ===========================================================================
// LongPressActionMenu — quick-reactions row + actions list, in a Modal.
// ===========================================================================

function LongPressActionMenu({
  message,
  isMine,
  onDismiss,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onDelete,
}: {
  message: ChatMessage;
  isMine: boolean;
  onDismiss: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const canEdit = isMine && message.kind === 'text';
  const canCopy = message.kind === 'text' && !!message.text;

  const actions: {
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    onPress: () => void;
    destructive?: boolean;
    show: boolean;
  }[] = [
    { icon: 'arrow-undo-outline', label: 'Reply', onPress: onReply, show: true },
    {
      icon: 'copy-outline',
      label: 'Copy',
      onPress: onCopy,
      show: canCopy,
    },
    {
      icon: 'create-outline',
      label: 'Edit',
      onPress: onEdit,
      show: canEdit,
    },
    {
      icon: 'trash-outline',
      label: 'Unsend',
      onPress: onDelete,
      destructive: true,
      show: isMine,
    },
  ];

  return (
    <Modal transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.menuBackdrop} onPress={onDismiss}>
        <View style={styles.menuStack}>
          {/* Quick reactions row */}
          <View
            style={[
              styles.menuReactions,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => onReact(emoji)}
                style={({ pressed }) => [
                  styles.reactionButton,
                  { backgroundColor: pressed ? c.surfaceAlt : 'transparent' },
                ]}
                hitSlop={4}
              >
                <ThemedText style={styles.reactionPickerEmoji}>
                  {emoji}
                </ThemedText>
              </Pressable>
            ))}
          </View>

          {/* Actions list */}
          <View
            style={[
              styles.menuList,
              { backgroundColor: c.surface, borderColor: c.border },
            ]}
          >
            {actions
              .filter((a) => a.show)
              .map((a, i, arr) => (
                <Pressable
                  key={a.label}
                  onPress={a.onPress}
                  style={({ pressed }) => [
                    styles.menuItem,
                    i < arr.length - 1 && {
                      borderBottomColor: c.border,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                    { backgroundColor: pressed ? c.surfaceAlt : 'transparent' },
                  ]}
                >
                  <Ionicons
                    name={a.icon}
                    size={20}
                    color={a.destructive ? c.danger : c.text}
                  />
                  <ThemedText
                    style={[
                      styles.menuItemLabel,
                      { color: a.destructive ? c.danger : c.text },
                    ]}
                  >
                    {a.label}
                  </ThemedText>
                </Pressable>
              ))}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

// ===========================================================================
// ReplyPreviewBar — above-composer "replying to X" pill with cancel.
// ===========================================================================

function ReplyPreviewBar({
  message,
  partnerName,
  onCancel,
  tint,
  surface,
  border,
  text,
  muted,
}: {
  message: ChatMessage;
  partnerName: string;
  onCancel: () => void;
  tint: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
}) {
  const author = message.authorId === 'me' ? 'yourself' : partnerName;
  const body = message.deletedAt
    ? 'Unsent message'
    : message.kind === 'image'
      ? '📷 Photo'
      : message.kind === 'audio'
        ? '🎤 Voice message'
        : message.text;

  return (
    <View
      style={[
        styles.replyBar,
        {
          backgroundColor: surface,
          borderColor: border,
          borderLeftColor: tint,
        },
      ]}
    >
      <View style={styles.replyBarText}>
        <ThemedText style={[styles.replyBarAuthor, { color: tint }]}>
          Replying to {author}
        </ThemedText>
        <ThemedText
          numberOfLines={1}
          style={[styles.replyBarBody, { color: text }]}
        >
          {body}
        </ThemedText>
      </View>
      <Pressable onPress={onCancel} hitSlop={8} style={styles.replyBarClose}>
        <Ionicons name="close" size={18} color={muted} />
      </Pressable>
    </View>
  );
}

// ===========================================================================
// RecordingComposer — replaces the input row while voice recording.
// ===========================================================================

function RecordingComposer({
  ms,
  onCancel,
  onSend,
  cancelColor,
  sendColor,
  barColor,
  borderColor,
  textColor,
  mutedColor,
}: {
  ms: number;
  onCancel: () => void;
  onSend: () => void;
  cancelColor: string;
  sendColor: string;
  barColor: string;
  borderColor: string;
  textColor: string;
  mutedColor: string;
}) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.4, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.composerRow}>
      <Pressable onPress={onCancel} hitSlop={8} style={styles.composerIcon}>
        <Ionicons name="trash-outline" size={24} color={cancelColor} />
      </Pressable>

      <View
        style={[
          styles.recordingBar,
          { backgroundColor: barColor, borderColor },
        ]}
      >
        <Animated.View
          style={[styles.recordingDot, { backgroundColor: cancelColor }, dotStyle]}
        />
        <ThemedText style={[styles.recordingTimer, { color: textColor }]}>
          {formatDuration(ms)}
        </ThemedText>
        <ThemedText style={[styles.recordingHint, { color: mutedColor }]}>
          Recording…
        </ThemedText>
      </View>

      <Pressable
        onPress={onSend}
        hitSlop={8}
        style={[styles.sendButton, { backgroundColor: sendColor }]}
      >
        <Ionicons name="send" size={18} color="#fff" />
      </Pressable>
    </View>
  );
}

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ===========================================================================
// Styles
// ===========================================================================

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },

  // ── Header ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  headerAvatarInitial: { fontSize: 15, fontWeight: '700' },
  headerOnlineDot: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  headerNameWrap: { flex: 1 },
  headerName: { fontSize: 15, fontWeight: '600' },
  headerSub: { fontSize: 11, marginTop: 1 },

  // ── List ────────────────────────────────────────────────────────────
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    paddingBottom: Spacing.lg,
  },

  // ── Bubbles ─────────────────────────────────────────────────────────
  swipeRow: {
    width: '100%',
    position: 'relative',
  },
  swipeIcon: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeIconLeft: { left: -16 },
  swipeIconRight: { right: -16 },
  swipeIconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleRow: {
    width: '100%',
  },
  bubbleRowMe: { alignItems: 'flex-end' },
  bubbleRowThem: { alignItems: 'flex-start' },

  bubble: {
    maxWidth: '78%',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radii.lg,
    position: 'relative',
  },
  imageBubble: {
    maxWidth: '70%',
    borderRadius: Radii.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  bubbleImage: {
    width: 220,
    height: 280,
    borderRadius: Radii.lg,
  },
  bubbleMe: { borderBottomRightRadius: 6 },
  bubbleThem: { borderBottomLeftRadius: 6 },
  bubbleText: { fontSize: 15, lineHeight: 20 },

  // Quoted preview inside a reply bubble
  quoteWrap: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
    borderLeftWidth: 3,
    borderRadius: 6,
    marginBottom: Spacing.xs,
  },
  quoteAuthor: { fontSize: 11, fontWeight: '700', marginBottom: 2 },
  quoteText: { fontSize: 13, lineHeight: 17 },

  // Deleted / Unsent placeholder
  deletedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deletedText: { fontSize: 14, fontStyle: 'italic' },

  // View-once locked tile (receiver, not yet opened)
  viewOnceLocked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 180,
    paddingVertical: 2,
  },
  viewOnceLockedIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  viewOnceLockedText: { flex: 1 },
  viewOnceLockedTitle: { fontSize: 14, fontWeight: '700' },
  viewOnceLockedSub: { fontSize: 11, marginTop: 1 },

  // View-once tombstone (both sides, after open)
  tombstoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tombstoneText: { fontSize: 13, fontStyle: 'italic' },

  bubbleWrap: {
    position: 'relative',
    maxWidth: '82%',
  },
  bubbleWrapWithReaction: {
    marginBottom: 14,
  },
  bubbleWrapWithLock: {
    marginTop: 9,
  },
  bubbleWrapMe: {
    alignSelf: 'flex-end',
  },
  bubbleWrapThem: {
    alignSelf: 'flex-start',
  },
  attachPill: {
    position: 'absolute',
    zIndex: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  /** Half-on / half-off top-right — WhatsApp view-once lock chip. */
  viewOnceLockPill: {
    top: 0,
    right: 2,
    transform: [{ translateY: -10 }],
  },

  // "edited" subscript
  editedTag: { fontSize: 10, fontStyle: 'italic', marginTop: 2, marginRight: 4 },

  // Audio
  audioRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 180,
  },
  audioBars: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    flex: 1,
  },
  audioBar: { width: 3, borderRadius: 1.5 },
  audioDuration: {
    fontSize: 11,
    fontVariant: ['tabular-nums'],
    fontWeight: '500',
  },

  // Status label + reaction
  statusLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
    marginRight: 4,
    alignSelf: 'flex-end',
  },
  statusLabelRowWithReaction: {
    marginTop: 2,
    marginRight: 8,
  },
  statusLabelText: { fontSize: 11, fontWeight: '500' },
  /** Outgoing: bottom-left kiss; incoming: bottom-right — WhatsApp-style. */
  reactionPillMe: {
    bottom: -1,
    left: 2,
    transform: [{ translateY: 15 }],
  },
  reactionPillThem: {
    bottom: -1,
    right: 2,
    transform: [{ translateY: 15 }],
  },
  reactionEmoji: { fontSize: 13 },
  reactionButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reactionPickerEmoji: { fontSize: 22 },

  // Typing
  typingBubble: { flexDirection: 'row', gap: 4, paddingVertical: 12 },
  typingDot: { width: 6, height: 6, borderRadius: 3 },

  // ── Long-press action menu (Modal) ──────────────────────────────────
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  menuStack: {
    width: '100%',
    maxWidth: 320,
    gap: Spacing.md,
  },
  menuReactions: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 8,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuList: {
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 14,
  },
  menuItemLabel: { fontSize: 16, fontWeight: '500' },


  // ── Reply preview bar (above composer) ──────────────────────────────
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: 3,
    marginBottom: Spacing.sm,
  },
  replyBarText: { flex: 1 },
  replyBarAuthor: { fontSize: 12, fontWeight: '700' },
  replyBarBody: { fontSize: 13, marginTop: 2 },
  replyBarClose: { padding: 4 },

  // ── Editing indicator ───────────────────────────────────────────────
  editingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  editingText: { flex: 1, fontSize: 13, fontWeight: '500' },

  // ── Composer ────────────────────────────────────────────────────────
  composer: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  composerIcon: {
    paddingBottom: 8,
    paddingTop: 4,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: Radii.lg, // curved, not pill
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    minHeight: 42,
    maxHeight: MAX_INPUT_HEIGHT,
  },
  input: {
    flex: 1,
    fontSize: 15,
    lineHeight: 20,
    paddingTop: 6,
    paddingBottom: 6,
    paddingRight: Spacing.sm,
    maxHeight: MAX_INPUT_HEIGHT - 12,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
  },

  // ── Recording composer ──────────────────────────────────────────────
  recordingBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: 10,
    borderRadius: Radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 42,
  },
  recordingDot: { width: 10, height: 10, borderRadius: 5 },
  recordingTimer: {
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  recordingHint: { fontSize: 12 },

  // ── Not found ──────────────────────────────────────────────────────
  notFound: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notFoundText: { fontSize: 16 },
});
