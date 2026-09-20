// The glass the phone chrome is made of.
//
// The panel's ordinary `cad-glass-surface` is a flat tinted blur: right for a
// sheet that fills an edge of a desktop window, wrong for something that floats
// over a 3D scene on a phone. This is the floating kind — a thicker, more
// saturated blur, a bright specular line along the top edge, a hairline ring
// and a wide soft shadow under it, so the piece reads as a lens lying on the
// scene rather than as a grey panel painted on top of it.
//
// It is inline rather than a class because the package ships no stylesheet of
// its own: both hosts (the app and the site) define the `--ui-glass-*` tokens,
// and everything else here has to travel with the component. `cad-glass-*`
// must NOT be combined with it — that class sets background-color with
// !important and would win.

export const LIQUID_GLASS_BLUR = "backdrop-blur-[26px] backdrop-saturate-[1.9] [-webkit-backdrop-filter:blur(26px)_saturate(1.9)]";

// `strength` 0..1 moves the tint from barely-there to nearly opaque. A piece
// that lands on the model (the dock, the view buttons) needs more of it than
// one over empty scene, or the text underneath reads through the labels.
export function liquidGlassStyle({ radius = "1.75rem", strength = 0.62, raised = true } = {}) {
  const tint = `color-mix(in srgb, var(--ui-glass-surface-tint) ${Math.round(strength * 100)}%, transparent)`;
  const shadows = [
    // The specular edge: brightest at the top, where a real lens catches light.
    "inset 0 1px 0 rgb(255 255 255 / 0.40)",
    "inset 0 -1px 0 rgb(255 255 255 / 0.08)",
    // The hairline ring that separates the glass from whatever is behind it.
    "inset 0 0 0 0.5px rgb(255 255 255 / 0.16)",
    "inset 0 0 0 1px color-mix(in srgb, var(--ui-border) 35%, transparent)"
  ];
  if (raised) {
    shadows.unshift("0 16px 36px -16px rgb(0 0 0 / 0.45)", "0 2px 10px -6px rgb(0 0 0 / 0.35)");
  }
  return {
    borderRadius: radius,
    backgroundColor: tint,
    boxShadow: shadows.join(", ")
  };
}

// A capsule that marks the chosen item inside a glass bar: the same lens, one
// step brighter, tinted by the accent so colour is not the only difference.
export function liquidGlassSelectionStyle({ radius = "1.25rem" } = {}) {
  return {
    borderRadius: radius,
    backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)",
    boxShadow: [
      "inset 0 1px 0 rgb(255 255 255 / 0.34)",
      "inset 0 0 0 0.5px color-mix(in srgb, var(--primary) 40%, transparent)"
    ].join(", ")
  };
}
