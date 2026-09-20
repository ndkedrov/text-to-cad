import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { cn } from "../kit/utils.js";
import PhoneModal from "./PhoneModal.js";
import { usePhoneLabels } from "./phoneUi.js";

// Choosing one of a list, on a phone.
//
// A dropdown anchored to its trigger is a desktop shape: on a phone it lands
// wherever the trigger happens to sit, covers the thing being configured, and
// gives a 116-board list a 280px window in the middle of the screen. The same
// choice as a sheet gets the full width, full-height rows, and a search field
// the keyboard can rise under without hiding anything that matters.

function groupOptions(options) {
  const groups = [];
  const byName = new Map();
  for (const option of options) {
    const name = option.group || "";
    if (!byName.has(name)) {
      const group = { name, options: [] };
      byName.set(name, group);
      groups.push(group);
    }
    byName.get(name).options.push(option);
  }
  return groups;
}

export function PhonePickerTrigger({ label, value, placeholder, disabled, onClick, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      data-slot="select-trigger"
      className={cn(
        "flex h-[var(--fs-control-h,2.75rem)] w-fit min-w-[var(--fs-value-w,7rem)] max-w-[14rem] items-center justify-between gap-1.5 overflow-hidden",
        "rounded-[var(--fs-radius,0.75rem)] border border-input bg-transparent px-3 text-[length:var(--fs-control-text,0.9375rem)] shadow-xs outline-none",
        "disabled:opacity-50 dark:bg-input/30",
        className
      )}
    >
      <span className={cn("min-w-0 truncate", !value && "text-muted-foreground")}>
        {value || placeholder || ""}
      </span>
      <ChevronDown className="size-[var(--fs-icon,1.125rem)] shrink-0 opacity-60" aria-hidden="true" />
    </button>
  );
}

export default function PhonePicker({
  open,
  onOpenChange,
  title,
  options,
  value,
  onValueChange,
  searchable = false,
  searchPlaceholder
}) {
  const labels = usePhoneLabels();
  const [query, setQuery] = useState("");
  const selectedRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery("");
    }
  }, [open]);

  // The list opens on what is already chosen: in 116 boards, scrolling to find
  // where you are is the whole cost of opening the list.
  useEffect(() => {
    if (open) {
      const frame = requestAnimationFrame(() => {
        selectedRef.current?.scrollIntoView?.({ block: "center" });
      });
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [open]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return options;
    }
    return options.filter((option) => String(option.label).toLowerCase().includes(needle));
  }, [options, query]);

  const groups = useMemo(() => groupOptions(shown), [shown]);

  return (
    <PhoneModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      closeLabel={labels.close}
      size="tall"
    >
      {searchable ? (
        <div className="sticky top-0 z-10 cad-glass-popover px-4 pb-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={searchPlaceholder || labels.search}
              aria-label={searchPlaceholder || labels.search}
              className="h-11 w-full rounded-[var(--fs-radius,0.75rem)] border border-input bg-transparent pl-9 pr-3 text-[0.9375rem] text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring dark:bg-input/30"
            />
          </div>
        </div>
      ) : null}
      <ul className="px-2 pb-2" role="listbox" aria-label={title}>
        {groups.length === 0 ? (
          <li className="px-3 py-6 text-center text-[0.9375rem] text-muted-foreground">{labels.empty}</li>
        ) : null}
        {groups.map((group) => (
          <li key={group.name || "_"}>
            {group.name ? (
              <div className="px-3 pb-1 pt-4 text-[0.6875rem] font-semibold uppercase tracking-wide text-muted-foreground">
                {group.name}
              </div>
            ) : null}
            <ul>
              {group.options.map((option) => {
                const selected = option.value === value;
                return (
                  <li key={option.value}>
                    <button
                      ref={selected ? selectedRef : null}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      onClick={() => {
                        onValueChange?.(option.value);
                        onOpenChange?.(false);
                      }}
                      className={cn(
                        "flex min-h-[3rem] w-full items-center gap-3 rounded-[0.75rem] px-3 text-left transition-colors active:bg-sidebar-accent",
                        selected && "bg-sidebar-accent/60"
                      )}
                    >
                      {/* Two lines rather than an ellipsis: the full width is
                          already there, and a truncated board name is the one
                          thing the list exists to tell apart. */}
                      <span className={cn("min-w-0 flex-1 py-2 text-[0.9375rem] leading-5 [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] overflow-hidden", selected && "font-semibold")}>
                        {option.label}
                      </span>
                      {selected ? (
                        <Check className="size-5 shrink-0 text-primary" strokeWidth={2.25} aria-hidden="true" />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ul>
    </PhoneModal>
  );
}
