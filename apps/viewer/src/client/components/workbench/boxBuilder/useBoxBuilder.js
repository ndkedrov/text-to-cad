import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildBoxPlan } from "@/workbench/boxBuilder/boxPlan.js";
import {
  boxDimensions,
  boxSpecWarnings,
  defaultBoxSpec,
  normalizeBoxSpec
} from "@/workbench/boxBuilder/boxSpec.js";

// The unsaved box survives a reload: it is a draft on this machine, not a file.
const DRAFT_STORAGE_KEY = "cad-viewer:box-builder:draft:v1";
const DRAFT_WRITE_DELAY_MS = 400;
const HISTORY_LIMIT = 200;

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
  const [, setHistoryVersion] = useState(0);
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
  const warnings = useMemo(() => boxSpecWarnings(spec), [spec]);
  const dirty = savedKey !== documentKey(name, spec);

  // A selection that points at something deleted (or undone away) is no selection.
  const effectiveSelection = useMemo(() => {
    if (!selection) {
      return null;
    }
    const list = selection.kind === "hole" ? spec.holes : spec.standoffs;
    return list.some((item) => item.id === selection.id) ? selection : null;
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
