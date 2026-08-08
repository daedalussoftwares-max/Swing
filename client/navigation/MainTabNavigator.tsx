import { Ionicons } from '@/lib/native/vector-icons';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChatsScreen from '@/screens/tabs/ChatsScreen';
import ExploreScreen from '@/screens/tabs/ExploreScreen';
import HomeScreen from '@/screens/tabs/HomeScreen';
import ProfileScreen from '@/screens/tabs/ProfileScreen';
import SendScreen from '@/screens/tabs/SendScreen';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChats } from '@/lib/chats-context';
import type { MainTabParamList } from '@/navigation/types';

const Tab = createBottomTabNavigator<MainTabParamList>();

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const TAB_CONFIG: Record<
  keyof MainTabParamList,
  { active: IoniconName; inactive: IoniconName; label: string }
> = {
  Home: { active: 'home', inactive: 'home-outline', label: 'Home' },
  Chats: { active: 'chatbubble', inactive: 'chatbubble-outline', label: 'Chats' },
  Send: { active: 'paper-plane', inactive: 'paper-plane-outline', label: 'Send' },
  Explore: { active: 'compass', inactive: 'compass-outline', label: 'Explore' },
  Profile: { active: 'person', inactive: 'person-outline', label: 'Profile' },
};

const INDICATOR_WIDTH = 28;
const INDICATOR_HEIGHT = 3;

export function MainTabNavigator() {
  return (
    <Tab.Navigator
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Chats" component={ChatsScreen} />
      <Tab.Screen name="Send" component={SendScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { chats } = useChats();
  const chatsUnread = useMemo(
    () =>
      chats.reduce(
        (sum, chat) => sum + (chat.isBlocked ? 0 : chat.unreadCount),
        0,
      ),
    [chats],
  );

  const tabCount = state.routes.length;
  const tabWidth = screenWidth / tabCount;
  const indicatorPosition = useSharedValue(state.index);

  useEffect(() => {
    indicatorPosition.value = withTiming(state.index, { duration: 220 });
  }, [state.index, indicatorPosition]);

  const indicatorStyle = useAnimatedStyle(() => {
    const x =
      indicatorPosition.value * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2;
    return { transform: [{ translateX: x }] };
  });

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          paddingBottom: insets.bottom + 8,
        },
      ]}
    >
      <Animated.View
        style={[
          styles.indicator,
          { backgroundColor: c.tint, width: INDICATOR_WIDTH },
          indicatorStyle,
        ]}
      />

      {state.routes.map((route, index) => {
        const icon = TAB_CONFIG[route.name as keyof MainTabParamList];
        if (!icon) return null;

        const isFocused = state.index === index;
        const onPress = () => {
          if (!isFocused) navigation.navigate(route.name);
        };

        return (
          <TabItem
            key={route.key}
            label={icon.label}
            activeIcon={icon.active}
            inactiveIcon={icon.inactive}
            focused={isFocused}
            activeColor={c.tint}
            inactiveColor={c.tabIconDefault}
            badge={route.name === 'Chats' ? chatsUnread : 0}
            badgeColor={c.tint}
            onPress={onPress}
          />
        );
      })}
    </View>
  );
}

type TabItemProps = {
  label: string;
  activeIcon: IoniconName;
  inactiveIcon: IoniconName;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  badge?: number;
  badgeColor?: string;
  onPress: () => void;
};

function TabItem({
  label,
  activeIcon,
  inactiveIcon,
  focused,
  activeColor,
  inactiveColor,
  badge = 0,
  badgeColor = '#FD425E',
  onPress,
}: TabItemProps) {
  const focus = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, { duration: 220 });
  }, [focused, focus]);

  const iconWrapStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + focus.value * 0.08 }],
  }));

  const activeIconStyle = useAnimatedStyle(() => ({
    opacity: focus.value,
  }));

  const inactiveIconStyle = useAnimatedStyle(() => ({
    opacity: 1 - focus.value,
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: 0.55 + focus.value * 0.45,
  }));

  return (
    <Pressable onPress={onPress} style={styles.tabItem} android_ripple={null}>
      <Animated.View style={[styles.iconWrap, iconWrapStyle]}>
        <Animated.View style={[styles.iconLayer, inactiveIconStyle]}>
          <Ionicons name={inactiveIcon} size={22} color={inactiveColor} />
        </Animated.View>
        <Animated.View style={[styles.iconLayer, activeIconStyle]}>
          <Ionicons name={activeIcon} size={22} color={activeColor} />
        </Animated.View>
        {badge > 0 ? (
          <View style={[styles.tabBadge, { backgroundColor: badgeColor }]}>
            <ThemedText style={styles.tabBadgeText}>
              {badge > 9 ? '9+' : badge}
            </ThemedText>
          </View>
        ) : null}
      </Animated.View>
      <Animated.View style={labelStyle}>
        <ThemedText
          style={[styles.label, { color: focused ? activeColor : inactiveColor }]}
        >
          {label}
        </ThemedText>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 8,
    position: 'relative',
  },
  indicator: {
    position: 'absolute',
    top: 0,
    height: INDICATOR_HEIGHT,
    borderRadius: INDICATOR_HEIGHT / 2,
    left: 0,
  },
  tabItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
    gap: 2,
  },
  iconWrap: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  tabBadge: {
    position: 'absolute',
    top: -5,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '700',
    lineHeight: 11,
  },
  iconLayer: {
    position: 'absolute',
  },
  label: {
    fontSize: 11,
    fontWeight: '500',
  },
});
