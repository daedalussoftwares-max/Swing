/**
 * ViewPager2 (react-native-pager-view) starts a page drag as soon as the
 * finger moves ~8dp sideways, even during a mostly-vertical gesture — so
 * scrolling, swiping a note up or just tapping slightly crooked switched
 * tabs. Raise the inner RecyclerView's touch slop so only a deliberate
 * horizontal swipe changes tab.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(root, '../package.json'));

let pkgDir;
try {
  pkgDir = path.dirname(require.resolve('react-native-pager-view/package.json'));
} catch {
  console.warn('[patch-pager-view-touch-slop] skip: react-native-pager-view not installed');
  process.exit(0);
}

const file = path.join(
  pkgDir,
  'android/src/main/java/com/reactnativepagerview/PagerViewViewManager.kt',
);
if (!fs.existsSync(file)) {
  console.warn('[patch-pager-view-touch-slop] skip: PagerViewViewManager.kt not found');
  process.exit(0);
}

const marker = 'SWING_PAGER_TOUCH_SLOP';
let text = fs.readFileSync(file, 'utf8');
if (text.includes(marker)) process.exit(0);

const anchor = '        vp.isSaveEnabled = false\n';
if (!text.includes(anchor)) {
  console.warn('[patch-pager-view-touch-slop] skip: anchor not found (library changed?)');
  process.exit(0);
}

const patch = `${anchor}        // ${marker}: only a deliberate horizontal swipe should change page.
        try {
            val rv = vp.getChildAt(0) as? androidx.recyclerview.widget.RecyclerView
            if (rv != null) {
                val field = androidx.recyclerview.widget.RecyclerView::class.java
                    .getDeclaredField("mTouchSlop")
                field.isAccessible = true
                field.setInt(rv, field.getInt(rv) * 3)
            }
        } catch (_: Throwable) {
            // Keep the default slop if RecyclerView internals ever change.
        }
`;
text = text.replace(anchor, patch);
fs.writeFileSync(file, text);
console.log('[patch-pager-view-touch-slop] patched ViewPager2 touch slop (x3)');
