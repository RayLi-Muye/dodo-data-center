import type { MapGeometry } from "@dodo/contracts";

type Coordinate = [number, number];

export type RenderGeometry =
  | { kind: "point"; point: Coordinate }
  | { kind: "line"; points: Coordinate[] }
  | { kind: "polygon"; rings: Coordinate[][] };

export function parseGeometry(geometry: MapGeometry): RenderGeometry {
  switch (geometry.type) {
    case "Point":
      return { kind: "point", point: geometry.coordinates };
    case "LineString":
      return { kind: "line", points: geometry.coordinates };
    case "Polygon":
      return { kind: "polygon", rings: geometry.coordinates };
  }
}

export const svgPoints = (points: Coordinate[]): string =>
  points.map(([x, y]) => `${x},${y}`).join(" ");

export const svgPolygonPath = (rings: Coordinate[][]): string =>
  rings.map((ring) => `M ${svgPoints(ring)} Z`).join(" ");
