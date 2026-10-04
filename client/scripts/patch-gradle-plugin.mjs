/**
 * RN gradle-plugin settings apply foojay-resolver from the portal; on some
 * networks/Java proxy setups the included build never registers plugins.
 * Foojay is optional for building the Android app.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const settingsPath = path.join(
  root,
  '../node_modules/@react-native/gradle-plugin/settings.gradle.kts',
);

if (!fs.existsSync(settingsPath)) {
  console.warn('[patch-gradle-plugin] skip: gradle-plugin not installed');
  process.exit(0);
}

let text = fs.readFileSync(settingsPath, 'utf8');
const needle = 'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0") }';
if (text.includes(needle)) {
  text = text.replace(needle, '// patched: foojay disabled for local Android builds');
  fs.writeFileSync(settingsPath, text);
  console.log('[patch-gradle-plugin] disabled foojay-resolver in gradle-plugin');
}
