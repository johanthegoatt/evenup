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

  // A tip or service charge on a cost, held as whole cents on top of the
  // amount. It is shared in the same proportion as the cost itself, which is
  // the fair way: someone whose main is twice as dear pays twice the service.
  function tipOf(expense) {
    var t = expense && expense.tip;
    return Number.isSafeInteger(t) && t > 0 ? t : 0;
  }

  // Amount plus tip: what the payer actually handed over.
  function grossAmount(expense) {
    return expense.amount + tipOf(expense);
  }

  // Spread the tip across the people who already share a cost, weighted by how
  // much each one owes, so the parts still add back up to the exact tip.
  function addTip(out, expense, index) {
    var tip = tipOf(expense);
    if (!tip) return out;
    var ids = Object.keys(out);
    if (!ids.length) return out;
    var weights = ids.map(function (id) { return Math.abs(out[id]); });
    if (weights.reduce(function (a, b) { return a + b; }, 0) <= 0) {
      weights = ids.map(function () { return 1; });
    }
    var parts = splitByWeights(tip, weights, index || 0);
    ids.forEach(function (id, j) { out[id] += parts[j]; });
    return out;
  }

  // What each person owes for one expense, as { personId: cents }.
  //   split.mode "even":   among = [ids]
  //   split.mode "shares": shares = { id: number }   (e.g. 2 for a couple)
  //   split.mode "exact":  exact = { id: cents }     (must add up to the amount)
  // Any tip on the cost is added on top, in the same proportions.
  function shareOf(expense, index) {
    var split = expense.split || { mode: "even" };
    var out = {};
    if (split.mode === "exact") {
      var total = 0, exIds = Object.keys(split.exact || {});
      exIds.forEach(function (id) {
        out[id] = split.exact[id];
        total += split.exact[id];
      });
      // A cost paid in another currency keeps its exact amounts in that
      // currency; they set each person's part of the converted total.
      var want = expense.fx ? expense.fx.amount : expense.amount;
      if (total !== want) throw new Error("exact amounts add up to " + total + ", not " + want);
      if (expense.fx) {
        var conv = splitByWeights(expense.amount, exIds.map(function (id) { return split.exact[id]; }), index || 0);
        exIds.forEach(function (id, j) { out[id] = conv[j]; });
      }
      return addTip(out, expense, index);
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
    return addTip(out, expense, index);
  }

  // Split one bill by the items each person actually had. The restaurant case:
  // you had the steak, I had the salad, we shared the wine. Each item is an
  // amount and a list of who had it, and the item is split equally between
  // them (largest remainder, so an odd cent on a shared item doesn't vanish).
  // Returns { exact: { id: cents }, total } summing to the sum of the items.
  // Feed `exact` into an "exact" split and any tip or service charge is shared
  // on top in the same proportions, so the person with the steak carries more
  // of it. This is the fair way to split a shared bill and the thing people
  // get wrong by hand, usually by splitting the whole thing evenly.
  function splitByItems(items, offset) {
    var exact = {}, total = 0;
    (items || []).forEach(function (it, idx) {
      var amt = it && it.amount | 0;
      var who = (it && it.who || []).filter(function (id) { return id != null; });
      if (amt <= 0 || !who.length) return;
      var parts = splitByWeights(amt, who.map(function () { return 1; }), (offset || 0) + idx);
      who.forEach(function (id, j) { exact[id] = (exact[id] || 0) + parts[j]; });
      total += amt;
    });
    return { exact: exact, total: total };
  }

  // Net position per person: positive means the group owes them money back.
  function balances(people, expenses) {
    var bal = {};
    people.forEach(function (p) { bal[p.id] = 0; });
    expenses.forEach(function (e, idx) {
      if (!(e.paidBy in bal)) throw new Error("unknown payer " + e.paidBy);
      bal[e.paidBy] += grossAmount(e);
      var owed = shareOf(e, idx);
      Object.keys(owed).forEach(function (id) {
        if (!(id in bal)) throw new Error("unknown person " + id);
        bal[id] -= owed[id];
      });
    });
    return bal;
  }

  // Within a group whose balances add to zero, the biggest debtor pays the
  // biggest creditor until everyone is square. Each payment clears at least
  // one person, so k people need at most k - 1 payments.
  function settleGreedy(entries) {
    var givers = [], takers = [], out = [];
    entries.forEach(function (e) {
      if (e.cents < 0) givers.push({ id: e.id, left: -e.cents });
      else if (e.cents > 0) takers.push({ id: e.id, left: e.cents });
    });
    var big = function (a, b) { return b.left - a.left || (a.id < b.id ? -1 : 1); };
    while (givers.length && takers.length) {
      givers.sort(big);
      takers.sort(big);
      var g = givers[0], t = takers[0];
      var amt = Math.min(g.left, t.left);
      out.push({ from: g.id, to: t.id, amount: amt });
      g.left -= amt;
      t.left -= amt;
      if (!g.left) givers.shift();
      if (!t.left) takers.shift();
    }
    return out;
  }

  // Fewest payments that square everyone up. Finding it is NP-hard
  // (Verhoeff, "Settling Multiple Debts Efficiently", 2004), but the answer
  // is n - g, where g is the most groups the n non-zero people can be split
  // into such that each group adds to zero on its own. For a dinner-sized
  // group a DP over subsets finds g exactly:
  //   best[mask] = max over i in mask of best[mask - i], plus 1 if mask sums to 0.
  // Past EXACT_LIMIT people it falls back to one greedy pass (at most n - 1).
  var EXACT_LIMIT = 16;

  function settle(bal) {
    var entries = Object.keys(bal)
      .filter(function (id) { return bal[id] !== 0; })
      .map(function (id) { return { id: id, cents: bal[id] }; });
    var total = entries.reduce(function (s, e) { return s + e.cents; }, 0);
    if (total !== 0) throw new Error("balances add up to " + total + ", not 0");
    var n = entries.length;
    if (n === 0) return { payments: [], exact: true };
    if (n > EXACT_LIMIT) return { payments: settleGreedy(entries), exact: false };

    var size = 1 << n;
    var sums = new Float64Array(size), best = new Int8Array(size), from = new Int8Array(size);
    for (var mask = 1; mask < size; mask++) {
      var low = mask & -mask, i = 31 - Math.clz32(low);
      sums[mask] = sums[mask ^ low] + entries[i].cents;
      var top = -1, pick = -1;
      for (var j = 0; j < n; j++) {
        if (!(mask & (1 << j))) continue;
        var v = best[mask ^ (1 << j)];
        if (v > top) { top = v; pick = j; }
      }
      best[mask] = top + (sums[mask] === 0 ? 1 : 0);
      from[mask] = pick;
    }

    // Walk back from everyone: each time the running set sums to zero, the
    // people removed since the last zero form one self-contained group.
    var groups = [], current = [];
    mask = size - 1;
    while (mask) {
      if (sums[mask] === 0 && current.length) { groups.push(current); current = []; }
      var p = from[mask];
      current.push(entries[p]);
      mask ^= 1 << p;
    }
    if (current.length) groups.push(current);

    var payments = [];
    groups.forEach(function (g) { payments = payments.concat(settleGreedy(g)); });
    return { payments: payments, exact: true };
  }

  // How many payments people would make if everyone paid back each payer
  // directly, after netting out pairs who owe each other.
  function directPayments(expenses) {
    var owe = {};
    expenses.forEach(function (e, idx) {
      var share = shareOf(e, idx);
      Object.keys(share).forEach(function (id) {
        if (id === e.paidBy || !share[id]) return;
        var a = id < e.paidBy ? id : e.paidBy, b = id < e.paidBy ? e.paidBy : id;
        var key = a + "\u0000" + b;
        owe[key] = (owe[key] || 0) + (id === a ? share[id] : -share[id]);
      });
    });
    return Object.keys(owe).filter(function (k) { return owe[k] !== 0; }).length;
  }

  // Exchange rates are read as exact decimals ("1.0835", "56,42") and kept
  // as the typed string, so a share link round-trips the same number.
  function parseRate(text) {
    var s = String(text == null ? "" : text).trim().replace(",", ".");
    if (!/^\d{1,7}(\.\d{1,8})?$/.test(s)) return null;
    s = s.replace(/^0+(?=\d)/, "").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    if (!/[1-9]/.test(s)) return null;
    return s;
  }

  // Foreign cents times the rate, rounded half up, in exact integer maths.
  function convert(cents, rate) {
    var r = parseRate(rate);
    if (r == null) throw new Error("bad rate");
    var dot = r.indexOf("."), decimals = dot === -1 ? 0 : r.length - dot - 1;
    var num = BigInt(r.replace(".", "")), den = BigInt(Math.pow(10, decimals));
    var out = (BigInt(cents) * num * 2n + den) / (2n * den);
    return Number(out);
  }

  function formatMoney(cents, currency, locale) {
    try {
      return new Intl.NumberFormat(locale || undefined, { style: "currency", currency: currency || "USD" }).format(cents / 100);
    } catch (e) {
      return (cents / 100).toFixed(2);
    }
  }

  // A share link carries the whole split in the URL fragment, which browsers
  // never send to a server. Everything read back is checked, because a link
  // can come from anyone.
  var LIMITS = { people: 30, expenses: 300, name: 40, what: 60, title: 60, pay: 80, amount: 1e11 };

  function cleanText(s, max) {
    return String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  }

  function pack(state) {
    var index = {};
    state.people.forEach(function (p, i) { index[p.id] = i; });
    var data = {
      v: 1,
      t: state.title || "",
      c: state.currency || "USD",
      p: state.people.map(function (p) { return p.name; }),
      h: state.people.some(function (p) { return p.pay; }) ? state.people.map(function (p) { return p.pay || ""; }) : undefined,
      e: state.expenses.map(function (e) {
        var s = e.split || { mode: "even" }, extra;
        if (s.mode === "shares") extra = Object.keys(s.shares).map(function (id) { return [index[id], s.shares[id]]; });
        else if (s.mode === "exact") extra = Object.keys(s.exact).map(function (id) { return [index[id], s.exact[id]]; });
        else extra = (s.among || []).map(function (id) { return index[id]; });
        var row = [e.what, e.amount, index[e.paidBy], s.mode === "shares" ? 1 : s.mode === "exact" ? 2 : 0, extra];
        if (e.fx) row.push([e.fx.code, e.fx.amount, e.fx.rate]);
        if (tipOf(e)) row.push(e.tip); // a trailing number is the tip; fx is an array
        return row;
      }),
      d: Object.keys(state.paid || {}).filter(function (k) { return state.paid[k]; }).map(function (k) {
        var bits = k.split(">");
        return index[bits[0]] + ">" + index[bits[1]] + ">" + bits[2];
      }).filter(function (k) { return !/undefined/.test(k); })
    };
    return toBase64Url(JSON.stringify(data));
  }

  function unpack(str) {
    var data = JSON.parse(fromBase64Url(String(str)));
    if (!data || data.v !== 1 || !Array.isArray(data.p) || !Array.isArray(data.e)) throw new Error("not an EvenUp link");
    if (data.p.length > LIMITS.people || data.e.length > LIMITS.expenses) throw new Error("link is too big");
    var people = data.p.map(function (name, i) {
      var person = { id: "p" + i, name: cleanText(name, LIMITS.name) || "Friend " + (i + 1) };
      var pay = Array.isArray(data.h) ? cleanText(data.h[i], LIMITS.pay) : "";
      if (pay) person.pay = pay;
      return person;
    });
    var who = function (i) {
      if (!(Number.isInteger(i) && i >= 0 && i < people.length)) throw new Error("link names someone who is not in the group");
      return people[i].id;
    };
    var money = function (c) {
      if (!(Number.isSafeInteger(c) && c >= 0 && c <= LIMITS.amount)) throw new Error("bad amount in link");
      return c;
    };
    var expenses = data.e.map(function (row, i) {
      if (!Array.isArray(row) || row.length < 5 || row.length > 7 || !Array.isArray(row[4])) throw new Error("bad cost in link");
      var mode = row[3], split;
      if (mode === 1) {
        split = { mode: "shares", shares: {} };
        row[4].forEach(function (pair) {
          var w = Number(pair[1]);
          if (!(w > 0 && w <= 100)) throw new Error("bad share in link");
          split.shares[who(pair[0])] = w;
        });
      } else if (mode === 2) {
        split = { mode: "exact", exact: {} };
        row[4].forEach(function (pair) { split.exact[who(pair[0])] = money(pair[1]); });
      } else if (mode === 0) {
        split = { mode: "even", among: row[4].map(who) };
      } else throw new Error("bad split in link");
      var e = { id: "e" + i, what: cleanText(row[0], LIMITS.what) || "Cost " + (i + 1), amount: money(row[1]), paidBy: who(row[2]), split: split };
      // Trailing slots after the split: an array is the foreign-currency info,
      // a number is the tip. Either, both or neither may be there.
      for (var t = 5; t < row.length; t++) {
        if (Array.isArray(row[t])) {
          var fx = row[t];
          if (!/^[A-Z]{3}$/.test(fx[0]) || parseRate(fx[2]) == null) throw new Error("bad currency in link");
          e.fx = { code: fx[0], amount: money(fx[1]), rate: parseRate(fx[2]) };
          if (convert(e.fx.amount, e.fx.rate) !== e.amount) throw new Error("converted amount in link does not match");
        } else if (typeof row[t] === "number") {
          e.tip = money(row[t]);
        } else throw new Error("bad cost in link");
      }
      shareOf(e, i); // throws if the split cannot work
      return e;
    });
    var paid = {};
    (Array.isArray(data.d) ? data.d : []).slice(0, 200).forEach(function (k) {
      var m = typeof k === "string" && /^(\d+)>(\d+)>(\d+)$/.exec(k);
      if (m && +m[1] < people.length && +m[2] < people.length) paid["p" + m[1] + ">p" + m[2] + ">" + m[3]] = true;
    });
    var currency = /^[A-Z]{3}$/.test(data.c) ? data.c : "USD";
    return { title: cleanText(data.t, LIMITS.title), currency: currency, people: people, expenses: expenses, paid: paid };
  }

  function toBase64Url(text) {
    var bytes = new TextEncoder().encode(text), bin = "";
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function fromBase64Url(s) {
    var bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  // A payment's key stays the same while the numbers stay the same, so a
  // "paid" tick drops off by itself if a later cost changes who owes what.
  function paymentKey(p) {
    return p.from + ">" + p.to + ">" + p.amount;
  }

  // How to pay someone, from what they typed as their handle. PayPal.me,
  // Monzo.me, Cash App and Venmo can all carry the amount, so the link opens
  // ready to send; anything else (an IBAN, revolut.me/x) is shown as written.
  // A link only prefills an amount in the currency that service settles in
  // (Monzo pounds, Cash App and Venmo US dollars), so a euro split falls back
  // to the plain profile link rather than sending the wrong number.
  function payLink(handle, cents, currency, note) {
    var h = cleanText(handle, LIMITS.pay);
    if (!h) return "";
    var amount = cents > 0 ? (cents / 100).toFixed(2) : "";
    var m;
    // PayPal.me / Monzo.me: amount in the path.
    if ((m = h.match(/^(?:https?:\/\/)?(?:www\.)?(paypal\.me|monzo\.me)\/([A-Za-z0-9._-]+)\/?$/i))) {
      if (!amount) return h;
      if (/^paypal/i.test(m[1])) return "https://paypal.me/" + m[2] + "/" + amount + (currency || "");
      return currency && currency !== "GBP" ? "https://monzo.me/" + m[2] : "https://monzo.me/" + m[2] + "/" + amount;
    }
    // Cash App: cash.app/$cashtag/amount, in US dollars.
    if ((m = h.match(/^(?:(?:https?:\/\/)?(?:www\.)?cash\.app\/)?\$([A-Za-z][A-Za-z0-9_]{0,19})$/i))) {
      var usd = amount && (!currency || currency === "USD");
      return "https://cash.app/$" + m[1] + (usd ? "/" + amount : "");
    }
    // Venmo: venmo.com/u/name?txn=pay&amount=..., also in US dollars. The
    // handle can be "@name", "venmo.com/name" or the full profile link.
    if ((m = h.match(/^(?:(?:https?:\/\/)?(?:www\.)?venmo\.com\/(?:u\/)?|@)([A-Za-z0-9_-]{1,30})$/i))) {
      var url = "https://venmo.com/" + m[1] + "?txn=pay";
      if (amount && (!currency || currency === "USD")) url += "&amount=" + amount;
      var text = cleanText(note, 60);
      if (text) url += "&note=" + encodeURIComponent(text);
      return url;
    }
    return h;
  }

  // The message nobody likes writing. Short, friendly, with the numbers.
  // `pays` maps person id to their payment handle, `currency` the ISO code.
  function reminder(name, owes, names, money, title, pays, currency) {
    var how = function (p) {
      var link = payLink(pays && pays[p.to], p.amount, currency, title);
      return link ? " (" + link + ")" : "";
    };
    var lines = owes.map(function (p) { return "• " + money(p.amount) + " to " + names[p.to] + how(p); });
    var where = title ? " for " + title : "";
    if (lines.length === 1) {
      return "Hi " + name + "! Settling up" + where + ": you owe " + money(owes[0].amount) + " to " + names[owes[0].to] + how(owes[0]) + ". Thank you!";
    }
    return "Hi " + name + "! Settling up" + where + ", you owe:\n" + lines.join("\n") + "\nThank you!";
  }

  // Tip in whole cents for a percent of an amount, rounded half up. Handles
  // "12.5" as readily as "15", and never goes below zero.
  function tipFromPercent(amount, percent) {
    var p = typeof percent === "number" ? percent : parseFloat(String(percent).replace(",", "."));
    if (!(p > 0) || !(amount > 0)) return 0;
    return Math.round((amount * p) / 100);
  }

  return {
    parseAmount: parseAmount,
    parseRate: parseRate,
    convert: convert,
    tipOf: tipOf,
    grossAmount: grossAmount,
    tipFromPercent: tipFromPercent,
    formatMoney: formatMoney,
    pack: pack,
    unpack: unpack,
    paymentKey: paymentKey,
    reminder: reminder,
    payLink: payLink,
    LIMITS: LIMITS,
    settle: settle,
    settle: settle,
    settleGreedy: settleGreedy,
    directPayments: directPayments,
    EXACT_LIMIT: EXACT_LIMIT,
    splitByWeights: splitByWeights,
    splitEven: splitEven,
    shareOf: shareOf,
    splitByItems: splitByItems,
    balances: balances
  };
});
