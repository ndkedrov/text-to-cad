import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "../kit/utils.js";
import PhoneNav from "./PhoneNav.js";
import PhoneModal from "./PhoneModal.js";
import PhoneSheet from "./PhoneSheet.js";
import { usePhoneViewport } from "./phoneViewport.js";
import { phoneSheetHeights } from "./phoneSheetMath.js";
import { PHONE_NAV_HEIGHT, PHONE_UI_TOKENS, PhoneUiProvider } from "./phoneUi.js";

// The phone chrome of the box builder: a navigation bar that never moves, a
// sheet that rises over the scene to whatever height the work needs, and the
// file actions as a modal rather than a sixth pane of settings.
//
// Nothing here has a desktop counterpart: beside a scene the panel is a column
// with a tab strip, which is the right shape for a mouse and the wrong one for
// a thumb. The two layouts share the controls inside them and nothing else.

// The tokens have to reach Radix's portals, which render at the end of <body>
// and so inherit from the document, never from this shell.
function usePhoneTokensOnRoot(active) {
  useEffect(() => {
    if (!active || typeof document === "undefined") {
      return undefined;
    }
    const root = document.documentElement;
    for (const [name, value] of Object.entries(PHONE_UI_TOKENS)) {
      root.style.setProperty(name, value);
    }
    return () => {
      for (const name of Object.keys(PHONE_UI_TOKENS)) {
        root.style.removeProperty(name);
      }
    };
  }, [active]);
}

export default function BoxBuilderPhoneShell({
  sections,
  modalSections = [],
  activeId,
  onActiveIdChange,
  onInsetsChange,
  navLabel,
  expandLabel,
  collapseLabel,
  closeLabel,
  labels,
  sheetActions = null
}) {
  const viewport = usePhoneViewport();
  const [detent, setDetent] = useState("half");
  const [modalId, setModalId] = useState("");

  usePhoneTokensOnRoot(true);

  const heights = useMemo(() => phoneSheetHeights(viewport), [viewport]);
  const modalSection = modalSections.find((section) => section.id === modalId) || null;
  const activeSection = sections.find((section) => section.id === activeId) || sections[0] || null;

  // What the scene has left to itself, so the model is framed in the part of
  // the screen that is actually showing it.
  const navHeight = PHONE_NAV_HEIGHT + viewport.safeArea.bottom;
  const bottomInset = navHeight + heights[detent];
  useEffect(() => {
    onInsetsChange?.({ bottom: bottomInset });
  }, [bottomInset, onInsetsChange]);

  const select = useCallback((id) => {
    const modal = modalSections.find((section) => section.id === id);
    if (modal) {
      setModalId(id);
      return;
    }
    if (id === activeId) {
      // The tab you are on is the way back to the model.
      setDetent((current) => (current === "closed" ? "half" : "closed"));
      return;
    }
    onActiveIdChange?.(id);
    setDetent((current) => (current === "closed" ? "half" : current));
  }, [activeId, modalSections, onActiveIdChange]);

  const navItems = useMemo(
    () => [...sections, ...modalSections].map((section) => ({
      id: section.id,
      label: section.title,
      Icon: section.Icon
    })),
    [sections, modalSections]
  );

  return (
    <PhoneUiProvider labels={labels}>
      {viewport.probe}
      <div
        data-phone-shell=""
        style={PHONE_UI_TOKENS}
        className="pointer-events-none fixed inset-0 z-30"
      >
        <div className="absolute inset-x-0 top-0" style={{ bottom: `${navHeight}px` }}>
          <PhoneSheet
            title={activeSection?.title || ""}
            detent={detent}
            heights={heights}
            keyboardInset={viewport.keyboardInset}
            onDetentChange={setDetent}
            expandLabel={expandLabel}
            collapseLabel={collapseLabel}
            trailing={sheetActions}
          >
            <div className={cn("pb-6 pt-1")}>{activeSection?.content}</div>
          </PhoneSheet>
        </div>
        <PhoneNav
          items={navItems}
          activeId={modalId || activeId}
          ariaLabel={navLabel}
          onSelect={select}
        />
      </div>
      {modalSections.map((section) => (
        <PhoneModal
          key={section.id}
          open={modalId === section.id}
          onOpenChange={(open) => setModalId(open ? section.id : "")}
          title={section.title}
          closeLabel={closeLabel}
          bodyClassName="pb-4"
        >
          {section.content}
        </PhoneModal>
      ))}
    </PhoneUiProvider>
  );
}
