// Box builder: evaluate a CSG plan with manifold (WASM) for the live preview.
// Same grammar as cadgen.box_csg; curves become polygons here, which is the only
// difference between what the preview shows and the exported STEP.

export function circleSegments(radius) {
  return Math.min(128, Math.max(24, Math.round(radius * 6 / 4) * 4));
}

// Counter-clockwise outline of a rectangle centred on the origin with rounded corners.
export function roundedRectContour(width, depth, radius) {
  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const cornerRadius = Math.min(Math.max(radius, 0), halfWidth, halfDepth);
  if (cornerRadius <= 1e-6) {
    return [[-halfWidth, -halfDepth], [halfWidth, -halfDepth], [halfWidth, halfDepth], [-halfWidth, halfDepth]];
  }
  const steps = Math.max(2, circleSegments(cornerRadius) / 4);
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
export function manifoldFromPlan(wasm, plan) {
  const { Manifold, CrossSection } = wasm;
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
        solid = extrudeContour(roundedRectContour(node.w, node.d, node.r), node.h);
        break;
      case "cyl":
        solid = own(Manifold.cylinder(node.h, node.r, node.r, circleSegments(node.r)));
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
