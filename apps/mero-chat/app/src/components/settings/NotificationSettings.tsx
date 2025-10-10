import React, { useState, useEffect } from 'react';
import styled from 'styled-components';
import useNotificationSound from '../../hooks/useNotificationSound';
import { Button } from '@calimero-network/mero-ui';

const SettingsContainer = styled.div`
  background-color: #0e0e10;
  border-radius: 0.375rem;
  overflow: hidden;
`;

const SettingsItem = styled.div<{ $borderbottom?: boolean; $roundedTop?: boolean; $roundedBottom?: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem;
  background-color: #0e0e10;
  ${({ $borderbottom }) => $borderbottom && "border-bottom: 1px solid #282933;"}
  ${({ $roundedTop }) =>
    $roundedTop &&
    "border-top-left-radius: 0.375rem; border-top-right-radius: 0.375rem;"}
  ${({ $roundedBottom }) =>
    $roundedBottom &&
    "border-bottom-left-radius: 0.375rem; border-bottom-right-radius: 0.375rem;"}
`;

const Text = styled.h6`
  color: #FFF;
  font-family: Helvetica Neue;
  font-size: 14px;
  font-style: normal;
  font-weight: 400;
  line-height: 150%;
  margin: 0;
  padding: 0;
`;

const ToggleButton = styled.button<{ $active: boolean }>`
  width: 44px;
  height: 24px;
  border-radius: 12px;
  border: none;
  background-color: ${({ $active }) => ($active ? '#73B30C' : '#686672')};
  position: relative;
  cursor: pointer;
  transition: background-color 0.2s ease;

  &::after {
    content: '';
    position: absolute;
    top: 2px;
    left: ${({ $active }) => ($active ? '22px' : '2px')};
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background-color: white;
    transition: left 0.2s ease;
  }
`;

const VolumeSlider = styled.input`
  width: 100px;
  height: 4px;
  border-radius: 2px;
  background: #282933;
  outline: none;
  -webkit-appearance: none;

  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #73B30C;
    cursor: pointer;
  }

  &::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #73B30C;
    cursor: pointer;
    border: none;
  }
`;

const VolumeContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const NotificationSettings: React.FC = () => {
  const { isEnabled, volume, setEnabled, setVolume, playSound } = useNotificationSound();
  const [localVolume, setLocalVolume] = useState(volume);

  useEffect(() => {
    setLocalVolume(volume);
  }, [volume]);

  const handleVolumeChange = (newVolume: number) => {
    setLocalVolume(newVolume);
    setVolume(newVolume);
  };

  const handleTestSound = () => {
    // Initialize audio context on user interaction
    if (typeof window !== 'undefined' && window.AudioContext) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
    }
    playSound('message');
  };

  return (
    <SettingsContainer>
      <SettingsItem $borderbottom $roundedTop>
        <Text>Enable notification sounds</Text>
        <ToggleButton
          $active={isEnabled}
          onClick={() => setEnabled(!isEnabled)}
        />
      </SettingsItem>
      
      <SettingsItem $borderbottom>
        <Text>Volume</Text>
        <VolumeContainer>
          <VolumeSlider
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={localVolume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            disabled={!isEnabled}
          />
          <Text style={{ minWidth: '30px', textAlign: 'right' }}>
            {Math.round(localVolume * 100)}%
          </Text>
        </VolumeContainer>
      </SettingsItem>

      <SettingsItem $borderbottom>
        <Text>Test sound</Text>
        <Button
          onClick={handleTestSound}
          disabled={!isEnabled}
        >
          Play
        </Button>
      </SettingsItem>
    </SettingsContainer>
  );
};

export default NotificationSettings;
