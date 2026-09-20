import { cn } from "../kit/utils.js";
import { SAFE_AREA_BOTTOM, SAFE_AREA_LEFT, SAFE_AREA_RIGHT } from "../kit/safeArea.js";
import { PHONE_NAV_HEIGHT } from "./phoneUi.js";

// The bottom bar: the one piece of chrome that never moves. Every part of the
// box is one tap away from anywhere, and the active tab tapped again puts the
// sheet away so the model has the whole screen.
export default function PhoneNav({ items, activeId, ariaLabel, onSelect }) {
  return (
    <nav
      data-phone-nav=""
      aria-label={ariaLabel}
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-40 cad-glass-surface border-t border-sidebar-border"
      style={{
        paddingBottom: SAFE_AREA_BOTTOM,
        paddingLeft: SAFE_AREA_LEFT,
        paddingRight: SAFE_AREA_RIGHT
      }}
    >
      <ul className="flex items-stretch" style={{ height: `${PHONE_NAV_HEIGHT}px` }}>
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
                  "flex h-full w-full flex-col items-center justify-center gap-1 px-0.5 transition-colors",
                  active ? "text-primary" : "text-muted-foreground active:text-foreground"
                )}
              >
                {/* The pill behind the icon is what marks the active tab on a
                    phone; colour alone is not enough in bright sun, and it is
                    the one shape that survives both themes. */}
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    active && "bg-primary/15"
                  )}
                >
                  <Icon className="size-5" strokeWidth={active ? 2.25 : 1.75} aria-hidden="true" />
                </span>
                <span
                  className={cn(
                    "min-w-0 max-w-full truncate text-[0.6875rem] leading-none",
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
  );
}
