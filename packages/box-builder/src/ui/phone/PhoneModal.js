import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { cn } from "../kit/utils.js";
import { SAFE_AREA_BOTTOM, SAFE_AREA_LEFT, SAFE_AREA_RIGHT, SAFE_AREA_TOP } from "../kit/safeArea.js";
import { PHONE_UI_TOKENS, PhoneUiProvider } from "./phoneUi.js";

// A phone modal: the card rises from the bottom edge, stops short of the status
// bar, and keeps its own header and footer in place while only the middle
// scrolls. The footer is where the one action that finishes the task lives —
// a phone reaches its bottom edge with a thumb and its top edge with a stretch.
//
// `size="auto"` hugs the content for a short question; `size="tall"` takes the
// screen for a list or a form.
export default function PhoneModal({
  open,
  onOpenChange,
  title,
  description,
  closeLabel,
  size = "auto",
  footer = null,
  bodyClassName,
  children
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/45 backdrop-blur-[2px]",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0"
          )}
        />
        <Dialog.Content
          data-phone-modal={size}
          style={{
            ...PHONE_UI_TOKENS,
            // Never under the status bar, and never taller than what is left.
            maxHeight: `calc(100% - ${SAFE_AREA_TOP} - 2.5rem)`,
            height: size === "tall" ? `calc(100% - ${SAFE_AREA_TOP} - 2.5rem)` : undefined,
            paddingLeft: SAFE_AREA_LEFT,
            paddingRight: SAFE_AREA_RIGHT
          }}
          className={cn(
            "cad-glass-popover fixed inset-x-0 bottom-0 z-50 flex flex-col",
            "rounded-t-[1.25rem] border-t border-sidebar-border text-sidebar-foreground",
            "shadow-[0_-16px_48px_-20px_rgb(0_0_0/0.6)]",
            "data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=closed]:duration-200",
            "data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom data-[state=open]:duration-300",
          )}
        >
          <PhoneUiProvider>
            <div className="flex h-4 shrink-0 items-end justify-center pb-1" aria-hidden="true">
              <span className="h-1 w-9 rounded-full bg-muted-foreground/45" />
            </div>
            <header className="flex shrink-0 items-start gap-2 px-4 pb-3">
              <div className="min-w-0 flex-1 pt-2">
                <Dialog.Title className="truncate text-base font-semibold leading-tight">{title}</Dialog.Title>
                {description ? (
                  <Dialog.Description className="mt-1 text-[0.8125rem] leading-5 text-muted-foreground">
                    {description}
                  </Dialog.Description>
                ) : (
                  <Dialog.Description className="sr-only">{title}</Dialog.Description>
                )}
              </div>
              <Dialog.Close
                aria-label={closeLabel}
                className="-mr-2 -mt-1 flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-sidebar-accent/70"
              >
                <X className="size-5" strokeWidth={2} aria-hidden="true" />
              </Dialog.Close>
            </header>
            <div
              className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", bodyClassName)}
              style={footer ? undefined : { paddingBottom: SAFE_AREA_BOTTOM }}
            >
              {children}
            </div>
            {footer ? (
              <footer
                className="shrink-0 border-t border-sidebar-border/70 px-4 pt-3"
                style={{ paddingBottom: `calc(0.75rem + ${SAFE_AREA_BOTTOM})` }}
              >
                {footer}
              </footer>
            ) : null}
          </PhoneUiProvider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
