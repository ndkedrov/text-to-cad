import { MAX_CONTOUR_POINTS, MAX_ENGRAVING_CONTOURS, MAX_ENGRAVING_POINTS } from "./engraving.js";

export function engravingFits(groups, silhouette) {
  const rings = [...silhouette, ...groups.flatMap((group) => group.contours)];
  return groups.length <= 32
    && groups.every((group) => group.contours.length <= MAX_ENGRAVING_CONTOURS)
    && rings.every((ring) => ring.length <= MAX_CONTOUR_POINTS)
    && rings.reduce((sum, ring) => sum + ring.length, 0) <= MAX_ENGRAVING_POINTS;
}

// Transfer whole tiny material regions to a neighbour. Nothing is subtracted
// from the drawing: each subtraction from one material is added to another.
// Keep the largest component of every colour and every isolated silhouette
// island. The 0.2 mm bound applies at the initial fitted size on the lid.
export async function mergeSmallColorRegions(wasm, groups, silhouette, {
  millimetresPerUnit, breathe = async () => {}
} = {}) {
  const unchanged = { colorGroups: groups, contours: silhouette, mergedRegions: 0 };
  if (engravingFits(groups, silhouette) || groups.length > 32
    || !(millimetresPerUnit > 0) || !Number.isFinite(millimetresPerUnit)) return unchanged;
  const regions = groups.map((group) => new wasm.CrossSection(group.contours, "Positive"));
  const candidates = [];
  const readGroups = () => groups.map((group, index) => ({ ...group, contours: regions[index].toPolygons() }));
  let mergedRegions = 0;
  try {
    regions.forEach((region, index) => {
      const pieces = region.decompose().sort((a, b) => b.area() - a.area());
      pieces.forEach((piece, rank) => {
        const { min, max } = piece.bounds();
        const span = Math.max(max[0] - min[0], max[1] - min[1]) * millimetresPerUnit;
        if (rank > 0 && span <= 0.2) candidates.push({ piece, index, span });
        else piece.delete();
      });
    });
    // Start with the least visible changes and stop as soon as the import fits.
    candidates.sort((a, b) => a.span - b.span);
    for (let n = 0; n < Math.min(candidates.length, 1200); n += 1) {
      const { piece, index } = candidates[n];
      const band = piece.offset(0.001 / millimetresPerUnit, "Miter");
      let neighbour = -1;
      let longestBoundary = 0;
      let joined = null;
      try {
        for (let other = 0; other < regions.length; other += 1) {
          if (other === index) continue;
          const contact = band.intersect(regions[other]);
          const sharedBoundary = contact.area();
          contact.delete();
          if (sharedBoundary > longestBoundary) {
            const union = regions[other].add(piece);
            // A nearby but disconnected island is not a neighbour. A real
            // shared edge joins outlines (or fills a material's hole).
            if (union.numContour() >= regions[other].numContour() + piece.numContour()) {
              union.delete();
              continue;
            }
            joined?.delete();
            joined = union;
            longestBoundary = sharedBoundary;
            neighbour = other;
          }
        }
      } finally { band.delete(); }
      if (neighbour !== -1) {
        const remainder = regions[index].subtract(piece);
        regions[index].delete(); regions[neighbour].delete();
        regions[index] = remainder; regions[neighbour] = joined;
        mergedRegions += 1;
      }
      if ((n + 1) % 16 === 0 || n === candidates.length - 1) {
        if (engravingFits(readGroups(), silhouette)) break;
        await breathe();
      }
    }
    if (!mergedRegions) return unchanged;
    // Return the original silhouette verbatim, including intentional holes.
    // All regions still form its disjoint partition; no contour filtering or
    // independent boundary simplification can open cracks between colours.
    return { colorGroups: readGroups(), contours: silhouette, mergedRegions };
  } finally {
    candidates.forEach(({ piece }) => piece.delete());
    regions.forEach((region) => region.delete());
  }
}
