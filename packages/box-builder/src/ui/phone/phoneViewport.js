import { useEffect, useRef, useState } from "react";
import { readSafeAreaInsets, SAFE_AREA_PROBE_STYLE } from "../kit/safeArea.js";

// What the phone chrome has to measure, in one place: how tall the screen is
// right now, how much of it the status bar and the home indicator own, and how
// much of it the keyboard has covered. Every one of these is read from the
// device rather than assumed — a guessed status-bar height is a notch through
// the title on the one phone that has it.

function currentHeight() {
  if (typeof window === "undefined") {
    return 800;
  }
  return Math.round(window.innerHeight || 800);
}

export function usePhoneViewport() {
  const probeRef = useRef(null);
  const [height, setHeight] = useState(currentHeight);
  const [safeArea, setSafeArea] = useState({ top: 0, right: 0, bottom: 0, left: 0 });
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    const measure = () => {
      setHeight(currentHeight());
      setSafeArea(readSafeAreaInsets(probeRef.current));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  // The on-screen keyboard shrinks the *visual* viewport and leaves the layout
  // viewport alone, so anything pinned to the bottom of the page sits under the
  // keys unless it is lifted by this much.
  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!viewport) {
      return undefined;
    }
    const update = () => {
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // A collapsing browser URL bar moves this by tens of pixels; only a
      // keyboard takes a fifth of the screen.
      setKeyboardInset(covered > window.innerHeight * 0.2 ? Math.round(covered) : 0);
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return {
    height,
    safeArea,
    keyboardInset,
    // Render this once inside the shell; it is what the insets are read from.
    probe: <span ref={probeRef} aria-hidden="true" className="pointer-events-none invisible fixed left-0 top-0" style={SAFE_AREA_PROBE_STYLE} />
  };
}
