import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Crosshair,
  Download,
  Eye,
  FolderOpen,
  LoaderCircle,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { copyTextToClipboard } from "@/ui/clipboard";
import { cn } from "@/ui/utils";
import {
  boxFileUrl,
  describeBoxError,
  fetchBoxStatus,
  isValidBoxName,
  listBoxes,
  loadBox,
  saveBox
} from "@/workbench/boxBuilder/boxApi.js";
import { centerSelected, duplicateSelected, removeSelected } from "@/workbench/boxBuilder/boxEdits.js";
import { buildBoxPlan } from "@/workbench/boxBuilder/boxPlan.js";
import {
  HOLE_FACES,
  HOLE_SHAPES,
  STANDOFF_PATTERNS,
  clampHolePosition,
  defaultBoxSpec,
  faceAxisLabels,
  faceRange,
  faceSizeLabels,
  holeAvailable,
  isWallFace,
  newHole,
  newStandoffGroup,
  roundMm
} from "@/workbench/boxBuilder/boxSpec.js";
import { formatWarning } from "@/workbench/boxBuilder/i18n.js";
import { refreshCadCatalog } from "@/workbench/cadManifestStore.js";
import FileSheet, {
  FILE_SHEET_COMPACT_BUTTON_CLASSES,
  FILE_SHEET_COMPACT_INPUT_CLASSES,
  FileSheetBooleanToggle,
  FileSheetButtonRow,
  FileSheetControlRow,
  FileSheetField,
  FileSheetFieldGrid,
  FileSheetInlineControlRow,
  FileSheetItemGroup,
  FileSheetSelectRow,
  FileSheetStatusText,
  FileSheetSubsection,
  FileSheetValueInput,
  parseFileSheetNumberInput
} from "../FileSheet";
import FileSheetTabbedSurface from "../FileSheetTabbedSurface";
import { useBoxLanguage } from "./useBoxLanguage";

const SECTION_IDS = Object.freeze({
  BODY: "box-body",
  LID: "box-lid",
  HOLES: "box-holes",
  STANDOFFS: "box-standoffs",
  FILE: "box-file"
});

const FORMAT_ORDER = ["step", "stl", "3mf"];
const STATUS_POLL_MS = 800;

// --- inputs ------------------------------------------------------------------

function formatNumber(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? String(Number(number.toFixed(digits))) : "";
}

function formatValue(value, unit, digits) {
  const text = formatNumber(value, digits);
  if (!unit) {
    return text;
  }
  return unit === "°" ? `${text}°` : `${text} ${unit}`;
}

function NumberInput({
  value,
  onCommit,
  unit = "mm",
  digits = 2,
  min = -Infinity,
  max = Infinity,
  step = 0.5,
  ariaLabel,
  className
}) {
  return (
    <FileSheetValueInput
      value={formatValue(value, unit, digits)}
      ariaLabel={ariaLabel}
      className={className}
      step={step}
      min={min}
      max={max}
      onValueCommit={(raw) => {
        const next = roundMm(parseFileSheetNumberInput(raw, { fallback: value, min, max }), 4);
        if (Math.abs(next - value) > 1e-9) {
          onCommit(next);
        }
      }}
    />
  );
}

function NumberRow({ label, ...props }) {
  return (
    <FileSheetInlineControlRow label={label}>
      <NumberInput ariaLabel={label} className="w-24" {...props} />
    </FileSheetInlineControlRow>
  );
}

function NumberField({ label, ...props }) {
  return (
    <FileSheetField label={label}>
      <NumberInput ariaLabel={label} className="w-full" {...props} />
    </FileSheetField>
  );
}

