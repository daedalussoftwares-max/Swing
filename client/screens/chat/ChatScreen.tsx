/**
 * 1-on-1 chat thread — Instagram-DM inspired.
 *
 * Performance model (why it's structured like this):
 *   - The draft lives inside `<Composer>`, so typing re-renders only the
 *     input row — never the message list.
 *   - The list is an inverted FlatList: newest message sits at the bottom
 *     with no `scrollToEnd` timers, and older pages load on scroll-up.
 *   - Rows are memoised (`MessageRow`) and receive stable callbacks, so a
 *     new message renders one bubble, not the whole thread.
 *   - The keyboard offset is animated on the UI thread
 *     (`useAnimatedKeyboard`) — no JS re-render per keyboard frame, and it
 *     works with Android edge-to-edge where `adjustResize` doesn't.
 *   - Typing indicators go over the WebSocket, throttled.
 *
 * Per-message interactions:
 *   - Tap            → opens images full-screen (`ImageViewerModal`);
 *                      on a failed message → Retry / Delete.
 *   - Long-press     → action menu: Reply / Copy / Edit / Delete +
 *                      a quick-reaction emoji row at the top.
 *   - Swipe right    → slide-to-reply.
 *   - Status flow    → Sending… → Sent → Delivered → Seen, shown ONLY
 *                      under the most recent message I sent.
 */

import { Ionicons } from '@/lib/native/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useVoicePlayback,
  voicePlayer,
} from '@/lib/native/audio';
import * as Clipboard from '@/lib/native/clipboard';
import * as Haptics from '@/lib/native/haptics';
import { Image } from '@/lib/native/image';
import * as ImagePicker from '@/lib/native/image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from '@/lib/router';
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Keyboard,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ListRenderItem,
} from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  FadeIn,
  FadeInDown,
  FadeOut,
  interpolate,
  useAnimatedKeyboard,
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
import { ChatActionMenu } from '@/components/chat-action-menu';
import { ImageViewerModal } from '@/components/image-viewer-modal';
import { ThemedText } from '@/components/themed-text';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useRefreshOnAppActive } from '@/hooks/use-refresh-on-app-active';
import { useAuth } from '@/lib/auth-context';
import { useChat, useChatsActions } from '@/lib/chats-context';
import { isLocalMediaUri, refreshMediaViewUrl } from '@/lib/upload-media';
import type { ChatMessage } from '@/types/chat';

const QUICK_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '🙏'];

/** Cap on the multiline input's height. Past this the input scrolls
 *  internally so the chat list above stays visible. */
const MAX_INPUT_HEIGHT = 110;
/** Horizontal drag distance (px) past which a swipe commits to a reply. */
const SWIPE_REPLY_THRESHOLD = 60;
/** Maximum visual translation the bubble can travel during a swipe. */
const SWIPE_MAX_TRAVEL = 80;
/** Re-send "typing" at most this often while the user keeps typing. */
const TYPING_THROTTLE_MS = 3_000;
/** Send "stopped typing" after this much idle time. */
const TYPING_IDLE_MS = 3_000;

const EMPTY_MESSAGES: ChatMessage[] = [];

type ActiveMessage = { id: string; isMine: boolean } | null;
type EditingMessage = { id: string; originalText: string } | null;

type RowActions = {
  longPress: (m: ChatMessage) => void;
  reply: (m: ChatMessage) => void;
  tapImage: (uri: string) => void;
  openViewOnce: (m: ChatMessage) => void;
  onceAudioEnded: () => void;
  pressFailed: (m: ChatMessage) => void;
};

