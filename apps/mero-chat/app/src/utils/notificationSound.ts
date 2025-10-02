/**
 * Notification sound utility using Web Audio API
 * Provides different sound patterns for various notification types
 */

export type NotificationType = 'message' | 'mention' | 'dm' | 'channel';

export interface NotificationSoundConfig {
  enabled: boolean;
  volume: number;
  type: NotificationType;
}

class NotificationSoundManager {
  private audioContext: AudioContext | null = null;
  private isEnabled: boolean = true;
  private volume: number = 0.5;

  constructor() {
    this.initializeAudioContext();
  }

  private initializeAudioContext() {
    if (typeof window !== 'undefined' && !this.audioContext) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (error) {
        console.warn('Web Audio API not supported:', error);
      }
    }
  }

  private ensureAudioContext() {
    if (!this.audioContext || this.audioContext.state === 'closed') {
      this.initializeAudioContext();
    }
    
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  initializeOnUserInteraction() {
    if (!this.audioContext) {
      this.initializeAudioContext();
    }
    if (this.audioContext?.state === 'suspended') {
      this.audioContext.resume();
    }
  }

  setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
  }

  private createTone(frequency: number, duration: number, startTime: number = 0): OscillatorNode | null {
    if (!this.audioContext || !this.isEnabled) return null;

    const oscillator = this.audioContext.createOscillator();
    const gainNode = this.audioContext.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(this.audioContext.destination);

    oscillator.frequency.setValueAtTime(frequency, this.audioContext.currentTime + startTime);
    oscillator.type = 'sine';

    gainNode.gain.setValueAtTime(0, this.audioContext.currentTime + startTime);
    gainNode.gain.linearRampToValueAtTime(this.volume * 0.3, this.audioContext.currentTime + startTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioContext.currentTime + startTime + duration);

    oscillator.start(this.audioContext.currentTime + startTime);
    oscillator.stop(this.audioContext.currentTime + startTime + duration);

    return oscillator;
  }

  private playMessageSound() {
    this.ensureAudioContext();
    
    this.createTone(800, 0.1, 0);
    this.createTone(1000, 0.1, 0.1);
  }

  private playMentionSound() {
    this.ensureAudioContext();
    
    this.createTone(1000, 0.1, 0);
    this.createTone(1200, 0.1, 0.15);
    this.createTone(1400, 0.1, 0.3);
  }

  private playDMSound() {
    this.ensureAudioContext();
    
    this.createTone(600, 0.15, 0);
    this.createTone(800, 0.15, 0.2);
  }

  private playChannelSound() {
    this.ensureAudioContext();
    
    this.createTone(700, 0.2, 0);
  }

  playNotification(type: NotificationType = 'message') {
    if (!this.isEnabled) return;

    this.ensureAudioContext();

    switch (type) {
      case 'message':
        this.playMessageSound();
        break;
      case 'mention':
        this.playMentionSound();
        break;
      case 'dm':
        this.playDMSound();
        break;
      case 'channel':
        this.playChannelSound();
        break;
      default:
        this.playMessageSound();
    }
  }

  async playCustomSound(soundUrl: string) {
    if (!this.isEnabled) return;

    this.ensureAudioContext();
    
    try {
      const response = await fetch(soundUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext!.decodeAudioData(arrayBuffer);
      
      const source = this.audioContext!.createBufferSource();
      const gainNode = this.audioContext!.createGain();
      
      source.buffer = audioBuffer;
      source.connect(gainNode);
      gainNode.connect(this.audioContext!.destination);
      
      gainNode.gain.setValueAtTime(this.volume, this.audioContext!.currentTime);
      
      source.start();
    } catch (error) {
      console.warn('Failed to play custom sound:', error);
      this.playNotification('message');
    }
  }
}

export const notificationSound = new NotificationSoundManager();

export const playNotificationSound = (type: NotificationType = 'message') => {
  notificationSound.playNotification(type);
};

export const setNotificationEnabled = (enabled: boolean) => {
  notificationSound.setEnabled(enabled);
};

export const setNotificationVolume = (volume: number) => {
  notificationSound.setVolume(volume);
};
