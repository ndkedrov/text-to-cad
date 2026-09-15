import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Copy,
  Crosshair,
  Download,
  Eye,
  FolderOpen,
  LoaderCircle,
  Magnet,
  Maximize2,
  Plus,
  Redo2,
  Save,
  Trash2,
  Undo2,
  X
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
import {
  ARRAY_DIRECTIONS,
  ARRAY_MODES,
  applyArray,
  centerSelected,
  duplicateSelected,
  planArray,
  removeSelected
} from "@/workbench/boxBuilder/boxEdits.js";
import {
  PORT_TYPE_IDS,
  boardMinimumSize,
  fitBoxToBoard,
  mountBoard,
  newBoard,
  newBoardHole,
  newBoardPort,
  resizeBoard,
  rotateBoard,
  setPortType,
  snapBoardToWalls,
  unmountBoard
} from "@/workbench/boxBuilder/boxBoards.js";
import { buildBoxPlan } from "@/workbench/boxBuilder/boxPlan.js";
import {
  BOARD_EDGES,
  BOARD_ROTATIONS,
  HOLE_FACES,
  HOLE_SHAPES,
  MAX_BOARDS,
  MAX_BOARD_HOLES,
  MAX_BOARD_PORTS,
  PORT_SHAPES,
  STANDOFF_PATTERNS,
  boardPortCutout,
  boxDimensions,
  clampBoardPosition,
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
  FILE_SHEET_COMPACT_ICON_BUTTON_CLASSES,
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
  FileSheetToggleRow,
  FileSheetValueInput,
  parseFileSheetNumberInput
} from "../FileSheet";
import FileSheetTabbedSurface from "../FileSheetTabbedSurface";
import { useBoardPresets } from "./useBoardPresets";
import { useBoxLanguage } from "./useBoxLanguage";

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
      <FileSheetSubsection title={t("section.view")}>
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
    <FileSheetSubsection title={t("section.array", { item: itemLabel })}>
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
        <FileSheetControlRow label={t("field.arraySpacing")} value={`${formatNumber(planned.spacing)} mm`} />
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
      <ArraySection builder={builder} kind="standoff" />
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

function SubHeading({ children }) {
  return <FileSheetStatusText className="font-medium text-sidebar-foreground">{children}</FileSheetStatusText>;
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
    <>
      <FileSheetInlineControlRow label={t("item.port", { n: index + 1 })}>
        <IconButton
          icon={X}
          label={t("action.removePort")}
          onClick={() => update((target) => {
            target.ports = target.ports.filter((entry) => entry.id !== port.id);
          })}
        />
      </FileSheetInlineControlRow>
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
    </>
  );
}

