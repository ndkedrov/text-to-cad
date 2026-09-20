import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  CircleDashed,
  CircuitBoard,
  Copy,
  Cylinder,
  Crosshair,
  Download,
  Eye,
  FolderOpen,
  LoaderCircle,
  Magnet,
  Maximize2,
  PanelTop,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  Save,
  Trash2,
  Undo2,
  Upload,
  X
} from "lucide-react";
import { Button } from "./kit/ui/button.jsx";
import { Input } from "./kit/ui/input.jsx";
import { copyTextToClipboard } from "./kit/clipboard.js";
import { cn } from "./kit/utils.js";
import { describeBoxError, isValidBoxName } from "../core/boxNames.js";
import { BoxAdapterProvider, useBoxAdapter } from "./adapter.js";
import {
  ARRAY_DIRECTIONS,
  ARRAY_MODES,
  applyArray,
  centerSelected,
  duplicateSelected,
  planArray,
  removeSelected
} from "../core/boxEdits.js";
import {
  PORT_TYPE_IDS,
  boardMinimumSize,
  boardNameMatches,
  boardTemplateState,
  boardTemplatesPending,
  syncBoardTemplates,
  updateBoardFromTemplate,
  fitBoxToBoard,
  flipBoard,
  mountBoard,
  newBoard,
  newBoardHole,
  newBoardPort,
  newBoardRail,
  resizeBoard,
  rotateBoard,
  setPortType,
  snapBoardToWalls,
  unmountBoard
} from "../core/boxBoards.js";
import { buildBoxPlan } from "../core/boxPlan.js";
import { floorSheetSvg } from "../core/floorSheet.js";
import {
  adapterCapabilities,
  confirmWithAdapter,
  fileAction,
  printFloorWithAdapter
} from "../core/adapterMembers.js";
import {
  ENGRAVING_MODES,
  PRINTABLE_GAP_WIDTH,
  PRINTABLE_LINE_WIDTH,
  engravingFromDrawing,
  engravingGapWidth,
  engravingLineWidth,
  engravingPartCount,
  engravingPointCount,
  engravingUnitsPerMm
} from "../core/engraving.js";
import { drawingFromSvg, redrawnContours } from "../browser/engravingImport.js";
import {
  BOARD_EDGES,
  BOARD_ROTATIONS,
  CONNECTOR_TYPES,
  HOLE_FACES,
  HOLE_SHAPES,
  MAX_BOARDS,
  MAX_BOARD_HOLES,
  MAX_BOARD_PORTS,
  MAX_BOARD_RAILS,
  MAX_LID_SCREWS,
  PORT_SHAPES,
  STANDOFF_PATTERNS,
  boardClampOpening,
  boardPortCutout,
  boardRailHeight,
  boxDimensions,
  clampBoardPosition,
  clampStemLength,
  clampHolePosition,
  connectorHole,
  connectorHoleMargin,
  defaultBoxSpec,
  faceAxisLabels,
  faceRange,
  faceSizeLabels,
  holeAvailable,
  holeCentreForLift,
  holeHalfExtents,
  holeLift,
  isWallFace,
  lidScrewPoints,
  newHole,
  newStandoffGroup,
  nextId,
  roundMm
} from "../core/boxSpec.js";
import { formatBoxNumber, formatWarning, getBoxLanguage } from "../core/i18n.js";
import FileSheet, {
  FILE_SHEET_COMPACT_BUTTON_CLASSES,
  FILE_SHEET_COMPACT_ICON_BUTTON_CLASSES,
  FILE_SHEET_COMPACT_INPUT_CLASSES,
  FileSheetBooleanToggle,
  FileSheetButtonRow,
  FileSheetComboboxRow,
  FileSheetControlRow,
  FileSheetDisclosure,
  FileSheetField,
  FileSheetFieldGrid,
  FileSheetInlineControlRow,
  FileSheetSelectRow,
  FileSheetStatusText,
  FileSheetSubsection,
  FileSheetToggleRow,
  FileSheetValueInput,
  parseFileSheetNumberInput
} from "./kit/FileSheet.js";
import FileSheetTabbedSurface from "./kit/FileSheetTabbedSurface.js";
import BoxBuilderPhoneShell from "./phone/BoxBuilderPhoneShell.js";
import { usePhoneUi } from "./phone/phoneUi.js";
import { useBoardPresets } from "./useBoardPresets.js";
import { useBoxLanguage } from "./useBoxLanguage.js";

const SECTION_IDS = Object.freeze({
  BODY: "box-body",
  LID: "box-lid",
  HOLES: "box-holes",
  STANDOFFS: "box-standoffs",
  BOARDS: "box-boards",
  FILE: "box-file"
});

const SECTION_FOR_SELECTION = Object.freeze({
  hole: SECTION_IDS.HOLES,
  standoff: SECTION_IDS.STANDOFFS,
  board: SECTION_IDS.BOARDS
});

// What went wrong while reading a drawing (engravingImport.js), in words.
const ENGRAVING_ERRORS = Object.freeze({
  "not-svg": "engraving.error.notSvg",
  "no-size": "engraving.error.noSize",
  "nothing-filled": "engraving.error.nothingFilled",
  "too-complex": "engraving.error.tooComplex"
});

const FORMAT_ORDER = ["step", "stl", "3mf"];
const STATUS_POLL_MS = 800;

// --- inputs ------------------------------------------------------------------

// Every component that shows numbers reads the language through useBoxLanguage, so
// it renders again when the language changes.
function formatNumber(value, digits = 2) {
  return formatBoxNumber(getBoxLanguage(), value, digits);
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
  unit,
  digits = 2,
  min = -Infinity,
  max = Infinity,
  step = 0.5,
  ariaLabel,
  className
}) {
  const { t } = useBoxLanguage();
  return (
    <FileSheetValueInput
      value={formatValue(value, unit ?? t("unit.mm"), digits)}
      ariaLabel={ariaLabel}
      decreaseLabel={t("action.decrease", { label: ariaLabel || "" })}
      increaseLabel={t("action.increase", { label: ariaLabel || "" })}
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
  const phone = usePhoneUi();
  return (
    <FileSheetInlineControlRow label={label}>
      <NumberInput ariaLabel={label} className={phone ? undefined : "w-24"} {...props} />
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
      {Icon ? <Icon className="size-[var(--fs-icon,0.875rem)]" strokeWidth={2} aria-hidden="true" /> : null}
      {children}
    </Button>
  );
}

// One item of a list (a hole, a standoff group, a board): folded to its label
// line with a summary, unfolded while it is selected. Opening it selects it and
// closing it clears the selection; picking it in the viewport opens it and
// scrolls it into view.
function ListItem({ selected, label, summary, onSelectedChange, children }) {
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
      className={cn("rounded-md transition-colors", selected && "bg-sidebar-accent/70")}
    >
      <FileSheetDisclosure label={label} summary={summary} open={selected} onOpenChange={onSelectedChange}>
        {children}
      </FileSheetDisclosure>
    </div>
  );
}

function holeSummary(hole, t) {
  const kind = hole.connector ? t(`port.type.${hole.connector}`) : t(`shape.${hole.shape}`);
  const size = hole.shape === "circle" || hole.shape === "hex"
    ? `⌀${formatNumber(hole.width)}`
    : `${formatNumber(hole.width)}×${formatNumber(hole.height)}`;
  return `${t(`face.${hole.face}`)} · ${kind} ${size}`;
}

