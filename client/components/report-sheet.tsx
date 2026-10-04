/**
 * Report flow: pick a reason → confirm (Report / Report & block) → saved
 * on the server for moderation. Blocking happens server-side in the same
 * call; the chat list updates via the `block.updated` socket event.
 */

import { Alert } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/components/action-sheet';
import { createReport, type ReportReason } from '@/lib/api/chats-api';
import * as Haptics from '@/lib/native/haptics';

const REASONS: { id: ReportReason; label: string; icon: ActionSheetItem['icon'] }[] = [
  { id: 'spam', label: 'Spam or scam', icon: 'mail-unread-outline' },
  { id: 'harassment', label: 'Harassment or bullying', icon: 'hand-left-outline' },
  { id: 'inappropriate', label: 'Inappropriate content', icon: 'eye-off-outline' },
  { id: 'fake_profile', label: 'Fake profile', icon: 'person-remove-outline' },
  { id: 'underage', label: 'May be under 18', icon: 'alert-circle-outline' },
  { id: 'other', label: 'Something else', icon: 'ellipsis-horizontal-circle-outline' },
];

type Props = {
  visible: boolean;
  userId: string;
  userName: string;
  chatId?: string;
  onClose: () => void;
  /** Called after a successful report; `blocked` if they chose to block too. */
  onReported?: (blocked: boolean) => void;
};

export function ReportSheet({ visible, userId, userName, chatId, onClose, onReported }: Props) {
  const submit = async (reason: ReportReason, alsoBlock: boolean) => {
    try {
      await createReport({ userId, chatId, reason, alsoBlock });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onReported?.(alsoBlock);
      Alert.alert(
        'Thanks for reporting',
        alsoBlock
          ? `We'll review it. ${userName} is blocked and won't be told.`
          : "We'll review it. They won't know who reported them.",
      );
    } catch {
      Alert.alert('Could not send report', 'Check your connection and try again.');
    }
  };

  const items: ActionSheetItem[] = REASONS.map((r) => ({
    id: r.id,
    icon: r.icon,
    label: r.label,
    onPress: () => {
      onClose();
      Alert.alert(`Report ${userName}?`, 'Our team reviews every report.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Report', onPress: () => void submit(r.id, false) },
        {
          text: 'Report & block',
          style: 'destructive',
          onPress: () => void submit(r.id, true),
        },
      ]);
    },
  }));

  return (
    <ActionSheet
      visible={visible}
      title={`Why are you reporting ${userName}?`}
      items={items}
      onClose={onClose}
    />
  );
}
