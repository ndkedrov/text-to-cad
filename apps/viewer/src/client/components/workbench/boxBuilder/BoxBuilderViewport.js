import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import manifoldWasmUrl from "manifold-3d/manifold.wasm?url";
import { Button } from "@/components/ui/button";
import { cn } from "@/ui/utils";
import { formatWarning } from "@/workbench/boxBuilder/i18n.js";
import {
  duplicateSelected,
  findSelected,
  nudgeSelected,
  removeSelected
} from "@/workbench/boxBuilder/boxEdits.js";
import { manifoldFromPlan, roundedRectContour } from "@/workbench/boxBuilder/manifoldPlan.js";
import { clampPieces } from "@/workbench/boxBuilder/boxPlan.js";
import {
  boardLevels,
  clampBoardPosition,
  clampHolePosition,
  clampStandoffPosition,
  faceAxisLabels,
  faceFrame,
  holeAvailable,
  holeLift,
  isWallFace,
  roundMm,
  standoffPoints
} from "@/workbench/boxBuilder/boxSpec.js";
import { useBoxLanguage } from "./useBoxLanguage";

const BASE_COLOR = 0xc3cad1;
const LID_COLOR = 0x93b4cc;
const EDGE_COLOR = 0x1f252b;
const HIGHLIGHT_COLOR = 0xf97316;
const BOARD_COLOR = 0x2f8f5b;
const PORT_COLOR = 0x9aa3ab;
// How far a connector body is drawn in from the board edge.
const PORT_BODY_DEPTH = 6;
// Pick proxies float just off the surface they belong to, so a ray reaches them
// before the solid they sit on.
const PROXY_LIFT = 0.35;
const DRAG_STEP_MM = 0.5;
const FINE_DRAG_STEP_MM = 0.1;

const VIEW_DIRECTIONS = Object.freeze({
  iso: [0.85, -1.25, 0.95],
  top: [0, -0.0001, 1],
  front: [0, -1, 0.1],
  side: [1, 0, 0.1]
});

const VIEW_OPTIONS = [
  ["iso", "view.iso"],
  ["top", "view.top"],
  ["front", "view.front"],
  ["side", "view.side"]
];

const LID_VIEW_OPTIONS = [
  ["open", "lid.open"],
  ["closed", "lid.closed"],
  ["hidden", "lid.hidden"]
];

let manifoldPromise = null;

function loadManifold() {
  if (!manifoldPromise) {
    manifoldPromise = import("manifold-3d")
      .then(async ({ default: Module }) => {
        const wasm = await Module({ locateFile: () => manifoldWasmUrl });
        wasm.setup();
        return wasm;
      })
      .catch((error) => {
        manifoldPromise = null;
        throw error;
      });
  }
  return manifoldPromise;
}

function formatMm(value) {
  return String(Number(Number(value).toFixed(2)));
}

// Theme colours are CSS (often oklch); a 1px canvas turns any of them into sRGB.
function cssColor(variable, fallback) {
  const color = new THREE.Color(fallback);
  try {
    const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    if (!value) {
      return color;
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.fillStyle = fallback;
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
    color.setRGB(red / 255, green / 255, blue / 255, THREE.SRGBColorSpace);
  } catch {
    // Keep the fallback.
  }
  return color;
}

// The item a warning is about: its own target, or the n-th hole or standoff group.
function warningTarget(spec, warning) {
  if (warning?.target) {
    return warning.target;
  }
  const isStandoff = String(warning?.key || "").startsWith("warning.standoffs");
  const list = isStandoff ? spec.standoffs : spec.holes;
  const item = list[Number(warning?.params?.n) - 1];
  return item ? { kind: isStandoff ? "standoff" : "hole", id: item.id } : null;
}

function lidLift(dims) {
  return Math.max(10, dims.wallHeight * 0.5) + (dims.lipEnabled ? dims.lipHeight : 0);
}

function geometryFromPlan(wasm, node) {
  const solid = manifoldFromPlan(wasm, node);
  try {
    const mesh = solid.getMesh();
    const { numProp, vertProperties, triVerts } = mesh;
    const vertexCount = vertProperties.length / numProp;
    const positions = new Float32Array(vertexCount * 3);
    for (let vertex = 0; vertex < vertexCount; vertex += 1) {
      positions[vertex * 3] = vertProperties[vertex * numProp];
      positions[vertex * 3 + 1] = vertProperties[vertex * numProp + 1];
      positions[vertex * 3 + 2] = vertProperties[vertex * numProp + 2];
    }
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    indexed.setIndex(new THREE.BufferAttribute(new Uint32Array(triVerts), 1));
    const shaded = toCreasedNormals(indexed, THREE.MathUtils.degToRad(30));
    indexed.dispose();
    return shaded;
  } finally {
    solid.delete();
  }
}

function disposeTree(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      material?.dispose?.();
    }
  });
}