function standoffSummary(group, t) {
  const spacing = group.pattern === "line"
    ? formatNumber(group.spacingX)
    : `${formatNumber(group.spacingX)}×${formatNumber(group.spacingY)}`;
  return `${t(`pattern.${group.pattern}`)} · ${spacing} ${t("unit.mm")}`;
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
          value={`${formatNumber(dims.width)} × ${formatNumber(dims.depth)} × ${formatNumber(dims.totalHeight)} ${t("unit.mm")}`}
        />
        {dims.wallsEnabled ? (
          <FileSheetControlRow
            label={t("field.inside")}
            value={`${formatNumber(dims.innerWidth)} × ${formatNumber(dims.innerDepth)} × ${formatNumber(dims.wallHeight)} ${t("unit.mm")}`}
          />
        ) : null}
      </FileSheetSubsection>
      <FileSheetSubsection>
        <FileSheetDisclosure
          label={t("section.view")}
          summary={t("view.summary", {
            on: [builder.display.boxMm, builder.display.groundMm, builder.display.boards].filter(Boolean).length,
            total: 3
          })}
        >
          <FileSheetToggleRow
            label={t("field.boxMm")}
            checked={builder.display.boxMm}
            onCheckedChange={(boxMm) => builder.setDisplay({ boxMm })}
          />
          <FileSheetToggleRow
            label={t("field.groundMm")}
            checked={builder.display.groundMm}
            onCheckedChange={(groundMm) => builder.setDisplay({ groundMm })}
          />
          <FileSheetToggleRow
            label={t("field.showBoards")}
            checked={builder.display.boards}
            onCheckedChange={(boards) => builder.setDisplay({ boards })}
          />
        </FileSheetDisclosure>
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
  // Editing any screw fixes all of them where they are: the corners are only the
  // starting point, and they move with the box until someone places them.
  const editScrews = (mutate) => edit((draft) => {
    const placed = draft.lid.screwPoints.length
      ? draft.lid.screwPoints
      : lidScrewPoints(boxDimensions(draft)).map(({ id, x, y }) => ({ id, x, y }));
    mutate(placed);
    draft.lid.screwPoints = placed;
  });

  const engraving = spec.lid.engraving;
  const fileRef = useRef(null);
  const [keepRatio, setKeepRatio] = useState(true);
  const [engravingError, setEngravingError] = useState("");
  const patchEngraving = (values) => edit((draft) => {
    if (draft.lid.engraving) {
      Object.assign(draft.lid.engraving, values);
    }
  });
  // With the proportions kept, the other side follows whichever one was typed.
  const resizeEngraving = (values) => {
    if (!engraving || !keepRatio) {
      patchEngraving(values);
      return;
    }
    const ratio = engraving.sizeY / engraving.sizeX;
    patchEngraving(values.sizeX != null
      ? { sizeX: values.sizeX, sizeY: roundMm(values.sizeX * ratio, 3) }
      : { sizeY: values.sizeY, sizeX: roundMm(values.sizeY / ratio, 3) });
  };
  // The drawing's lines cut at another width, or its narrow gaps closed: redrawn
  // from the shapes and lines themselves, so the file is not needed again. Both
  // arrive in millimetres and are kept in the drawing's units.
  const redrawEngraving = async ({ lineMm = engravingLineWidth(engraving), gapMm = engravingGapWidth(engraving) } = {}) => {
    if (!engraving?.strokes.length && !engraving?.fills.length) {
      return;
    }
    const units = engravingUnitsPerMm(engraving);
    const lineWidth = engraving.strokes.length ? lineMm * units : 0;
    const gapWidth = gapMm * units;
    try {
      const contours = await redrawnContours(engraving, { lineWidth, gapWidth });
      edit((draft) => {
        const target = draft.lid.engraving;
        if (target) {
          target.lineWidth = lineWidth;
          target.gapWidth = gapWidth;
          target.contours = contours;
        }
      });
      setEngravingError("");
    } catch (error) {
      setEngravingError(t(ENGRAVING_ERRORS[error?.message] || "engraving.error.unreadable"));
    }
  };

  const loadEngraving = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const drawing = await drawingFromSvg(await file.text(), { name: file.name.replace(/\.svg$/iu, "") });
      // A drawing that gives its real size comes in at it; one that does not is
      // sized to sit on the lid, two thirds of it at most.
      const fit = Math.min((dims.width * 2) / 3 / drawing.width, (dims.depth * 2) / 3 / drawing.height);
      edit((draft) => {
        draft.lid.engraving = engravingFromDrawing(drawing, { millimetresPerUnit: drawing.millimetresPerUnit || fit });
      });
      setEngravingError("");
    } catch (error) {
      setEngravingError(t(ENGRAVING_ERRORS[error?.message] || "engraving.error.unreadable"));
    }
  };

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
                value={`${formatNumber(dims.lipWidth)} × ${formatNumber(dims.lipDepth)} ${t("unit.mm")}`}
              />
            </>
          ) : null}
        </FileSheetSubsection>
      ) : null}
      {spec.lid.enabled ? (
        <FileSheetSubsection
          title={t("section.lidScrews")}
          trailing={<FileSheetBooleanToggle checked={spec.lid.screws} onCheckedChange={set("screws")} ariaLabel={t("section.lidScrews")} />}
        >
          {spec.lid.screws ? (
            <>
              <FileSheetStatusText>{t("lid.screwsHint")}</FileSheetStatusText>
              <NumberRow label={t("field.screwDepth")} value={spec.lid.screwDepth} min={2} max={spec.walls.height} step={0.5} onCommit={set("screwDepth")} />
              <NumberRow label={t("field.screwDiameter")} value={spec.lid.screwDiameter} min={4} max={20} step={0.5} onCommit={set("screwDiameter")} />
              <NumberRow label={t("field.screwPilot")} value={spec.lid.screwPilot} min={0.5} max={spec.lid.screwDiameter - 2} step={0.1} onCommit={set("screwPilot")} />
              <NumberRow label={t("field.screwHole")} value={spec.lid.screwHole} min={0.5} max={spec.lid.screwDiameter} step={0.1} onCommit={set("screwHole")} />
              <NumberRow label={t("field.screwInset")} value={spec.lid.screwInset} min={0} max={spec.walls.thickness} step={0.1} onCommit={set("screwInset")} />
              {spec.lid.screwPoints.length ? null : <FileSheetStatusText>{t("lid.screwsAuto")}</FileSheetStatusText>}
              {lidScrewPoints(dims).map((point, index) => (
                <FileSheetFieldGrid key={point.id} columns={3} className="items-end">
                  <NumberField
                    label={`${index + 1} · ${t("field.centerX")}`}
                    value={point.x}
                    min={-2000}
                    max={2000}
                    step={0.5}
                    onCommit={(x) => editScrews((points) => {
                      points[index].x = x;
                    })}
                  />
                  <NumberField
                    label={t("field.centerY")}
                    value={point.y}
                    min={-2000}
                    max={2000}
                    step={0.5}
                    onCommit={(y) => editScrews((points) => {
                      points[index].y = y;
                    })}
                  />
                  <IconButton
                    icon={X}
                    label={t("action.removeScrew")}
                    onClick={() => editScrews((points) => {
                      points.splice(index, 1);
                    })}
                  />
                </FileSheetFieldGrid>
              ))}
              <FileSheetButtonRow columns={2}>
                <CompactButton
                  icon={Plus}
                  disabled={lidScrewPoints(dims).length >= MAX_LID_SCREWS}
                  onClick={() => editScrews((points) => {
                    points.push({ id: nextId("screw", points), x: 0, y: dims.innerDepth / 2 });
                  })}
                >
                  {t("action.addScrew")}
                </CompactButton>
                <CompactButton
                  icon={Crosshair}
                  disabled={!spec.lid.screwPoints.length}
                  onClick={() => edit((draft) => {
                    draft.lid.screwPoints = [];
                  })}
                >
                  {t("action.screwsToCorners")}
                </CompactButton>
              </FileSheetButtonRow>
            </>
          ) : null}
        </FileSheetSubsection>
      ) : null}
      {spec.lid.enabled ? (
        <FileSheetSubsection title={t("section.engraving")}>
          {engraving ? (
            <>
              <FileSheetControlRow label={t("field.engravingFile")} value={engraving.name || t("engraving.unnamed")} />
              <FileSheetSelectRow
                label={t("field.engravingMode")}
                value={engraving.mode}
                onValueChange={(mode) => patchEngraving({ mode })}
                options={ENGRAVING_MODES.map((mode) => ({ value: mode, label: t(`engraving.mode.${mode}`) }))}
              />
              <FileSheetFieldGrid columns={2}>
                <NumberField label={t("field.centerX")} value={engraving.x} min={-2000} max={2000} step={0.5} onCommit={(x) => patchEngraving({ x })} />
                <NumberField label={t("field.centerY")} value={engraving.y} min={-2000} max={2000} step={0.5} onCommit={(y) => patchEngraving({ y })} />
              </FileSheetFieldGrid>
              <FileSheetFieldGrid columns={2}>
                <NumberField label={t("size.width")} value={engraving.sizeX} min={0.5} max={2000} step={0.5} onCommit={(sizeX) => resizeEngraving({ sizeX })} />
                <NumberField label={t("size.height")} value={engraving.sizeY} min={0.5} max={2000} step={0.5} onCommit={(sizeY) => resizeEngraving({ sizeY })} />
              </FileSheetFieldGrid>
              <FileSheetToggleRow label={t("field.keepRatio")} checked={keepRatio} onCheckedChange={setKeepRatio} />
              <NumberRow label={t("field.engravingDepth")} value={engraving.depth} min={0.1} max={100} step={0.1} onCommit={(depth) => patchEngraving({ depth })} />
              {engraving.strokes.length ? (
                <NumberRow
                  label={t("field.engravingLineWidth")}
                  value={engravingLineWidth(engraving)}
                  min={0.1}
                  max={50}
                  step={0.05}
                  onCommit={(lineMm) => redrawEngraving({ lineMm })}
                />
              ) : null}
              {engraving.strokes.length || engraving.fills.length ? (
                <NumberRow
                  label={t("field.engravingGap")}
                  value={engravingGapWidth(engraving)}
                  min={0}
                  max={10}
                  step={0.05}
                  onCommit={(gapMm) => redrawEngraving({ gapMm })}
                />
              ) : null}
              <FileSheetStatusText>
                {t("engraving.summary", { contours: engravingPartCount(engraving), points: engravingPointCount(engraving) })}
              </FileSheetStatusText>
              {engraving.depth >= spec.lid.thickness ? <FileSheetStatusText>{t("engraving.through")}</FileSheetStatusText> : null}
              {engraving.mode === "inlay" ? <FileSheetStatusText>{t("engraving.inlayHint")}</FileSheetStatusText> : null}
              {engraving.mode === "inlay" && (
                (engraving.strokes.length && engravingLineWidth(engraving) < PRINTABLE_LINE_WIDTH)
                || engravingGapWidth(engraving) < PRINTABLE_GAP_WIDTH
              ) ? (
                <FileSheetStatusText>{t("engraving.printHint")}</FileSheetStatusText>
              ) : null}
              <FileSheetButtonRow columns={2}>
                <CompactButton icon={Upload} onClick={() => fileRef.current?.click()}>{t("action.replaceEngraving")}</CompactButton>
                <CompactButton
                  icon={X}
                  onClick={() => edit((draft) => {
                    draft.lid.engraving = null;
                  })}
                >
                  {t("action.removeEngraving")}
                </CompactButton>
              </FileSheetButtonRow>
            </>
          ) : (
            <>
              <FileSheetStatusText>{t("engraving.hint")}</FileSheetStatusText>
              <FileSheetButtonRow>
                <CompactButton icon={Upload} onClick={() => fileRef.current?.click()}>{t("action.addEngraving")}</CompactButton>
              </FileSheetButtonRow>
            </>
          )}
          {engravingError ? <FileSheetStatusText tone="error">{engravingError}</FileSheetStatusText> : null}
          <input
            ref={fileRef}
            type="file"
            accept=".svg,image/svg+xml"
            className="hidden"
            aria-label={t("action.addEngraving")}
            onChange={loadEngraving}
          />
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
  // On a wall, a new size, shape or turn keeps the hole's bottom edge where it was.
  const reshape = (values) => update((target) => {
    const lift = isWallFace(target.face) ? holeLift(dims, target) : null;
    Object.assign(target, values);
    if (lift !== null) {
      target.v = holeCentreForLift(dims, target, lift);
    }
  });
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
    <ListItem
      selected={selected}
      label={t("item.hole", { n: index + 1 })}
      summary={holeSummary(hole, t)}
      onSelectedChange={(open) => setSelection(open ? itemSelection : null)}
  >
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
        value={hole.connector ? `connector:${hole.connector}` : hole.shape}
        onValueChange={(value) => reshape(
          value.startsWith("connector:") ? connectorHole(value.slice("connector:".length)) : { shape: value, connector: "" }
        )}
        options={[
          ...HOLE_SHAPES.map((shape) => ({ value: shape, label: t(`shape.${shape}`) })),
          ...CONNECTOR_TYPES.map((type) => ({ value: `connector:${type}`, label: t(`port.type.${type}`), group: t("shape.connectors") }))
        ]}
      />
      {round ? (
        <NumberRow
          label={hole.shape === "hex" ? t("field.acrossFlats") : t("field.diameter")}
          value={hole.width}
          min={0.3}
          max={500}
          step={0.5}
          onCommit={(width) => reshape({ width, height: width, connector: "" })}
        />
      ) : (
        <FileSheetFieldGrid columns={hole.shape === "rect" ? 3 : 2}>
          <NumberField label={sizeU} value={hole.width} min={0.3} max={500} step={0.5} onCommit={(width) => reshape({ width, connector: "" })} />
          <NumberField label={sizeV} value={hole.height} min={0.3} max={500} step={0.5} onCommit={(height) => reshape({ height, connector: "" })} />
          {hole.shape === "rect" ? (
            <NumberField label={t("field.radius")} value={hole.radius} min={0} max={Math.min(hole.width, hole.height) / 2} step={0.25} onCommit={(radius) => reshape({ radius, connector: "" })} />
          ) : null}
        </FileSheetFieldGrid>
      )}
      {hole.connector ? (
        <FileSheetStatusText>
          {connectorHoleMargin(hole.connector) > 0
            ? t("hole.connectorNote", { margin: formatNumber(connectorHoleMargin(hole.connector)) })
            : t("hole.connectorExact")}
        </FileSheetStatusText>
      ) : null}
      <FileSheetFieldGrid columns={hole.shape === "circle" ? 2 : 3}>
        <NumberField label={labelU} value={hole.u} min={range.u[0]} max={range.u[1]} step={0.5} onCommit={(u) => patch({ u })} />
        {isWallFace(hole.face) ? (
          <NumberField
            label={labelV}
            value={holeLift(dims, hole)}
            min={0}
            max={Math.max(0, dims.wallHeight - 2 * holeHalfExtents(hole)[1])}
            step={0.5}
            onCommit={(lift) => patch({ v: holeCentreForLift(dims, hole, lift) })}
          />
        ) : (
          <NumberField label={labelV} value={hole.v} min={range.v[0]} max={range.v[1]} step={0.5} onCommit={(v) => patch({ v })} />
        )}
        {hole.shape !== "circle" ? (
          <NumberField label={t("field.rotation")} unit="°" digits={1} value={hole.rotation} min={-360} max={360} step={15} onCommit={(rotation) => reshape({ rotation })} />
        ) : null}
      </FileSheetFieldGrid>
      <ItemActions builder={builder} selection={itemSelection} />
    </ListItem>
  );
}

