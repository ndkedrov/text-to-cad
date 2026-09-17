// Box builder: evaluate a CSG plan with manifold (WASM), for the live preview or
// for print files a host writes itself. Same grammar as cadgen.box_csg; curves
// become polygons here, which is the only difference between what the preview
// shows and the exported STEP.

// Segments in a full circle of this radius, as the preview draws it. Always a
// multiple of 4, so a rounded corner gets a whole quarter.
export function circleSegments(radius) {
  return Math.min(128, Math.max(24, Math.round(radius * 6 / 4) * 4));
}

// How far a facet of an exported circle may stray from the true curve, in mm.
export const EXPORT_CHORD_TOLERANCE_MM = 0.02;

// The same for print files (STL, 3MF), where a facet shows on the part: never
// coarser than the preview the user saw, and fine enough that no chord sits
// further than EXPORT_CHORD_TOLERANCE_MM inside the circle, up to 256. Measured
// against the server's files: every volume within 0.15 %, every bounding box
// exact. Always a multiple of 4.
export function exportCircleSegments(radius) {
  const preview = circleSegments(radius);
  if (radius <= EXPORT_CHORD_TOLERANCE_MM) {
    return preview;
  }
  const chord = Math.PI / Math.acos(1 - EXPORT_CHORD_TOLERANCE_MM / radius);
  return Math.min(256, Math.max(preview, Math.ceil(chord / 4) * 4));
}

export const PLAN_QUALITIES = Object.freeze(["preview", "export"]);

// Segments for a circle at a quality: "preview" (the default) or "export".
export function circleSegmentsFor(radius, quality = "preview") {
  if (quality === "preview") {
    return circleSegments(radius);
  }
  if (quality === "export") {
    return exportCircleSegments(radius);
  }
  throw new Error(`unknown plan quality: ${quality}`);
}

// Counter-clockwise outline of a rectangle centred on the origin with rounded corners.
export function roundedRectContour(width, depth, radius, quality = "preview") {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cornerRadius = Math.min(Math.max(radius, 0), halfWidth, halfDepth);
  const segments = circleSegmentsFor(cornerRadius, quality);
  if (cornerRadius <= 1e-6) {
    return [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  }
  const steps = Math.max(2, segments / 4);
  const corners = [
    [halfWidth - cornerRadius, halfDepth - cornerRadius, 0],
    [-halfWidth + cornerRadius, halfDepth - cornerRadius, 90],
    [-halfWidth + cornerRadius, -halfDepth + cornerRadius, 180],
    [halfWidth - cornerRadius, -halfDepth + cornerRadius, 270]
  ];
  const points = [];
  for (const [centerX, centerY, startDegrees] of corners) {
    for (let step = 0; step <= steps; step += 1) {
      const angle = ((startDegrees + (90 * step) / steps) * Math.PI) / 180;
      const point = [centerX + cornerRadius * Math.cos(angle), centerY + cornerRadius * Math.sin(angle)];
      const previous = points[points.length - 1];
      if (!previous || Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 1e-6) {
        points.push(point);
      }
    }
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length > 1 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 1e-6) {
    points.pop();
  }
  return points;
}

// Returns a Manifold the caller owns (call .delete() when done). Every
// intermediate object is freed here: WASM memory is not garbage-collected.
// `quality` sets how finely circles and rounded corners are cut into polygons:
// "preview" (the default) or "export".
export function manifoldFromPlan(wasm, plan, { quality = "preview" } = {}) {
  const { Manifold, CrossSection } = wasm;
  // An unknown quality fails here, before any wasm object is made.
  circleSegmentsFor(1, quality);
  const owned = [];
  const own = (object) => {
    owned.push(object);
    return object;
  };

  const extrudeContour = (contour, height) => {
    const section = own(new CrossSection([contour]));
    return own(section.extrude(height));
  };

  const build = (node) => {
    let solid;
    switch (node.type) {
      case "rrect":
        solid = extrudeContour(roundedRectContour(node.w, node.d, node.r, quality), node.h);
        break;
      case "cyl":
        solid = own(Manifold.cylinder(node.h, node.r, node.r, circleSegmentsFor(node.r, quality)));
        break;
      case "poly":
        solid = extrudeContour(node.points, node.h);
        break;
      case "union": {
        const children = node.children.map(build);
        solid = children.length === 1 ? children[0] : own(Manifold.union(children));
        break;
      }
      case "difference": {
        const [first, ...rest] = node.children.map(build);
        if (!rest.length) {
          solid = first;
        } else {
          const cutter = rest.length === 1 ? rest[0] : own(Manifold.union(rest));
          solid = own(first.subtract(cutter));
        }
        break;
      }
      default:
        throw new Error(`unknown plan node type: ${node.type}`);
    }
    const [rx = 0, ry = 0, rz = 0] = node.rot || [];
    if (rx) {
      solid = own(solid.rotate([rx, 0, 0]));
    }
    if (ry) {
      solid = own(solid.rotate([0, ry, 0]));
    }
    if (rz) {
      solid = own(solid.rotate([0, 0, rz]));
    }
    if (node.pos) {
      solid = own(solid.translate(node.pos));
    }
    return solid;
  };

  let result = null;
  try {
    result = build(plan);
    return result;
  } finally {
    for (const object of owned) {
      if (object !== result) {
        object.delete();
      }
    }
  }
}
