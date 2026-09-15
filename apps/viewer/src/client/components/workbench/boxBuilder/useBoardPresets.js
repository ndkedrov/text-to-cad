import { useEffect, useState } from "react";
import { fetchBoardPresets } from "@/workbench/boxBuilder/boxApi.js";

// The server's circuit-board templates, fetched once per page. A server without
// the route, or a failed request, leaves only "Custom".
let presetsPromise = null;

export function useBoardPresets() {
  const [presets, setPresets] = useState([]);
  useEffect(() => {
    let cancelled = false;
    if (!presetsPromise) {
      presetsPromise = fetchBoardPresets()
        .then((payload) => (Array.isArray(payload?.boards) ? payload.boards : []))
        .catch(() => {
          presetsPromise = null;
          return [];
        });
    }
    presetsPromise.then((boards) => {
      if (!cancelled) {
        setPresets(boards);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return presets;
}
