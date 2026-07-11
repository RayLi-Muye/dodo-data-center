type Coordinate = [number, number];

export type RenderGeometry =
  | { kind: "point"; point: Coordinate }
  | { kind: "line"; points: Coordinate[] }
  | { kind: "polygon"; points: Coordinate[] };

const isCoordinate = (value: unknown): value is Coordinate =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === "number" &&
  Number.isFinite(value[0]) &&
  typeof value[1] === "number" &&
  Number.isFinite(value[1]);

export function parseGeometry(geometry: Record<string, unknown>): RenderGeometry | null {
  const type = geometry.type;
  const coordinates = geometry.coordinates;
  if (type === "Point" && isCoordinate(coordinates)) {
    return { kind: "point", point: coordinates };
  }
  if (type === "LineString" && Array.isArray(coordinates) && coordinates.every(isCoordinate)) {
    return { kind: "line", points: coordinates };
  }
  if (
    type === "Polygon" &&
    Array.isArray(coordinates) &&
    Array.isArray(coordinates[0]) &&
    coordinates[0].every(isCoordinate)
  ) {
    return { kind: "polygon", points: coordinates[0] };
  }
  return null;
}

export const svgPoints = (points: Coordinate[]): string =>
  points.map(([x, y]) => `${x},${y}`).join(" ");
