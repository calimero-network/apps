import { useCallback, useEffect, useRef, useState } from 'react';
import { 
  playNotificationSound, 
  setNotificationEnabled, 
  setNotificationVolume,
  type NotificationType 
} from '../utils/notificationSound';

interface UseNotificationSoundOptions {
  enabled?: boolean;
  volume?: number;
  respectFocus?: boolean;
  respectMute?: boolean;
}

interface UseNotificationSoundReturn {
  playSound: (type?: NotificationType) => void;
  playSoundForMessage: (messageId: string, type?: NotificationType, isMention?: boolean) => void;
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  isEnabled: boolean;
  volume: number;
}

const STORAGE_KEY = 'curb-notification-settings';

const defaultSettings = {
  enabled: false,
  volume: 0.5,
  respectFocus: true,
  respectMute: true,
};

export const useNotificationSound = (
  options: UseNotificationSoundOptions = {},
  currentChatId?: string
): UseNotificationSoundReturn => {
  const [isEnabled, setIsEnabled] = useState(defaultSettings.enabled);
  const [volume, setVolumeState] = useState(defaultSettings.volume);
  const [isCurrentChat, setIsCurrentChat] = useState(false);
  
  const settings = { ...defaultSettings, ...options };
  const lastMessageRef = useRef<string>('');

  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setIsEnabled(parsed.enabled ?? defaultSettings.enabled);
        setVolumeState(parsed.volume ?? defaultSettings.volume);
      }
    } catch (error) {
      console.warn('Failed to load notification settings:', error);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        enabled: isEnabled,
        volume: volume,
      }));
    } catch (error) {
      console.warn('Failed to save notification settings:', error);
    }
  }, [isEnabled, volume]);

  useEffect(() => {
    setNotificationEnabled(isEnabled);
    setNotificationVolume(volume);
  }, [isEnabled, volume]);


  useEffect(() => {
    setIsCurrentChat(!!currentChatId);
  }, [currentChatId]);

  const playSound = useCallback((type: NotificationType = 'message') => {
    if (!isEnabled) return;

    if (settings.respectMute && isCurrentChat) return;

    playNotificationSound(type);
  }, [isEnabled, settings.respectMute, isCurrentChat]);

  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
  }, []);

  const setVolume = useCallback((newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clampedVolume);
  }, []);

  const playSoundForMessage = useCallback((
    messageId: string, 
    type: NotificationType = 'message',
    isMention: boolean = false
  ) => {
    // Prevent duplicate sounds for the same message
    if (lastMessageRef.current === messageId) return;
    
    lastMessageRef.current = messageId;
    
    playSound(isMention ? 'mention' : type);
    
    setTimeout(() => {
      lastMessageRef.current = '';
    }, 2000);
  }, [playSound]);

  return {
    playSound,
    playSoundForMessage,
    setEnabled,
    setVolume,
    isEnabled,
    volume,
  };
};

export default useNotificationSound;