// Millimetre paper on the printed parts: lines every 1, 5 and 10 mm in the part's
// own coordinates (from the box centre), projected along whichever axis the
// surface faces most, so they lie on the floor and on both sides of every wall.
// Lines packed tighter than a few pixels fade out instead of turning grey.
const GRID_FRAGMENT_HEADER = `
uniform float boxGridStrength;
varying vec3 vGridPosition;
varying vec3 vGridNormal;
float boxGridLine(vec2 coord, float spacing) {
  vec2 cell = coord / spacing;
  vec2 width = max(fwidth(cell), vec2(1e-5));
  vec2 toLine = abs(fract(cell - 0.5) - 0.5) / width;
  float line = 1.0 - clamp(min(toLine.x, toLine.y), 0.0, 1.0);
  return line * (1.0 - smoothstep(0.2, 0.45, max(width.x, width.y)));
}
`;

const GRID_FRAGMENT_BODY = `
if (boxGridStrength > 0.0) {
  vec3 facing = abs(normalize(vGridNormal));
  vec2 gridCoord = facing.z >= max(facing.x, facing.y)
    ? vGridPosition.xy
    : (facing.x >= facing.y ? vGridPosition.yz : vGridPosition.xz);
  float gridInk = max(
    max(boxGridLine(gridCoord, 1.0) * 0.16, boxGridLine(gridCoord, 5.0) * 0.3),
    boxGridLine(gridCoord, 10.0) * 0.45
  );
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.07, 0.09, 0.11), gridInk * boxGridStrength);
}
`;

function addMillimetreGrid(material, runtime) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.boxGridStrength = runtime.gridUniforms.boxGridStrength;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vGridPosition;\nvarying vec3 vGridNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGridPosition = position;\nvGridNormal = objectNormal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\n${GRID_FRAGMENT_HEADER}`)
      .replace("#include <color_fragment>", `#include <color_fragment>\n${GRID_FRAGMENT_BODY}`);
  };
  material.customProgramCacheKey = () => "box-millimetre-grid";
  return material;
}

function replacePartMesh(runtime, part, geometry) {
  const group = part === "base" ? runtime.baseGroup : runtime.lidGroup;
  for (const key of [`${part}Mesh`, `${part}Edges`]) {
    const previous = runtime[key];
    if (previous) {
      group.remove(previous);
      disposeTree(previous);
      runtime[key] = null;
    }
  }
  if (!geometry) {
    return;
  }
  const mesh = new THREE.Mesh(geometry, addMillimetreGrid(new THREE.MeshStandardMaterial({
    color: part === "base" ? BASE_COLOR : LID_COLOR,
    roughness: 0.78,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1
  }), runtime));
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geometry, 25),
    new THREE.LineBasicMaterial({ color: EDGE_COLOR, transparent: true, opacity: 0.55 })
  );
  group.add(mesh, edges);
  runtime[`${part}Mesh`] = mesh;
  runtime[`${part}Edges`] = edges;
}

function hexagonContour(acrossFlats) {
  const circumradius = acrossFlats / Math.sqrt(3);
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (Math.PI / 3) * index;
    return [circumradius * Math.cos(angle), circumradius * Math.sin(angle)];
  });
}

