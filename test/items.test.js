const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/engine.js");

test("splits a bill by the items each person had", () => {
  // Steak 2000 (Ann), salad 1000 (Bea), wine 1500 (both share).
  const r = E.splitByItems([
    { amount: 2000, who: ["ann"] },
    { amount: 1000, who: ["bea"] },
    { amount: 1500, who: ["ann", "bea"] }
  ]);
  assert.equal(r.total, 4500);
  assert.equal(r.exact.ann, 2000 + 750);
  assert.equal(r.exact.bea, 1000 + 750);
  assert.equal(r.exact.ann + r.exact.bea, r.total);
});

test("an odd cent on a shared item doesn't vanish", () => {
  const r = E.splitByItems([{ amount: 1001, who: ["a", "b", "c"] }]);
  assert.equal(r.exact.a + r.exact.b + r.exact.c, 1001);
  // 1001 / 3 = 333.67, so one person carries the extra cent.
  const vals = ["a", "b", "c"].map((id) => r.exact[id]).sort();
  assert.deepEqual(vals, [333, 334, 334]);
});

test("items with nobody or nothing are skipped", () => {
  const r = E.splitByItems([
    { amount: 500, who: [] },
    { amount: 0, who: ["a"] },
    { amount: 800, who: ["a"] }
  ]);
  assert.equal(r.total, 800);
  assert.equal(r.exact.a, 800);
});

test("the item amounts feed an exact split, and a tip rides on top in proportion", () => {
  const items = E.splitByItems([
    { amount: 3000, who: ["ann"] },
    { amount: 1000, who: ["bea"] }
  ]);
  const owed = E.shareOf({
    amount: 4000,
    split: { mode: "exact", exact: items.exact },
    tip: 400
  }, 0);
  // Tip of 400 split 3:1, so Ann pays 3000+300, Bea 1000+100.
  assert.equal(owed.ann, 3300);
  assert.equal(owed.bea, 1100);
  assert.equal(owed.ann + owed.bea, 4400);
});
