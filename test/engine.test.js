const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/engine.js");

const sum = (xs) => xs.reduce((a, b) => a + b, 0);

test("amounts read as whole cents in both decimal styles", () => {
  assert.equal(E.parseAmount("12"), 1200);
  assert.equal(E.parseAmount("12.5"), 1250);
  assert.equal(E.parseAmount("12.05"), 1205);
  assert.equal(E.parseAmount("1,234.50"), 123450);
  assert.equal(E.parseAmount("1.234,50"), 123450);
  assert.equal(E.parseAmount("1,234"), 123400);
  assert.equal(E.parseAmount("$ 8.99"), 899);
  assert.equal(E.parseAmount("₱1 500"), 150000);
  assert.ok(Number.isNaN(E.parseAmount("")));
  assert.ok(Number.isNaN(E.parseAmount("abc")));
});

test("an even split always adds back up to the total", () => {
  for (let total = 0; total < 2000; total += 7) {
    for (let n = 1; n <= 9; n++) {
      const parts = E.splitEven(total, n, total);
      assert.equal(sum(parts), total);
      assert.ok(Math.max(...parts) - Math.min(...parts) <= 1);
    }
  }
});

test("100.00 three ways is 33.34 / 33.33 / 33.33, and the extra cent moves around", () => {
  assert.deepEqual(E.splitEven(10000, 3, 0), [3334, 3333, 3333]);
  assert.deepEqual(E.splitEven(10000, 3, 1), [3333, 3334, 3333]);
  assert.deepEqual(E.splitEven(10000, 3, 2), [3333, 3333, 3334]);
});

test("shares split in proportion, still to the cent", () => {
  // A couple (2 shares) and a single (1 share) on a 100.00 room.
  assert.deepEqual(E.splitByWeights(10000, [2, 1], 0), [6667, 3333]);
  const parts = E.splitByWeights(99999, [3, 1, 1, 2], 0);
  assert.equal(sum(parts), 99999);
});

test("balances net out to zero across the group", () => {
  const people = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const expenses = [
    { amount: 9000, paidBy: "a", split: { mode: "even", among: ["a", "b", "c"] } },
    { amount: 1000, paidBy: "b", split: { mode: "shares", shares: { b: 1, c: 1 } } },
    { amount: 2500, paidBy: "c", split: { mode: "exact", exact: { a: 1000, c: 1500 } } }
  ];
  const bal = E.balances(people, expenses);
  assert.deepEqual(bal, { a: 9000 - 3000 - 1000, b: 1000 - 3000 - 500, c: 2500 - 3000 - 500 - 1500 });
  assert.equal(sum(Object.values(bal)), 0);
});

test("exact splits that do not add up are refused", () => {
  assert.throws(() => E.shareOf({ amount: 1000, split: { mode: "exact", exact: { a: 400, b: 500 } } }), /add up/);
});