function holeProxyGeometry(hole) {
  const thickness = 0.5;
  let geometry;
  if (hole.shape === "circle") {
    geometry = new THREE.CylinderGeometry(hole.width / 2, hole.width / 2, thickness, 48);
    geometry.rotateX(Math.PI / 2);
  } else {
    const contour = hole.shape === "hex"
      ? hexagonContour(hole.width)
      : roundedRectContour(
        hole.width,
        hole.height,
        hole.shape === "slot" ? Math.min(hole.width, hole.height) / 2 : hole.radius
      );
    const shape = new THREE.Shape();
    contour.forEach(([x, y], index) => (index ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    geometry.translate(0, 0, -thickness / 2);
  }
  geometry.rotateZ(THREE.MathUtils.degToRad(hole.rotation));
  return geometry;
}

function proxyMaterial() {
  return new THREE.MeshBasicMaterial({
    color: HIGHLIGHT_COLOR,
    transparent: true,
    opacity: 0,
    depthWrite: false
  });
}

function buildProxies(spec, dims) {
  const base = new THREE.Group();
  const lid = new THREE.Group();
  for (const hole of spec.holes) {
    if (!holeAvailable(dims, hole.face)) {
      continue;
    }
    const frame = faceFrame(dims, hole.face);
    const axisU = new THREE.Vector3(...frame.u);
    const axisV = new THREE.Vector3(...frame.v);
    const normal = new THREE.Vector3(...frame.normal);
    const mesh = new THREE.Mesh(holeProxyGeometry(hole), proxyMaterial());
    mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axisU, axisV, normal));
    mesh.position.set(...frame.origin)
      .addScaledVector(axisU, hole.u)
      .addScaledVector(axisV, hole.v)
      .addScaledVector(normal, PROXY_LIFT);
    mesh.renderOrder = 2;
    mesh.userData.feature = { kind: "hole", id: hole.id };
    (hole.face === "lid" ? lid : base).add(mesh);
  }
  for (const group of spec.standoffs) {
    const radius = group.outerDiameter / 2 + 0.4;
    for (const [x, y] of standoffPoints(group)) {
      const geometry = new THREE.CylinderGeometry(radius, radius, group.height + 0.3, 40);
      geometry.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(geometry, proxyMaterial());
      mesh.position.set(x, y, dims.floorTop + group.height / 2 + 0.05);
      mesh.renderOrder = 2;
      mesh.userData.feature = { kind: "standoff", id: group.id };
      base.add(mesh);
    }
  }
  return { base, lid };
}

// A board plate with its mounting holes, in the board's own frame centred on the
// origin, from z = 0 (its underside) up.
function boardPlateGeometry(board) {
  const halfWidth = board.width / 2;
  const halfLength = board.length / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -halfLength);
  shape.lineTo(halfWidth, -halfLength);
  shape.lineTo(halfWidth, halfLength);
  shape.lineTo(-halfWidth, halfLength);
  shape.closePath();
  // Triangulation breaks on a hole that touches the outline or another hole:
  // draw only the ones clear of both (the standoffs are there either way).
  const drawn = [];
  for (const hole of board.holes) {
    const radius = hole.diameter / 2;
    const clearOfEdges = hole.x - radius > 0.05 && hole.x + radius < board.width - 0.05 &&
      hole.y - radius > 0.05 && hole.y + radius < board.length - 0.05;
    const clearOfHoles = drawn.every((other) => (
      Math.hypot(other.x - hole.x, other.y - hole.y) > other.diameter / 2 + radius + 0.05
    ));
    if (!clearOfEdges || !clearOfHoles) {
      continue;
    }
    drawn.push(hole);
    const path = new THREE.Path();
    path.absarc(hole.x - halfWidth, hole.y - halfLength, radius, 0, Math.PI * 2, false);
    shape.holes.push(path);
  }
  return new THREE.ExtrudeGeometry(shape, { depth: board.thickness, bevelEnabled: false, curveSegments: 20 });
}

// A connector body on its board edge: PORT_BODY_DEPTH in from the edge and
// `overhang` out past it.
function portBodyMesh(board, port, material) {
  const depth = PORT_BODY_DEPTH + port.overhang;
  const alongX = port.edge === "front" || port.edge === "back";
  let geometry;
  if (port.shape === "circle") {
    geometry = new THREE.CylinderGeometry(port.width / 2, port.width / 2, depth, 32);
    if (!alongX) {
      geometry.rotateZ(Math.PI / 2);
    }
  } else {
    geometry = alongX
      ? new THREE.BoxGeometry(port.width, depth, port.height)
      : new THREE.BoxGeometry(depth, port.width, port.height);
  }
  const mesh = new THREE.Mesh(geometry, material);
  const halfWidth = board.width / 2;
  const halfLength = board.length / 2;
  const inward = (PORT_BODY_DEPTH - port.overhang) / 2;
  const z = board.thickness + port.elevation + port.height / 2;
  if (port.edge === "back") {
    mesh.position.set(port.offset - halfWidth, halfLength - inward, z);
  } else if (port.edge === "left") {
    mesh.position.set(-halfWidth + inward, port.offset - halfLength, z);
  } else if (port.edge === "right") {
    mesh.position.set(halfWidth - inward, port.offset - halfLength, z);
  } else {
    mesh.position.set(port.offset - halfWidth, -halfLength + inward, z);
  }
  return mesh;
}

