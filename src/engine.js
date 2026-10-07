(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.EvenUp = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // All money is whole cents (minor units) so nothing drifts from float maths.
  // "12.5", "12.50", "1,234.5" and "1 234,50" all read as 1234 / 1250 cents.
  function parseAmount(text) {
    var s = String(text == null ? "" : text).trim().replace(/[^\d.,-]/g, "");
    if (!s || s === "-") return NaN;
    var neg = s.charAt(0) === "-";
    s = s.replace(/-/g, "");
    var lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
    var sep = Math.max(lastDot, lastComma);
    var whole = s, frac = "";
    // A separator followed by 1 or 2 digits is the decimal point; anything
    // else ("1,234" or "1.234.567") is grouping.
    if (sep !== -1 && s.length - sep - 1 <= 2 && s.length - sep - 1 > 0) {
      whole = s.slice(0, sep);
      frac = s.slice(sep + 1);
    }
    whole = whole.replace(/[.,]/g, "");
    if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return NaN;
    var cents = Number(whole || "0") * 100 + Number((frac + "00").slice(0, 2));
    if (!Number.isSafeInteger(cents)) return NaN;
    return neg ? -cents : cents;
  }

  // Split `total` cents into parts proportional to `weights`, using the
  // largest remainder method so the parts always add back up to the total.
  // Leftover cents go to the largest fractional parts; ties are broken
  // starting at `offset`, so the same person does not always pay the extra cent.
  function splitByWeights(total, weights, offset) {
    var n = weights.length;
    var sum = 0;
    for (var i = 0; i < n; i++) {
      if (!(weights[i] >= 0)) throw new Error("weights must be zero or more");
      sum += weights[i];
    }
    if (n === 0 || sum <= 0) throw new Error("nobody to split with");
    var sign = total < 0 ? -1 : 1, abs = Math.abs(total);
    var parts = new Array(n), rems = [], given = 0;
    for (i = 0; i < n; i++) {
      var exact = (abs * weights[i]) / sum;
      parts[i] = Math.floor(exact);
      given += parts[i];
      rems.push({ i: i, r: exact - parts[i], turn: (i - (offset || 0) % n + n) % n });
    }
    rems.sort(function (a, b) { return b.r - a.r || a.turn - b.turn; });
    for (var k = 0; k < abs - given; k++) parts[rems[k].i] += 1;
    return parts.map(function (p) { return p * sign; });
  }

  function splitEven(total, n, offset) {
    var w = [];
    for (var i = 0; i < n; i++) w.push(1);
    return splitByWeights(total, w, offset);
  }

  // What each person owes for one expense, as { personId: cents }.
  //   split.mode "even":   among = [ids]
  //   split.mode "shares": shares = { id: number }   (e.g. 2 for a couple)
  //   split.mode "exact":  exact = { id: cents }     (must add up to the amount)
  function shareOf(expense, index) {
    var split = expense.split || { mode: "even" };
    var out = {};
    if (split.mode === "exact") {
      var total = 0;
      Object.keys(split.exact || {}).forEach(function (id) {
        out[id] = split.exact[id];
        total += split.exact[id];
      });
      if (total !== expense.amount) throw new Error("exact amounts add up to " + total + ", not " + expense.amount);
      return out;
    }
    var ids, weights;
    if (split.mode === "shares") {
      ids = Object.keys(split.shares || {}).filter(function (id) { return split.shares[id] > 0; });
      weights = ids.map(function (id) { return split.shares[id]; });
    } else {
      ids = (split.among || []).slice();
      weights = ids.map(function () { return 1; });
    }
    var parts = splitByWeights(expense.amount, weights, index || 0);
    ids.forEach(function (id, j) { out[id] = parts[j]; });
    return out;
  }

  // Net position per person: positive means the group owes them money back.
  function balances(people, expenses) {
    var bal = {};
    people.forEach(function (p) { bal[p.id] = 0; });
    expenses.forEach(function (e, idx) {
      if (!(e.paidBy in bal)) throw new Error("unknown payer " + e.paidBy);
      bal[e.paidBy] += e.amount;
      var owed = shareOf(e, idx);
      Object.keys(owed).forEach(function (id) {
        if (!(id in bal)) throw new Error("unknown person " + id);
        bal[id] -= owed[id];
      });
    });
    return bal;
  }

  return {
    parseAmount: parseAmount,
    splitByWeights: splitByWeights,
    splitEven: splitEven,
    shareOf: shareOf,
    balances: balances
  };
});