function ArraySection({ builder, kind }) {
  const { t } = useBoxLanguage();
  const { spec, selection, edit } = builder;
  const [direction, setDirection] = useState("+u");
  const [mode, setMode] = useState("count");
  const [count, setCount] = useState(3);
  const [step, setStep] = useState(10);
  if (selection?.kind !== kind) {
    return null;
  }
  const list = kind === "hole" ? spec.holes : spec.standoffs;
  const index = list.findIndex((item) => item.id === selection.id);
  if (index < 0) {
    return null;
  }
  const onWall = kind === "hole" && isWallFace(list[index].face);
  const options = { direction, mode, count, step };
  const planned = planArray(spec, selection, options);
  const itemLabel = kind === "hole" ? t("item.hole", { n: index + 1 }) : t("item.standoffs", { n: index + 1 });
  return (
    <FileSheetSubsection>
      <FileSheetDisclosure label={t("section.array", { item: itemLabel })}>
        <FileSheetSelectRow
          label={t("field.direction")}
          value={direction}
          onValueChange={setDirection}
          options={ARRAY_DIRECTIONS.map((value) => ({ value, label: t(`array.dir.${onWall ? "wall" : "plane"}.${value}`) }))}
        />
        <FileSheetSelectRow
          label={t("field.arrayMode")}
          value={mode}
          onValueChange={setMode}
          options={ARRAY_MODES.map((value) => ({ value, label: t(`array.mode.${value}`) }))}
        />
        {mode === "fill" ? null : (
          <NumberRow
            label={mode === "even" ? t("field.rowCount") : t("field.copies")}
            unit=""
            digits={0}
            value={count}
            min={mode === "even" ? 2 : 1}
            max={100}
            step={1}
            onCommit={(value) => setCount(Math.round(value))}
          />
        )}
        {mode === "even" ? null : (
          <NumberRow label={t("field.step")} value={step} min={0.5} max={500} step={0.5} onCommit={setStep} />
        )}
        {mode === "even" && planned.spacing ? (
          <FileSheetControlRow label={t("field.arraySpacing")} value={`${formatNumber(planned.spacing)} ${t("unit.mm")}`} />
        ) : null}
        <FileSheetControlRow label={t("field.arrayResult")} value={t("array.result", { count: planned.positions.length })} />
        {planned.skipped ? (
          <FileSheetStatusText tone="error">{t("array.skipped", { count: planned.skipped })}</FileSheetStatusText>
        ) : null}
        <FileSheetButtonRow>
          <CompactButton
            icon={Copy}
            disabled={!planned.positions.length}
            onClick={() => edit((draft) => {
              applyArray(draft, selection, options);
            })}
          >
            {t("action.createArray")}
          </CompactButton>
        </FileSheetButtonRow>
      </FileSheetDisclosure>
    </FileSheetSubsection>
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
      <ArraySection builder={builder} kind="hole" />
      <FileSheetSubsection title={t("section.holes")} contentClassName="space-y-0.5">
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
    <ListItem
      selected={selected}
      label={t("item.standoffs", { n: index + 1 })}
      summary={standoffSummary(group, t)}
      onSelectedChange={(open) => setSelection(open ? itemSelection : null)}
  >
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
    </ListItem>
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
      <ArraySection builder={builder} kind="standoff" />
      <FileSheetSubsection title={t("section.standoffs")} contentClassName="space-y-0.5">
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

function IconButton({ icon: Icon, label, className, ...props }) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      className={cn(FILE_SHEET_COMPACT_ICON_BUTTON_CLASSES, className)}
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon className="size-3.5" strokeWidth={2} aria-hidden="true" />
    </Button>
  );
}

