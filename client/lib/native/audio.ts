/**
 * Voice-note recording + playback on top of react-native-nitro-sound.
 *
 * nitro-sound exposes ONE native player with ONE progress listener, so
 * playback is modelled as a single shared "voice player": only one note
 * plays at a time, starting another stops the previous one, and each
 * bubble subscribes to it and re-renders only while it is the active one
 * (no per-bubble polling timers).
 */
import { useEffect, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import Sound from 'react-native-nitro-sound';

export const RecordingPresets = { HIGH_QUALITY: {} };

export async function setAudioModeAsync(_options: {
  allowsRecording?: boolean;
  playsInSilentMode?: boolean;
}): Promise<void> {
  // nitro-sound configures the audio session itself.
}

export const AudioModule = {
  /** Current mic permission without prompting. */
  async getRecordingPermissionsAsync(): Promise<{ granted: boolean }> {
    if (Platform.OS === 'android') {
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      );
      return { granted };
    }
    return { granted: true };
  },
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

// ── Recording ──────────────────────────────────────────────────────────

export function useAudioRecorder(_preset: unknown) {
  const uriRef = useRef<string | null>(null);
  const startedRef = useRef<Promise<string> | null>(null);

  return {
    async prepareToRecordAsync() {
      // Recording and playback share the native session; stop any note.
      await voicePlayer.stop();
    },
    async record() {
      uriRef.current = null;
      // nitro-sound writes to a unique file (sound_<ts>.mp4, AAC) when no
      // path is given. Keep the promise so stop() can't race the start.
      startedRef.current = Sound.startRecorder();
      await startedRef.current;
    },
    async stop() {
      try {
        await startedRef.current;
      } catch {
        /* start failed; stopRecorder will reject too */
      }
      startedRef.current = null;
      const uri = await Sound.stopRecorder();
      // Guard against the library's sentinel strings.
      uriRef.current = uri && uri.includes('/') ? uri : null;
      return { uri: uriRef.current };
    },
    get uri() {
      return uriRef.current;
    },
  };
}

// ── Playback ───────────────────────────────────────────────────────────

export type VoicePlaybackState = {
  /** This uri is the one loaded in the native player. */
  active: boolean;
  playing: boolean;
  /** True between tapping play and the first progress tick. */
  loading: boolean;
  positionMs: number;
  durationMs: number;
};

type PlayerSnapshot = {
  uri: string | null;
  playing: boolean;
  loading: boolean;
  positionMs: number;
  durationMs: number;
};

const IDLE: VoicePlaybackState = {
  active: false,
  playing: false,
  loading: false,
  positionMs: 0,
  durationMs: 0,
};

let snap: PlayerSnapshot = {
  uri: null,
  playing: false,
  loading: false,
  positionMs: 0,
  durationMs: 0,
};
const subscribers = new Set<() => void>();
const finishListeners = new Set<(uri: string) => void>();
let wired = false;

function update(patch: Partial<PlayerSnapshot>) {
  snap = { ...snap, ...patch };
  for (const fn of subscribers) fn();
}

function wire() {
  if (wired) return;
  wired = true;
  try {
    Sound.setSubscriptionDuration(0.1);
  } catch {
    /* older native builds */
  }
  Sound.addPlayBackListener((e) => {
    if (!snap.uri) return;
    update({
      loading: false,
      positionMs: e.currentPosition,
      durationMs: e.duration > 0 ? e.duration : snap.durationMs,
    });
  });
  Sound.addPlaybackEndListener(() => {
    const finished = snap.uri;
    update({ playing: false, loading: false, positionMs: 0 });
    if (finished) for (const fn of finishListeners) fn(finished);
  });
}

export const voicePlayer = {
  /** Play / pause / resume `uri`. Throws if the native player can't load it. */
  async toggle(uri: string): Promise<void> {
    wire();
    if (snap.uri === uri && snap.playing) {
      await Sound.pausePlayer();
      update({ playing: false });
      return;
    }
    if (snap.uri === uri && !snap.playing && snap.positionMs > 0) {
      try {
        await Sound.resumePlayer();
        update({ playing: true });
        return;
      } catch {
        /* player was released — fall through to a fresh start */
      }
    }
    if (snap.uri && snap.uri !== uri) {
      await Sound.stopPlayer().catch(() => {});
    }
    update({ uri, playing: true, loading: true, positionMs: 0, durationMs: 0 });
    try {
      await Sound.startPlayer(uri);
    } catch (e) {
      update({ uri: null, playing: false, loading: false });
      throw e;
    }
  },

  async seek(uri: string, positionMs: number): Promise<void> {
    if (snap.uri !== uri) return;
    await Sound.seekToPlayer(positionMs);
    update({ positionMs });
  },

  async stop(): Promise<void> {
    if (!snap.uri) return;
    update({ uri: null, playing: false, loading: false, positionMs: 0 });
    await Sound.stopPlayer().catch(() => {});
  },

  /** Called with the uri whenever a note plays to the end. */
  onFinish(fn: (uri: string) => void) {
    finishListeners.add(fn);
    return () => {
      finishListeners.delete(fn);
    };
  },
};

function stateFor(uri: string): VoicePlaybackState {
  if (snap.uri !== uri) return IDLE;
  return {
    active: true,
    playing: snap.playing,
    loading: snap.loading,
    positionMs: snap.positionMs,
    durationMs: snap.durationMs,
  };
}

function sameState(a: VoicePlaybackState, b: VoicePlaybackState) {
  return (
    a.active === b.active &&
    a.playing === b.playing &&
    a.loading === b.loading &&
    a.positionMs === b.positionMs &&
    a.durationMs === b.durationMs
  );
}

/** Playback state for one voice note; re-renders only when it changes. */
export function useVoicePlayback(uri: string): VoicePlaybackState {
  const [state, setState] = useState<VoicePlaybackState>(() => stateFor(uri));
  useEffect(() => {
    const sync = () => {
      const next = stateFor(uri);
      setState((prev) => (sameState(prev, next) ? prev : next));
    };
    sync();
    subscribers.add(sync);
    return () => {
      subscribers.delete(sync);
    };
  }, [uri]);
  return state;
}