function BoardItem({ builder, board, index }) {
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
  const summary = t("board.summary", {
    width: formatNumber(board.width),
    length: formatNumber(board.length),
    holes: board.holes.length,
    ports: board.ports.length
  });

  return (
    <SelectableItem selected={selected} onSelect={() => setSelection(itemSelection)}>
      <FileSheetItemGroup
        label={t("item.board", { n: index + 1, name: boardLabel(board, t) })}
        className="!mt-0"
      >
        <FileSheetControlRow label={board.mounted ? t("board.mounted") : t("board.notMounted")} value={summary} />
        {board.mounted ? (
          selected ? (
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
              <FileSheetButtonRow columns={3}>
                <CompactButton icon={Magnet} disabled={!board.ports.length} onClick={() => run(snapBoardToWalls)}>
                  {t("action.snapBoard")}
                </CompactButton>
                <CompactButton icon={Maximize2} onClick={() => run(fitBoxToBoard)}>{t("action.fitBox")}</CompactButton>
                <CompactButton icon={ArrowUpFromLine} onClick={() => run(unmountBoard)}>{t("action.unmountBoard")}</CompactButton>
              </FileSheetButtonRow>
            </>
          ) : null
        ) : (
          <>
            <FileSheetButtonRow>
              <Button
                type="button"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => {
                  run(mountBoard);
                  setSelection(itemSelection);
                }}
              >
                <ArrowDownToLine className="size-3.5" aria-hidden="true" />
                {t("action.mountBoard")}
              </Button>
            </FileSheetButtonRow>
            {selected ? <FileSheetStatusText>{t("boards.mountHint")}</FileSheetStatusText> : null}
          </>
        )}

        {selected ? (
          <>
            <FileSheetFieldGrid columns={3}>
              <NumberField label={t("field.boardWidth")} value={board.width} min={boardMinimumSize(board, "x")} max={400} step={0.5} onCommit={(width) => run(resizeBoard, { width })} />
              <NumberField label={t("field.boardLength")} value={board.length} min={boardMinimumSize(board, "y")} max={400} step={0.5} onCommit={(length) => run(resizeBoard, { length })} />
              <NumberField label={t("field.thickness")} value={board.thickness} min={0.4} max={5} step={0.1} onCommit={(thickness) => patch({ thickness })} />
            </FileSheetFieldGrid>
            <FileSheetFieldGrid columns={2}>
              <NumberField label={t("field.boardClearance")} value={board.clearance} min={1} max={200} step={0.5} onCommit={(clearance) => patch({ clearance })} />
              <NumberField label={t("field.componentHeight")} value={board.componentHeight} min={0} max={200} step={0.5} onCommit={(componentHeight) => patch({ componentHeight })} />
            </FileSheetFieldGrid>
            <FileSheetFieldGrid columns={2}>
              <NumberField label={t("field.padDiameter")} value={board.padDiameter} min={2} max={30} step={0.5} onCommit={(padDiameter) => patch({ padDiameter })} />
              <NumberField label={t("field.boreDiameter")} value={board.boreDiameter} min={0} max={board.padDiameter - 0.8} step={0.1} onCommit={(boreDiameter) => patch({ boreDiameter })} />
            </FileSheetFieldGrid>

            <SubHeading>{t("section.boardHoles")}</SubHeading>
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

            <SubHeading>{t("section.ports")}</SubHeading>
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
            <ItemActions builder={builder} selection={itemSelection} />
          </>
        ) : null}
      </FileSheetItemGroup>
    </SelectableItem>
  );
}

function BoardsTab({ builder }) {
  const { t } = useBoxLanguage();
  const { spec, edit, setSelection } = builder;
  const presets = useBoardPresets();
  const [presetId, setPresetId] = useState("custom");
  const preset = presets.find((entry) => entry.id === presetId) || null;
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
        <FileSheetSelectRow
          label={t("field.boardPreset")}
          value={preset ? presetId : "custom"}
          onValueChange={setPresetId}
          options={[
            { value: "custom", label: t("board.preset.custom") },
            ...presets.map((entry) => ({ value: entry.id, label: entry.name }))
          ]}
        />
        <FileSheetButtonRow>
          <CompactButton icon={Plus} disabled={full} onClick={addBoard}>{t("action.addBoard")}</CompactButton>
        </FileSheetButtonRow>
        {full ? <FileSheetStatusText>{t("boards.full", { max: MAX_BOARDS })}</FileSheetStatusText> : null}
        {!full && preset ? <FileSheetStatusText>{t("boards.presetNote")}</FileSheetStatusText> : null}
      </FileSheetSubsection>
      <FileSheetSubsection title={t("section.boards")}>
        {spec.boards.length ? (
          spec.boards.map((board, index) => (
            <BoardItem key={board.id} builder={builder} board={board} index={index} />
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

  // Picking a hole, standoff group or board in the viewport brings its tab forward.
  useEffect(() => {
    if (!SECTION_FOR_SELECTION[selectionKind]) {
      return;
    }
    setOpenSectionIds([SECTION_FOR_SELECTION[selectionKind]]);
  }, [selectionKind, selectionId]);

  const sections = [
    { id: SECTION_IDS.BODY, title: t("tab.body"), content: <BodyTab builder={builder} /> },
    { id: SECTION_IDS.LID, title: t("tab.lid"), content: <LidTab builder={builder} /> },
    { id: SECTION_IDS.HOLES, title: t("tab.holes"), content: <HolesTab builder={builder} /> },
    { id: SECTION_IDS.STANDOFFS, title: t("tab.standoffs"), content: <StandoffsTab builder={builder} /> },
    { id: SECTION_IDS.BOARDS, title: t("tab.boards"), content: <BoardsTab builder={builder} /> },
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
