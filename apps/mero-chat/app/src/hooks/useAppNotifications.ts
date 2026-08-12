import { useCallback } from "react";
import { useNotifications } from "@calimero-network/mero-ui";
import { useNotificationSound } from "./useNotificationSound";
import type { NotificationType } from "../utils/notificationSound";
import { useToast } from "../contexts/ToastContext";
import { notificationPreview } from "../utils/plainText";

export interface AppNotification {
  title: string;
  message: string;
  type?: NotificationType;
  duration?: number;
  playSound?: boolean;
}

/**
 * Custom hook that integrates sound notifications with toast notifications
 * Combines the existing sound system with Mero UI's toast system
 */
export function useAppNotifications(currentChatId?: string) {
  const { addNotification } = useNotifications();
  const { addToast } = useToast();
  const {
    playSoundForMessage,
    playSound,
    isEnabled: soundEnabled,
  } = useNotificationSound(
    {
      enabled: true,
      volume: 0.5,
      respectFocus: true,
      respectMute: true,
    },
    currentChatId,
  );

  /**
   * Show a notification with optional sound
   */
  const notify = useCallback(
    (notification: AppNotification) => {
      const {
        title,
        message,
        type = "message",
        duration = 5000,
        playSound: shouldPlaySound = true,
      } = notification;


      // Determine variant based on notification type
      const notificationVariant = type === "mention" ? "warning" : "info";
      const priority =
        type === "mention" ? "high" : type === "dm" ? "medium" : "low";

      // Show custom toast notification (temporary)
      addToast({
        title,
        message,
        type: type === "mention" ? "mention" : type === "dm" ? "dm" : "channel",
        duration,
      });

      // Add to notification center (persistent)
      addNotification({
        title,
        description: message,
        variant: notificationVariant,
        priority,
        status: "unread",
        category: type === "dm" ? "user" : "system",
      });

      // Native OS banner. In the desktop launcher the shell polyfill routes
      // window.Notification -> NSUserNotification (per-app dock identity). In a
      // plain browser without notification permission this is a silent no-op;
      // try/catch guards the constructor throw when permission is "denied".
      //
      // Only banner when it's worth interrupting: the app doesn't have focus
      // (user isn't already looking at it), OR it's a mention/DM (always worth a
      // banner). When focused on a regular message the in-app toast is enough —
      // banner-ing what you're already reading is just noise.
      // Native OS banner (delivered by the host over the shell→host socket).
      // Only interrupt when the app isn't focused, or it's a mention/DM — the
      // in-app toast covers the focused case.
      const hasFocus =
        typeof document !== "undefined" &&
        typeof document.hasFocus === "function" &&
        document.hasFocus();
      const isDirected = type === "mention" || type === "dm";
      if (!hasFocus || isDirected) {
        try {
          new Notification(title, { body: message });
        } catch {
          /* no notification support / permission — ignore */
        }
      }

      // Play sound if enabled
      if (shouldPlaySound && soundEnabled) {
        playSound(type);
      }
    },
    [addToast, addNotification, playSound, soundEnabled],
  );

  /**
   * Notify for a new message
   */
  const notifyMessage = useCallback(
    (
      messageId: string,
      sender: string,
      text: string,
      isMention: boolean = false,
    ) => {
      const type: NotificationType = isMention ? "mention" : "message";
      const title = isMention
        ? `${sender} mentioned you`
        : `New message from ${sender}`;

      // Flatten the rich-editor HTML first: OS banners render the body
      // verbatim, so raw markup shows tags, and truncating first cuts mid-tag.
      const truncatedText = notificationPreview(text);

      notify({
        title,
        message: truncatedText,
        type,
      });

      // Also play sound using the existing system
      playSoundForMessage(messageId, type, isMention);
    },
    [notify, playSoundForMessage],
  );

  /**
   * Notify for a new DM
   */
  const notifyDM = useCallback(
    (messageId: string, sender: string, text: string) => {
      const truncatedText = notificationPreview(text);

      notify({
        title: `New DM from ${sender}`,
        message: truncatedText,
        type: "dm",
      });

      playSoundForMessage(messageId, "dm", false);
    },
    [notify, playSoundForMessage],
  );

  /**
   * Notify for a new channel message
   */
  const notifyChannel = useCallback(
    (messageId: string, channelName: string, sender: string, text: string) => {
      const truncatedText = notificationPreview(text);

      notify({
        title: `${sender} in #${channelName}`,
        message: truncatedText,
        type: "channel",
      });

      playSoundForMessage(messageId, "channel", false);
    },
    [notify, playSoundForMessage],
  );

  /**
   * Notify for a new thread reply in a background channel
   */
  const notifyThread = useCallback(
    (messageId: string, channelName: string, sender: string, text: string) => {
      const truncatedText = notificationPreview(text);

      notify({
        title: `New reply from ${sender} in #${channelName}`,
        message: truncatedText,
        type: "message",
      });

      playSoundForMessage(messageId, "message", false);
    },
    [notify, playSoundForMessage],
  );

  return {
    notify,
    notifyMessage,
    notifyDM,
    notifyChannel,
    notifyThread,
    playSoundForMessage,
    playSound,
  };
}