export default function ChatScreen() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const auth = useAuth();
  const signedIn = auth.status === 'signed-in' && !!auth.user?.id;
  const {
    refresh,
    sendMessage,
    retryMessage,
    discardMessage,
    editMessage,
    deleteMessage,
    markChatOpened,
    setActiveChat,
    setTyping,
    unblockChat,
    addReaction,
    openViewOnce,
    loadMessages,
    loadOlderMessages,
  } = useChatsActions();

  // Subscribes to THIS chat only — other chats' activity doesn't re-render.
  const chat = useChat(chatId);
  const chatExists = !!chat;
  const [lookupDone, setLookupDone] = useState(false);
  // Messages newer than this animate in; history doesn't.
  const [mountedAt] = useState(() => Date.now());
  const [hadChat, setHadChat] = useState(false);
  if (chatExists && !hadChat) setHadChat(true);

  // The partner (or my other device) deleted this conversation.
  useEffect(() => {
    if (!hadChat || chatExists) return;
    Alert.alert('Chat deleted', 'This conversation is no longer available.');
    router.back();
  }, [hadChat, chatExists, router]);

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
  // A view-once voice note the recipient just opened (playing right now).
  const [onceAudio, setOnceAudio] = useState<{ messageId: string; url: string } | null>(
    null,
  );
  // Failed message the user tapped (Retry / Delete sheet).
  const [failedTarget, setFailedTarget] = useState<ChatMessage | null>(null);
  /** Pending media awaiting "Send / Send once" choice. Null while idle. */
  const [pendingMedia, setPendingMedia] = useState<{ imageUri: string } | null>(
    null,
  );
  // Voice-recording state.
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recordMs, setRecordMs] = useState(0);
  const recordStartRef = useRef<number>(0);
  const recordTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const composerRef = useRef<ComposerHandle>(null);

  // ───── Data loading / read state ───────────────────────────────────────

  useEffect(() => {
    if (!chatId || !signedIn) return;
    if (chatExists) {
      void loadMessages(chatId);
      return;
    }
    // Deep link / notification into a chat the list hasn't seen yet.
    let cancelled = false;
    void refresh().finally(() => {
      if (!cancelled) setLookupDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [chatId, signedIn, chatExists, loadMessages, refresh]);

  // While this screen is focused, incoming messages are read instantly.
  useFocusEffect(
    useCallback(() => {
      if (!chatId) return;
      setActiveChat(chatId);
      return () => setActiveChat(null);
    }, [chatId, setActiveChat]),
  );

  const onAppActive = useCallback(() => {
    if (!chatId) return;
    void loadMessages(chatId);
    markChatOpened(chatId);
  }, [chatId, loadMessages, markChatOpened]);
  useRefreshOnAppActive(onAppActive);

  // When the app goes to background, drop the keyboard so the multiline
  // input can't get stuck at an over-grown height on resume.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') Keyboard.dismiss();
    });
    return () => sub.remove();
  }, []);

  // ───── List data ───────────────────────────────────────────────────────

  const messages = chat?.messages ?? EMPTY_MESSAGES;
  // Inverted list → newest first.
  const listData = useMemo(() => [...messages].reverse(), [messages]);
  const messageById = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);
  const lastMineId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].authorId === 'me') return messages[i].id;
    }
    return null;
  }, [messages]);

  const rowActions = useMemo<RowActions>(
    () => ({
      longPress: (m) => {
        if (m.status === 'failed') {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setFailedTarget(m);
          return;
        }
        if (m.deletedAt || m.status === 'sending') return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        setActiveMessage({ id: m.id, isMine: m.authorId === 'me' });
      },
      reply: (m) => {
        if (m.status === 'failed' || m.status === 'sending') return;
        Haptics.selectionAsync();
        setReplyTarget(m);
        composerRef.current?.focus();
      },
      tapImage: (uri) => setPreviewUri(uri),
      openViewOnce: (m) => {
        if (!chatId) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        void openViewOnce(chatId, m.id).then((url) => {
          if (!url) return;
          if (m.kind === 'image') {
            setPreviewUri(url);
          } else {
            setOnceAudio({ messageId: m.id, url });
            void voicePlayer.toggle(url).catch(() => setOnceAudio(null));
          }
        });
      },
      onceAudioEnded: () => setOnceAudio(null),
      pressFailed: (m) => setFailedTarget(m),
    }),
    [chatId, openViewOnce],
  );

  const renderItem = useCallback<ListRenderItem<ChatMessage>>(
    ({ item, index }) => (
      <MessageRow
        message={item}
        prevAuthorId={listData[index + 1]?.authorId}
        isLastMine={item.id === lastMineId}
        animateIn={Date.parse(item.createdAt) > mountedAt}
        onceAudioUrl={onceAudio?.messageId === item.id ? onceAudio.url : undefined}
        quoted={
          item.replyToMessageId
            ? messageById.get(item.replyToMessageId)
            : undefined
        }
        actions={rowActions}
      />
    ),
    [listData, lastMineId, messageById, rowActions, mountedAt, onceAudio],
  );

  const onEndReached = useCallback(() => {
    if (chatId) void loadOlderMessages(chatId);
  }, [chatId, loadOlderMessages]);

  // ───── Keyboard (UI thread) ────────────────────────────────────────────

  const keyboard = useAnimatedKeyboard({
    isStatusBarTranslucentAndroid: true,
    isNavigationBarTranslucentAndroid: true,
  });
  const bottomInset = insets.bottom;
  const keyboardPad = useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, keyboard.height.value - bottomInset),
  }));

  // ───── Composer callbacks ──────────────────────────────────────────────

  const handleSubmit = useCallback(
    (text: string) => {
      if (!chatId) return;
      Haptics.selectionAsync();
      if (editing) {
        editMessage(chatId, editing.id, text);
        setEditing(null);
        return;
      }
      void sendMessage(chatId, {
        kind: 'text',
        text,
        replyToMessageId: replyTarget?.id,
      });
      setReplyTarget(null);
    },
    [chatId, editing, replyTarget, editMessage, sendMessage],
  );

  const handleTyping = useCallback(
    (isTyping: boolean) => {
      if (chatId) setTyping(chatId, isTyping);
    },
    [chatId, setTyping],
  );

  const handlePickImage = useCallback(async () => {
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
    // Park the picked image and let the user choose Send vs Send once.
    setPendingMedia({ imageUri: result.assets[0].uri });
  }, []);

  // ───── Voice recording (gesture lives in <Composer>) ───────────────────

  const recordingRef = useRef(false);

  /** Starts the recorder. Resolves false when we only asked for the mic
   *  permission (first use — the finger is long gone by then) or failed. */
  const startRecording = useCallback(async (): Promise<boolean> => {
    try {
      const current = await AudioModule.getRecordingPermissionsAsync();
      if (!current.granted) {
        const perm = await AudioModule.requestRecordingPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(
            'Microphone needed',
            'Allow Swing to use the microphone to send voice messages.',
          );
        }
        return false;
      }
      await voicePlayer.stop();
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      await recorder.record();
      recordingRef.current = true;
      recordStartRef.current = Date.now();
      setRecordMs(0);
      if (recordTickRef.current) clearInterval(recordTickRef.current);
      recordTickRef.current = setInterval(() => {
        setRecordMs(Date.now() - recordStartRef.current);
      }, 200);
      return true;
    } catch (e) {
      console.warn('Failed to start recording', e);
      Alert.alert('Could not record', 'The microphone is unavailable right now.');
      return false;
    }
  }, [recorder]);

  const finishRecording = useCallback(
    async (action: 'send' | 'cancel', viewOnce: boolean) => {
      if (!recordingRef.current) return;
      recordingRef.current = false;
      if (recordTickRef.current) {
        clearInterval(recordTickRef.current);
        recordTickRef.current = null;
      }
      const duration = Date.now() - recordStartRef.current;
      setRecordMs(0);
      let uri: string | null;
      try {
        uri = (await recorder.stop()).uri;
      } catch (e) {
        console.warn('Failed to stop recording', e);
        if (action === 'send') {
          Alert.alert('Recording failed', 'Please try recording again.');
        }
        return;
      } finally {
        setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      }
      if (action !== 'send' || !uri || !chatId) return;
      void sendMessage(chatId, {
        kind: 'audio',
        text: '',
        audioUri: uri,
        audioDurationMs: duration,
        viewOnce,
        replyToMessageId: replyTarget?.id,
      });
      setReplyTarget(null);
    },
    [recorder, chatId, sendMessage, replyTarget],
  );

  useEffect(
    () => () => {
      if (recordTickRef.current) clearInterval(recordTickRef.current);
      void voicePlayer.stop();
    },
    [],
  );

  /**
   * Queues the picked photo. The bubble appears instantly with the local
   * file; upload + send happen in the background.
   */
  const commitPendingMedia = (viewOnce: boolean) => {
    if (!pendingMedia || !chatId) return;
    Haptics.selectionAsync();
    void sendMessage(chatId, {
      kind: 'image',
      text: '',
      imageUri: pendingMedia.imageUri,
      replyToMessageId: replyTarget?.id,
      viewOnce,
    });
    setPendingMedia(null);
    setReplyTarget(null);
  };

  // ───── Not found / loading ─────────────────────────────────────────────

  if (!chat) {
    const stillLooking = signedIn && !lookupDone;
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <View style={styles.notFound}>
          {stillLooking ? (
            <ActivityIndicator color={c.tint} />
          ) : (
            <>
              <ThemedText style={styles.notFoundText}>Chat not found.</ThemedText>
              <Pressable onPress={() => router.back()}>
                <ThemedText style={{ color: c.tint, marginTop: Spacing.md }}>
                  Go back
                </ThemedText>
              </Pressable>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ───── Per-message actions ─────────────────────────────────────────────

  const closeLongPress = () => setActiveMessage(null);

  const handleReply = (m: ChatMessage) => {
    closeLongPress();
    rowActions.reply(m);
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
    setReplyTarget(null);
    closeLongPress();
    composerRef.current?.setText(m.text);
    composerRef.current?.focus();
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
    composerRef.current?.setText('');
  };

  const openPartnerProfile = () => {
    router.push(`/profile/${chat.partner.id}`);
  };

  const activeMessageObj = activeMessage
    ? messageById.get(activeMessage.id)
    : undefined;

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
            {chat.partner.avatarUrl ? (
              <Image
                source={{ uri: chat.partner.avatarUrl }}
                style={styles.headerAvatarImage}
                contentFit="cover"
              />
            ) : (
              <ThemedText
                style={[styles.headerAvatarInitial, { color: c.tintPressed }]}
              >
                {chat.partner.name.charAt(0).toUpperCase()}
              </ThemedText>
            )}
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
            <ThemedText
              style={[
                styles.headerSub,
                { color: chat.partnerTyping ? c.tint : c.textMuted },
              ]}
            >
              {chat.partnerTyping
                ? 'typing…'
                : chat.partner.onlineNow
                  ? 'Active now'
                  : 'Offline'}
            </ThemedText>
          </View>
        </Pressable>

        <Pressable hitSlop={12} onPress={() => setShowChatActions(true)}>
          <Ionicons name="ellipsis-vertical" size={22} color={c.text} />
        </Pressable>
      </View>

      {/* Body: messages + composer ride up with the keyboard together. */}
      <Animated.View style={[styles.flex, keyboardPad]}>
        {messages.length === 0 && !chat.historyLoaded ? (
          <View style={styles.listPlaceholder}>
            <ActivityIndicator color={c.textMuted} />
          </View>
        ) : messages.length === 0 && !chat.partnerTyping ? (
          <Pressable style={styles.listPlaceholder} onPress={Keyboard.dismiss}>
            <ThemedText style={[styles.emptyThread, { color: c.textMuted }]}>
              No messages yet. Say hi!
            </ThemedText>
          </Pressable>
        ) : (
          <FlatList
            inverted
            style={styles.flex}
            data={listData}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={styles.list}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.4}
            initialNumToRender={20}
            maxToRenderPerBatch={12}
            windowSize={11}
            ListHeaderComponent={chat.partnerTyping ? <TypingBubble /> : null}
          />
        )}

        {/* Composer */}
        <View
          style={[
            styles.composer,
            {
              borderTopColor: c.border,
              backgroundColor: c.surface,
              paddingBottom: insets.bottom + Spacing.sm,
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

          {chat.isBlocked ? (
            <View style={styles.blockedBar}>
              <ThemedText style={[styles.blockedText, { color: c.textMuted }]}>
                You blocked {chat.partner.name}. You can't message them.
              </ThemedText>
              <Pressable
                onPress={() => unblockChat(chat.id)}
                style={({ pressed }) => [
                  styles.unblockButton,
                  { borderColor: c.tint, opacity: pressed ? 0.7 : 1 },
                ]}
              >
                <ThemedText style={[styles.unblockText, { color: c.tint }]}>
                  Unblock
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <Composer
              ref={composerRef}
              editing={!!editing}
              recordMs={recordMs}
              onSubmit={handleSubmit}
              onTyping={handleTyping}
              onPickImage={handlePickImage}
              onRecordStart={startRecording}
              onRecordFinish={finishRecording}
            />
          )}
        </View>
      </Animated.View>

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

      {/* "Send / View once" picker shown after picking a photo. */}
      <ActionSheet
        visible={pendingMedia !== null}
        title="Send photo"
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
                  onPress: () => commitPendingMedia(false),
                } as ActionSheetItem,
                {
                  id: 'once',
                  icon: 'eye-outline',
                  label: 'View once',
                  subtitle:
                    'Destroys itself after being opened, leaving only a history line',
                  onPress: () => commitPendingMedia(true),
                } as ActionSheetItem,
              ])
            : []
        }
      />

      {/* Failed send: Retry / Delete */}
      <ActionSheet
        visible={failedTarget !== null}
        title="Message not sent"
        onClose={() => setFailedTarget(null)}
        items={
          failedTarget?.clientMsgId
            ? ([
                {
                  id: 'retry',
                  icon: 'refresh',
                  label: 'Try again',
                  primary: true,
                  onPress: () => {
                    retryMessage(chat.id, failedTarget.clientMsgId!);
                    setFailedTarget(null);
                  },
                } as ActionSheetItem,
                {
                  id: 'discard',
                  icon: 'trash-outline',
                  label: 'Delete message',
                  destructive: true,
                  onPress: () => {
                    discardMessage(chat.id, failedTarget.clientMsgId!);
                    setFailedTarget(null);
                  },
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
    </SafeAreaView>
  );
}

const keyExtractor = (m: ChatMessage) => m.clientMsgId ?? m.id;

// ===========================================================================
// Composer — owns the draft so keystrokes never re-render the thread.
// Voice notes are WhatsApp-style: hold the mic to record, release to send,
// slide left to cancel, slide up to lock (hands-free + "view once").
// ===========================================================================

type ComposerHandle = {
  setText: (text: string) => void;
  focus: () => void;
};

type RecordMode = 'idle' | 'hold' | 'locked';
type RecordAction = 'send' | 'cancel';

/** Drag this far left while holding to cancel the recording. */
const CANCEL_DRAG_PX = 110;
/** Drag this far up while holding to lock (keep recording hands-free). */
const LOCK_DRAG_PX = 80;
/** Shorter notes are treated as an accidental tap. */
const MIN_VOICE_MS = 700;
const HOLD_HINT = 'Hold to record, release to send';

type ComposerProps = {
  editing: boolean;
  recordMs: number;
  onSubmit: (text: string) => void;
  onTyping: (isTyping: boolean) => void;
  onPickImage: () => void;
  /** Resolves true once the recorder is running (false: permission prompt
   *  shown / mic unavailable). */
  onRecordStart: () => Promise<boolean>;
  onRecordFinish: (action: RecordAction, viewOnce: boolean) => void;
};

const Composer = memo(
  forwardRef<ComposerHandle, ComposerProps>(function Composer(
    {
      editing,
      recordMs,
      onSubmit,
      onTyping,
      onPickImage,
      onRecordStart,
      onRecordFinish,
    },
    ref,
  ) {
    const scheme = useColorScheme() ?? 'light';
    const c = Colors[scheme];
    const [text, setText] = useState('');
    const [mode, setMode] = useState<RecordMode>('idle');
    const [viewOnce, setViewOnce] = useState(false);
    const [hint, setHint] = useState<string | null>(null);
    const inputRef = useRef<TextInput>(null);
    const typing = useRef<{
      active: boolean;
      lastSentAt: number;
      idle: ReturnType<typeof setTimeout> | null;
    }>({ active: false, lastSentAt: 0, idle: null });

    // Gesture bookkeeping lives in refs: the PanResponder is created once.
    const modeRef = useRef<RecordMode>('idle');
    const gestureRef = useRef({ released: true, startedAt: 0 });
    const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handlersRef = useRef({
      start: onRecordStart,
      finish: (_a: RecordAction, _v: boolean) => {},
      hint: (_m: string) => {},
      lock: () => {},
    });
    const dragX = useSharedValue(0);
    const dragY = useSharedValue(0);
    const holding = useSharedValue(0);

    useImperativeHandle(
      ref,
      () => ({
        setText: (t: string) => setText(t),
        focus: () => {
          setTimeout(() => inputRef.current?.focus(), 50);
        },
      }),
      [],
    );

    const stopTyping = useCallback(() => {
      const t = typing.current;
      if (t.idle) clearTimeout(t.idle);
      t.idle = null;
      if (t.active) {
        t.active = false;
        onTyping(false);
      }
    }, [onTyping]);

    // Clear our "typing…" on the partner's screen when leaving the chat.
    useEffect(() => stopTyping, [stopTyping]);

    const setRecordMode = useCallback(
      (next: RecordMode) => {
        modeRef.current = next;
        setMode(next);
        holding.value = withTiming(next === 'hold' ? 1 : 0, { duration: 150 });
        if (next !== 'hold') {
          dragX.value = withTiming(0, { duration: 150 });
          dragY.value = withTiming(0, { duration: 150 });
        }
      },
      [dragX, dragY, holding],
    );

    const showHint = useCallback((message: string) => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      setHint(message);
      hintTimer.current = setTimeout(() => setHint(null), 1800);
    }, []);

    const finish = useCallback(
      (action: RecordAction, once: boolean) => {
        if (modeRef.current === 'idle') return;
        const tooShort = Date.now() - gestureRef.current.startedAt < MIN_VOICE_MS;
        setRecordMode('idle');
        setViewOnce(false);
        if (action === 'send' && tooShort) {
          onRecordFinish('cancel', false);
          showHint(HOLD_HINT);
          return;
        }
        Haptics.impactAsync(
          action === 'send'
            ? Haptics.ImpactFeedbackStyle.Light
            : Haptics.ImpactFeedbackStyle.Medium,
        );
        onRecordFinish(action, once);
      },
      [onRecordFinish, setRecordMode, showHint],
    );

    useEffect(() => {
      handlersRef.current = {
        start: onRecordStart,
        finish,
        hint: showHint,
        lock: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          setRecordMode('locked');
        },
      };
    }, [onRecordStart, finish, showHint, setRecordMode]);

    useEffect(
      () => () => {
        if (hintTimer.current) clearTimeout(hintTimer.current);
        // Leaving the chat mid-recording discards it.
        if (modeRef.current !== 'idle') handlersRef.current.finish('cancel', false);
      },
      [],
    );

    const [micPan] = useState(() =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const g = gestureRef.current;
          g.released = false;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          void handlersRef.current.start().then((ok) => {
            if (!ok) return;
            g.startedAt = Date.now();
            modeRef.current = 'hold';
            if (g.released) {
              // Finger lifted before the recorder came up: it was a tap.
              handlersRef.current.finish('send', false);
              return;
            }
            setMode('hold');
            holding.value = withTiming(1, { duration: 150 });
          });
        },
        onPanResponderMove: (_e, gs) => {
          if (modeRef.current !== 'hold') return;
          dragX.value = Math.min(0, gs.dx);
          dragY.value = Math.min(0, gs.dy);
          if (gs.dx < -CANCEL_DRAG_PX) {
            handlersRef.current.finish('cancel', false);
          } else if (gs.dy < -LOCK_DRAG_PX) {
            handlersRef.current.lock();
          }
        },
        onPanResponderRelease: () => {
          gestureRef.current.released = true;
          if (modeRef.current === 'hold') handlersRef.current.finish('send', false);
        },
        onPanResponderTerminate: () => {
          gestureRef.current.released = true;
          if (modeRef.current === 'hold') handlersRef.current.finish('cancel', false);
        },
      }),
    );

    const micStyle = useAnimatedStyle(() => ({
      transform: [
        { translateX: dragX.value * 0.6 },
        { translateY: dragY.value * 0.6 },
        { scale: 1 + holding.value * 0.35 },
      ],
    }));
    const slideStyle = useAnimatedStyle(() => ({
      opacity: interpolate(dragX.value, [-CANCEL_DRAG_PX, 0], [0.15, 1], Extrapolation.CLAMP),
      transform: [{ translateX: dragX.value * 0.5 }],
    }));
    const lockStyle = useAnimatedStyle(() => ({
      opacity: holding.value,
      transform: [
        { translateY: -56 + dragY.value * 0.4 },
        { scale: interpolate(dragY.value, [-LOCK_DRAG_PX, 0], [1.15, 1], Extrapolation.CLAMP) },
      ],
    }));

    const onChangeText = (value: string) => {
      setText(value);
      if (editing) return;
      if (!value.trim()) {
        stopTyping();
        return;
      }
      const t = typing.current;
      const now = Date.now();
      if (!t.active || now - t.lastSentAt > TYPING_THROTTLE_MS) {
        t.active = true;
        t.lastSentAt = now;
        onTyping(true);
      }
      if (t.idle) clearTimeout(t.idle);
      t.idle = setTimeout(stopTyping, TYPING_IDLE_MS);
    };

    const submit = () => {
      const value = text.trim();
      if (!value) return;
      stopTyping();
      onSubmit(value);
      setText('');
    };

    const hasText = text.trim().length > 0;

    if (mode === 'locked') {
      return (
        <View style={styles.composerRow}>
          <Pressable
            onPress={() => finish('cancel', false)}
            hitSlop={8}
            style={styles.composerIcon}
            accessibilityLabel="Delete recording"
          >
            <Ionicons name="trash-outline" size={24} color={c.danger} />
          </Pressable>
          <View
            style={[
              styles.recordingBar,
              { backgroundColor: c.surfaceAlt, borderColor: c.border },
            ]}
          >
            <RecDot color={c.danger} />
            <ThemedText style={[styles.recordingTimer, { color: c.text }]}>
              {formatDuration(recordMs)}
            </ThemedText>
            <ThemedText style={[styles.recordingHint, { color: c.textMuted }]}>
              Recording…
            </ThemedText>
          </View>
          <Pressable
            onPress={() => {
              Haptics.selectionAsync();
              setViewOnce((v) => !v);
            }}
            hitSlop={8}
            style={[
              styles.onceToggle,
              {
                borderColor: viewOnce ? c.tint : c.border,
                backgroundColor: viewOnce ? c.tint : 'transparent',
              },
            ]}
            accessibilityLabel="Listen once"
            accessibilityState={{ selected: viewOnce }}
          >
            <ThemedText
              style={[styles.onceToggleText, { color: viewOnce ? '#fff' : c.textMuted }]}
            >
              1
            </ThemedText>
          </Pressable>
          <Pressable
            onPress={() => finish('send', viewOnce)}
            hitSlop={8}
            style={[styles.sendButton, { backgroundColor: c.tint }]}
            accessibilityLabel="Send voice message"
          >
            <Ionicons name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      );
    }

    return (
      <View>
        {hint ? (
          <Animated.View
            entering={FadeIn.duration(120)}
            exiting={FadeOut.duration(200)}
            style={[styles.recordHintBubble, { backgroundColor: c.text }]}
          >
            <ThemedText style={[styles.recordHintText, { color: c.background }]}>
              {hint}
            </ThemedText>
          </Animated.View>
        ) : null}
        <View style={styles.composerRow}>
          {mode === 'hold' ? (
            <View key="rec" style={styles.holdBar}>
              <RecDot color={c.danger} />
              <ThemedText style={[styles.recordingTimer, { color: c.text }]}>
                {formatDuration(recordMs)}
              </ThemedText>
              <Animated.View style={[styles.slideCancel, slideStyle]}>
                <Ionicons name="chevron-back" size={16} color={c.textMuted} />
                <ThemedText style={[styles.recordingHint, { color: c.textMuted }]}>
                  Slide to cancel
                </ThemedText>
              </Animated.View>
            </View>
          ) : (
            <View key="input" style={styles.inputRow}>
              <Pressable onPress={onPickImage} hitSlop={8} style={styles.composerIcon}>
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
                  value={text}
                  onChangeText={onChangeText}
                  placeholder={editing ? 'Edit message…' : 'Message…'}
                  placeholderTextColor={c.textSubtle}
                  style={[styles.input, { color: c.text }]}
                  multiline
                  scrollEnabled
                  maxLength={4000}
                />
              </View>
            </View>
          )}

          {hasText || editing ? (
            <Pressable
              key="send"
              onPress={submit}
              hitSlop={8}
              style={[styles.sendButton, { backgroundColor: hasText ? c.tint : c.surfaceAlt }]}
            >
              <Ionicons
                name={editing ? 'checkmark' : 'send'}
                size={18}
                color={hasText ? '#fff' : c.textMuted}
              />
            </Pressable>
          ) : (
            <View
              key="mic"
              style={styles.micHit}
              accessibilityRole="button"
              accessibilityLabel="Hold to record a voice message"
              {...micPan.panHandlers}
            >
              {mode === 'hold' ? (
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.lockIndicator,
                    { backgroundColor: c.surface, borderColor: c.border },
                    lockStyle,
                  ]}
                >
                  <Ionicons name="lock-closed-outline" size={16} color={c.textMuted} />
                  <Ionicons name="chevron-up" size={14} color={c.textMuted} />
                </Animated.View>
              ) : null}
              <Animated.View
                style={[
                  styles.sendButton,
                  { backgroundColor: mode === 'hold' ? c.tint : c.surfaceAlt },
                  micStyle,
                ]}
              >
                <Ionicons name="mic" size={20} color={mode === 'hold' ? '#fff' : c.tint} />
              </Animated.View>
            </View>
          )}
        </View>
      </View>
    );
  }),
);