// A board's template name; boards saved before names were stored carry only a template id.
function boardLabel(board, t) {
  if (board.name) {
    return board.name;
  }
  const key = `board.preset.${board.preset}`;
  const text = t(key);
  return text === key ? board.preset : text;
}

function BoardPortEditor({ builder, board, port, index, update }) {
  const { t } = useBoxLanguage();
  const { dims } = builder;
  const patchPort = (change) => update((target) => {
    const entry = target.ports.find((candidate) => candidate.id === port.id);
    if (entry) {
      if (typeof change === "function") {
        change(entry);
      } else {
        Object.assign(entry, change);
      }
    }
  });
  const edgeLength = port.edge === "front" || port.edge === "back" ? board.width : board.length;
  const circle = port.shape === "circle";
  const cutout = board.mounted && dims.wallsEnabled ? boardPortCutout(dims, board, port) : null;
  return (
    <FileSheetDisclosure
      label={t("item.port", { n: index + 1 })}
      summary={`${t(`port.type.${port.type}`)} · ${t(`edge.${port.edge}`)}`}
    >
      <FileSheetSelectRow
        label={t("field.portType")}
        value={port.type}
        onValueChange={(type) => patchPort((entry) => setPortType(entry, type))}
        options={PORT_TYPE_IDS.map((type) => ({ value: type, label: t(`port.type.${type}`) }))}
      />
      <FileSheetSelectRow
        label={t("field.boardEdge")}
        value={port.edge}
        onValueChange={(edge) => patchPort({ edge })}
        options={BOARD_EDGES.map((edge) => ({ value: edge, label: t(`edge.${edge}`) }))}
      />
      {port.type === "custom" ? (
        <FileSheetSelectRow
          label={t("field.portShape")}
          value={port.shape}
          onValueChange={(shape) => patchPort(shape === "circle" ? { shape, height: port.width } : { shape })}
          options={PORT_SHAPES.map((shape) => ({ value: shape, label: t(`shape.${shape}`) }))}
        />
      ) : null}
      <FileSheetFieldGrid columns={3}>
        <NumberField label={t("field.portOffset")} value={port.offset} min={0} max={edgeLength} step={0.5} onCommit={(offset) => patchPort({ offset })} />
        <NumberField label={t("field.portElevation")} value={port.elevation} min={-20} max={100} step={0.25} onCommit={(elevation) => patchPort({ elevation })} />
        <NumberField label={t("field.portOverhang")} value={port.overhang} min={0} max={30} step={0.5} onCommit={(overhang) => patchPort({ overhang })} />
      </FileSheetFieldGrid>
      {circle ? (
        <NumberRow label={t("field.diameter")} value={port.width} min={0.5} max={100} step={0.5} onCommit={(width) => patchPort({ width, height: width })} />
      ) : (
        <FileSheetFieldGrid columns={3}>
          <NumberField label={t("size.width")} value={port.width} min={0.5} max={100} step={0.5} onCommit={(width) => patchPort({ width })} />
          <NumberField label={t("size.height")} value={port.height} min={0.5} max={100} step={0.5} onCommit={(height) => patchPort({ height })} />
          <NumberField label={t("field.radius")} value={port.radius} min={0} max={Math.min(port.width, port.height) / 2} step={0.25} onCommit={(radius) => patchPort({ radius })} />
        </FileSheetFieldGrid>
      )}
      <NumberRow label={t("field.portMargin")} value={port.margin} min={0} max={5} step={0.1} onCommit={(margin) => patchPort({ margin })} />
      {cutout ? (
        <FileSheetControlRow
          label={t("field.portExit")}
          value={t(cutout.gap > 0 ? "port.exit" : "port.exitInside", {
            face: t(`face.${cutout.face}`),
            gap: formatNumber(cutout.gap, 1)
          })}
        />
      ) : null}
      <FileSheetButtonRow>
        <CompactButton
          icon={X}
          onClick={() => update((target) => {
            target.ports = target.ports.filter((entry) => entry.id !== port.id);
          })}
        >
          {t("action.removePort")}
        </CompactButton>
      </FileSheetButtonRow>
    </FileSheetDisclosure>
  );
}

