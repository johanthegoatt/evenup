"use strict";
var test = require("node:test");
var assert = require("node:assert");
var E = require("../src/engine.js");

function sum(obj) { return Object.keys(obj).reduce(function (s, k) { return s + obj[k]; }, 0); }

test("tipFromPercent rounds half up and ignores nonsense", function () {
  assert.strictEqual(E.tipFromPercent(5000, 15), 750);   // 15% of 50.00
  assert.strictEqual(E.tipFromPercent(5000, 12.5), 625);
  assert.strictEqual(E.tipFromPercent(1001, 10), 100);   // 100.1 -> 100
  assert.strictEqual(E.tipFromPercent(1005, 10), 101);   // 100.5 -> 101 (half up)
  assert.strictEqual(E.tipFromPercent(5000, 0), 0);
  assert.strictEqual(E.tipFromPercent(0, 15), 0);
  assert.strictEqual(E.tipFromPercent(5000, "bad"), 0);
});

test("grossAmount is amount plus tip", function () {
  assert.strictEqual(E.grossAmount({ amount: 5000, tip: 750 }), 5750);
  assert.strictEqual(E.grossAmount({ amount: 5000 }), 5000);
  assert.strictEqual(E.grossAmount({ amount: 5000, tip: -5 }), 5000); // junk ignored
});

test("an even split carries the tip and the parts add up to the gross", function () {
  var e = { amount: 3000, tip: 600, paidBy: "a", split: { mode: "even", among: ["a", "b", "c"] } };
  var share = E.shareOf(e, 0);
  assert.strictEqual(sum(share), 3600);           // 30.00 + 6.00
  assert.strictEqual(share.a + share.b + share.c, 3600);
  // Each should be close to 12.00 (10 + 2 tip).
  Object.keys(share).forEach(function (id) { assert.ok(share[id] === 1200); });
});

test("tip follows shares, so the bigger eater pays more service", function () {
  // a has 3 shares, b has 1. Bill 40.00, tip 10.00 -> gross 50.00.
  var e = { amount: 4000, tip: 1000, paidBy: "a", split: { mode: "shares", shares: { a: 3, b: 1 } } };
  var share = E.shareOf(e, 0);
  assert.strictEqual(sum(share), 5000);
  assert.strictEqual(share.a, 3750); // 3/4 of 50.00
  assert.strictEqual(share.b, 1250); // 1/4 of 50.00
});

test("tip on an exact split spreads in proportion to the exact parts", function () {
  // a owes 10.00, b owes 30.00; 20% tip = 8.00 shared 1:3.
  var e = { amount: 4000, tip: 800, paidBy: "a", split: { mode: "exact", exact: { a: 1000, b: 3000 } } };
  var share = E.shareOf(e, 0);
  assert.strictEqual(sum(share), 4800);
  assert.strictEqual(share.a, 1200); // 10.00 + 2.00
  assert.strictEqual(share.b, 3600); // 30.00 + 6.00
});

test("balances still net to zero with a tip", function () {
  var people = [{ id: "a" }, { id: "b" }, { id: "c" }];
  var expenses = [{ amount: 3000, tip: 555, paidBy: "a", split: { mode: "even", among: ["a", "b", "c"] } }];
  var bal = E.balances(people, expenses);
  assert.strictEqual(bal.a + bal.b + bal.c, 0);
  // a paid 35.55, owes a third of it back.
  assert.ok(bal.a > 0 && bal.b < 0 && bal.c < 0);
});

test("a tip survives a share link round-trip, alongside currency", function () {
  var state = {
    title: "Dinner", currency: "GBP",
    people: [{ id: "p0", name: "Ana" }, { id: "p1", name: "Ben" }],
    expenses: [
      { id: "e0", what: "Meal", amount: 4000, paidBy: "p0", tip: 500, split: { mode: "even", among: ["p0", "p1"] } },
      { id: "e1", what: "Taxi abroad", amount: 2000, paidBy: "p1", tip: 300,
        fx: { code: "EUR", amount: 2300, rate: "0.8696" }, split: { mode: "even", among: ["p0", "p1"] } }
    ],
    paid: {}
  };
  // keep the fx amount consistent with convert()
  state.expenses[1].amount = E.convert(2300, "0.8696");
  var back = E.unpack(E.pack(state));
  assert.strictEqual(back.expenses[0].tip, 500);
  assert.strictEqual(back.expenses[1].tip, 300);
  assert.strictEqual(back.expenses[1].fx.code, "EUR");
});

test("old links with no tip still read", function () {
  var state = {
    title: "T", currency: "USD",
    people: [{ id: "p0", name: "A" }, { id: "p1", name: "B" }],
    expenses: [{ id: "e0", what: "X", amount: 1000, paidBy: "p0", split: { mode: "even", among: ["p0", "p1"] } }],
    paid: {}
  };
  var back = E.unpack(E.pack(state));
  assert.strictEqual(E.tipOf(back.expenses[0]), 0);
});