/** Pulsing red "recording" dot. */
function RecDot({ color }: { color: string }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(0.3, { duration: 500, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 500, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [pulse]);
  const style = useAnimatedStyle(() => ({ opacity: pulse.value }));
  return <Animated.View style={[styles.recordingDot, { backgroundColor: color }, style]} />;
}

// ===========================================================================
// MessageRow — memoised list cell (swipe wrapper + bubble).
// ===========================================================================

const MessageRow = memo(function MessageRow({
  message,
  prevAuthorId,
  isLastMine,
  animateIn,
  onceAudioUrl,
  quoted,
  actions,
}: {
  message: ChatMessage;
  prevAuthorId?: string;
  isLastMine: boolean;
  animateIn: boolean;
  onceAudioUrl?: string;
  quoted?: ChatMessage;
  actions: RowActions;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const pending = message.status === 'failed' || message.status === 'sending';
  return (
    <Animated.View entering={animateIn ? FadeInDown.duration(200) : undefined}>
      <SwipeableBubble
        isMe={message.authorId === 'me'}
        onReply={() => actions.reply(message)}
        accentColor={c.tint}
        mutedColor={c.textMuted}
        disabled={!!message.deletedAt || pending}
      >
        <MessageBubble
          message={message}
          prevAuthorId={prevAuthorId}
          isLastMine={isLastMine}
          quoted={quoted}
          onLongPress={() => actions.longPress(message)}
          onTapImage={actions.tapImage}
          onOpenViewOnce={() => actions.openViewOnce(message)}
          onceAudioUrl={onceAudioUrl}
          onOnceAudioEnd={actions.onceAudioEnded}
          onPressFailed={() => actions.pressFailed(message)}
        />
      </SwipeableBubble>
    </Animated.View>
  );
});

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
  /** Recipient taps a sealed view-once message. */
  onOpenViewOnce: () => void;
  /** One-time URL of a view-once voice note being played right now. */
  onceAudioUrl?: string;
  onOnceAudioEnd: () => void;
  /** Tap on a message whose send failed (Retry / Delete). */
  onPressFailed: () => void;
};

const MessageBubble = memo(function MessageBubble({
  message,
  prevAuthorId,
  isLastMine,
  quoted,
  onLongPress,
  onTapImage,
  onOpenViewOnce,
  onceAudioUrl,
  onOnceAudioEnd,
  onPressFailed,
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
  // Sender never keeps the media of a view-once message either.
  const isSenderSealed = isViewOnce && !isViewed && isMe;
  const showViewOnceLock = isViewOnce && isMe && !isDeleted;
  const viewOnceLockIcon = isViewed
    ? 'lock-open-outline'
    : 'lock-closed-outline';
  const hasReaction = !!message.reaction;
  const isFailed = message.status === 'failed';
  const isUploading =
    message.status === 'sending' && message.kind !== 'text';
  const showStatus = isMe && !isDeleted && (isLastMine || isFailed);

  const handlePress = () => {
    if (isFailed) {
      onPressFailed();
      return;
    }
    if (isDeleted || isDestroyed) return;
    if (isLocked) {
      // Server burns it and hands back a one-time URL.
      onOpenViewOnce();
      return;
    }
    if (isSenderSealed) return;
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
          message.kind === 'image' && !isDeleted && !isLocked && !isDestroyed && !isSenderSealed
            ? styles.imageBubble
            : styles.bubble,
          isMe ? styles.bubbleMe : styles.bubbleThem,
          (message.kind !== 'image' || isDeleted || isLocked || isDestroyed || isSenderSealed) && {
            backgroundColor: isDeleted
              ? c.surfaceAlt
              : isMe
                ? c.tint
                : c.surface,
            opacity: isFailed ? 0.6 : 1,
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
        ) : isDestroyed && onceAudioUrl ? (
          <AudioBubble
            uri={onceAudioUrl}
            seed={message.id}
            durationMs={message.audioDurationMs ?? 0}
            tint={c.tint}
            mutedTint={c.textMuted}
            barBg={c.borderStrong}
            onPlaybackEnd={onOnceAudioEnd}
          />
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
        ) : isSenderSealed ? (
          <ViewOnceLocked
            variant="sender"
            kind={message.kind === 'audio' ? 'audio' : 'image'}
            tint="#fff"
            mutedColor="rgba(255,255,255,0.75)"
            borderColor="rgba(255,255,255,0.5)"
          />
        ) : isLocked ? (
          /* Receiver-side locked tile — tap reveals the media one time. */
          <ViewOnceLocked
            variant="receiver"
            kind={message.kind === 'audio' ? 'audio' : 'image'}
            tint={c.tint}
            mutedColor={c.textMuted}
            borderColor={c.border}
          />
        ) : message.kind === 'image' && message.imageUri ? (
          <View>
            <ChatImage
              uri={message.imageUri}
              mediaKey={message.mediaKey}
              style={[styles.bubbleImage, (isUploading || isFailed) && styles.bubbleImagePending]}
            />
            {isUploading ? (
              <View style={styles.imageOverlay}>
                <ActivityIndicator color="#fff" />
              </View>
            ) : null}
          </View>
        ) : message.kind === 'audio' && message.audioUri ? (
          <AudioBubble
            uri={message.audioUri}
            mediaKey={message.mediaKey}
            seed={message.clientMsgId ?? message.id}
            durationMs={message.audioDurationMs ?? 0}
            tint={isMe ? '#fff' : c.tint}
            mutedTint={isMe ? 'rgba(255,255,255,0.7)' : c.textMuted}
            barBg={isMe ? 'rgba(255,255,255,0.25)' : c.borderStrong}
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
});

// ===========================================================================
// ViewOnceLocked — receiver-side "Tap to view" tile for view-once media.
// ===========================================================================

function ViewOnceLocked({
  variant,
  kind,
  tint,
  mutedColor,
  borderColor,
}: {
  variant: 'receiver' | 'sender';
  kind: 'image' | 'audio';
  tint: string;
  mutedColor: string;
  borderColor: string;
}) {
  const title =
    variant === 'sender'
      ? kind === 'audio'
        ? 'Voice message'
        : 'Photo'
      : `Tap to ${kind === 'audio' ? 'listen' : 'view'}`;
  const subtitle =
    variant === 'sender'
      ? `${kind === 'audio' ? 'Listen' : 'View'} once · Not opened yet`
      : kind === 'audio'
        ? 'Listen once'
        : 'View once';
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
          {title}
        </ThemedText>
        <ThemedText style={[styles.viewOnceLockedSub, { color: mutedColor }]}>
          {subtitle}
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
  mediaKey,
  seed,
  durationMs,
  tint,
  mutedTint,
  barBg,
  onPlaybackEnd,
}: {
  uri: string;
  /** R2 key — used to mint a fresh URL when the presigned one expired. */
  mediaKey?: string;
  /** Stable per-message seed for the decorative waveform. */
  seed: string;
  durationMs: number;
  tint: string;
  mutedTint: string;
  barBg: string;
  /** Fired once playback reaches the end. Used by view-once to burn the
   *  clip after the recipient hears it. */
  onPlaybackEnd?: () => void;
}) {
  const [freshUri, setFreshUri] = useState<string | null>(null);
  const playUri = freshUri ?? uri;
  const st = useVoicePlayback(playUri);
  const [barsWidth, setBarsWidth] = useState(0);

  useEffect(() => {
    if (!onPlaybackEnd) return;
    return voicePlayer.onFinish((finished) => {
      if (finished === playUri) onPlaybackEnd();
    });
  }, [playUri, onPlaybackEnd]);

  const toggle = async () => {
    Haptics.selectionAsync();
    try {
      await voicePlayer.toggle(playUri);
    } catch {
      // Presigned URLs expire after an hour — mint a new one and retry.
      if (mediaKey && !isLocalMediaUri(playUri)) {
        try {
          const next = await refreshMediaViewUrl(mediaKey);
          setFreshUri(next);
          await voicePlayer.toggle(next);
          return;
        } catch {
          /* fall through to the alert */
        }
      }
      Alert.alert('Could not play', 'This voice message is unavailable right now.');
    }
  };

  const totalMs = st.durationMs > 0 ? st.durationMs : durationMs;
  const playedFraction =
    st.active && totalMs > 0 ? Math.min(1, st.positionMs / totalMs) : 0;
  const bars = useMemo(() => waveform(seed, 28), [seed]);

  const seekTo = (x: number) => {
    if (!st.active || barsWidth <= 0 || totalMs <= 0) return;
    const fraction = Math.max(0, Math.min(1, x / barsWidth));
    void voicePlayer.seek(playUri, fraction * totalMs);
  };

  return (
    <View style={styles.audioRow}>
      <Pressable onPress={toggle} hitSlop={8} style={styles.audioPlayButton}>
        {st.loading ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Ionicons name={st.playing ? 'pause' : 'play'} size={22} color={tint} />
        )}
      </Pressable>
      <Pressable
        style={styles.audioBars}
        onLayout={(e) => setBarsWidth(e.nativeEvent.layout.width)}
        onPress={(e) => seekTo(e.nativeEvent.locationX)}
      >
        {bars.map((h, i) => {
          const filled = (i + 0.5) / bars.length <= playedFraction;
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
      </Pressable>
      <ThemedText style={[styles.audioDuration, { color: mutedTint }]}>
        {formatDuration(st.active && st.positionMs > 0 ? st.positionMs : totalMs)}
      </ThemedText>
    </View>
  );
}

/** Chat photo that re-signs its URL once if the presigned link expired. */
function ChatImage({
  uri,
  mediaKey,
  style,
}: {
  uri: string;
  mediaKey?: string;
  style: React.ComponentProps<typeof Image>['style'];
}) {
  const [fresh, setFresh] = useState<string | null>(null);
  const [retried, setRetried] = useState(false);
  const onError = () => {
    if (retried || !mediaKey || isLocalMediaUri(uri)) return;
    setRetried(true);
    void refreshMediaViewUrl(mediaKey)
      .then((next) => setFresh(next))
      .catch(() => {});
  };
  return (
    <Image
      source={{ uri: fresh ?? uri }}
      style={style}
      contentFit="cover"
      onError={onError}
    />
  );
}

/** Deterministic pseudo-waveform so every note looks distinct but stable. */
function waveform(seed: string, count: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    const r = ((h >>> 0) % 1000) / 1000;
    out.push(5 + Math.round(r * 17));
  }
  return out;
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
    case 'failed':
      label = 'Not sent · Tap to retry or delete';
      icon = 'alert-circle';
      color = '#EF4444';
      break;
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
  headerAvatarImage: { width: 36, height: 36, borderRadius: 18 },
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
  listPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyThread: {
    textAlign: 'center',
    fontSize: 14,
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
  bubbleImagePending: { opacity: 0.7 },
  imageOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
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
  audioPlayButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioBars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
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

  // ── Blocked state (replaces composer) ─────────────────────────────
  blockedBar: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  blockedText: { fontSize: 13, textAlign: 'center' },
  unblockButton: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  unblockText: { fontSize: 14, fontWeight: '600' },

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

  // ── Hold-to-record ──────────────────────────────────────────────────
  inputRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.sm,
  },
  holdBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 42,
    paddingHorizontal: Spacing.sm,
  },
  slideCancel: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  micHit: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockIndicator: {
    position: 'absolute',
    width: 34,
    paddingVertical: 6,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: 2,
  },
  onceToggle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  onceToggleText: { fontSize: 13, fontWeight: '800' },
  recordHintBubble: {
    alignSelf: 'flex-end',
    marginBottom: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderRadius: Radii.pill,
  },
  recordHintText: { fontSize: 12, fontWeight: '600' },

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
