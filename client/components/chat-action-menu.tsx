/**
 * Chat-level action sheet — Pin / Unpin / Delete / Block / Report.
 *
 * Used by:
 *   - Chats tab (long-press on a row)
 *   - Chat thread (three-dots in the header)
 *
 * Talks to the chats store directly so the host just has to render
 * <ChatActionMenu chatId={...} visible={...} onClose={...}/>.
 */

import { useRouter } from '@/lib/router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/action-sheet';
import { ReportSheet } from '@/components/report-sheet';
import { useChat, useChatsActions } from '@/lib/chats-context';

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
  const { pinChat, unpinChat, deleteChat, blockChat, unblockChat } =
    useChatsActions();

  const [reporting, setReporting] = useState(false);
  const chat = useChat(chatId);
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
            "You won't receive their messages or planes, and they won't see when you're online. They won't be notified.",
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
        onClose();
        setReporting(true);
      },
    },
    {
      id: 'delete',
      icon: 'trash-outline',
      label: 'Delete chat for both',
      destructive: true,
      onPress: () => {
        confirmAndRun(
          'Delete chat for both?',
          `All messages will be deleted for you and ${chat.partner.name}, and you'll no longer be connected. This can't be undone.`,
          true,
          () => {
            deleteChat(chat.id);
            if (popOnDelete) router.back();
          },
        );
      },
    },
  ];

  return (
    <>
      <ActionSheet visible={visible} items={items} onClose={onClose} />
      <ReportSheet
        visible={reporting}
        userId={chat.partner.id}
        userName={chat.partner.name}
        chatId={chat.id}
        onClose={() => setReporting(false)}
      />
    </>
  );
}
