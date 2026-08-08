import type { NavigatorScreenParams } from '@react-navigation/native';

export type MainTabParamList = {
  Home: undefined;
  Chats: undefined;
  Send: undefined;
  Explore: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Splash: undefined;
  Signup: undefined;
  Signin: undefined;
  ProfileSetup: undefined;
  Main: NavigatorScreenParams<MainTabParamList> | undefined;
  PlaneDetail: { id: string; readOnly?: string };
  ProfileUser: { userId: string };
  ProfileEdit: undefined;
  Chat: { chatId: string };
  Notifications: undefined;
  Planes: undefined;
  Settings: undefined;
  Status: undefined;
  Story: { userId: string };
};
