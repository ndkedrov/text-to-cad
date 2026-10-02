// Boolean operations may produce touching rings and near-zero spikes. Resolve
// them before rounding/serializing, using a tolerance in drawing coordinates.
function polygons(section, tolerance = 0.01) {
  const clean = section.simplify(tolerance);
  try {
    return clean.toPolygons().map((ring) => ring.map(([x, y]) => [x, y]));
  } finally { clean.delete(); }
}

// Resolve SVG paint order into disjoint, printable regions. Later paint covers
// earlier paint; equal source colours share one editable material.
export function composeColorGroups(wasm, layers) {
  const { CrossSection } = wasm;
  const regions = new Map();
  try {
    for (const layer of layers) {
      if (!layer.contours.length) continue;
      const area = new CrossSection(layer.contours, "Positive");
      try {
        for (const [key, previous] of regions) {
          const next = previous.area.subtract(area);
          previous.area.delete();
          regions.set(key, { ...previous, area: next });
        }
        const key = layer.id || layer.color;
        const previous = regions.get(key);
        const next = previous ? previous.area.add(area) : new CrossSection(layer.contours, "Positive");
        previous?.area.delete();
        regions.set(key, { ...layer, area: next });
      } finally {
        area.delete();
      }
    }
    return [...regions.values()].map(({ area, ...layer }, index) => ({
      id: layer.id || `color-${index + 1}`,
      sourceColor: layer.sourceColor || layer.color,
      color: layer.color,
      contours: polygons(area)
    })).filter((layer) => layer.contours.length);
  } finally {
    for (const { area } of regions.values()) area.delete();
  }
}

export function unionColorContours(wasm, groups) {
  const contours = groups.flatMap((group) => group.contours);
  if (!contours.length) return [];
  const area = new wasm.CrossSection(contours, "Positive");
  try {
    return polygons(area);
  } finally {
    area.delete();
  }
}
