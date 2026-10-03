import { buildBoxPlan, coloredPlanParts } from "./boxPlan.js";
import { manifoldFromPlan } from "./manifoldPlan.js";

// Match the STEP builder's linear RGB colors, encoded here as sRGB.
const DEFAULT_COLOR = "#D4D4D8";
const LID_COLOR = "#E5EAEF";

// Keep closed kernel meshes indexed: coincident vertices on touching islands
// can be topologically distinct. Coordinate welding loses that distinction.
export function buildBoxPrintMesh(wasm, spec, part) {
  const plan = buildBoxPlan(spec, { layout: "print" });
  let parts;
  if (part === "base") parts = [{ plan: plan.base, color: DEFAULT_COLOR }];
  else if (part === "lid") parts = [{ plan: plan.lid, color: DEFAULT_COLOR }];
  else if (part === "inlay" && plan.inlay) {
    const colors = coloredPlanParts(plan.inlay);
    parts = [{ plan: plan.lid, color: LID_COLOR },
      ...(colors.length ? colors : [{ plan: plan.inlay, color: "#F9D36C" }])];
  } else throw new Error(`Unavailable box print part: ${part}`);
  const primitives = parts.filter(({ plan: node }) => node).map(({ plan: node, color }) => {
    const solid = manifoldFromPlan(wasm, node, { quality: "export" });
    try {
      if (solid.status() !== "NoError" || solid.isEmpty()) {
        throw new Error(`Invalid box print mesh: ${solid.status()}`);
      }
      const mesh = solid.getMesh();
      const positions = new Float32Array(mesh.numVert * 3);
      for (let i = 0; i < mesh.numVert; i++) {
        positions.set(mesh.vertProperties.subarray(i * mesh.numProp, i * mesh.numProp + 3), i * 3);
      }
      return { color: color.toUpperCase(), positions, indices: new Uint32Array(mesh.triVerts) };
    } finally {
      solid.delete();
    }
  });
  if (!primitives.length) throw new Error(`Unavailable box print part: ${part}`);
  return { primitives, triangleCount: primitives.reduce((n, p) => n + p.indices.length / 3, 0) };
}
