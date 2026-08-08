import { createNativeStackNavigator } from '@react-navigation/native-stack';

import SplashScreen from '@/app/(auth)/splash';
import SignupScreen from '@/app/(auth)/signup';
import SigninScreen from '@/app/(auth)/signin';
import ProfileSetupScreen from '@/app/(auth)/profile-setup';
import ChatScreen from '@/app/chat/[chatId]';
import NotificationsScreen from '@/app/notifications';
import PlaneDetailScreen from '@/app/plane/[id]';
import PlanesScreen from '@/app/planes';
import ProfileEditScreen from '@/app/profile/edit';
import ProfileUserScreen from '@/app/profile/[userId]';
import SettingsScreen from '@/app/settings';
import StatusScreen from '@/app/status';
import StoryScreen from '@/app/story/[userId]';
import { MainTabNavigator } from '@/navigation/MainTabNavigator';
import type { RootStackParamList } from '@/navigation/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

export function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }} initialRouteName="Splash">
      <Stack.Screen name="Splash" component={SplashScreen} />
      <Stack.Screen name="Signup" component={SignupScreen} />
      <Stack.Screen name="Signin" component={SigninScreen} />
      <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
      <Stack.Screen name="Main" component={MainTabNavigator} />
      <Stack.Screen
        name="PlaneDetail"
        component={PlaneDetailScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ProfileUser"
        component={ProfileUserScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ProfileEdit"
        component={ProfileEditScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Chat"
        component={ChatScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Planes"
        component={PlanesScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Status"
        component={StatusScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="Story"
        component={StoryScreen}
        options={{ animation: 'fade', presentation: 'fullScreenModal' }}
      />
    </Stack.Navigator>
  );
}
