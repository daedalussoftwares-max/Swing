import 'react-native-gesture-handler';
import { AppRegistry } from 'react-native';

import { Ionicons } from './lib/native/vector-icons';

// Ensures tab/bar icons render on Android (and as a fallback on iOS).
void Ionicons.loadFont();

import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