// Mounted boards as they sit on their standoffs. Shown, never printed.
function buildBoardVisuals(spec, dims) {
  const root = new THREE.Group();
  for (const board of spec.boards) {
    if (!board.mounted) {
      continue;
    }
    const feature = { kind: "board", id: board.id };
    const holder = new THREE.Group();
    holder.position.set(board.x, board.y, boardLevels(dims, board).bottom);
    holder.rotation.z = THREE.MathUtils.degToRad(board.rotation);
    // Upside down: turned over about the board's own Y axis, underside kept at `bottom`.
    const body = new THREE.Group();
    if (board.flipped) {
      body.rotation.y = Math.PI;
      body.position.z = board.thickness;
    }
    holder.add(body);
    const plate = new THREE.Mesh(boardPlateGeometry(board), new THREE.MeshStandardMaterial({
      color: BOARD_COLOR,
      roughness: 0.6,
      metalness: 0,
      transparent: true,
      opacity: 0.9
    }));
    const portMaterial = new THREE.MeshStandardMaterial({ color: PORT_COLOR, roughness: 0.4, metalness: 0.3 });
    const parts = [plate, ...board.ports.map((port) => portBodyMesh(board, port, portMaterial))];
    for (const part of parts) {
      part.userData.feature = feature;
      part.userData.boardPart = true;
      body.add(part);
    }
    root.add(holder);
  }
  return root;
}

function boardMeshes(runtime) {
  const meshes = [];
  runtime.boardVisuals?.traverse((object) => {
    if (object.isMesh && object.userData.boardPart) {
      meshes.push(object);
    }
  });
  return meshes;
}

function sameFeature(left, right) {
  return Boolean(left && right && left.kind === right.kind && left.id === right.id);
}

function paintProxies(runtime, selection, hover) {
  for (const group of [runtime.baseProxies, runtime.lidProxies]) {
    for (const mesh of group?.children || []) {
      const feature = mesh.userData.feature;
      mesh.material.opacity = sameFeature(feature, selection) ? 0.5 : sameFeature(feature, hover) ? 0.22 : 0;
    }
  }
  for (const mesh of boardMeshes(runtime)) {
    const feature = mesh.userData.feature;
    mesh.material.emissive.setHex(sameFeature(feature, selection) ? 0x9a4a10 : sameFeature(feature, hover) ? 0x4a2508 : 0x000000);
  }
  runtime.requestRender();
}

function applyTheme(runtime, dims) {
  const background = cssColor("--background", "#f4f5f7");
  const foreground = cssColor("--foreground", "#1f2328");
  runtime.scene.background = background;
  for (const key of ["grid", "gridFine"]) {
    if (runtime[key]) {
      runtime.scene.remove(runtime[key]);
      disposeTree(runtime[key]);
      runtime[key] = null;
    }
  }
  if (dims) {
    const size = Math.max(100, Math.ceil((Math.max(dims.width, dims.depth) * 2) / 50) * 50);
    // The 1 mm table grid: fainter than the 5 mm one and drawn under it; the
    // render loop fades it out as the camera pulls back.
    const fineColor = background.clone().lerp(foreground, 0.07);
    const fine = new THREE.GridHelper(size, size, fineColor, fineColor);
    fine.material.transparent = true;
    fine.material.depthWrite = false;
    fine.rotation.x = Math.PI / 2;
    fine.position.z = -0.03;
    fine.renderOrder = -1;
    fine.visible = Boolean(runtime.display?.groundMm);
    runtime.scene.add(fine);
    runtime.gridFine = fine;
    const grid = new THREE.GridHelper(
      size,
      size / 5,
      background.clone().lerp(foreground, 0.28),
      background.clone().lerp(foreground, 0.12)
    );
    grid.rotation.x = Math.PI / 2;
    grid.position.z = -0.02;
    runtime.scene.add(grid);
    runtime.grid = grid;
    runtime.gridSize = size;
  }
  runtime.requestRender();
}

function applyViewport(runtime, container, insets) {
  const width = Math.max(container.clientWidth, 1);
  const height = Math.max(container.clientHeight, 1);
  runtime.renderer.setSize(width, height, false);
  runtime.camera.aspect = width / height;
  // Centre the model in the part of the canvas the side panels leave visible.
  const left = Number(insets?.left) || 0;
  const right = Number(insets?.right) || 0;
  const top = Number(insets?.top) || 0;
  runtime.camera.setViewOffset(width, height, (right - left) / 2, -top / 2, width, height);
  runtime.camera.updateProjectionMatrix();
  runtime.requestRender();
}

function frameBox(runtime, dims, view, lidView, spec) {
  const { camera, controls } = runtime;
  const lift = lidView === "open" && dims.lidEnabled ? lidLift(dims) : 0;
  const height = dims.totalHeight + lift;
  // Clamp T pieces lie on the bed to the right of the box: keep them in the frame.
  const pieces = spec ? clampPieces(spec, dims) : [];
  const last = pieces[pieces.length - 1];
  const extra = last ? last.x + last.width - dims.width / 2 : 0;
  const center = new THREE.Vector3(extra / 2, 0, height / 2);
  const radius = 0.5 * Math.hypot(dims.width + extra, dims.depth, height);
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2))) * 1.12;
  const direction = new THREE.Vector3(...(VIEW_DIRECTIONS[view] || VIEW_DIRECTIONS.iso)).normalize();
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 200, 0.05);
  camera.far = distance * 50;
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.update();
  runtime.requestRender();
}

