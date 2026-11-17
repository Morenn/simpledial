import test from "node:test";
import assert from "node:assert/strict";
import { findSpatialNeighbor, getRelativeGroupPosition } from "../newtab/keyboard-nav.js";

test("bookmarks column-flow grid jumps directly between columns and steps within a column", () => {
  // 2 columns (360px wide, 40px tall): col 0 has 3 rows (indices 0,1,2), col 1 has 2 rows (indices 3,4)
  const rects = [
    { left: 0, top: 0, width: 360, height: 40 },    // 0: col 0, row 0
    { left: 0, top: 43, width: 360, height: 40 },   // 1: col 0, row 1
    { left: 0, top: 86, width: 360, height: 40 },   // 2: col 0, row 2
    { left: 376, top: 0, width: 360, height: 40 },  // 3: col 1, row 0
    { left: 376, top: 43, width: 360, height: 40 }  // 4: col 1, row 1
  ];

  // ArrowDown / ArrowUp stay in column 0
  assert.equal(findSpatialNeighbor(rects, 0, "ArrowDown", "grid"), 1);
  assert.equal(findSpatialNeighbor(rects, 1, "ArrowDown", "grid"), 2);
  assert.equal(findSpatialNeighbor(rects, 2, "ArrowDown", "grid"), -1);
  assert.equal(findSpatialNeighbor(rects, 2, "ArrowUp", "grid"), 1);

  // ArrowRight jumps from col 0 row 1 -> col 1 row 1 (skipping index 2)
  assert.equal(findSpatialNeighbor(rects, 1, "ArrowRight", "grid"), 4);
  // ArrowRight from col 0 row 2 -> col 1 row 1 (closest vertical match in shorter col 1)
  assert.equal(findSpatialNeighbor(rects, 2, "ArrowRight", "grid"), 4);
  // ArrowLeft jumps back from col 1 row 0 -> col 0 row 0
  assert.equal(findSpatialNeighbor(rects, 3, "ArrowLeft", "grid"), 0);
});

test("wrapped variable-width group tabs jump rows on ArrowUp/ArrowDown and step sequentially on ArrowLeft/ArrowRight", () => {
  // Row 0: tabs 0 (0..90), 1 (100..220), 2 (230..310)
  // Row 1: tabs 3 (0..130), 4 (140..280)
  const rects = [
    { left: 0, top: 0, width: 90, height: 28 },
    { left: 100, top: 0, width: 120, height: 28 },
    { left: 230, top: 0, width: 80, height: 28 },
    { left: 0, top: 36, width: 130, height: 28 },
    { left: 140, top: 36, width: 140, height: 28 }
  ];

  // ArrowRight / ArrowLeft move sequentially across wrapped rows
  assert.equal(findSpatialNeighbor(rects, 2, "ArrowRight", "groups"), 3);
  assert.equal(findSpatialNeighbor(rects, 3, "ArrowLeft", "groups"), 2);
  assert.equal(findSpatialNeighbor(rects, 0, "ArrowLeft", "groups"), -1);
  assert.equal(findSpatialNeighbor(rects, 4, "ArrowRight", "groups"), -1);

  // ArrowDown jumps to the closest horizontal tab in the next row
  assert.equal(findSpatialNeighbor(rects, 0, "ArrowDown", "groups"), 3);
  assert.equal(findSpatialNeighbor(rects, 1, "ArrowDown", "groups"), 4);
  assert.equal(findSpatialNeighbor(rects, 2, "ArrowDown", "groups"), 4);
  assert.equal(findSpatialNeighbor(rects, 4, "ArrowDown", "groups"), -1);

  // ArrowUp jumps back to the closest horizontal tab in the previous row
  assert.equal(findSpatialNeighbor(rects, 3, "ArrowUp", "groups"), 0);
  assert.equal(findSpatialNeighbor(rects, 4, "ArrowUp", "groups"), 1);
  assert.equal(findSpatialNeighbor(rects, 0, "ArrowUp", "groups"), -1);
});

test("getRelativeGroupPosition detects header, footer, left, and right placements", () => {
  const bookmarks = { left: 240, top: 100, right: 1000, bottom: 700, width: 760, height: 600 };
  assert.equal(getRelativeGroupPosition({ left: 240, top: 10, right: 1000, bottom: 60, width: 760, height: 50 }, bookmarks), "above");
  assert.equal(getRelativeGroupPosition({ left: 240, top: 720, right: 1000, bottom: 770, width: 760, height: 50 }, bookmarks), "below");
  assert.equal(getRelativeGroupPosition({ left: 10, top: 100, right: 220, bottom: 700, width: 210, height: 600 }, bookmarks), "left");
  assert.equal(getRelativeGroupPosition({ left: 1020, top: 100, right: 1230, bottom: 700, width: 210, height: 600 }, bookmarks), "right");
});

test("vertical side-space groups use spatial grid mode so ArrowRight/ArrowLeft exit toward bookmarks", () => {
  const verticalTabs = [
    { left: 10, top: 100, width: 180, height: 28 },
    { left: 10, top: 136, width: 180, height: 28 },
    { left: 10, top: 172, width: 180, height: 28 }
  ];
  assert.equal(findSpatialNeighbor(verticalTabs, 0, "ArrowDown", "grid"), 1);
  assert.equal(findSpatialNeighbor(verticalTabs, 1, "ArrowUp", "grid"), 0);
  assert.equal(findSpatialNeighbor(verticalTabs, 0, "ArrowRight", "grid"), -1);
  assert.equal(findSpatialNeighbor(verticalTabs, 1, "ArrowLeft", "grid"), -1);
});
