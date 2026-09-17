import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PLAN_NODE_LIMIT, PLAN_POINT_LIMIT, buildBoxPlan, countPlanNodes, countPlanPoints } from "../core/boxPlan.js";
import {
  boxDimensions,
  boxSpecWarnings,
  defaultBoxSpec,
  normalizeBoxSpec
} from "../core/boxSpec.js";

// The unsaved box survives a reload: it is a draft on this machine, not a file.
const DRAFT_STORAGE_KEY = "cad-viewer:box-builder:draft:v1";
const DRAFT_WRITE_DELAY_MS = 400;
const HISTORY_LIMIT = 200;
// How the viewport draws things, remembered in this browser; not part of the box.
const DISPLAY_STORAGE_KEY = "cad-viewer:box-builder:display:v1";
const DEFAULT_DISPLAY = Object.freeze({ groundMm: true, boxMm: false, boards: true });

function readDisplay() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(DISPLAY_STORAGE_KEY) || "{}");
    return Object.fromEntries(Object.entries(DEFAULT_DISPLAY).map(([key, fallback]) => (
      [key, typeof parsed?.[key] === "boolean" ? parsed[key] : fallback]
    )));
  } catch {
    return { ...DEFAULT_DISPLAY };
  }
}

function readDraft() {
  try {
    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    return {
      name: typeof parsed?.name === "string" ? parsed.name : "box",
      spec: normalizeBoxSpec(parsed?.spec),
      savedKey: typeof parsed?.savedKey === "string" ? parsed.savedKey : null
    };
  } catch {
    return null;
  }
}

function writeDraft(draft) {
  try {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Storage full or blocked: the draft is a convenience, the saved file is the record.
  }
}

function cloneSpec(spec) {
  return JSON.parse(JSON.stringify(spec));
}

function sameSpec(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function documentKey(name, spec) {
  return JSON.stringify({ name, spec });
}

// Editable box state: the spec, its undo history, the selected hole or standoff
// group, whether it matches what was last saved, and everything derived from it
// (dimensions, preview plan, warnings).
export function useBoxBuilder() {
  const [initial] = useState(() => readDraft() || {
    name: "box",
    spec: normalizeBoxSpec(defaultBoxSpec()),
    savedKey: null
  });
  const [spec, setSpecState] = useState(initial.spec);
  const [name, setName] = useState(initial.name);
  const [savedKey, setSavedKey] = useState(initial.savedKey);
  const [selection, setSelection] = useState(null);
  const [display, setDisplayState] = useState(readDisplay);
  const [, setHistoryVersion] = useState(0);

  const setDisplay = useCallback((patch) => {
    setDisplayState((current) => {
      const next = { ...current, ...patch };
      try {
        window.localStorage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Blocked storage: the choice lasts for this page.
      }
      return next;
    });
  }, []);
  const specRef = useRef(spec);
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const gestureOriginRef = useRef(null);

  const applySpec = useCallback((next) => {
    specRef.current = next;
    setSpecState(next);
  }, []);

  const pushHistory = useCallback((previous) => {
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), previous];
    futureRef.current = [];
    setHistoryVersion((version) => version + 1);
  }, []);

  // One undoable change. `mutate` edits a copy of the spec in place.
  const edit = useCallback((mutate) => {
    const draft = cloneSpec(specRef.current);
    mutate(draft);
    const next = normalizeBoxSpec(draft);
    const previous = specRef.current;
    if (sameSpec(previous, next)) {
      return;
    }
    pushHistory(previous);
    applySpec(next);
  }, [applySpec, pushHistory]);

  // A drag is one undo step however many frames it takes.
  const beginGesture = useCallback(() => {
    if (!gestureOriginRef.current) {
      gestureOriginRef.current = specRef.current;
    }
  }, []);

  const gestureEdit = useCallback((mutate) => {
    const draft = cloneSpec(specRef.current);
    mutate(draft);
    applySpec(normalizeBoxSpec(draft));
  }, [applySpec]);

  const endGesture = useCallback(({ cancel = false } = {}) => {
    const origin = gestureOriginRef.current;
    gestureOriginRef.current = null;
    if (!origin) {
      return;
    }
    if (cancel) {
      applySpec(origin);
      return;
    }
    if (!sameSpec(origin, specRef.current)) {
      pushHistory(origin);
    }
  }, [applySpec, pushHistory]);

  const undo = useCallback(() => {
    if (!pastRef.current.length) {
      return;
    }
    const previous = pastRef.current[pastRef.current.length - 1];
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, specRef.current];
    applySpec(previous);
    setHistoryVersion((version) => version + 1);
  }, [applySpec]);

  const redo = useCallback(() => {
    if (!futureRef.current.length) {
      return;
    }
    const next = futureRef.current[futureRef.current.length - 1];
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, specRef.current];
    applySpec(next);
    setHistoryVersion((version) => version + 1);
  }, [applySpec]);

  // Opening a saved box or starting over: a new document, so a fresh history.
  const replace = useCallback((nextName, nextSpec, { saved = false } = {}) => {
    const normalized = normalizeBoxSpec(nextSpec);
    pastRef.current = [];
    futureRef.current = [];
    gestureOriginRef.current = null;
    setSelection(null);
    setName(nextName);
    setSavedKey(saved ? documentKey(nextName, normalized) : null);
    applySpec(normalized);
    setHistoryVersion((version) => version + 1);
  }, [applySpec]);

  const markSaved = useCallback((savedName, savedSpec) => {
    setSavedKey(documentKey(savedName, normalizeBoxSpec(savedSpec)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => writeDraft({ name, spec, savedKey }), DRAFT_WRITE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [name, spec, savedKey]);

  const dims = useMemo(() => boxDimensions(spec), [spec]);
  const plan = useMemo(() => buildBoxPlan(spec), [spec]);
  const warnings = useMemo(() => {
    const list = boxSpecWarnings(spec);
    // The saved lid is turned over for printing: one more node than the preview's.
    const nodes = countPlanNodes(plan.base) + countPlanNodes(plan.lid) + (plan.lid ? 1 : 0)
      + countPlanNodes(plan.inlay) + (plan.inlay ? 1 : 0);
    if (nodes > PLAN_NODE_LIMIT) {
      list.push({ key: "warning.tooComplex", params: { count: nodes, limit: PLAN_NODE_LIMIT } });
    }
    const points = countPlanPoints(plan.base) + countPlanPoints(plan.lid) + countPlanPoints(plan.inlay);
    if (points > PLAN_POINT_LIMIT) {
      list.push({ key: "warning.tooManyPoints", params: { count: points, limit: PLAN_POINT_LIMIT } });
    }
    return list;
  }, [spec, plan]);
  const dirty = savedKey !== documentKey(name, spec);

  // A selection that points at something deleted (or undone away) is no selection.
  const effectiveSelection = useMemo(() => {
    if (!selection) {
      return null;
    }
    const lists = { hole: spec.holes, standoff: spec.standoffs, board: spec.boards };
    return (lists[selection.kind] || []).some((item) => item.id === selection.id) ? selection : null;
  }, [selection, spec]);

  return {
    spec,
    name,
    setName,
    dims,
    plan,
    warnings,
    dirty,
    markSaved,
    selection: effectiveSelection,
    setSelection,
    display,
    setDisplay,
    edit,
    beginGesture,
    gestureEdit,
    endGesture,
    undo,
    redo,
    canUndo: pastRef.current.length > 0,
    canRedo: futureRef.current.length > 0,
    replace
  };
}
