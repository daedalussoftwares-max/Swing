/**
 * Audio shim (replaces expo-audio).
 */
import { useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

export const RecordingPresets = { HIGH_QUALITY: {} };

type PlayerStatus = {
  playing: boolean;
  currentTime: number;
  duration: number;
  didJustFinish: boolean;
};

type AudioPlayer = {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seekTo: (seconds: number) => Promise<void>;
  getStatus: () => PlayerStatus;
};

const defaultStatus: PlayerStatus = {
  playing: false,
  currentTime: 0,
  duration: 0,
  didJustFinish: false,
};

export async function setAudioModeAsync(_options: {
  allowsRecording?: boolean;
  playsInSilentMode?: boolean;
}): Promise<void> {
  // expo-audio toggled AVAudioSession on iOS; native recording lib handles session setup.
}

export const AudioModule = {
  async requestRecordingPermissionsAsync(): Promise<{ granted: boolean }> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      return { granted: granted === PermissionsAndroid.RESULTS.GRANTED };
    }
    return { granted: true };
  },
};

export function useAudioRecorder(_preset: unknown) {
  const uriRef = useRef<string | null>(null);

  return {
    async prepareToRecordAsync() {},
    async record() {
      await AudioRecorderPlayer.startRecorder();
    },
    async stop() {
      const uri = await AudioRecorderPlayer.stopRecorder();
      uriRef.current = uri;
      return { uri };
    },
    get uri() {
      return uriRef.current;
    },
  };
}

export function useAudioPlayer(source: { uri: string }): AudioPlayer {
  const statusRef = useRef<PlayerStatus>(defaultStatus);

  useEffect(() => {
    AudioRecorderPlayer.addPlayBackListener((e) => {
      statusRef.current = {
        playing: e.currentPosition < e.duration,
        currentTime: e.currentPosition / 1000,
        duration: e.duration / 1000,
        didJustFinish: e.currentPosition >= e.duration - 50 && e.duration > 0,
      };
    });
    return () => {
      AudioRecorderPlayer.removePlayBackListener();
    };
  }, []);

  return {
    async play() {
      await AudioRecorderPlayer.startPlayer(source.uri);
      statusRef.current = { ...statusRef.current, playing: true };
    },
    async pause() {
      await AudioRecorderPlayer.pausePlayer();
      statusRef.current = { ...statusRef.current, playing: false };
    },
    async seekTo(seconds: number) {
      await AudioRecorderPlayer.seekToPlayer(seconds * 1000);
    },
    getStatus: () => statusRef.current,
  };
}

export function useAudioPlayerStatus(player: AudioPlayer): PlayerStatus {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 200);
    return () => clearInterval(id);
  }, []);
  return player.getStatus();
}