function BoardItem({ builder, board, index, presets }) {
  const { t } = useBoxLanguage();
  const { edit, selection, setSelection } = builder;
  const itemSelection = { kind: "board", id: board.id };
  const selected = selection?.kind === "board" && selection.id === board.id;
  const update = (mutate) => edit((draft) => {
    const target = draft.boards.find((entry) => entry.id === board.id);
    if (target) {
      mutate(target, draft);
    }
  });
  const patch = (values) => update((target) => Object.assign(target, values));
  const run = (action, ...args) => edit((draft) => action(draft, board.id, ...args));
  const moveTo = (x, y) => update((target, draft) => {
    Object.assign(target, clampBoardPosition(boxDimensions(draft), target, x, y));
  });
  const mm = t("unit.mm");
  const count = (items) => (items.length ? String(items.length) : t("summary.none"));

  return (
    <ListItem
      selected={selected}
      label={t("item.board", { n: index + 1, name: boardLabel(board, t) })}
      summary={`${board.mounted ? t("board.mounted") : t("board.notMounted")} · ${formatNumber(board.width)}×${formatNumber(board.length)} ${mm}`}
      onSelectedChange={(open) => setSelection(open ? itemSelection : null)}
    >
      {board.mounted ? (
        <>
          <FileSheetFieldGrid columns={2}>
            <NumberField label={t("field.centerX")} value={board.x} min={-2000} max={2000} step={0.5} onCommit={(x) => moveTo(x, board.y)} />
            <NumberField label={t("field.centerY")} value={board.y} min={-2000} max={2000} step={0.5} onCommit={(y) => moveTo(board.x, y)} />
          </FileSheetFieldGrid>
          <FileSheetSelectRow
            label={t("field.rotation")}
            value={String(board.rotation)}
            onValueChange={(value) => run(rotateBoard, Number(value))}
            options={BOARD_ROTATIONS.map((rotation) => ({ value: String(rotation), label: `${rotation}°` }))}
          />
          <FileSheetToggleRow
            label={t("field.boardFlipped")}
            checked={board.flipped}
            onCheckedChange={(flipped) => run(flipBoard, flipped)}
          />
          <FileSheetButtonRow columns={3}>
            <CompactButton icon={Magnet} disabled={!board.ports.length} onClick={() => run(snapBoardToWalls)}>
              {t("action.snapBoard")}
            </CompactButton>
            <CompactButton icon={Maximize2} onClick={() => run(fitBoxToBoard)}>{t("action.fitBox")}</CompactButton>
            <CompactButton icon={ArrowUpFromLine} onClick={() => run(unmountBoard)}>{t("action.unmountBoard")}</CompactButton>
          </FileSheetButtonRow>
        </>
      ) : (
        <FileSheetButtonRow>
          <Button type="button" size="sm" className="h-[var(--fs-control-h,1.75rem)] text-[length:var(--fs-control-text,0.6875rem)]" onClick={() => run(mountBoard)}>
            <ArrowDownToLine className="size-3.5" aria-hidden="true" />
            {t("action.mountBoard")}
          </Button>
        </FileSheetButtonRow>
      )}

      {boardTemplateState(board, presets).state === "edited" ? (
        <>
          <FileSheetStatusText>{t("board.templateChanged")}</FileSheetStatusText>
          <FileSheetButtonRow>
            <CompactButton icon={RefreshCw} onClick={() => run(updateBoardFromTemplate, presets)}>
              {t("action.updateFromTemplate")}
            </CompactButton>
          </FileSheetButtonRow>
        </>
      ) : null}

      <FileSheetDisclosure
        label={t("board.part.size")}
        summary={`${formatNumber(board.width)}×${formatNumber(board.length)} ${mm} · ${t("board.clearanceShort", { value: formatNumber(board.clearance) })}`}
      >
        <FileSheetFieldGrid columns={3}>
          <NumberField label={t("field.boardWidth")} value={board.width} min={boardMinimumSize(board, "x")} max={400} step={0.5} onCommit={(width) => run(resizeBoard, { width })} />
          <NumberField label={t("field.boardLength")} value={board.length} min={boardMinimumSize(board, "y")} max={400} step={0.5} onCommit={(length) => run(resizeBoard, { length })} />
          <NumberField label={t("field.thickness")} value={board.thickness} min={0.4} max={5} step={0.1} onCommit={(thickness) => patch({ thickness })} />
        </FileSheetFieldGrid>
        <FileSheetFieldGrid columns={2}>
          <NumberField label={t("field.boardClearance")} value={board.clearance} min={0} max={200} step={0.5} onCommit={(clearance) => patch({ clearance })} />
          <NumberField label={t("field.componentHeight")} value={board.componentHeight} min={0} max={200} step={0.5} onCommit={(componentHeight) => patch({ componentHeight })} />
        </FileSheetFieldGrid>
        <FileSheetFieldGrid columns={2}>
          <NumberField label={t("field.padDiameter")} value={board.padDiameter} min={2} max={30} step={0.5} onCommit={(padDiameter) => patch({ padDiameter })} />
          <NumberField label={t("field.boreDiameter")} value={board.boreDiameter} min={0} max={board.padDiameter - 0.8} step={0.1} onCommit={(boreDiameter) => patch({ boreDiameter })} />
        </FileSheetFieldGrid>
      </FileSheetDisclosure>

      <FileSheetDisclosure label={t("board.part.holes")} summary={count(board.holes)}>
        <FileSheetStatusText>{t("board.holesHint")}</FileSheetStatusText>
        {board.holes.map((hole, holeIndex) => {
          const patchHole = (values) => update((target) => {
            const entry = target.holes.find((candidate) => candidate.id === hole.id);
            if (entry) {
              Object.assign(entry, values);
            }
          });
          return (
            <FileSheetFieldGrid key={hole.id} columns={4} className="items-end">
              <NumberField label={`${holeIndex + 1} · X`} value={hole.x} min={hole.diameter / 2} max={board.width - hole.diameter / 2} step={0.5} onCommit={(x) => patchHole({ x })} />
              <NumberField label="Y" value={hole.y} min={hole.diameter / 2} max={board.length - hole.diameter / 2} step={0.5} onCommit={(y) => patchHole({ y })} />
              <NumberField label="⌀" value={hole.diameter} min={0.5} max={12} step={0.1} onCommit={(diameter) => patchHole({ diameter })} />
              <IconButton
                icon={X}
                label={t("action.removeHole")}
                onClick={() => update((target) => {
                  target.holes = target.holes.filter((entry) => entry.id !== hole.id);
                })}
              />
            </FileSheetFieldGrid>
          );
        })}
        <FileSheetButtonRow>
          <CompactButton
            icon={Plus}
            disabled={board.holes.length >= MAX_BOARD_HOLES}
            onClick={() => update((target) => {
              target.holes.push(newBoardHole(target));
            })}
          >
            {t("action.addHole")}
          </CompactButton>
        </FileSheetButtonRow>
      </FileSheetDisclosure>

      <FileSheetDisclosure
        label={t("board.part.hold")}
        summary={[
          board.rails.length ? t("board.railsCount", { n: board.rails.length }) : "",
          board.clamp ? t("board.clampOn") : ""
        ].filter(Boolean).join(" · ") || t("summary.none")}
      >
        <FileSheetStatusText>{t("board.holdHint")}</FileSheetStatusText>
        <FileSheetToggleRow label={t("field.boardClamp")} checked={board.clamp} onCheckedChange={(clamp) => patch({ clamp })} />
        {board.clamp ? (
          <>
            <NumberRow label={t("field.clampHeight")} value={board.clampHeight} min={1} max={200} step={0.5} onCommit={(clampHeight) => patch({ clampHeight })} />
            <NumberRow
              label={t("field.clampOffset")}
              value={board.clampOffset}
              min={0}
              max={Math.max(board.width, board.length)}
              step={0.5}
              onCommit={(clampOffset) => patch({ clampOffset })}
            />
            <FileSheetFieldGrid columns={3}>
              <NumberField label={t("field.clampDiameter")} value={board.clampDiameter} min={2} max={30} step={0.5} onCommit={(clampDiameter) => patch({ clampDiameter })} />
              <NumberField label={t("field.clampBore")} value={board.clampBore} min={0} max={board.clampDiameter - 0.8} step={0.1} onCommit={(clampBore) => patch({ clampBore })} />
              <NumberField label={t("field.clampGap")} value={board.clampGap} min={0} max={20} step={0.1} onCommit={(clampGap) => patch({ clampGap })} />
            </FileSheetFieldGrid>
            <FileSheetControlRow
              label={t("field.clampOpening")}
              value={`${formatNumber(boardClampOpening(board))} ${mm}`}
            />
            <FileSheetStatusText>{t("board.clampStem", { stem: formatNumber(clampStemLength(board), 1) })}</FileSheetStatusText>
          </>
        ) : null}
        {board.rails.map((rail, railIndex) => {
          const patchRail = (values) => update((target) => {
            const entry = target.rails.find((candidate) => candidate.id === rail.id);
            if (entry) {
              Object.assign(entry, values);
            }
          });
          return (
            <FileSheetDisclosure
              key={rail.id}
              label={t("item.rail", { n: railIndex + 1 })}
              summary={`${formatNumber(rail.length)}×${formatNumber(rail.thickness)} ${mm} · ${formatNumber(rail.offset)} ${mm}`}
            >
              <FileSheetFieldGrid columns={2}>
                <NumberField label={t("field.railOffset")} value={rail.offset} min={0} max={Math.max(board.width, board.length)} step={0.5} onCommit={(offset) => patchRail({ offset })} />
                <NumberField label={t("field.railLength")} value={rail.length} min={1} max={400} step={0.5} onCommit={(length) => patchRail({ length })} />
              </FileSheetFieldGrid>
              <FileSheetFieldGrid columns={2}>
                <NumberField label={t("field.railThickness")} value={rail.thickness} min={0.5} max={50} step={0.5} onCommit={(thickness) => patchRail({ thickness })} />
                <NumberField label={t("field.railHeight")} value={boardRailHeight(board, rail)} min={0.1} max={200} step={0.5} onCommit={(height) => patchRail({ height })} />
              </FileSheetFieldGrid>
              <FileSheetButtonRow>
                <CompactButton
                  icon={X}
                  onClick={() => update((target) => {
                    target.rails = target.rails.filter((entry) => entry.id !== rail.id);
                  })}
                >
                  {t("action.removeRail")}
                </CompactButton>
              </FileSheetButtonRow>
            </FileSheetDisclosure>
          );
        })}
        <FileSheetButtonRow>
          <CompactButton
            icon={Plus}
            disabled={board.rails.length >= MAX_BOARD_RAILS}
            onClick={() => update((target) => {
              target.rails.push(newBoardRail(target));
            })}
          >
            {t("action.addRail")}
          </CompactButton>
        </FileSheetButtonRow>
      </FileSheetDisclosure>

      <FileSheetDisclosure label={t("board.part.ports")} summary={count(board.ports)}>
        <FileSheetStatusText>{t("board.portsHint")}</FileSheetStatusText>
        {board.ports.map((port, portIndex) => (
          <BoardPortEditor key={port.id} builder={builder} board={board} port={port} index={portIndex} update={update} />
        ))}
        <FileSheetButtonRow>
          <CompactButton
            icon={Plus}
            disabled={board.ports.length >= MAX_BOARD_PORTS}
            onClick={() => update((target) => {
              target.ports.push(newBoardPort(target));
            })}
          >
            {t("action.addPort")}
          </CompactButton>
        </FileSheetButtonRow>
      </FileSheetDisclosure>

      <ItemActions builder={builder} selection={itemSelection} />
    </ListItem>
  );
}

