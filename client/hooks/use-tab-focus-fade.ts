/**
 * Legacy no-op. Tabs used to fake a transition with an 18px slide/fade on
 * focus; the tab navigator is now a native pager whose content follows the
 * finger, so an extra focus animation would double-animate.
 *
 * Returns a stable empty style so existing `<Animated.View style={fadeStyle}>`
 * call sites keep compiling and rendering identically. New code should not
 * use it.
 */

const NO_STYLE = Object.freeze({});

/** @deprecated No-op — the pager provides the tab transition. */
export function useTabFocusFade(): Readonly<Record<string, never>> {
  return NO_STYLE;
}
