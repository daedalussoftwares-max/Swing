import { createNativeStackNavigator } from '@react-navigation/native-stack';

import NotificationsScreen from '@/screens/NotificationsScreen';
import SettingsScreen from '@/screens/SettingsScreen';
import StatusScreen from '@/screens/StatusScreen';
import SplashScreen from '@/screens/auth/SplashScreen';
import SigninScreen from '@/screens/auth/SigninScreen';
import SignupScreen from '@/screens/auth/SignupScreen';
import ProfileSetupScreen from '@/screens/auth/ProfileSetupScreen';
import ChatScreen from '@/screens/chat/ChatScreen';
import PlaneDetailScreen from '@/screens/plane/PlaneDetailScreen';
import PlanesScreen from '@/screens/plane/PlanesScreen';
import EditProfileScreen from '@/screens/profile/EditProfileScreen';
import UserProfileScreen from '@/screens/profile/UserProfileScreen';
import StoryScreen from '@/screens/story/StoryScreen';
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
        component={UserProfileScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <Stack.Screen
        name="ProfileEdit"
        component={EditProfileScreen}
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
