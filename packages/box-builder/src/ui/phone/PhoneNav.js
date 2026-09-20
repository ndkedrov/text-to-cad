import { cn } from "../kit/utils.js";
import { SAFE_AREA_BOTTOM, SAFE_AREA_LEFT, SAFE_AREA_RIGHT } from "../kit/safeArea.js";
import { PHONE_DOCK_GAP, PHONE_DOCK_HEIGHT } from "./phoneMetrics.js";
import { LIQUID_GLASS_BLUR, liquidGlassSelectionStyle, liquidGlassStyle } from "./liquidGlass.js";

// The dock: the one piece of chrome that never moves. Every part of the box is
// one tap away from anywhere, and the tab you are on, tapped again, puts the
// sheet away so the model has the whole screen.
//
// It floats clear of the edges rather than filling the bottom of the screen,
// so the scene continues underneath it and the glass has something to refract.
export default function PhoneNav({ items, activeId, ariaLabel, onSelect }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-3"
      style={{
        paddingBottom: `calc(${PHONE_DOCK_GAP}px + ${SAFE_AREA_BOTTOM})`,
        paddingLeft: `calc(0.75rem + ${SAFE_AREA_LEFT})`,
        paddingRight: `calc(0.75rem + ${SAFE_AREA_RIGHT})`
      }}
    >
      <nav
        data-phone-nav=""
        aria-label={ariaLabel}
        className={cn("pointer-events-auto w-full max-w-md", LIQUID_GLASS_BLUR)}
        style={liquidGlassStyle({ radius: `${Math.round(PHONE_DOCK_HEIGHT / 2)}px`, strength: 0.7 })}
      >
        <ul className="flex items-stretch px-1.5" style={{ height: `${PHONE_DOCK_HEIGHT}px` }}>
          {items.map((item) => {
            const Icon = item.Icon;
            const active = item.id === activeId;
            return (
              <li key={item.id} className="min-w-0 flex-1">
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={active ? "page" : undefined}
                  data-phone-nav-item={item.id}
                  className={cn(
                    "relative flex h-full w-full flex-col items-center justify-center gap-[3px] px-0.5 transition-colors",
                    active ? "text-primary" : "text-muted-foreground active:text-foreground"
                  )}
                >
                  {/* The lens behind the chosen tab. Colour alone does not carry
                      in sunlight, and it is the one mark that survives both
                      themes. */}
                  {active ? (
                    <span
                      className="pointer-events-none absolute inset-y-1.5 inset-x-0.5"
                      style={liquidGlassSelectionStyle()}
                      aria-hidden="true"
                    />
                  ) : null}
                  <Icon
                    className="relative size-[1.3rem]"
                    strokeWidth={active ? 2.3 : 1.8}
                    aria-hidden="true"
                  />
                  <span
                    className={cn(
                      "relative min-w-0 max-w-full truncate text-[0.625rem] leading-none",
                      active ? "font-semibold" : "font-medium"
                    )}
                  >
                    {item.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