function BoardsTab({ builder }) {
  const { t } = useBoxLanguage();
  const { spec, edit, setSelection } = builder;
  const { boards: presets, categories } = useBoardPresets();
  const [presetId, setPresetId] = useState("custom");
  const [category, setCategory] = useState("all");
  const categoryName = (id) => {
    const key = `board.category.${id}`;
    const text = t(key);
    return text === key ? id : text;
  };
  const counts = Object.fromEntries(categories.map((id) => [id, presets.filter((entry) => entry.category === id).length]));
  // Shown in category order; with every type shown, the list is grouped under category headings.
  const shown = (category === "all" ? categories : [category])
    .flatMap((id) => presets.filter((entry) => entry.category === id));
  const preset = shown.find((entry) => entry.id === presetId) || null;
  const full = spec.boards.length >= MAX_BOARDS;
  // A new board goes straight into the box.
  const addBoard = () => {
    let created = null;
    edit((draft) => {
      if (draft.boards.length < MAX_BOARDS) {
        created = newBoard(draft, preset);
        draft.boards.push(created);
        mountBoard(draft, created.id);
      }
    });
    if (created) {
      setSelection({ kind: "board", id: created.id });
    }
  };
  return (
    <div>
      <FileSheetSubsection title={t("section.newBoard")}>
        {presets.length ? (
          <FileSheetSelectRow
            label={t("field.boardCategory")}
            value={category}
            onValueChange={setCategory}
            options={[
              { value: "all", label: `${t("board.category.all")} (${presets.length})` },
              ...categories
                .filter((id) => counts[id] || id === category)
                .map((id) => ({ value: id, label: `${categoryName(id)} (${counts[id] || 0})` }))
            ]}
          />
        ) : null}
        <FileSheetComboboxRow
          label={t("field.boardPreset")}
          value={preset ? presetId : "custom"}
          onValueChange={setPresetId}
          matches={(option, text) => boardNameMatches(option.label, text)}
          searchPlaceholder={t("board.searchPlaceholder")}
          emptyText={t("boards.noMatch")}
          options={[
            { value: "custom", label: t("board.preset.custom") },
            ...shown.map((entry) => ({
              value: entry.id,
              label: entry.name,
              group: category === "all" ? categoryName(entry.category) : undefined
            }))
          ]}
        />
        <FileSheetButtonRow>
          <CompactButton icon={Plus} disabled={full} onClick={addBoard}>{t("action.addBoard")}</CompactButton>
        </FileSheetButtonRow>
        {full ? <FileSheetStatusText>{t("boards.full", { max: MAX_BOARDS })}</FileSheetStatusText> : null}
        {!full && preset ? <FileSheetStatusText>{t("boards.presetNote")}</FileSheetStatusText> : null}
      </FileSheetSubsection>
      <FileSheetSubsection title={t("section.boards")} contentClassName="space-y-0.5">
        {spec.boards.length ? (
          <FileSheetToggleRow
            label={t("field.showBoards")}
            checked={builder.display.boards}
            onCheckedChange={(boards) => builder.setDisplay({ boards })}
          />
        ) : null}
        {spec.boards.length ? (
          spec.boards.map((board, index) => (
            <BoardItem key={board.id} builder={builder} board={board} index={index} presets={presets} />
          ))
        ) : (
          <FileSheetStatusText>{t("boards.empty")}</FileSheetStatusText>
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
  const adapter = useBoxAdapter();
  const { spec, dims, name, setName, warnings, dirty, markSaved, replace, undo, redo, canUndo, canRedo } = builder;
  const [savedBoxes, setSavedBoxes] = useState([]);
  const [openTarget, setOpenTarget] = useState("");
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [quota, setQuota] = useState(null);
  const [printProblem, setPrintProblem] = useState(null);
  const nameValid = isValidBoxName(name);
  const building = ["queued", "building"].includes(status?.build?.state);
  const capabilities = adapterCapabilities(adapter, { hosted });

  const refreshList = useCallback(async () => {
    try {
      const payload = await adapter.listBoxes();
      setSavedBoxes(Array.isArray(payload?.boxes) ? payload.boxes : []);
      if (payload?.quota) {
        setQuota(payload.quota);
      }
    } catch (listError) {
      setError(listError);
    }
  }, [adapter]);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  useEffect(() => {
    if (!nameValid) {
      setStatus(null);
      return undefined;
    }
    let cancelled = false;
    adapter.boxStatus(name).then(
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
  }, [adapter, name, nameValid]);

  useEffect(() => {
    if (!building) {
      return undefined;
    }
    const timer = window.setInterval(async () => {
      try {
        const payload = await adapter.boxStatus(name);
        setStatus(payload);
        if (payload?.quota) {
          setQuota(payload.quota);
        }
        if (!["queued", "building"].includes(payload?.build?.state)) {
          adapter.onOutputsChanged?.();
        }
      } catch (pollError) {
        setError(pollError);
      }
    }, STATUS_POLL_MS);
    return () => window.clearInterval(timer);
  }, [adapter, building, name]);

  const save = async () => {
    if (!nameValid) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const plan = buildBoxPlan(spec, { layout: "print" });
      const payload = await adapter.saveBox(name, { spec, plan: { base: plan.base, lid: plan.lid, inlay: plan.inlay } });
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
    if (dirty && !(await confirmWithAdapter(adapter, t("confirm.open", { name: target })))) {
      return;
    }
    setError(null);
    try {
      const payload = await adapter.loadBox(target);
      // A host that had to change the document while reading it opens it as unsaved.
      replace(payload.name, payload.spec, { saved: payload.changed !== true });
      setStatus(payload);
    } catch (loadError) {
      setError(loadError);
    }
  };

  const startNew = async () => {
    if (dirty && !(await confirmWithAdapter(adapter, t("confirm.new")))) {
      return;
    }
    replace(freeBoxName(savedBoxes), defaultBoxSpec());
  };

  // The floor, 1:1, in a window of its own: the browser's print dialog saves it as a
  // PDF. A host with its own printing does it instead.
  const printFloor = async () => {
    const svg = floorSheetSvg(spec, {
      title: t("floor.sheetTitle", { name, width: formatNumber(dims.width), depth: formatNumber(dims.depth) }),
      note: t("floor.sheetNote"),
      ruler: t("floor.sheetRuler", { mm: 50 })
    });
    const printed = await printFloorWithAdapter(adapter, svg, name || "box");
    // A browser that refused the window is told how to allow it; a host that could not print is not a browser.
    setPrintProblem(printed ? null : typeof adapter?.printFloorSheet === "function" ? "floor.failed" : "floor.blocked");
  };

  // A file through the host's exportFile: false is the user cancelling, not a failure.
  const exportFile = async (run) => {
    setError(null);
    try {
      await run();
    } catch (exportError) {
      setError(exportError);
    }
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
        {capabilities.folderPath ? <FileSheetControlRow label={t("field.folder")} value={`boxes/${name}`} /> : null}
        <FileSheetControlRow label={t("field.state")} value={dirty ? t("state.unsaved") : t("state.saved")} valueMono={false} />
        {quota && capabilities.quota ? <FileSheetControlRow label={t("field.today")} value={quotaText(quota, t)} /> : null}
      </FileSheetSubsection>

      <FileSheetSubsection title={t("section.build")}>
        <FileSheetButtonRow>
          <Button
            type="button"
            size="sm"
            className="h-[var(--fs-control-h,1.75rem)] text-[length:var(--fs-control-text,0.6875rem)]"
            onClick={save}
            disabled={!nameValid || saving || building}
          >
            {saving || building
              ? <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              : <Save className="size-3.5" aria-hidden="true" />}
            {building ? t("action.building") : t("action.save")}
          </Button>
        </FileSheetButtonRow>
        <FileSheetButtonRow>
          <CompactButton icon={Printer} onClick={printFloor}>{t("action.printFloor")}</CompactButton>
        </FileSheetButtonRow>
        {printProblem ? <FileSheetStatusText tone="error">{t(printProblem)}</FileSheetStatusText> : null}
        {summary ? summary.lines.map((line) => (
          <FileSheetStatusText key={line} tone={summary.tone}>{line}</FileSheetStatusText>
        )) : null}
        {error ? <FileSheetStatusText tone="error">{describeBoxError(error, t)}</FileSheetStatusText> : null}
        {["base", "lid", "inlay"].map((part) => {
          const files = outputs
            .filter((output) => output.part === part)
            .sort((left, right) => FORMAT_ORDER.indexOf(left.format) - FORMAT_ORDER.indexOf(right.format));
          if (!files.length) {
            return null;
          }
          return (
            <FileSheetInlineControlRow key={part} label={t(`part.${part}`)}>
              <span className="flex items-center gap-1">
                {files.map((output) => {
                  const action = fileAction(adapter, status?.name || name, part, output.format);
                  const label = output.format.toUpperCase();
                  const title = t("action.download", { format: label });
                  const icon = <Download className="size-3.5" strokeWidth={2} aria-hidden="true" />;
                  if (action.kind === "export") {
                    return (
                      <Button
                        key={output.file}
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn(FILE_SHEET_COMPACT_BUTTON_CLASSES, "px-1.5")}
                        title={title}
                        onClick={() => exportFile(action.run)}
                      >
                        {icon}
                        {label}
                      </Button>
                    );
                  }
                  return (
                    <Button
                      key={output.file}
                      asChild
                      size="sm"
                      variant="outline"
                      className={cn(FILE_SHEET_COMPACT_BUTTON_CLASSES, "px-1.5")}
                    >
                      <a href={action.href} download={output.file.split(/[\\/]/u).pop()} title={title}>
                        {icon}
                        {label}
                      </a>
                    </Button>
                  );
                })}
                {capabilities.openStep && files.some((output) => output.format === "step") ? (
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
        {folderPath && capabilities.copyFolderPath ? (
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

const SECTION_IDS_LIST = Object.values(SECTION_IDS);

function HistoryActions({ builder }) {
  const { t } = useBoxLanguage();
  const { undo, redo, canUndo, canRedo } = builder;
  const classes = "flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors active:bg-sidebar-accent/70 disabled:opacity-35";
  return (
    <>
      <button type="button" className={classes} onClick={undo} disabled={!canUndo} aria-label={t("action.undo")} title={t("action.undo")}>
        <Undo2 className="size-5" strokeWidth={2} aria-hidden="true" />
      </button>
      <button type="button" className={classes} onClick={redo} disabled={!canRedo} aria-label={t("action.redo")} title={t("action.redo")}>
        <Redo2 className="size-5" strokeWidth={2} aria-hidden="true" />
      </button>
    </>
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
  hosted = false,
  adapter,
  // A host that gives the panel the whole bottom of a phone screen asks for the
  // phone chrome and takes back the insets the model has to be framed in.
  phoneShell = false,
  onPhoneInsetsChange
}) {
  const { t } = useBoxLanguage();
  const [openSectionIds, setOpenSectionIds] = useState([SECTION_IDS.BODY]);
  const selectionKind = builder.selection?.kind || "";
  const selectionId = builder.selection?.id || "";
  const { boards: boardPresets } = useBoardPresets(adapter);
  const { spec, edit } = builder;

  // An engraving from before the cut was worked out as the drawing came in: its
  // lines become contours once, so the box stops rebuilding a chain of little
  // slots on every load.
  useEffect(() => {
    const engraving = spec.lid.engraving;
    if (!engraving?.strokes.length || engraving.contours.length) {
      return undefined;
    }
    let cancelled = false;
    redrawnContours(engraving, engraving).then(
      (contours) => {
        if (cancelled || !contours.length) {
          return;
        }
        edit((draft) => {
          const target = draft.lid.engraving;
          if (target && !target.contours.length) {
            target.contours = contours;
          }
        });
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [spec, edit]);

  // Boards in the box follow their templates when those change, unless edited
  // since (those offer an update in their own item). Whatever tab is open.
  useEffect(() => {
    if (boardPresets.length && boardTemplatesPending(spec, boardPresets)) {
      edit((draft) => {
        syncBoardTemplates(draft, boardPresets);
      });
    }
  }, [boardPresets, spec, edit]);

  // Picking a hole, standoff group or board in the viewport brings its tab forward.
  useEffect(() => {
    if (!SECTION_FOR_SELECTION[selectionKind]) {
      return;
    }
    setOpenSectionIds([SECTION_FOR_SELECTION[selectionKind]]);
  }, [selectionKind, selectionId]);

  const designSections = [
    { id: SECTION_IDS.BODY, title: t("tab.body"), Icon: Box, content: <BodyTab builder={builder} /> },
    { id: SECTION_IDS.LID, title: t("tab.lid"), Icon: PanelTop, content: <LidTab builder={builder} /> },
    { id: SECTION_IDS.HOLES, title: t("tab.holes"), Icon: CircleDashed, content: <HolesTab builder={builder} /> },
    { id: SECTION_IDS.STANDOFFS, title: t("tab.standoffs"), Icon: Cylinder, content: <StandoffsTab builder={builder} /> },
    { id: SECTION_IDS.BOARDS, title: t("tab.boards"), Icon: CircuitBoard, content: <BoardsTab builder={builder} /> }
  ];
  const fileSection = {
    id: SECTION_IDS.FILE,
    title: t("tab.file"),
    Icon: FolderOpen,
    content: <FileTab builder={builder} onOpenFile={onOpenFile} hosted={hosted} />
  };
  const sections = [...designSections, fileSection];

  // On a phone the panel is the whole bottom of the screen: a navigation bar,
  // a sheet that the model stays visible above, and the file actions as a
  // modal. Saving and exporting are a task with an end, not a place to browse,
  // and giving them a tab is what left the phone build with six cramped tabs
  // and no room for any of them.
  if (!isDesktop && phoneShell) {
    const activeId = [...openSectionIds].reverse().find((id) => SECTION_IDS_LIST.includes(id))
      || SECTION_IDS.BODY;
    return (
      <BoxAdapterProvider adapter={adapter}>
        <BoxBuilderPhoneShell
          sections={designSections}
          modalSections={[fileSection]}
          activeId={activeId === SECTION_IDS.FILE ? SECTION_IDS.BODY : activeId}
          onActiveIdChange={(id) => setOpenSectionIds([id])}
          onInsetsChange={onPhoneInsetsChange}
          navLabel={t("sheet.title")}
          expandLabel={t("sheet.expand")}
          collapseLabel={t("sheet.collapse")}
          closeLabel={t("action.close")}
          labels={{
            close: t("action.close"),
            search: t("picker.search"),
            empty: t("picker.empty")
          }}
          sheetActions={
            <HistoryActions builder={builder} />
          }
        />
      </BoxAdapterProvider>
    );
  }

  return (
    <BoxAdapterProvider adapter={adapter}>
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
    </BoxAdapterProvider>
  );
}
