// Safe-area insets: the edges of the screen under a status bar, a camera
// cutout or a home indicator. Browsers report them only to a page that asks for
// `viewport-fit=cover` (an app hosting the panel full screen), so on the site
// every inset stays 0 and nothing moves.
//
// A host whose web view does not report env(safe-area-inset-*) itself (Android
// WebView before M144) can set the same values as --safe-area-inset-* on the
// root element; they win over the browser's own.
function safeAreaInset(side) {
  return `var(--safe-area-inset-${side}, env(safe-area-inset-${side}, 0px))`;
}

export const SAFE_AREA_TOP = safeAreaInset("top");
export const SAFE_AREA_RIGHT = safeAreaInset("right");
export const SAFE_AREA_BOTTOM = safeAreaInset("bottom");
export const SAFE_AREA_LEFT = safeAreaInset("left");

// Padding of an element that measures the insets: give it this style and read
// the numbers back with readSafeAreaInsets.
export const SAFE_AREA_PROBE_STYLE = {
  paddingTop: SAFE_AREA_TOP,
  paddingRight: SAFE_AREA_RIGHT,
  paddingBottom: SAFE_AREA_BOTTOM,
  paddingLeft: SAFE_AREA_LEFT
};

export function readSafeAreaInsets(probe) {
  if (!probe || typeof getComputedStyle !== "function") {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const style = getComputedStyle(probe);
  const read = (value) => Number.parseFloat(value) || 0;
  return {
    top: read(style.paddingTop),
    right: read(style.paddingRight),
    bottom: read(style.paddingBottom),
    left: read(style.paddingLeft)
  };
}
