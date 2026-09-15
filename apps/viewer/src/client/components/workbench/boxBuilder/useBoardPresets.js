import { useEffect, useState } from "react";
import { fetchBoardPresets } from "@/workbench/boxBuilder/boxApi.js";

// The server's circuit-board templates: { boards, categories }. Fetched whenever
// the board list is shown and again whenever this tab comes back into view, so
// presets an admin publishes in another tab are offered without a reload. Until
// an answer arrives (or when the server has no such route) the last list seen on
// this page is used, which starts empty: only "Custom".
let lastPresets = { boards: [], categories: [] };

export function useBoardPresets() {
  const [presets, setPresets] = useState(lastPresets);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      fetchBoardPresets().then(
        (payload) => {
          if (!cancelled && Array.isArray(payload?.boards)) {
            lastPresets = {
              boards: payload.boards,
              categories: Array.isArray(payload.categories) ? payload.categories : []
            };
            setPresets(lastPresets);
          }
        },
        () => {}
      );
    };
    const refreshWhenShown = () => {
      if (!document.hidden) {
        refresh();
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenShown);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenShown);
    };
  }, []);
  return presets;
}
