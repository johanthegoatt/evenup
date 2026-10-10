const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/engine.js");

test("rates are read as exact decimals", () => {
  assert.equal(E.parseRate("1.0835"), "1.0835");
  assert.equal(E.parseRate(" 56,42 "), "56.42");
  assert.equal(E.parseRate("0.0068000"), "0.0068");
  assert.equal(E.parseRate("12."), null);
  assert.equal(E.parseRate("0"), null);
  assert.equal(E.parseRate("-1"), null);
  assert.equal(E.parseRate("1e3"), null);
  assert.equal(E.parseRate("abc"), null);
});

test("convert rounds half up without float drift", () => {
  assert.equal(E.convert(5000, "1.0835"), 5418); // 54.175 -> 54.18
  assert.equal(E.convert(100, "1.005"), 101);    // 1.005 is exact here, not 1.00499
  assert.equal(E.convert(123456789, "56.4231"), Math.round(123456789 * 56.4231));
  assert.equal(E.convert(1e11, "1234.56789"), 123456789000000);
});

const people = [{ id: "a", name: "Ana" }, { id: "b", name: "Ben" }];

test("a cost in another currency counts in the trip currency", () => {
  const amount = E.convert(5000, "1.0835");
  const e = { id: "x", what: "Taxi", amount, paidBy: "a", split: { mode: "even", among: ["a", "b"] }, fx: { code: "EUR", amount: 5000, rate: "1.0835" } };
  const bal = E.balances(people, [e]);
  assert.equal(bal.a + bal.b, 0);
  assert.equal(Math.abs(bal.b), Math.floor(amount / 2) + (amount % 2));
});

test("exact amounts in the foreign currency share out the converted total", () => {
  const e = { id: "x", what: "Dinner", amount: E.convert(9000, "1.1"), paidBy: "a",
    split: { mode: "exact", exact: { a: 3000, b: 6000 } }, fx: { code: "EUR", amount: 9000, rate: "1.1" } };
  const s = E.shareOf(e, 0);
  assert.deepEqual(s, { a: 3300, b: 6600 });
  e.split.exact.b = 5000;
  assert.throws(() => E.shareOf(e, 0), /add up/);
});

test("share links carry the currency, rate and original amount", () => {
  const e = { id: "x", what: "Taxi", amount: E.convert(5000, "1.0835"), paidBy: "a",
    split: { mode: "exact", exact: { a: 2000, b: 3000 } }, fx: { code: "EUR", amount: 5000, rate: "1.0835" } };
  const back = E.unpack(E.pack({ title: "", currency: "USD", people, expenses: [e], paid: {} }));
  assert.deepEqual(back.expenses[0].fx, { code: "EUR", amount: 5000, rate: "1.0835" });
  assert.deepEqual(Object.values(E.balances(back.people, back.expenses)), Object.values(E.balances(people, [e])));
});

test("a link whose converted amount was tampered with is refused", () => {
  const e = { id: "x", what: "Taxi", amount: 9999, paidBy: "a",
    split: { mode: "even", among: ["a", "b"] }, fx: { code: "EUR", amount: 5000, rate: "1.0835" } };
  assert.throws(() => E.unpack(E.pack({ title: "", currency: "USD", people, expenses: [e], paid: {} })), /does not match/);
  const bad = { ...e, amount: E.convert(5000, "1.0835"), fx: { code: "eur", amount: 5000, rate: "1.0835" } };
  assert.throws(() => E.unpack(E.pack({ title: "", currency: "USD", people, expenses: [bad], paid: {} })), /currency/);
});
