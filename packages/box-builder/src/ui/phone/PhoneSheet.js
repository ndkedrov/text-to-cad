import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../kit/utils.js";
import { PHONE_SHEET_HEADER_HEIGHT } from "./phoneUi.js";

// The panel on a phone: a sheet that rises from above the navigation bar.
//
// It rests at one of three detents — away, half the screen, or all of it under
// the top bar — because a box is edited while watching it change. A sheet that
// only knows "open" and "closed" hides the model exactly when the number being
// dragged is the one that moves it, which is what the first build did with a
// full-width drawer over the scene.
export const PHONE_SHEET_DETENTS = Object.freeze(["closed", "half", "full"]);

// A flick beats position: past this speed the sheet goes the way the finger
// threw it, even from the middle of the travel.
const FLICK_VELOCITY = 0.5;

function closestDetent(heights, value) {
  return PHONE_SHEET_DETENTS.reduce(
    (best, name) => (Math.abs(heights[name] - value) < Math.abs(heights[best] - value) ? name : best),
    "half"
  );
}

export function settleDetent(heights, value, velocity) {
  const closest = closestDetent(heights, value);
  if (Math.abs(velocity) <= FLICK_VELOCITY) {
    return closest;
  }
  // A downward flick is a positive dy, which shrinks the sheet.
  const step = velocity > 0 ? -1 : 1;
  const index = PHONE_SHEET_DETENTS.indexOf(closest) + step;
  return PHONE_SHEET_DETENTS[Math.min(Math.max(index, 0), PHONE_SHEET_DETENTS.length - 1)];
}

export default function PhoneSheet({
  title,
  detent,
  heights,
  keyboardInset = 0,
  onDetentChange,
  expandLabel,
  collapseLabel,
  trailing = null,
  children
}) {
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);

  const restingHeight = heights[detent] ?? heights.half;
  const visibleHeight = drag ? drag.height : restingHeight;

  const startDrag = useCallback((event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    // The header carries buttons (undo, redo, the expand chevron). Starting a
    // drag on one of them ends in a settle that overrides the button's own
    // click, which is why tapping the chevron did nothing at all.
    if (event.target?.closest?.("button")) {
      return;
    }
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: restingHeight,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0
    };
    setDrag({ height: restingHeight });
  }, [restingHeight]);

  const moveDrag = useCallback((event) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const elapsed = Math.max(event.timeStamp - state.lastTime, 1);
    state.velocity = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    const next = state.startHeight - (event.clientY - state.startY);
    setDrag({ height: Math.min(Math.max(next, 0), heights.full) });
  }, [heights.full]);

  const endDrag = useCallback((event) => {
    const state = dragRef.current;
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragRef.current = null;
    setDrag((current) => {
      if (current) {
        onDetentChange?.(settleDetent(heights, current.height, state.velocity));
      }
      return null;
    });
  }, [heights, onDetentChange]);

  const expanded = detent === "full";
  const toggle = () => onDetentChange?.(expanded ? "half" : "full");

  return (
    <section
      data-phone-sheet={detent}
      aria-label={title}
      className={cn(
        "pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden",
        "cad-glass-surface rounded-t-[1.25rem] border-t border-sidebar-border text-sidebar-foreground",
        "shadow-[0_-12px_40px_-20px_rgb(0_0_0/0.55)]",
        !drag && "transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      )}
      style={{ height: `${visibleHeight}px` }}
    >
      <header
        className="flex shrink-0 cursor-grab touch-none select-none flex-col active:cursor-grabbing"
        style={{ height: `${PHONE_SHEET_HEADER_HEIGHT}px` }}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="flex h-4 items-end justify-center pb-1" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-muted-foreground/45" />
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-1 px-4 pb-1">
          <h2 className="min-w-0 flex-1 truncate text-[0.9375rem] font-semibold leading-none">{title}</h2>
          {trailing}
          <button
            type="button"
            onClick={toggle}
            aria-label={expanded ? collapseLabel : expandLabel}
            aria-expanded={expanded}
            title={expanded ? collapseLabel : expandLabel}
            className="-mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-sidebar-accent/70"
          >
            {expanded
              ? <ChevronDown className="size-5" strokeWidth={2} aria-hidden="true" />
              : <ChevronUp className="size-5" strokeWidth={2} aria-hidden="true" />}
          </button>
        </div>
      </header>
      <div
        data-phone-sheet-body=""
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: keyboardInset ? `${keyboardInset}px` : undefined }}
      >
        {children}
      </div>
    </section>
  );
}
