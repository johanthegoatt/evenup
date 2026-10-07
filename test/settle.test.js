const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/engine.js");

const bal = (vals) => Object.fromEntries(vals.map((c, i) => ["p" + i, c]));

// Apply payments and check everyone ends at exactly zero.
function squares(b, payments) {
  const left = { ...b };
  for (const p of payments) {
    assert.ok(p.amount > 0);
    left[p.from] += p.amount;
    left[p.to] -= p.amount;
  }
  return Object.values(left).every((c) => c === 0);
}

// Brute force: the most zero-sum groups the non-zero people split into.
function maxGroups(vals) {
  const xs = vals.filter((v) => v !== 0);
  let best = 0;
  (function go(i, sums) {
    if (i === xs.length) {
      if (sums.every((s) => s === 0)) best = Math.max(best, sums.length);
      return;
    }
    for (let g = 0; g < sums.length; g++) { sums[g] += xs[i]; go(i + 1, sums); sums[g] -= xs[i]; }
    sums.push(xs[i]); go(i + 1, sums); sums.pop();
  })(0, []);
  return { n: xs.length, best };
}

let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

test("fewest payments matches a brute-force search on 400 random groups", () => {
  for (let t = 0; t < 400; t++) {
    const n = 2 + Math.floor(rnd() * 6);
    const vals = [];
    for (let i = 0; i < n - 1; i++) vals.push(Math.round(rnd() * 16 - 8) * 250);
    vals.push(-vals.reduce((a, b) => a + b, 0));
    const b = bal(vals);
    const { payments, exact } = E.settle(b);
    assert.ok(exact);
    assert.ok(squares(b, payments), JSON.stringify(vals));
    const { n: live, best } = maxGroups(vals);
    assert.equal(payments.length, live - best, JSON.stringify(vals));
  }
});

test("seven friends: biggest-pays-biggest needs 6 payments, the exact search finds 4", () => {
  const b = bal([500, 700, 400, 400, -500, -700, -800]);
  const greedy = E.settleGreedy(Object.entries(b).map(([id, cents]) => ({ id, cents })));
  const { payments } = E.settle(b);
  assert.equal(greedy.length, 6);
  assert.equal(payments.length, 4);
  assert.ok(squares(b, payments));
});

test("already square means no payments", () => {
  assert.deepEqual(E.settle({ a: 0, b: 0 }).payments, []);
});

test("balances that do not add to zero are refused", () => {
  assert.throws(() => E.settle({ a: 100, b: -99 }), /add up/);
});

test("big groups fall back to one greedy pass that still squares everyone", () => {
  const vals = [];
  for (let i = 0; i < 29; i++) vals.push(Math.round(rnd() * 400 - 200) * 37);
  vals.push(-vals.reduce((a, b) => a + b, 0));
  const b = bal(vals);
  const { payments, exact } = E.settle(b);
  assert.equal(exact, false);
  assert.ok(squares(b, payments));
  assert.ok(payments.length <= vals.filter((v) => v).length - 1);
});

test("a full 16-person group still solves exactly, and fast", () => {
  const vals = [];
  for (let i = 0; i < 15; i++) vals.push(Math.round(rnd() * 20 - 10) * 100);
  vals.push(-vals.reduce((a, b) => a + b, 0));
  const t0 = Date.now();
  const { payments, exact } = E.settle(bal(vals));
  assert.ok(exact);
  assert.ok(squares(bal(vals), payments));
  assert.ok(Date.now() - t0 < 1500, `${Date.now() - t0} ms`);
});

test("direct paybacks: a dinner of 4 paid by 2 people", () => {
  const all = ["a", "b", "c", "d"];
  const expenses = [
    { amount: 8000, paidBy: "a", split: { mode: "even", among: all } },
    { amount: 4000, paidBy: "b", split: { mode: "even", among: all } }
  ];
  // c and d each pay a and b; a and b net out to one payment between them.
  assert.equal(E.directPayments(expenses), 5);
  assert.equal(E.settle(E.balances(all.map((id) => ({ id })), expenses)).payments.length, 3);
});