export default function BoxBuilderViewport({ builder, insets, sourceUrl = "" }) {
  const containerRef = useRef(null);
  const canvasHostRef = useRef(null);
  const runtimeRef = useRef(null);
  const framedRef = useRef(false);
  const hoverRef = useRef(null);
  const latestRef = useRef({});
  const [wasm, setWasm] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [buildError, setBuildError] = useState("");
  const [hover, setHover] = useState(null);
  const [readout, setReadout] = useState(null);
  const [lidView, setLidView] = useState("open");
  const [warningsOpen, setWarningsOpen] = useState(false);
  const { language, t } = useBoxLanguage();
  const { spec, dims, plan, selection, warnings } = builder;
  latestRef.current = { builder, insets, lidView, t };

  useEffect(() => {
    let cancelled = false;
    loadManifold().then(
      (module) => {
        if (!cancelled) {
          setWasm(module);
        }
      },
      (error) => {
        if (!cancelled) {
          setLoadError(String(error?.message || error));
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  // Scene, camera, controls, render loop, input.
  useEffect(() => {
    const container = containerRef.current;
    const host = canvasHostRef.current;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.className = "block h-full w-full touch-none outline-none";
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 10000);
    camera.up.set(0, 0, 1);
    camera.position.set(150, -220, 160);
    scene.add(camera);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6f7780, 1.5));
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.7);
    keyLight.position.set(0.7, 1, 0.6);
    camera.add(keyLight);
    camera.add(keyLight.target);
    keyLight.target.position.set(0, 0, -1);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.14;
    controls.screenSpacePanning = true;
    controls.zoomToCursor = true;

    const baseGroup = new THREE.Group();
    const lidGroup = new THREE.Group();
    scene.add(baseGroup, lidGroup);

    const runtime = {
      renderer,
      scene,
      camera,
      controls,
      baseGroup,
      lidGroup,
      baseMesh: null,
      baseEdges: null,
      lidMesh: null,
      lidEdges: null,
      baseProxies: null,
      lidProxies: null,
      boardVisuals: null,
      grid: null,
      gridFine: null,
      gridSize: 0,
      display: latestRef.current.builder.display,
      gridUniforms: { boxGridStrength: { value: latestRef.current.builder.display?.boxMm ? 1 : 0 } },
      needsRender: true,
      requestRender: () => {
        runtime.needsRender = true;
      }
    };
    runtimeRef.current = runtime;
    controls.addEventListener("change", runtime.requestRender);
    applyTheme(runtime, latestRef.current.builder.dims);
    applyViewport(runtime, host, latestRef.current.insets);

    const themeObserver = new MutationObserver(() => applyTheme(runtime, latestRef.current.builder.dims));
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
    const resizeObserver = new ResizeObserver(() => applyViewport(runtime, host, latestRef.current.insets));
    resizeObserver.observe(host);

    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const moved = controls.update();
      const fine = runtime.gridFine;
      if (fine?.visible) {
        const distance = Math.max(camera.position.distanceTo(controls.target), 1e-3);
        const pixelsPerMm = renderer.domElement.height / (2 * distance * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
        const opacity = THREE.MathUtils.clamp((pixelsPerMm - 2.5) / 4, 0, 1);
        if (Math.abs(fine.material.opacity - opacity) > 0.01) {
          fine.material.opacity = opacity;
          runtime.needsRender = true;
        }
      }
      if (runtime.needsRender || moved) {
        runtime.needsRender = false;
        renderer.render(scene, camera);
      }
    };
    tick();

    // --- input -------------------------------------------------------------
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let drag = null;
    let press = null;
    let hoverFrame = 0;

    const aimRay = (event) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      raycaster.setFromCamera(pointer, camera);
    };
    const shown = (object) => {
      for (let node = object; node; node = node.parent) {
        if (!node.visible) {
          return false;
        }
      }
      return true;
    };
    const pick = (event) => {
      aimRay(event);
      const targets = [
        runtime.baseMesh,
        runtime.lidMesh,
        ...(runtime.baseProxies?.children || []),
        ...(runtime.lidProxies?.children || []),
        ...boardMeshes(runtime)
      ].filter((object) => object && shown(object));
      const hit = raycaster.intersectObjects(targets, false)[0];
      return hit?.object.userData.feature ? { feature: hit.object.userData.feature, point: hit.point } : null;
    };

    const setHovered = (feature) => {
      if (sameFeature(hoverRef.current, feature) || (!hoverRef.current && !feature)) {
        return;
      }
      hoverRef.current = feature;
      setHover(feature);
      renderer.domElement.style.cursor = feature ? "grab" : "";
    };

    const finishDrag = (cancel) => {
      if (!drag) {
        return;
      }
      try {
        renderer.domElement.releasePointerCapture(drag.pointerId);
      } catch {
        // Already released.
      }
      controls.enabled = true;
      latestRef.current.builder.endGesture({ cancel });
      drag = null;
      renderer.domElement.style.cursor = hoverRef.current ? "grab" : "";
      setReadout(null);
    };

    // Capture phase on the host: runs before OrbitControls' own listener on the
    // canvas, so grabbing a feature never also starts an orbit.
    const onPointerDown = (event) => {
      if (event.button !== 0) {
        return;
      }
      press = { x: event.clientX, y: event.clientY };
      const hit = pick(event);
      if (!hit) {
        return;
      }
      const { builder: current } = latestRef.current;
      const item = findSelected(current.spec, hit.feature);
      if (!item) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      current.setSelection({ kind: hit.feature.kind, id: hit.feature.id });
      const normal = hit.feature.kind === "hole"
        ? new THREE.Vector3(...faceFrame(current.dims, item.face).normal)
        : new THREE.Vector3(0, 0, 1);
      drag = {
        feature: hit.feature,
        item,
        plane: new THREE.Plane().setFromNormalAndCoplanarPoint(normal, hit.point),
        start: hit.point.clone(),
        pointerId: event.pointerId
      };
      controls.enabled = false;
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = "grabbing";
      current.beginGesture();
    };

    const onPointerMove = (event) => {
      if (drag) {
        aimRay(event);
        const point = new THREE.Vector3();
        if (!raycaster.ray.intersectPlane(drag.plane, point)) {
          return;
        }
        const delta = point.sub(drag.start);
        const step = event.shiftKey ? FINE_DRAG_STEP_MM : DRAG_STEP_MM;
        const snap = (value) => roundMm(Math.round(value / step) * step, 3);
        const { builder: current } = latestRef.current;
        const { item } = drag;
        let text;
        if (drag.feature.kind !== "hole") {
          const isBoard = drag.feature.kind === "board";
          const clampPosition = isBoard ? clampBoardPosition : clampStandoffPosition;
          const target = clampPosition(current.dims, item, snap(item.x + delta.x), snap(item.y + delta.y));
          current.gestureEdit((draft) => {
            const entry = (isBoard ? draft.boards : draft.standoffs).find((candidate) => candidate.id === item.id);
            if (entry) {
              entry.x = target.x;
              entry.y = target.y;
            }
          });
          text = `X ${formatMm(target.x)} · Y ${formatMm(target.y)} ${latestRef.current.t("unit.mm")}`;
        } else {
          const frameAxes = faceFrame(current.dims, item.face);
          const deltaU = delta.dot(new THREE.Vector3(...frameAxes.u));
          const deltaV = delta.dot(new THREE.Vector3(...frameAxes.v));
          const target = clampHolePosition(current.dims, item, snap(item.u + deltaU), snap(item.v + deltaV));
          current.gestureEdit((draft) => {
            const hole = draft.holes.find((entry) => entry.id === item.id);
            if (hole) {
              hole.u = target.u;
              hole.v = target.v;
            }
          });
          const [labelU, labelV] = faceAxisLabels(item.face).map((key) => latestRef.current.t(key));
          const shownV = isWallFace(item.face) ? holeLift(current.dims, { ...item, v: target.v }) : target.v;
          text = `${labelU} ${formatMm(target.u)} · ${labelV} ${formatMm(shownV)} ${latestRef.current.t("unit.mm")}`;
        }
        setReadout({ x: event.clientX, y: event.clientY, text });
        return;
      }
      if (event.buttons) {
        return;
      }
      cancelAnimationFrame(hoverFrame);
      hoverFrame = requestAnimationFrame(() => setHovered(pick(event)?.feature || null));
    };

    const onPointerUp = (event) => {
      if (drag) {
        finishDrag(false);
        press = null;
        return;
      }
      if (press && event.button === 0 && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4 && !pick(event)) {
        latestRef.current.builder.setSelection(null);
      }
      press = null;
    };

    const onPointerLeave = () => {
      if (!drag) {
        setHovered(null);
      }
    };

    const onKeyDown = (event) => {
      if (event.target?.closest?.("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox']")) {
        return;
      }
      const { builder: current } = latestRef.current;
      const modifier = event.ctrlKey || event.metaKey;
      if (event.key === "Escape") {
        if (drag) {
          finishDrag(true);
        } else {
          current.setSelection(null);
        }
        return;
      }
      // event.code, not event.key: the shortcut stays on the same key in a Cyrillic layout.
      if (modifier && event.code === "KeyZ") {
        event.preventDefault();
        if (event.shiftKey) {
          current.redo();
        } else {
          current.undo();
        }
        return;
      }
      if (modifier && event.code === "KeyY") {
        event.preventDefault();
        current.redo();
        return;
      }
      const selected = current.selection;
      if (!selected || drag) {
        return;
      }
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        current.edit((draft) => removeSelected(draft, selected));
        current.setSelection(null);
        return;
      }
      if (modifier && event.code === "KeyD") {
        event.preventDefault();
        let copy = null;
        current.edit((draft) => {
          copy = duplicateSelected(draft, selected);
        });
        if (copy) {
          current.setSelection(copy);
        }
        return;
      }
      const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
      if (arrows[event.key]) {
        event.preventDefault();
        const size = event.shiftKey ? 10 : 1;
        const [du, dv] = arrows[event.key];
        current.edit((draft) => nudgeSelected(draft, selected, du * size, dv * size));
      }
    };

    host.addEventListener("pointerdown", onPointerDown, { capture: true });
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointerleave", onPointerLeave);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(hoverFrame);
      host.removeEventListener("pointerdown", onPointerDown, { capture: true });
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointerleave", onPointerLeave);
      window.removeEventListener("keydown", onKeyDown);
      themeObserver.disconnect();
      resizeObserver.disconnect();
      controls.dispose();
      disposeTree(scene);
      renderer.dispose();
      renderer.domElement.remove();
      runtimeRef.current = null;
      void container;
    };
  }, []);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime && canvasHostRef.current) {
      applyViewport(runtime, canvasHostRef.current, insets);
    }
  }, [insets?.left, insets?.right, insets?.top]);

  // Geometry: rebuilt from the plan at most once per frame.
  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime || !wasm) {
      return undefined;
    }
    const handle = requestAnimationFrame(() => {
      try {
        replacePartMesh(runtime, "base", plan.base ? geometryFromPlan(wasm, plan.base) : null);
        replacePartMesh(runtime, "lid", plan.lid ? geometryFromPlan(wasm, plan.lid) : null);
        setBuildError("");
      } catch (error) {
        setBuildError(String(error?.message || error));
      }
      const wantedGrid = Math.max(100, Math.ceil((Math.max(dims.width, dims.depth) * 2) / 50) * 50);
      if (wantedGrid !== runtime.gridSize) {
        applyTheme(runtime, dims);
      }
      if (!framedRef.current) {
        framedRef.current = true;
        frameBox(runtime, dims, "iso", latestRef.current.lidView, latestRef.current.builder?.spec);
      }
      runtime.requestRender();
    });
    return () => cancelAnimationFrame(handle);
  }, [wasm, plan, dims]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    for (const key of ["baseProxies", "lidProxies", "boardVisuals"]) {
      if (runtime[key]) {
        runtime[key].parent?.remove(runtime[key]);
        disposeTree(runtime[key]);
        runtime[key] = null;
      }
    }
    const proxies = buildProxies(spec, dims);
    runtime.baseGroup.add(proxies.base);
    runtime.lidGroup.add(proxies.lid);
    runtime.baseProxies = proxies.base;
    runtime.lidProxies = proxies.lid;
    runtime.boardVisuals = buildBoardVisuals(spec, dims);
    runtime.boardVisuals.visible = runtime.display?.boards !== false;
    runtime.baseGroup.add(runtime.boardVisuals);
    paintProxies(runtime, latestRef.current.builder.selection, hoverRef.current);
  }, [spec, dims]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) {
      paintProxies(runtime, selection, hover);
    }
  }, [selection, hover]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.lidGroup.visible = lidView !== "hidden";
    runtime.lidGroup.position.z = lidView === "open" ? lidLift(dims) : 0;
    runtime.requestRender();
  }, [lidView, dims]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (!runtime) {
      return;
    }
    runtime.display = builder.display;
    runtime.gridUniforms.boxGridStrength.value = builder.display.boxMm ? 1 : 0;
    if (runtime.gridFine) {
      runtime.gridFine.visible = builder.display.groundMm;
    }
    // Hidden boards are not pickable either: the pick skips invisible objects.
    if (runtime.boardVisuals) {
      runtime.boardVisuals.visible = builder.display.boards;
    }
    runtime.requestRender();
  }, [builder.display]);

  const setView = (view) => {
    const runtime = runtimeRef.current;
    if (runtime) {
      frameBox(runtime, dims, view, lidView, spec);
    }
  };

  const left = Number(insets?.left) || 0;
  const right = Number(insets?.right) || 0;
  const top = Number(insets?.top) || 0;
  const error = loadError
    ? t("viewport.loadError", { error: loadError })
    : buildError ? t("viewport.geometryError", { error: buildError }) : "";
  const buttonClasses = "h-7 px-2 text-[11px]";

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden" data-box-builder-viewport="">
      <div ref={canvasHostRef} className="absolute inset-0" />

      <div
        className="pointer-events-auto absolute flex flex-wrap items-center gap-1.5"
        style={{ left: left + 12, top: top + 12, maxWidth: `calc(100% - ${left + right + 24}px)` }}
      >
        <div className="cad-glass-surface flex items-center gap-0.5 rounded-lg border border-sidebar-border p-0.5">
          {VIEW_OPTIONS.map(([value, labelKey]) => (
            <Button key={value} type="button" variant="ghost" size="sm" className={buttonClasses} onClick={() => setView(value)}>
              {t(labelKey)}
            </Button>
          ))}
        </div>
        {dims.lidEnabled ? (
          <div className="cad-glass-surface flex items-center gap-0.5 rounded-lg border border-sidebar-border p-0.5" aria-label={t("lid.viewAria")}>
            {LID_VIEW_OPTIONS.map(([value, labelKey]) => (
              <Button
                key={value}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={lidView === value}
                className={cn(buttonClasses, lidView === value && "bg-accent text-accent-foreground")}
                onClick={() => setLidView(value)}
              >
                {t(labelKey)}
              </Button>
            ))}
          </div>
        ) : null}
        {warnings.length ? (
          <div className="relative">
            <button
              type="button"
              aria-expanded={warningsOpen}
              onClick={() => setWarningsOpen((open) => !open)}
              className="cad-glass-surface rounded-lg border border-amber-500/50 px-2 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/10 dark:text-amber-300"
            >
              {t("viewport.warnings", { count: warnings.length })} {warningsOpen ? "▴" : "▾"}
            </button>
            {warningsOpen ? (
              <ul className="cad-glass-surface absolute left-0 top-full z-10 mt-1 w-72 max-w-[80vw] space-y-0.5 rounded-lg border border-amber-500/50 p-1 shadow-lg">
                {warnings.map((warning) => {
                  const target = warningTarget(spec, warning);
                  const sentence = formatWarning(language, warning);
                  return (
                    <li key={sentence}>
                      <button
                        type="button"
                        disabled={!target}
                        onClick={() => {
                          if (target) {
                            builder.setSelection(target);
                          }
                          setWarningsOpen(false);
                        }}
                        className="w-full rounded-md px-2 py-1.5 text-left text-[11px] leading-4 text-foreground hover:bg-accent disabled:cursor-default disabled:hover:bg-transparent"
                      >
                        {sentence}
                      </button>
                    </li>
                  );
                })}
                <li className="px-2 pb-1 pt-0.5 text-[10px] leading-4 text-muted-foreground">{t("viewport.warningsHint")}</li>
              </ul>
            ) : null}
          </div>
        ) : null}
        {!wasm && !loadError ? (
          <div className="cad-glass-surface rounded-lg border border-sidebar-border px-2 py-1 text-[11px] text-muted-foreground">
            {t("viewport.loading")}
          </div>
        ) : null}
        {error ? (
          <div className="cad-glass-surface rounded-lg border border-destructive/50 px-2 py-1 text-[11px] text-destructive">
            {error}
          </div>
        ) : null}
      </div>

      <div
        className="pointer-events-none absolute flex flex-wrap items-end justify-center gap-2 px-3"
        style={{ left, right, bottom: 12 }}
      >
        <div className="cad-glass-surface max-w-full rounded-lg border border-sidebar-border px-2.5 py-1 text-center text-[10px] leading-4 text-muted-foreground">
          {t("viewport.hint")}
        </div>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="cad-glass-surface pointer-events-auto rounded-lg border border-sidebar-border px-2.5 py-1 text-[10px] font-medium leading-4 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            {t("footer.source")}
          </a>
        ) : null}
      </div>

      {readout ? (
        <div
          className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium tabular-nums text-popover-foreground shadow-md"
          style={{ left: readout.x + 16, top: readout.y + 16 }}
        >
          {readout.text}
        </div>
      ) : null}
    </div>
  );
}
