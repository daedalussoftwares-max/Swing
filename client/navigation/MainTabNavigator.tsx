import { Ionicons } from '@/lib/native/vector-icons';
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabBarProps,
  type MaterialTopTabNavigationOptions,
} from '@react-navigation/material-top-tabs';
import React, { useMemo } from 'react';
import {
  Animated,
  Dimensions,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import ChatsScreen from '@/screens/tabs/ChatsScreen';
import ExploreScreen from '@/screens/tabs/ExploreScreen';
import HomeScreen from '@/screens/tabs/HomeScreen';
import ProfileScreen from '@/screens/tabs/ProfileScreen';
import SendScreen from '@/screens/tabs/SendScreen';
import { ThemedText } from '@/components/themed-text';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useChatsUnreadTotal } from '@/lib/chats-context';
import type { MainTabParamList } from '@/navigation/types';

/**
 * Bottom tabs backed by a native pager (material-top-tabs +
 * react-native-pager-view) so swiping between tabs follows the finger and
 * snaps natively — Instagram / WhatsApp style. The tab bar is our own and is
 * driven by the pager's live `position`, so the indicator and icon/label
 * cross-fades track the finger too.
 *
 * Nested horizontal scrollers (Home card carousel, Profile segment pager)
 * keep their own touches natively; tab swipes start anywhere else.
 */
const Tab = createMaterialTopTabNavigator<MainTabParamList>();

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

// Known up-front so the pager renders at full width on the first frame
// instead of measuring first (avoids a one-frame layout jump).
const INITIAL_LAYOUT = { width: Dimensions.get('window').width, height: 0 };

const renderTabBar = (props: MaterialTopTabBarProps) => (
  <CustomTabBar {...props} />
);

function TabLazyPlaceholder() {
  const scheme = useColorScheme() ?? 'light';
  return (
    <View style={[styles.fill, { backgroundColor: Colors[scheme].background }]} />
  );
}

const renderLazyPlaceholder = () => <TabLazyPlaceholder />;

export function MainTabNavigator() {
  const scheme = useColorScheme() ?? 'light';
  const background = Colors[scheme].background;

  const screenOptions = useMemo<MaterialTopTabNavigationOptions>(
    () => ({
      swipeEnabled: true,
      animationEnabled: true,
      // Mount a tab the first time it's needed; keep immediate neighbours
      // pre-rendered so a swipe never reveals a blank page. Once mounted, a
      // tab stays mounted (no re-mounts on swipe).
      lazy: true,
      lazyPreloadDistance: 1,
      lazyPlaceholder: renderLazyPlaceholder,
      sceneStyle: { backgroundColor: background },
    }),
    [background],
  );

  return (
    <Tab.Navigator
      tabBarPosition="bottom"
      tabBar={renderTabBar}
      initialLayout={INITIAL_LAYOUT}
      overScrollMode="never"
      screenOptions={screenOptions}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Chats" component={ChatsScreen} />
      <Tab.Screen name="Send" component={SendScreen} />
      <Tab.Screen name="Explore" component={ExploreScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function CustomTabBar({ state, navigation, position }: MaterialTopTabBarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const chatsUnread = useChatsUnreadTotal();

  const tabCount = state.routes.length;
  const tabWidth = screenWidth / tabCount;

  // Indicator x follows the pager's live (fractional) page position.
  const indicatorTranslateX = useMemo(() => {
    const inputRange = state.routes.map((_, i) => i);
    return position.interpolate({
      inputRange,
      outputRange: inputRange.map(
        (i) => i * tabWidth + (tabWidth - INDICATOR_WIDTH) / 2,
      ),
      extrapolate: 'clamp',
    });
  }, [position, state.routes, tabWidth]);

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
        pointerEvents="none"
        style={[
          styles.indicator,
          {
            backgroundColor: c.tint,
            width: INDICATOR_WIDTH,
            transform: [{ translateX: indicatorTranslateX }],
          },
        ]}
      />

      {state.routes.map((route, index) => {
        const icon = TAB_CONFIG[route.name as keyof MainTabParamList];
        if (!icon) return null;

        const isFocused = state.index === index;
        const onPress = () => {
          const event = navigation.emit({
            type: 'tabPress',
            target: route.key,
            canPreventDefault: true,
          });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };
        const onLongPress = () => {
          navigation.emit({ type: 'tabLongPress', target: route.key });
        };

        return (
          <TabItem
            key={route.key}
            index={index}
            position={position}
            label={icon.label}
            activeIcon={icon.active}
            inactiveIcon={icon.inactive}
            focused={isFocused}
            activeColor={c.tint}
            inactiveColor={c.tabIconDefault}
            badge={route.name === 'Chats' ? chatsUnread : 0}
            badgeColor={c.tint}
            onPress={onPress}
            onLongPress={onLongPress}
          />
        );
      })}
    </View>
  );
}

type TabItemProps = {
  index: number;
  position: MaterialTopTabBarProps['position'];
  label: string;
  activeIcon: IoniconName;
  inactiveIcon: IoniconName;
  focused: boolean;
  activeColor: string;
  inactiveColor: string;
  badge?: number;
  badgeColor?: string;
  onPress: () => void;
  onLongPress: () => void;
};

function TabItem({
  index,
  position,
  label,
  activeIcon,
  inactiveIcon,
  focused,
  activeColor,
  inactiveColor,
  badge = 0,
  badgeColor = '#FD425E',
  onPress,
  onLongPress,
}: TabItemProps) {
  // 1 when this tab is fully selected, 0 when a neighbour (or further) is —
  // interpolated live from the pager so the cross-fade tracks the finger.
  const anim = useMemo(() => {
    const focus = position.interpolate({
      inputRange: [index - 1, index, index + 1],
      outputRange: [0, 1, 0],
      extrapolate: 'clamp',
    });
    return {
      active: focus,
      inactive: focus.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      scale: focus.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }),
      inactiveLabel: focus.interpolate({
        inputRange: [0, 1],
        outputRange: [0.55, 0],
      }),
    };
  }, [position, index]);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tabItem}
      android_ripple={null}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge > 0 ? `${label}, ${badge} unread` : label}
    >
      <Animated.View style={[styles.iconWrap, { transform: [{ scale: anim.scale }] }]}>
        <Animated.View style={[styles.iconLayer, { opacity: anim.inactive }]}>
          <Ionicons name={inactiveIcon} size={22} color={inactiveColor} />
        </Animated.View>
        <Animated.View style={[styles.iconLayer, { opacity: anim.active }]}>
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
      <View>
        <Animated.View style={{ opacity: anim.inactiveLabel }}>
          <ThemedText style={[styles.label, { color: inactiveColor }]}>
            {label}
          </ThemedText>
        </Animated.View>
        <Animated.View style={[styles.labelOverlay, { opacity: anim.active }]}>
          <ThemedText style={[styles.label, { color: activeColor }]}>
            {label}
          </ThemedText>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
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
  labelOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
  },
});
