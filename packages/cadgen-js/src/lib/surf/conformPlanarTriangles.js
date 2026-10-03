// Earcut can omit collinear trim vertices. Adjacent STEP faces still use those
// vertices, so restore them without moving the planar boundary or its area.
export function conformPlanarTriangles(points, triangles) {
  const coordinates = points.map((p) => [p.x, p.y]);
  const sorted = [0, 1].map((axis) => coordinates.map((_, i) => i)
    .sort((a, b) => coordinates[a][axis] - coordinates[b][axis]));
  const span = coordinates.reduce((s, [x, y]) => Math.max(s, Math.abs(x), Math.abs(y)), 1);
  const epsilon = span * 1e-10;
  const cache = new Map();
  const between = (a, b) => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (!cache.has(key)) {
      const start = Math.min(a, b), end = Math.max(a, b);
      const [x, y] = coordinates[start], [u, v] = coordinates[end];
      const dx = u - x, dy = v - y, length = Math.hypot(dx, dy);
      const axis = Math.abs(dx) >= Math.abs(dy) ? 0 : 1;
      const low = Math.min(coordinates[start][axis], coordinates[end][axis]);
      const high = Math.max(coordinates[start][axis], coordinates[end][axis]);
      const order = sorted[axis];
      let lo = 0, hi = order.length;
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (coordinates[order[mid]][axis] <= low + epsilon) lo = mid + 1;
        else hi = mid;
      }
      const found = [];
      for (let i = lo; i < order.length && coordinates[order[i]][axis] < high - epsilon; i += 1) {
        const id = order[i], [px, py] = coordinates[id];
        if (Math.abs(dx * (py - y) - dy * (px - x)) <= epsilon * length) {
          found.push({ id, t: ((px - x) * dx + (py - y) * dy) / (length * length) });
        }
      }
      found.sort((p, q) => p.t - q.t);
      cache.set(key, found.filter((p, i) => !i || p.t - found[i - 1].t > epsilon / length).map((p) => p.id));
    }
    const ids = cache.get(key);
    return a < b ? ids : [...ids].reverse();
  };
  const result = [];
  for (const triangle of triangles) {
    const pending = [triangle];
    while (pending.length) {
      const [a, b, c] = pending.pop();
      let split = false;
      for (const [p, q, r] of [[a,b,c], [b,c,a], [c,a,b]]) {
        const ids = between(p, q);
        if (!ids.length) continue;
        let previous = p;
        for (const id of ids) { pending.push([previous, id, r]); previous = id; }
        pending.push([previous, q, r]); split = true; break;
      }
      if (!split) result.push([a, b, c]);
    }
  }
  return result;
}