function CompactButton({ icon: Icon, children, className, ...props }) {
  return (
    <Button type="button" size="sm" variant="outline" className={cn(FILE_SHEET_COMPACT_BUTTON_CLASSES, className)} {...props}>
      {Icon ? <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

function SelectableItem({ selected, onSelect, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (selected) {
      ref.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);
  return (
    <div
      ref={ref}
      data-selected={selected ? "true" : undefined}
      className={cn("rounded-md py-1 transition-colors [&:not(:first-child)]:mt-3", selected && "bg-sidebar-accent/70")}
      onPointerDownCapture={() => {
        if (!selected) {
          onSelect();
        }
      }}
      onFocusCapture={() => {
        if (!selected) {
          onSelect();
        }
      }}
    >
      {children}
    </div>
  );
}

function ItemActions({ builder, selection }) {
  const { t } = useBoxLanguage();
  return (
    <FileSheetButtonRow columns={3}>
      <CompactButton icon={Crosshair} onClick={() => builder.edit((draft) => centerSelected(draft, selection))}>
        {t("action.center")}
      </CompactButton>
      <CompactButton
        icon={Copy}
        onClick={() => {
          let copy = null;
          builder.edit((draft) => {
            copy = duplicateSelected(draft, selection);
          });
          if (copy) {
            builder.setSelection(copy);
          }
        }}
      >
        {t("action.copy")}
      </CompactButton>
      <CompactButton
        icon={Trash2}
        onClick={() => {
          builder.edit((draft) => removeSelected(draft, selection));
          builder.setSelection(null);
        }}
      >
        {t("action.delete")}
      </CompactButton>
    </FileSheetButtonRow>
  );
}

// --- tabs --------------------------------------------------------------------

function BodyTab({ builder }) {
  const { t } = useBoxLanguage();
  const { spec, dims, edit } = builder;
  const set = (group, key) => (value) => edit((draft) => {
    draft[group][key] = value;
  });
  const half = Math.min(spec.base.width, spec.base.depth) / 2;
  return (
    <div>
      <FileSheetSubsection title={t("section.floor")}>
        <NumberRow label={t("field.width")} value={spec.base.width} min={10} max={500} step={1} onCommit={set("base", "width")} />
        <NumberRow label={t("field.depth")} value={spec.base.depth} min={10} max={500} step={1} onCommit={set("base", "depth")} />
        <NumberRow label={t("field.floorThickness")} value={spec.base.thickness} min={0.4} max={50} step={0.2} onCommit={set("base", "thickness")} />
        <NumberRow label={t("field.cornerRadius")} value={spec.base.radius} min={0} max={half} step={0.5} onCommit={set("base", "radius")} />
      </FileSheetSubsection>
      <FileSheetSubsection
        title={t("section.walls")}
        trailing={(
          <FileSheetBooleanToggle
            checked={spec.walls.enabled}
            onCheckedChange={set("walls", "enabled")}
            ariaLabel={t("section.walls")}
          />
        )}
      >
        {spec.walls.enabled ? (
          <>
            <NumberRow label={t("field.wallHeight")} value={spec.walls.height} min={1} max={500} step={1} onCommit={set("walls", "height")} />
            <NumberRow label={t("field.wallThickness")} value={spec.walls.thickness} min={0.4} max={Math.max(0.4, half - 1)} step={0.2} onCommit={set("walls", "thickness")} />
          </>
        ) : null}
      </FileSheetSubsection>
      <FileSheetSubsection title={t("section.dimensions")}>
        <FileSheetControlRow
          label={t("field.overall")}
          value={`${formatNumber(dims.width)} × ${formatNumber(dims.depth)} × ${formatNumber(dims.totalHeight)} mm`}
        />
        {dims.wallsEnabled ? (
          <FileSheetControlRow
            label={t("field.inside")}
            value={`${formatNumber(dims.innerWidth)} × ${formatNumber(dims.innerDepth)} × ${formatNumber(dims.wallHeight)} mm`}
          />
        ) : null}
      </FileSheetSubsection>
    </div>
  );
}

function LidTab({ builder }) {
  const { t } = useBoxLanguage();
  const { spec, dims, edit } = builder;
  const set = (key) => (value) => edit((draft) => {
    draft.lid[key] = value;
  });
  if (!spec.walls.enabled) {
    return (
      <div className="pt-2">
        <FileSheetStatusText>{t("lid.needsWalls")}</FileSheetStatusText>
      </div>
    );
  }
  return (
    <div>
      <FileSheetSubsection
        title={t("section.lid")}
        trailing={<FileSheetBooleanToggle checked={spec.lid.enabled} onCheckedChange={set("enabled")} ariaLabel={t("section.lid")} />}
      >
        {spec.lid.enabled ? (
          <NumberRow label={t("field.thickness")} value={spec.lid.thickness} min={0.4} max={50} step={0.2} onCommit={set("thickness")} />
        ) : null}
      </FileSheetSubsection>
      {spec.lid.enabled ? (
        <FileSheetSubsection
          title={t("section.lip")}
          trailing={<FileSheetBooleanToggle checked={spec.lid.lip} onCheckedChange={set("lip")} ariaLabel={t("section.lip")} />}
        >
          {spec.lid.lip ? (
            <>
              <NumberRow label={t("field.height")} value={spec.lid.lipHeight} min={0.5} max={spec.walls.height} step={0.5} onCommit={set("lipHeight")} />
              <NumberRow label={t("field.thickness")} value={spec.lid.lipThickness} min={0.4} max={50} step={0.1} onCommit={set("lipThickness")} />
              <NumberRow label={t("field.clearance")} value={spec.lid.clearance} min={0} max={3} step={0.05} onCommit={set("clearance")} />
              <FileSheetControlRow
                label={t("field.lipSize")}
                value={`${formatNumber(dims.lipWidth)} × ${formatNumber(dims.lipDepth)} mm`}
              />
            </>
          ) : null}
        </FileSheetSubsection>
      ) : null}
    </div>
  );
}

function HoleItem({ builder, hole, index }) {
  const { t } = useBoxLanguage();
  const { dims, edit, selection, setSelection } = builder;
  const itemSelection = { kind: "hole", id: hole.id };
  const selected = selection?.kind === "hole" && selection.id === hole.id;
  const update = (mutate) => edit((draft) => {
    const target = draft.holes.find((entry) => entry.id === hole.id);
    if (target) {
      mutate(target);
    }
  });
  const patch = (values) => update((target) => Object.assign(target, values));
  const [labelU, labelV] = faceAxisLabels(hole.face).map((key) => t(key));
  const [sizeU, sizeV] = faceSizeLabels(hole.face).map((key) => t(key));
  const range = faceRange(dims, hole.face);
  const round = hole.shape === "circle" || hole.shape === "hex";

  const changeFace = (face) => update((target) => {
    const sameKind = isWallFace(face) === isWallFace(target.face);
    const u = sameKind ? target.u : 0;
    const v = sameKind ? target.v : isWallFace(face) ? roundMm(dims.floorTop + dims.wallHeight / 2, 2) : 0;
    target.face = face;
    Object.assign(target, clampHolePosition(dims, target, u, v));
  });

  return (
    <SelectableItem selected={selected} onSelect={() => setSelection(itemSelection)}>
      <FileSheetItemGroup label={t("item.hole", { n: index + 1 })} className="!mt-0">
        <FileSheetSelectRow
          label={t("field.face")}
          value={hole.face}
          onValueChange={changeFace}
          options={HOLE_FACES.map((face) => ({
            value: face,
            label: holeAvailable(dims, face) ? t(`face.${face}`) : t("face.off", { face: t(`face.${face}`) })
          }))}
        />
        <FileSheetSelectRow
          label={t("field.shape")}
          value={hole.shape}
          onValueChange={(shape) => patch({ shape })}
          options={HOLE_SHAPES.map((shape) => ({ value: shape, label: t(`shape.${shape}`) }))}
        />
        {round ? (
          <NumberRow
            label={hole.shape === "hex" ? t("field.acrossFlats") : t("field.diameter")}
            value={hole.width}
            min={0.3}
            max={500}
            step={0.5}
            onCommit={(width) => patch({ width, height: width })}
          />
        ) : (
          <FileSheetFieldGrid columns={hole.shape === "rect" ? 3 : 2}>
            <NumberField label={sizeU} value={hole.width} min={0.3} max={500} step={0.5} onCommit={(width) => patch({ width })} />
            <NumberField label={sizeV} value={hole.height} min={0.3} max={500} step={0.5} onCommit={(height) => patch({ height })} />
            {hole.shape === "rect" ? (
              <NumberField label={t("field.radius")} value={hole.radius} min={0} max={Math.min(hole.width, hole.height) / 2} step={0.25} onCommit={(radius) => patch({ radius })} />
            ) : null}
          </FileSheetFieldGrid>
        )}
        <FileSheetFieldGrid columns={hole.shape === "circle" ? 2 : 3}>
          <NumberField label={labelU} value={hole.u} min={range.u[0]} max={range.u[1]} step={0.5} onCommit={(u) => patch({ u })} />
          <NumberField label={labelV} value={hole.v} min={range.v[0]} max={range.v[1]} step={0.5} onCommit={(v) => patch({ v })} />
          {hole.shape !== "circle" ? (
            <NumberField label={t("field.rotation")} unit="°" digits={1} value={hole.rotation} min={-360} max={360} step={15} onCommit={(rotation) => patch({ rotation })} />
          ) : null}
        </FileSheetFieldGrid>
        <ItemActions builder={builder} selection={itemSelection} />
      </FileSheetItemGroup>
    </SelectableItem>
  );
}

function HolesTab({ builder }) {
  const { t } = useBoxLanguage();
  const { spec, dims, edit, setSelection } = builder;
  const [face, setFace] = useState("floor");
  const faces = HOLE_FACES.filter((candidate) => holeAvailable(dims, candidate));
  const activeFace = faces.includes(face) ? face : "floor";
  const addHole = () => {
    let created = null;
    edit((draft) => {
      created = newHole(draft, activeFace);
      draft.holes.push(created);
    });
    if (created) {
      setSelection({ kind: "hole", id: created.id });
    }
  };
  return (
    <div>
      <FileSheetSubsection title={t("section.newHole")}>
        <FileSheetSelectRow
          label={t("field.face")}
          value={activeFace}
          onValueChange={setFace}
          options={faces.map((value) => ({ value, label: t(`face.${value}`) }))}
        />
        <FileSheetButtonRow>
          <CompactButton icon={Plus} onClick={addHole}>{t("action.addHole")}</CompactButton>
        </FileSheetButtonRow>
      </FileSheetSubsection>
      <FileSheetSubsection title={t("section.holes")}>
        {spec.holes.length ? (
          spec.holes.map((hole, index) => (
            <HoleItem key={hole.id} builder={builder} hole={hole} index={index} />
          ))
        ) : (
          <FileSheetStatusText>{t("holes.empty")}</FileSheetStatusText>
        )}
      </FileSheetSubsection>
    </div>
  );
}

function StandoffItem({ builder, group, index }) {
  const { t } = useBoxLanguage();
  const { edit, selection, setSelection } = builder;
  const itemSelection = { kind: "standoff", id: group.id };
  const selected = selection?.kind === "standoff" && selection.id === group.id;
  const patch = (values) => edit((draft) => {
    const target = draft.standoffs.find((entry) => entry.id === group.id);
    if (target) {
      Object.assign(target, values);
    }
  });
  const spacingLabels = group.pattern === "triangle" ? ["spacing.base", "spacing.apex"] : ["spacing.x", "spacing.y"];
  return (
    <SelectableItem selected={selected} onSelect={() => setSelection(itemSelection)}>
      <FileSheetItemGroup label={t("item.standoffs", { n: index + 1 })} className="!mt-0">
        <FileSheetSelectRow
          label={t("field.pattern")}
          value={group.pattern}
          onValueChange={(pattern) => patch({ pattern })}
          options={STANDOFF_PATTERNS.map((pattern) => ({ value: pattern, label: t(`pattern.${pattern}`) }))}
        />
        {group.pattern === "line" ? (
          <NumberRow label={t("field.spacing")} value={group.spacingX} min={0} max={1000} step={0.5} onCommit={(spacingX) => patch({ spacingX })} />
        ) : (
          <FileSheetFieldGrid columns={2}>
            <NumberField
              label={t("field.spacingFirst", { axis: t(spacingLabels[0]).toLowerCase() })}
              value={group.spacingX}
              min={0}
              max={1000}
              step={0.5}
              onCommit={(spacingX) => patch({ spacingX })}
            />
            <NumberField label={t(spacingLabels[1])} value={group.spacingY} min={0} max={1000} step={0.5} onCommit={(spacingY) => patch({ spacingY })} />
          </FileSheetFieldGrid>
        )}
        <FileSheetFieldGrid columns={3}>
          <NumberField label={t("field.holeDiameter")} value={group.holeDiameter} min={0} max={group.outerDiameter - 0.4} step={0.1} onCommit={(holeDiameter) => patch({ holeDiameter })} />
          <NumberField label={t("field.padDiameter")} value={group.outerDiameter} min={1} max={200} step={0.5} onCommit={(outerDiameter) => patch({ outerDiameter })} />
          <NumberField label={t("field.height")} value={group.height} min={0.5} max={500} step={0.5} onCommit={(height) => patch({ height })} />
        </FileSheetFieldGrid>
        <FileSheetFieldGrid columns={3}>
          <NumberField label={t("field.centerX")} value={group.x} min={-2000} max={2000} step={0.5} onCommit={(x) => patch({ x })} />
          <NumberField label={t("field.centerY")} value={group.y} min={-2000} max={2000} step={0.5} onCommit={(y) => patch({ y })} />
          <NumberField label={t("field.rotation")} unit="°" digits={1} value={group.rotation} min={-360} max={360} step={15} onCommit={(rotation) => patch({ rotation })} />
        </FileSheetFieldGrid>
        <ItemActions builder={builder} selection={itemSelection} />
      </FileSheetItemGroup>
    </SelectableItem>
  );
}

function StandoffsTab({ builder }) {
  const { t } = useBoxLanguage();
  const { spec, edit, setSelection } = builder;
  const addGroup = () => {
    let created = null;
    edit((draft) => {
      created = newStandoffGroup(draft);
      draft.standoffs.push(created);
    });
    if (created) {
      setSelection({ kind: "standoff", id: created.id });
    }
  };
  return (
    <div>
      <FileSheetSubsection title={t("section.newStandoffs")}>
        <FileSheetButtonRow>
          <CompactButton icon={Plus} onClick={addGroup}>{t("action.addStandoffs")}</CompactButton>
        </FileSheetButtonRow>
      </FileSheetSubsection>
      <FileSheetSubsection title={t("section.standoffs")}>
        {spec.standoffs.length ? (
          spec.standoffs.map((group, index) => (
            <StandoffItem key={group.id} builder={builder} group={group} index={index} />
          ))
        ) : (
          <FileSheetStatusText>{t("standoffs.empty")}</FileSheetStatusText>
        )}
      </FileSheetSubsection>
    </div>
  );
}

function freeBoxName(boxes, base = "box") {
  const taken = new Set(boxes.map((box) => box.name));
  if (!taken.has(base)) {
    return base;
  }
  for (let index = 2; ; index += 1) {
    if (!taken.has(`${base}-${index}`)) {
      return `${base}-${index}`;
    }
  }
}

function buildSummary(status, t, language) {
  const build = status?.build;
  if (!build) {
    return null;
  }
  if (build.state === "queued") {
    return { tone: "muted", lines: [t("build.queued")] };
  }
  if (build.state === "building") {
    return { tone: "muted", lines: [t("build.running")] };
  }
  if (build.state === "error") {
    return {
      tone: "error",
      lines: Object.entries(build.parts)
        .filter(([, part]) => part.state === "error")
        .map(([part, info]) => `${t(`part.${part}`)}: ${info.error}`)
    };
  }
  const finished = build.finishedAt
    ? new Date(build.finishedAt * 1000).toLocaleTimeString(language === "uk" ? "uk-UA" : "en-GB")
    : "";
  return { tone: "muted", lines: [finished ? t("build.doneAt", { time: finished }) : t("build.done")] };
}

function quotaText(quota, t) {
  const parts = [];
  if (quota.dailyNewBoxes != null) {
    parts.push(t("quota.new", { used: quota.newBoxes, limit: quota.dailyNewBoxes }));
  }
  if (quota.dailyBuilds != null) {
    parts.push(t("quota.builds", { used: quota.builds, limit: quota.dailyBuilds }));
  }
  return parts.join(" · ");
}

function FileTab({ builder, onOpenFile, hosted = false }) {
  const { language, t } = useBoxLanguage();
  const { spec, name, setName, warnings, dirty, markSaved, replace, undo, redo, canUndo, canRedo } = builder;
  const [savedBoxes, setSavedBoxes] = useState([]);
  const [openTarget, setOpenTarget] = useState("");
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [quota, setQuota] = useState(null);
  const nameValid = isValidBoxName(name);
  const building = ["queued", "building"].includes(status?.build?.state);

  const refreshList = useCallback(async () => {
    try {
      const payload = await listBoxes();
      setSavedBoxes(Array.isArray(payload?.boxes) ? payload.boxes : []);
      if (payload?.quota) {
        setQuota(payload.quota);
      }
    } catch (listError) {
      setError(listError);
    }
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!nameValid) {
      setStatus(null);
      return undefined;
    }
    let cancelled = false;
    fetchBoxStatus(name).then(
      (payload) => {
        if (!cancelled) {
          setStatus(payload);
          if (payload?.quota) {
            setQuota(payload.quota);
          }
        }
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [name, nameValid]);

  useEffect(() => {
    if (!building) {
      return undefined;
    }
    const timer = window.setInterval(async () => {
      try {
        const payload = await fetchBoxStatus(name);
        setStatus(payload);
        if (payload?.quota) {
          setQuota(payload.quota);
        }
        if (!["queued", "building"].includes(payload?.build?.state)) {
          refreshCadCatalog();
        }
      } catch (pollError) {
        setError(pollError);
      }
    }, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [building, name]);

  const save = async () => {
    if (!nameValid) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const plan = buildBoxPlan(spec, { layout: "print" });
      const payload = await saveBox(name, { spec, plan: { base: plan.base, lid: plan.lid } });
      setStatus(payload);
      if (payload?.quota) {
        setQuota(payload.quota);
      }
      markSaved(name, spec);
      refreshList();
    } catch (saveError) {
      setError(saveError);
    } finally {
      setSaving(false);
    }
  };

  const openBox = async (target) => {
    if (!target) {
      return;
    }
    if (dirty && !window.confirm(t("confirm.open", { name: target }))) {
      return;
    }
    setError(null);
    try {
      const payload = await loadBox(target);
      replace(payload.name, payload.spec, { saved: true });
      setStatus(payload);
    } catch (loadError) {
      setError(loadError);
    }
  };

  const startNew = () => {
    if (dirty && !window.confirm(t("confirm.new"))) {
      return;
    }
    replace(freeBoxName(savedBoxes), defaultBoxSpec());
  };

  const summary = buildSummary(status, t, language);
  const outputs = Array.isArray(status?.outputs) ? status.outputs : [];
  const folderPath = outputs[0]?.path ? outputs[0].path.replace(/[\\/][^\\/]+$/u, "") : "";
  const selectedOpenTarget = savedBoxes.some((box) => box.name === openTarget) ? openTarget : (savedBoxes[0]?.name || "");

  return (
    <div>
      <FileSheetSubsection title={t("section.box")}>
        <FileSheetInlineControlRow label={t("field.name")}>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value.replace(/\s+/gu, "-"))}
            className={cn(FILE_SHEET_COMPACT_INPUT_CLASSES, "w-40")}
            aria-label={t("field.nameAria")}
            spellCheck={false}
          />
        </FileSheetInlineControlRow>
        {!nameValid ? (
          <FileSheetStatusText tone="error">{t("name.invalid")}</FileSheetStatusText>
        ) : null}
        {hosted ? null : <FileSheetControlRow label={t("field.folder")} value={`boxes/${name}`} />}
        <FileSheetControlRow label={t("field.state")} value={dirty ? t("state.unsaved") : t("state.saved")} />
        {quota ? <FileSheetControlRow label={t("field.today")} value={quotaText(quota, t)} /> : null}
      </FileSheetSubsection>

      <FileSheetSubsection title={t("section.build")}>
        <FileSheetButtonRow>
          <Button
            type="button"
            size="sm"
            className="h-7 text-[11px]"
            onClick={save}
            disabled={!nameValid || saving || building}
          >
            {saving || building
              ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              : <Save className="size-3.5" aria-hidden="true" />}
            {building ? t("action.building") : t("action.save")}
          </Button>
        </FileSheetButtonRow>
        {summary ? summary.lines.map((line) => (
          <FileSheetStatusText key={line} tone={summary.tone}>{line}</FileSheetStatusText>
        )) : null}
        {error ? <FileSheetStatusText tone="error">{describeBoxError(error, t)}</FileSheetStatusText> : null}
        {["base", "lid"].map((part) => {
          const files = outputs
            .filter((output) => output.part === part)
            .sort((left, right) => FORMAT_ORDER.indexOf(left.format) - FORMAT_ORDER.indexOf(right.format));
          if (!files.length) {
            return null;
          }
          return (
            <FileSheetInlineControlRow key={part} label={t(`part.${part}`)}>
              <span className="flex items-center gap-1">
                {files.map((output) => (
                  <Button
                    key={output.file}
                    asChild
                    size="sm"
                    variant="outline"
                    className={cn(FILE_SHEET_COMPACT_BUTTON_CLASSES, "px-1.5")}
                  >
                    <a
                      href={boxFileUrl(status?.name || name, part, output.format)}
                      download
                      title={t("action.download", { format: output.format.toUpperCase() })}
                    >
                      <Download className="size-3.5" strokeWidth={2} aria-hidden="true" />
                      {output.format.toUpperCase()}
                    </a>
                  </Button>
                ))}
                {!hosted && files.some((output) => output.format === "step") ? (
                  <CompactButton
                    icon={Eye}
                    className="px-1.5"
                    title={t("action.openStep")}
                    aria-label={t("action.openStep")}
                    onClick={() => onOpenFile?.(files.find((output) => output.format === "step").file)}
                  />
                ) : null}
              </span>
            </FileSheetInlineControlRow>
          );
        })}
        {folderPath ? (
          <FileSheetButtonRow>
            <CompactButton
              icon={Copy}
              title={folderPath}
              onClick={async () => {
                await copyTextToClipboard(folderPath);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? t("action.pathCopied") : t("action.copyPath")}
            </CompactButton>
          </FileSheetButtonRow>
        ) : null}
      </FileSheetSubsection>

      <FileSheetSubsection title={t("section.open")}>
        {savedBoxes.length ? (
          <FileSheetSelectRow
            label={t("field.savedBoxes")}
            value={selectedOpenTarget}
            onValueChange={setOpenTarget}
            options={savedBoxes.map((box) => ({ value: box.name, label: box.name }))}
          />
        ) : (
          <FileSheetStatusText>{t("saved.empty")}</FileSheetStatusText>
        )}
        <FileSheetButtonRow columns={2}>
          <CompactButton icon={FolderOpen} disabled={!selectedOpenTarget} onClick={() => openBox(selectedOpenTarget)}>
            {t("action.open")}
          </CompactButton>
          <CompactButton icon={Plus} onClick={startNew}>{t("action.newBox")}</CompactButton>
        </FileSheetButtonRow>
      </FileSheetSubsection>

      <FileSheetSubsection title={t("section.history")}>
        <FileSheetButtonRow columns={2}>
          <CompactButton icon={Undo2} disabled={!canUndo} onClick={undo}>{t("action.undo")}</CompactButton>
          <CompactButton icon={Redo2} disabled={!canRedo} onClick={redo}>{t("action.redo")}</CompactButton>
        </FileSheetButtonRow>
      </FileSheetSubsection>

      {warnings.length ? (
        <FileSheetSubsection title={t("section.check")}>
          {warnings.map((warning) => {
            const sentence = formatWarning(language, warning);
            return <FileSheetStatusText key={sentence} tone="error">{sentence}</FileSheetStatusText>;
          })}
        </FileSheetSubsection>
      ) : null}
    </div>
  );
}

// --- sheet -------------------------------------------------------------------

export default function BoxBuilderSheet({
  open,
  isDesktop,
  width,
  onOpenChange,
  onStartResize,
  builder,
  onOpenFile,
  hosted = false
}) {
  const { t } = useBoxLanguage();
  const [openSectionIds, setOpenSectionIds] = useState([SECTION_IDS.BODY]);
  const selectionKind = builder.selection?.kind || "";
  const selectionId = builder.selection?.id || "";

  // Picking a hole or standoff in the viewport brings its tab forward.
  useEffect(() => {
    if (!selectionKind) {
      return;
    }
    setOpenSectionIds([selectionKind === "hole" ? SECTION_IDS.HOLES : SECTION_IDS.STANDOFFS]);
  }, [selectionKind, selectionId]);

  const sections = [
    { id: SECTION_IDS.BODY, title: t("tab.body"), content: <BodyTab builder={builder} /> },
    { id: SECTION_IDS.LID, title: t("tab.lid"), content: <LidTab builder={builder} /> },
    { id: SECTION_IDS.HOLES, title: t("tab.holes"), content: <HolesTab builder={builder} /> },
    { id: SECTION_IDS.STANDOFFS, title: t("tab.standoffs"), content: <StandoffsTab builder={builder} /> },
    { id: SECTION_IDS.FILE, title: t("tab.file"), content: <FileTab builder={builder} onOpenFile={onOpenFile} hosted={hosted} /> }
  ];

  return (
    <FileSheet
      open={open}
      title={t("sheet.title")}
      isDesktop={isDesktop}
      width={width}
      onOpenChange={onOpenChange}
      onStartResize={onStartResize}
      scrollBody={false}
    >
      <FileSheetTabbedSurface
        kind="box"
        sections={sections}
        openSectionIds={openSectionIds}
        onOpenSectionIdsChange={setOpenSectionIds}
      />
    </FileSheet>
  );
}
