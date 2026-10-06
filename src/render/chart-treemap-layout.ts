/**
 * Squarified treemap layout (Bruls, Huizing and van Wijk).
 *
 * Cells are placed in input order: rows grow along the shorter side of the
 * remaining rectangle while that keeps the worst aspect ratio from getting
 * worse. Plain arithmetic in a fixed order, so the same values always give the
 * same rectangles; callers round before emitting.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The worst aspect ratio of a row of areas laid along a side of length `side`. */
function worst(row: readonly number[], side: number): number {
  const sum = row.reduce((total, area) => total + area, 0);
  if (sum === 0 || side === 0) return Number.POSITIVE_INFINITY;
  const largest = Math.max(...row);
  const smallest = Math.min(...row);
  const sideSquared = side * side;
  const sumSquared = sum * sum;
  return Math.max((sideSquared * largest) / sumSquared, sumSquared / (sideSquared * smallest));
}

/** Rectangles for positive values, one per value, in input order. Non-positive values get an empty rect. */
export function squarify(values: readonly number[], bounds: Rect): Rect[] {
  const out: Rect[] = values.map(() => ({ x: bounds.x, y: bounds.y, width: 0, height: 0 }));
  const indexes = values.map((_, index) => index).filter((index) => (values[index] ?? 0) > 0);
  const total = indexes.reduce((sum, index) => sum + (values[index] ?? 0), 0);
  if (total <= 0) return out;
  const scale = (bounds.width * bounds.height) / total;
  const free: Rect = { ...bounds };
  let row: number[] = [];

  const placeRow = (members: readonly number[]) => {
    const areas = members.map((index) => (values[index] ?? 0) * scale);
    const sum = areas.reduce((acc, area) => acc + area, 0);
    if (free.width >= free.height) {
      // A column on the left of the free space.
      const width = free.height === 0 ? 0 : sum / free.height;
      let y = free.y;
      members.forEach((index, position) => {
        const height = width === 0 ? 0 : (areas[position] ?? 0) / width;
        out[index] = { x: free.x, y, width, height };
        y += height;
      });
      free.x += width;
      free.width -= width;
    } else {
      // A row along the top of the free space.
      const height = free.width === 0 ? 0 : sum / free.width;
      let x = free.x;
      members.forEach((index, position) => {
        const width = height === 0 ? 0 : (areas[position] ?? 0) / height;
        out[index] = { x, y: free.y, width, height };
        x += width;
      });
      free.y += height;
      free.height -= height;
    }
  };

  for (const index of indexes) {
    const side = Math.min(free.width, free.height);
    const area = (values[index] ?? 0) * scale;
    const current = row.map((member) => (values[member] ?? 0) * scale);
    if (row.length === 0 || worst([...current, area], side) <= worst(current, side)) {
      row.push(index);
    } else {
      placeRow(row);
      row = [index];
    }
  }
  if (row.length > 0) placeRow(row);
  return out;
}
