import { describe, expect, it } from "vitest";

import { parseGeometry, svgPoints } from "../lib/geometry";

describe("map geometry", () => {
  it("parses GeoJSON point and line shapes", () => {
    expect(parseGeometry({ type: "Point", coordinates: [75, 25] })).toEqual({ kind: "point", point: [75, 25] });
    expect(parseGeometry({ type: "LineString", coordinates: [[0, 0], [100, 100]] })).toEqual({
      kind: "line",
      points: [[0, 0], [100, 100]],
    });
  });

  it("rejects unknown or non-finite geometry", () => {
    expect(parseGeometry({ type: "Point", coordinates: [Number.NaN, 1] })).toBeNull();
    expect(parseGeometry({ type: "Circle", coordinates: [1, 2] })).toBeNull();
  });

  it("serializes points for an SVG polyline", () => {
    expect(svgPoints([[0, 0], [5.5, 9]])).toBe("0,0 5.5,9");
  });
});
