import 'react-native-gesture-handler';
import { CommonActions, NavigationContainer } from '@react-navigation/native';
import { useEffect } from 'react';
import { ActivityIndicator, StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  initialWindowMetrics,
  SafeAreaProvider,
} from 'react-native-safe-area-context';

import { AuthProfileSync } from '@/components/auth-profile-sync';
import { PushBootstrap } from '@/components/push-bootstrap';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useDismissKeyboardOnBackground } from '@/hooks/use-dismiss-keyboard-on-background';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ChatsProvider } from '@/lib/chats-context';
import { NotificationsProvider } from '@/lib/notifications-context';
import { PlaneBalanceProvider } from '@/lib/plane-balance-context';
import { navigationRef } from '@/lib/router';
import { InboxPlanesProvider } from '@/lib/inbox-planes-context';
import { SentPlanesProvider } from '@/lib/sent-planes-context';
import { UserSettingsProvider } from '@/lib/user-settings-context';
import { RootNavigator } from '@/navigation/RootNavigator';

const AUTH_ROUTES = new Set(['Splash', 'Signup', 'Signin', 'ProfileSetup']);

function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();

  useEffect(() => {
    if (status === 'loading') return;

    const syncAuthRoute = () => {
      if (!navigationRef.isReady()) return;

      const route = navigationRef.getCurrentRoute();
      const currentName = route?.name;
      const inAuthGroup = currentName ? AUTH_ROUTES.has(currentName) : false;

      if (status === 'signed-out' && !inAuthGroup) {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'Splash' }],
          }),
        );
        return;
      }

      if (status === 'signed-in' && inAuthGroup) {
        if (user.profileComplete) {
          navigationRef.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'Main' }],
            }),
          );
        } else if (currentName !== 'ProfileSetup') {
          navigationRef.dispatch(
            CommonActions.reset({
              index: 0,
              routes: [{ name: 'ProfileSetup' }],
            }),
          );
        }
      }
    };

    syncAuthRoute();
    return navigationRef.addListener('state', syncAuthRoute);
  }, [status, user]);

  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (status === 'loading') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: c.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={c.tint} />
      </View>
    );
  }

  return <>{children}</>;
}

function AppShell() {
  const colorScheme = useColorScheme();
  useDismissKeyboardOnBackground();

  return (
    <>
      <StatusBar barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'} />
      <NotificationsProvider>
        <PlaneBalanceProvider>
          <InboxPlanesProvider>
            <SentPlanesProvider>
              <ChatsProvider>
                <AuthGate>
                  <RootNavigator />
                </AuthGate>
              </ChatsProvider>
            </SentPlanesProvider>
          </InboxPlanesProvider>
        </PlaneBalanceProvider>
      </NotificationsProvider>
    </>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      {/* Root provider: overlays rendered outside the navigator (e.g. the
          in-app message banner) need safe-area insets too. */}
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <AuthProvider>
          <UserSettingsProvider>
            <AuthProfileSync />
            <PushBootstrap />
            <NavigationContainer ref={navigationRef}>
              <AppShell />
            </NavigationContainer>
          </UserSettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
