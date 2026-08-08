/**
 * Chat-level action sheet — Pin / Unpin / Delete / Block / Report.
 *
 * Used by:
 *   - Chats tab (long-press on a row)
 *   - Chat thread (three-dots in the header)
 *
 * Talks to `useChats()` directly so the host just has to render
 * <ChatActionMenu chatId={...} visible={...} onClose={...}/>.
 */

import { useRouter } from '@/lib/router';
import { Alert } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/action-sheet';
import { useChats } from '@/lib/chats-context';

type Props = {
  chatId: string | null;
  visible: boolean;
  onClose: () => void;
  /** When true (i.e. invoked from inside the chat thread), the Delete
   *  action also pops the navigation stack. */
  popOnDelete?: boolean;
};

export function ChatActionMenu({ chatId, visible, onClose, popOnDelete }: Props) {
  const router = useRouter();
  const {
    getChat,
    pinChat,
    unpinChat,
    deleteChat,
    blockChat,
    unblockChat,
  } = useChats();

  const chat = chatId ? getChat(chatId) : undefined;
  if (!chat) {
    return (
      <ActionSheet visible={visible} items={[]} onClose={onClose} />
    );
  }

  const isPinned = !!chat.pinnedAt;
  const isBlocked = !!chat.isBlocked;

  const confirmAndRun = (
    title: string,
    body: string,
    destructive: boolean,
    run: () => void,
  ) => {
    Alert.alert(title, body, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Confirm',
        style: destructive ? 'destructive' : 'default',
        onPress: () => {
          run();
          onClose();
        },
      },
    ]);
  };

  const items: ActionSheetItem[] = [
    {
      id: 'pin',
      icon: isPinned ? 'pin' : 'pin-outline',
      label: isPinned ? 'Unpin chat' : 'Pin chat',
      onPress: () => {
        if (isPinned) unpinChat(chat.id);
        else pinChat(chat.id);
        onClose();
      },
    },
    {
      id: 'block',
      icon: isBlocked ? 'lock-open-outline' : 'ban-outline',
      label: isBlocked ? `Unblock ${chat.partner.name}` : `Block ${chat.partner.name}`,
      destructive: !isBlocked,
      onPress: () => {
        if (isBlocked) {
          unblockChat(chat.id);
          onClose();
        } else {
          confirmAndRun(
            `Block ${chat.partner.name}?`,
            "They won't be able to send you new planes or messages.",
            true,
            () => blockChat(chat.id),
          );
        }
      },
    },
    {
      id: 'report',
      icon: 'flag-outline',
      label: 'Report',
      onPress: () => {
        confirmAndRun(
          'Report this chat?',
          "Our team will review and take action if needed. You'll be kept anonymous.",
          false,
          () => {
            // TODO: send report event when backend is wired up.
          },
        );
      },
    },
    {
      id: 'delete',
      icon: 'trash-outline',
      label: 'Delete chat',
      destructive: true,
      onPress: () => {
        confirmAndRun(
          'Delete this chat?',
          "You'll lose the entire conversation. This can't be undone.",
          true,
          () => {
            deleteChat(chat.id);
            if (popOnDelete) router.back();
          },
        );
      },
    },
  ];

  return <ActionSheet visible={visible} items={items} onClose={onClose} />;
}
