/**
 * Permissions shim (replaces expo-location + expo-notifications).
 */
import Geolocation from '@react-native-community/geolocation';
import { PermissionsAndroid, Platform } from 'react-native';

type PermResult = { granted: boolean; status: string };

async function getForegroundPermissionsAsync(): Promise<PermResult> {
  if (Platform.OS === 'android') {
    const granted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return {
      granted,
      status: granted ? 'granted' : 'denied',
    };
  }
  return { granted: true, status: 'granted' };
}

async function requestForegroundPermissionsAsync(): Promise<PermResult> {
  if (Platform.OS === 'android') {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    const granted = result === PermissionsAndroid.RESULTS.GRANTED;
    return { granted, status: granted ? 'granted' : 'denied' };
  }
  return { granted: true, status: 'granted' };
}

export const Location = {
  getForegroundPermissionsAsync,
  requestForegroundPermissionsAsync,
  getCurrentPositionAsync: () =>
    new Promise<{ coords: { latitude: number; longitude: number } }>((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (pos) => resolve({ coords: pos.coords }),
        reject,
      );
    }),
};

export const Notifications = {
  async getPermissionsAsync(): Promise<PermResult> {
    return { granted: false, status: 'undetermined' };
  },
  async requestPermissionsAsync(_options?: unknown): Promise<PermResult> {
    return { granted: false, status: 'denied' };
  },
};
