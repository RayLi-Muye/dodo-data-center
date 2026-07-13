import { describe, expect, it } from "vitest";

import { parseGeometry, svgPoints, svgPolygonPath } from "../lib/geometry";

describe("map geometry", () => {
  it("parses GeoJSON point and line shapes", () => {
    expect(parseGeometry({ type: "Point", coordinates: [75, 25] })).toEqual({ kind: "point", point: [75, 25] });
    expect(parseGeometry({ type: "LineString", coordinates: [[0, 0], [100, 100]] })).toEqual({
      kind: "line",
      points: [[0, 0], [100, 100]],
    });
  });

  it("preserves every ring from strict polygon geometry", () => {
    expect(parseGeometry({
      type: "Polygon",
      coordinates: [
        [[0, 0], [10, 0], [10, 10], [0, 0]],
        [[2, 2], [3, 2], [3, 3], [2, 2]],
      ],
    })).toEqual({
      kind: "polygon",
      rings: [
        [[0, 0], [10, 0], [10, 10], [0, 0]],
        [[2, 2], [3, 2], [3, 3], [2, 2]],
      ],
    });
  });

  it("serializes points for an SVG polyline", () => {
    expect(svgPoints([[0, 0], [5.5, 9]])).toBe("0,0 5.5,9");
    expect(svgPolygonPath([[[0, 0], [5, 0], [0, 0]]])).toBe("M 0,0 5,0 0,0 Z");
  });
});
