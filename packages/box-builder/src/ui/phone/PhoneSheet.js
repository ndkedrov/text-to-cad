import { useCallback, useRef, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "../kit/utils.js";
import { PHONE_SHEET_HEADER_HEIGHT } from "./phoneUi.js";
import { LIQUID_GLASS_BLUR, liquidGlassStyle } from "./liquidGlass.js";
import { settleDetent } from "./phoneSheetMath.js";

// The panel on a phone: a sheet that rises from above the navigation bar.
//
// It rests at one of three detents — away, half the screen, or all of it under
// the top bar — because a box is edited while watching it change. A sheet that
// only knows "open" and "closed" hides the model exactly when the number being
// dragged is the one that moves it, which is what the first build did with a
// full-width drawer over the scene. Where those stops are, and where a drag
// settles, is phoneSheetMath.js.

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
        "pointer-events-auto absolute inset-x-0 bottom-0 z-30 flex flex-col overflow-hidden text-sidebar-foreground",
        LIQUID_GLASS_BLUR,
        !drag && "transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
      )}
      style={{
        ...liquidGlassStyle({ radius: "1.5rem 1.5rem 0 0", strength: 0.72 }),
        height: `${visibleHeight}px`
      }}
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
