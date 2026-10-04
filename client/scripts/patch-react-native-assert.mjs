/**
 * Xcode 26: importing glog/logging.h as a module through react_native_assert breaks
 * NitroModules (Swift). Use plain assert on Apple platforms in debug builds.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const assertPath = path.join(
  root,
  '../node_modules/react-native/ReactCommon/react/debug/react_native_assert.h',
);

if (!fs.existsSync(assertPath)) {
  console.warn('[patch-react-native-assert] skip: react_native_assert.h not found');
  process.exit(0);
}

const marker = 'SWING_XCODE26_GLOG_WORKAROUND';
let text = fs.readFileSync(assertPath, 'utf8');
if (text.includes(marker)) {
  process.exit(0);
}

const block = `#else // __ANDROID__

#include <glog/logging.h>
#include <cassert>

// For all platforms, but iOS+Xcode especially: flush logs because some might be
// lost on iOS if an assert is hit right after this. If you are trying to debug
// something actively and have added lots of LOG statements to track down an
// issue, there is race between flushing the final logs and stopping execution
// when the assert hits. Thus, if we know an assert will fail, we force flushing
// to happen right before the assert.
#define react_native_assert(cond)                           \\
  if (!(cond)) {                                            \\
    LOG(ERROR) << "react_native_assert failure: " << #cond; \\
    google::FlushLogFiles(google::GLOG_INFO);               \\
    assert(cond);                                           \\
  }

#endif // platforms besides __ANDROID__`;

const replacement = `#else // __ANDROID__

// ${marker}
#if defined(__APPLE__)
#include <cassert>
#define react_native_assert(cond) assert(cond)
#else
#include <glog/logging.h>
#include <cassert>

#define react_native_assert(cond)                           \\
  if (!(cond)) {                                            \\
    LOG(ERROR) << "react_native_assert failure: " << #cond; \\
    google::FlushLogFiles(google::GLOG_INFO);               \\
    assert(cond);                                           \\
  }
#endif

#endif // platforms besides __ANDROID__`;

if (!text.includes(block)) {
  console.warn('[patch-react-native-assert] skip: unexpected header shape');
  process.exit(0);
}

fs.writeFileSync(assertPath, text.replace(block, replacement));
console.log('[patch-react-native-assert] Apple debug asserts without glog import');
