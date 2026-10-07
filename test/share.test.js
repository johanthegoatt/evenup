const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/engine.js");

const state = {
  title: "Beach trip",
  currency: "PHP",
  people: [{ id: "x1", name: "Ana" }, { id: "x2", name: "Ben" }, { id: "x3", name: "Cris 🌴" }],
  expenses: [
    { id: "a", what: "Cabin", amount: 900000, paidBy: "x1", split: { mode: "shares", shares: { x1: 2, x2: 1, x3: 1 } } },
    { id: "b", what: "Grocery run", amount: 245050, paidBy: "x2", split: { mode: "even", among: ["x1", "x2", "x3"] } },
    { id: "c", what: "Boat", amount: 300000, paidBy: "x3", split: { mode: "exact", exact: { x1: 100000, x2: 200000 } } }
  ],
  paid: { "x2>x1>5000": true }
};

test("a split survives the trip through a share link", () => {
  const back = E.unpack(E.pack(state));
  assert.equal(back.title, "Beach trip");
  assert.equal(back.currency, "PHP");
  assert.deepEqual(back.people.map((p) => p.name), ["Ana", "Ben", "Cris 🌴"]);
  const names = (s) => E.balances(s.people, s.expenses);
  // Same money per person, by position, even though ids are renumbered.
  assert.deepEqual(Object.values(names(back)), Object.values(names(state)));
  assert.deepEqual(back.paid, { "p1>p0>5000": true });
});

test("the link only uses URL-safe characters", () => {
  assert.match(E.pack(state), /^[A-Za-z0-9_-]+$/);
});

const enc = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

test("links that point at people outside the group are refused", () => {
  assert.throws(() => E.unpack(enc({ v: 1, p: ["A"], e: [["x", 100, 3, 0, [0]]] })), /not in the group/);
});

test("bad amounts and broken splits are refused", () => {
  assert.throws(() => E.unpack(enc({ v: 1, p: ["A", "B"], e: [["x", -5, 0, 0, [0, 1]]] })), /amount/);
  assert.throws(() => E.unpack(enc({ v: 1, p: ["A", "B"], e: [["x", 1.5, 0, 0, [0, 1]]] })), /amount/);
  assert.throws(() => E.unpack(enc({ v: 1, p: ["A", "B"], e: [["x", 100, 0, 2, [[0, 10]]]] })), /add up/);
  assert.throws(() => E.unpack(enc({ v: 1, p: ["A", "B"], e: [["x", 100, 0, 0, []]] })), /nobody/);
  assert.throws(() => E.unpack("not-a-link"), /./);
});

test("oversized links are refused and names are trimmed", () => {
  const many = Array.from({ length: 31 }, (_, i) => "P" + i);
  assert.throws(() => E.unpack(enc({ v: 1, p: many, e: [] })), /too big/);
  const back = E.unpack(enc({ v: 1, c: "<b>", p: ["x".repeat(500), "  \u0000 "], e: [] }));
  assert.equal(back.people[0].name.length, E.LIMITS.name);
  assert.equal(back.people[1].name, "Friend 2");
  assert.equal(back.currency, "USD");
});

test("reminder messages say who to pay and how much", () => {
  const money = (c) => E.formatMoney(c, "USD", "en-US");
  const names = { b: "Ben", c: "Cris" };
  assert.equal(
    E.reminder("Ana", [{ to: "b", amount: 1250 }], names, money, "Beach trip"),
    "Hi Ana! Settling up for Beach trip: you owe $12.50 to Ben. Thank you!"
  );
  assert.equal(
    E.reminder("Ana", [{ to: "b", amount: 1250 }, { to: "c", amount: 300 }], names, money, ""),
    "Hi Ana! Settling up, you owe:\n• $12.50 to Ben\n• $3.00 to Cris\nThank you!"
  );
});
