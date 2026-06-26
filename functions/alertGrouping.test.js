// ABOUTME: Tests for groupByPriority — scored earthquakes bucket into
// ABOUTME: descending priority order so the most urgent alert leads.

const {test} = require("node:test");
const assert = require("node:assert/strict");

const {groupByPriority} = require("./alertGrouping");

test("groupByPriority returns empty for no earthquakes", () => {
  assert.deepEqual(groupByPriority([]), []);
});

test("groupByPriority orders buckets from highest priority to lowest", () => {
  const quakes = [
    {id: "a", alertPriority: 0},
    {id: "b", alertPriority: 2},
    {id: "c", alertPriority: 1},
  ];
  const groups = groupByPriority(quakes);
  assert.deepEqual(groups.map((g) => g.priority), [2, 1, 0]);
});

test("groupByPriority groups multiple quakes of the same priority", () => {
  const quakes = [
    {id: "a", alertPriority: 2},
    {id: "b", alertPriority: 2},
    {id: "c", alertPriority: 1},
  ];
  const groups = groupByPriority(quakes);
  assert.equal(groups[0].priority, 2);
  assert.equal(groups[0].earthquakes.length, 2);
  assert.equal(groups[1].priority, 1);
  assert.equal(groups[1].earthquakes.length, 1);
});

test("groupByPriority omits priorities with no members", () => {
  const quakes = [{id: "a", alertPriority: 2}];
  const groups = groupByPriority(quakes);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].priority, 2);
});

test("groupByPriority leads with the most urgent bucket", () => {
  // Regression for the priority-loop overwrite: a P2 and a P0 both present,
  // the P2 bucket must lead so the highest-priority message is returned.
  const quakes = [
    {id: "minor", alertPriority: 0},
    {id: "major", alertPriority: 2},
  ];
  const groups = groupByPriority(quakes);
  assert.equal(groups[0].priority, 2);
  assert.equal(groups[0].earthquakes[0].id, "major");
});
