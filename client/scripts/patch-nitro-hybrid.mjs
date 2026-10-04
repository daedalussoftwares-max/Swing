/**
 * react-native-audio-recorder-player nitrogen specs call HybridObject.updateNative,
 * which is not yet in published react-native-nitro-modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const hybridPath = path.join(
  root,
  '../node_modules/react-native-nitro-modules/android/src/main/java/com/margelo/nitro/core/HybridObject.kt',
);

if (!fs.existsSync(hybridPath)) {
  console.warn('[patch-nitro-hybrid] skip: nitro-modules not installed');
  process.exit(0);
}

let text = fs.readFileSync(hybridPath, 'utf8');
if (text.includes('fun updateNative(')) {
  process.exit(0);
}

const anchor = `  open fun dispose() {
    synchronized(this) {
      cxxPart?.destroy()
      cxxPart = null
    }
  }`;

const insert = `  open fun dispose() {
    synchronized(this) {
      cxxPart?.destroy()
      cxxPart = null
    }
  }

  /**
   * Called from nitrogen-generated HybridObject specs to sync JNI hybrid data.
   */
  @DoNotStrip
  @Keep
  @CallSuper
  open fun updateNative(hybridData: HybridData) {
    // Default no-op; generated subclasses override and call super.
  }`;

if (!text.includes(anchor)) {
  console.warn('[patch-nitro-hybrid] skip: unexpected HybridObject.kt shape');
  process.exit(0);
}

text = text.replace(anchor, insert);
fs.writeFileSync(hybridPath, text);
console.log('[patch-nitro-hybrid] added HybridObject.updateNative');
