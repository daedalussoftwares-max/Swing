/**
 * Navigation helpers — replaces expo-router hooks in screen code.
 */
import {
  CommonActions,
  createNavigationContainerRef,
  useFocusEffect,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { type ReactNode } from 'react';
import { Pressable, type PressableProps } from 'react-native';

import type { MainTabParamList } from '@/navigation/types';
import type { RootStackParamList } from '@/navigation/types';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

type Href =
  | string
  | {
      pathname: string;
      params?: Record<string, string | undefined>;
    };

function resolveHref(href: Href): {
  name: keyof RootStackParamList;
  params?: RootStackParamList[keyof RootStackParamList];
} {
  if (typeof href === 'object') {
    if (href.pathname === '/plane/[id]') {
      return {
        name: 'PlaneDetail',
        params: {
          id: href.params?.id ?? '',
          readOnly: href.params?.readOnly,
        },
      };
    }
  }

  const path = typeof href === 'string' ? href : href.pathname;

  switch (path) {
    case '/(auth)/splash':
    case '/splash':
      return { name: 'Splash' };
    case '/(auth)/signup':
      return { name: 'Signup' };
    case '/(auth)/signin':
      return { name: 'Signin' };
    case '/(auth)/profile-setup':
      return { name: 'ProfileSetup' };
    case '/(tabs)':
    case '/':
      return { name: 'Main' };
    case '/status':
      return { name: 'Status' };
    case '/settings':
      return { name: 'Settings' };
    case '/notifications':
      return { name: 'Notifications' };
    case '/planes':
      return { name: 'Planes' };
    case '/profile/edit':
      return { name: 'ProfileEdit' };
    default:
      break;
  }

  let m = path.match(/^\/chat\/([^/]+)$/);
  if (m) return { name: 'Chat', params: { chatId: m[1] } };

  m = path.match(/^\/plane\/([^/]+)$/);
  if (m) return { name: 'PlaneDetail', params: { id: m[1] } };

  m = path.match(/^\/profile\/([^/]+)$/);
  if (m) return { name: 'ProfileUser', params: { userId: m[1] } };

  m = path.match(/^\/story\/([^/]+)$/);
  if (m) return { name: 'Story', params: { userId: m[1] } };

  const tabScreens: Record<string, string> = {
    '/': 'Home',
    '/chats': 'Chats',
    '/send': 'Send',
    '/explore': 'Explore',
    '/profile': 'Profile',
  };
  if (tabScreens[path]) {
    return {
      name: 'Main',
      params: { screen: tabScreens[path] as keyof MainTabParamList },
    };
  }

  return { name: 'Main' };
}

export function useRouter() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  const go = (href: Href, mode: 'navigate' | 'replace' | 'push') => {
    const target = resolveHref(href);
    if (mode === 'replace') {
      if (navigationRef.isReady()) {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: target.name, params: target.params }],
          }),
        );
      } else {
        navigation.replace(target.name, target.params as never);
      }
      return;
    }
    if (mode === 'push') {
      navigation.push(target.name, target.params as never);
      return;
    }
    navigation.navigate(target.name, target.params as never);
  };

  return {
    push: (href: Href) => go(href, 'push'),
    replace: (href: Href) => go(href, 'replace'),
    navigate: (href: Href) => go(href, 'navigate'),
    back: () => navigation.goBack(),
  };
}

export function useLocalSearchParams<
  T extends Record<string, string | undefined> = Record<string, string | undefined>,
>() {
  const route = useRoute();
  return route.params as T;
}

const ROUTE_TO_PATH: Record<string, string> = {
  Home: '/',
  Chats: '/chats',
  Send: '/send',
  Explore: '/explore',
  Profile: '/profile',
  Splash: '/(auth)/splash',
  Signup: '/(auth)/signup',
  Signin: '/(auth)/signin',
  ProfileSetup: '/(auth)/profile-setup',
  Main: '/(tabs)',
};

export function usePathname(): string {
  const route = useRoute();
  return ROUTE_TO_PATH[route.name] ?? `/${route.name}`;
}

export function useSegments(): readonly string[] {
  const route = useRoute();
  if (route.name === 'Main') return ['(tabs)'];
  if (route.name === 'Splash') return ['(auth)', 'splash'];
  if (route.name === 'Signup') return ['(auth)', 'signup'];
  if (route.name === 'Signin') return ['(auth)', 'signin'];
  if (route.name === 'ProfileSetup') return ['(auth)', 'profile-setup'];
  return [];
}

export { useFocusEffect };

type LinkProps = {
  href: Href;
  replace?: boolean;
  asChild?: boolean;
  children: ReactNode;
};

export function Link({ href, replace, asChild, children }: LinkProps) {
  const router = useRouter();
  const onPress = () => (replace ? router.replace(href) : router.push(href));

  if (asChild && React.isValidElement<PressableProps>(children)) {
    return React.cloneElement(children, { onPress });
  }

  return <Pressable onPress={onPress}>{children}</Pressable>;
}
