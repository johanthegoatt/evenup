(function () {
  "use strict";
  var E = window.EvenUp;
  var P = window.Penny || { say: function () {}, mood: function () {}, react: function () {}, start: function () {} };
  var $ = function (id) { return document.getElementById(id); };
  var KEY = "evenup.state";

  var CURRENCIES = ["PHP", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "INR", "JPY", "KRW", "IDR", "MYR", "THB", "VND", "HKD", "NZD", "MXN", "BRL", "ZAR", "AED", "CHF", "SEK"];

  var state = blank();
  var editing = null; // id of the cost being edited
  var undo = null;
  var nextId = 1;

  function blank() {
    return { title: "", currency: guessCurrency(), people: [], expenses: [], paid: {} };
  }

  function guessCurrency() {
    var region = "";
    try { region = (new Intl.Locale(navigator.language).maximize().region) || ""; } catch (e) {}
    var map = { PH: "PHP", US: "USD", GB: "GBP", CA: "CAD", AU: "AUD", SG: "SGD", IN: "INR", JP: "JPY", KR: "KRW", ID: "IDR", MY: "MYR", TH: "THB", VN: "VND", HK: "HKD", NZ: "NZD", MX: "MXN", BR: "BRL", ZA: "ZAR", AE: "AED", CH: "CHF", SE: "SEK",
      DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", IE: "EUR", PT: "EUR", BE: "EUR", AT: "EUR", FI: "EUR", GR: "EUR" };
    return map[region] || "USD";
  }

  function uid(prefix) {
    var id;
    do { id = prefix + (nextId++).toString(36); } while (state.people.some(function (p) { return p.id === id; }) || state.expenses.some(function (e) { return e.id === id; }));
    return id;
  }

  function save() {
    try { localStorage.setItem(KEY, E.pack(state)); } catch (e) {}
  }

  function loadSaved() {
    var hash = location.hash.replace(/^#/, "");
    if (hash.indexOf("s=") === 0) {
      try {
        state = E.unpack(hash.slice(2));
        history.replaceState(null, "", location.pathname + location.search);
        save();
        return "link";
      } catch (e) {
        history.replaceState(null, "", location.pathname + location.search);
        return "badlink";
      }
    }
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { state = E.unpack(raw); return "saved"; }
    } catch (e) {}
    return "new";
  }

  var money = function (c) { return E.formatMoney(c, state.currency); };
  var nameOf = function (id) {
    var p = state.people.find(function (x) { return x.id === id; });
    return p ? p.name : "?";
  };
  var namesMap = function () {
    var m = {};
    state.people.forEach(function (p) { m[p.id] = p.name; });
    return m;
  };
  var initials = function (name) {
    var parts = name.trim().split(/\s+/);
    var s = Array.from(parts[0] || "?")[0] + (parts[1] ? Array.from(parts[1])[0] : "");
    return s.toUpperCase();
  };

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "text") n.textContent = attrs[k];
      else if (k === "class") n.className = attrs[k];
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k) n.appendChild(typeof k === "string" ? document.createTextNode(k) : k); });
    return n;
  }

  function showError(id, msg, field) {
    var node = $(id);
    node.textContent = msg || "";
    node.hidden = !msg;
    if (field) field.setAttribute("aria-invalid", msg ? "true" : "false");
  }

  // ---------- People ----------

  $("person-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var input = $("person-name");
    var name = input.value.replace(/\s+/g, " ").trim();
    if (!name) return showError("person-error", "Type a name first.", input);
    if (state.people.length >= E.LIMITS.people) return showError("person-error", "That's the most people one split can hold (" + E.LIMITS.people + ").", input);
    if (state.people.some(function (p) { return p.name.toLowerCase() === name.toLowerCase(); })) {
      return showError("person-error", name + " is already in. Add a last name or nickname to tell them apart.", input);
    }
    showError("person-error", "", input);
    var p = { id: uid("p"), name: name.slice(0, E.LIMITS.name) };
    state.people.push(p);
    // Someone new joins the "equally" split of the cost being typed.
    pendingTicks[p.id] = true;
    input.value = "";
    input.focus();
    commit();
    P.react("person", { name: p.name, count: state.people.length });
  });

  $("people").addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-remove-person]");
    if (!btn) return;
    var id = btn.getAttribute("data-remove-person");
    var used = state.expenses.filter(function (e) {
      return e.paidBy === id || Object.prototype.hasOwnProperty.call(E.shareOf(e), id);
    }).length;
    if (used) {
      toast(nameOf(id) + " is in " + used + (used === 1 ? " cost" : " costs") + ". Take them out of those first.");
      P.react("blocked");
      return;
    }
    var idx = state.people.findIndex(function (p) { return p.id === id; });
    var gone = state.people.splice(idx, 1)[0];
    commit();
    toast(gone.name + " removed.", function () { state.people.splice(idx, 0, gone); commit(); });
  });

  // ---------- Cost form ----------

  var pendingTicks = {};

  function mode() {
    return document.querySelector('input[name="mode"]:checked').value;
  }

  var HINTS = {
    even: "Tick who shared it. Everyone pays the same.",
    shares: "Give a bigger number to someone who had more. A couple can be 2, a kid can be 0.5.",
    exact: "Type what each person had. It needs to add up to the total."
  };

  function renderSplitRows(keep) {
    var wrap = $("split-rows");
    var old = keep ? readRows() : {};
    wrap.textContent = "";
    var m = mode();
    $("mode-hint").textContent = HINTS[m];
    state.people.forEach(function (p) {
      var row = el("div", { class: "split-row" });
      if (m === "even") {
        var on = old[p.id] != null ? old[p.id] : pendingTicks[p.id] !== false;
        var box = el("input", { type: "checkbox", "data-person": p.id });
        box.checked = !!on;
        row.appendChild(el("label", { class: "check" }, [box, el("span", { class: "who", text: p.name })]));
        row.appendChild(el("span", { class: "each", "data-each": p.id }));
      } else if (m === "shares") {
        row.appendChild(el("span", { class: "who", text: p.name }));
        var n = el("input", { type: "number", min: "0", max: "100", step: "0.5", inputmode: "decimal", "data-person": p.id, "aria-label": "Shares for " + p.name });
        n.value = old[p.id] != null ? old[p.id] : 1;
        row.appendChild(n);
        row.appendChild(el("span", { class: "each", "data-each": p.id }));
      } else {
        row.appendChild(el("span", { class: "who", text: p.name }));
        var a = el("input", { type: "text", inputmode: "decimal", placeholder: "0.00", "data-person": p.id, "aria-label": "Amount for " + p.name });
        a.value = old[p.id] != null ? old[p.id] : "";
        row.appendChild(a);
      }
      wrap.appendChild(row);
    });
    preview();
  }

  function readRows() {
    var out = {};
    document.querySelectorAll("#split-rows [data-person]").forEach(function (inp) {
      out[inp.getAttribute("data-person")] = inp.type === "checkbox" ? inp.checked : inp.value;
    });
    return out;
  }

  // Build the split from the form. Returns { split } or { error }.
  function readSplit(amount) {
    var m = mode(), rows = readRows();
    var ids = Object.keys(rows);
    if (m === "even") {
      var among = ids.filter(function (id) { return rows[id]; });
      if (!among.length) return { error: "Tick at least one person who shared it." };
      return { split: { mode: "even", among: among } };
    }
    if (m === "shares") {
      var shares = {}, any = false;
      for (var i = 0; i < ids.length; i++) {
        var w = Number(rows[ids[i]]);
        if (rows[ids[i]] === "" || !(w >= 0 && w <= 100)) return { error: "Shares are numbers from 0 to 100." };
        if (w > 0) { shares[ids[i]] = w; any = true; }
      }
      if (!any) return { error: "Give at least one person a share above 0." };
      return { split: { mode: "shares", shares: shares } };
    }
    var exact = {}, sum = 0;
    for (var j = 0; j < ids.length; j++) {
      var raw = String(rows[ids[j]]).trim();
      if (!raw) continue;
      var c = E.parseAmount(raw);
      if (!(c >= 0)) return { error: "Check the amount for " + nameOf(ids[j]) + "." };
      if (c > 0) { exact[ids[j]] = c; sum += c; }
    }
    if (!Object.keys(exact).length) return { error: "Type an amount for at least one person." };
    if (amount >= 0 && sum !== amount) {
      return { error: "These add up to " + money(sum) + ", but the cost is " + money(amount) + "." };
    }
    return { split: { mode: "exact", exact: exact } };
  }

  // Live "each pays" numbers and the exact-amount counter.
  function preview() {
    var amount = E.parseAmount($("amount").value);
    var m = mode();
    document.querySelectorAll("#split-rows [data-each]").forEach(function (n) { n.textContent = ""; });
    var left = $("exact-left");
    left.hidden = m !== "exact";
    if (m === "exact") {
      var sum = 0;
      document.querySelectorAll("#split-rows [data-person]").forEach(function (inp) {
        var c = E.parseAmount(inp.value);
        if (c > 0) sum += c;
      });
      if (!(amount > 0)) { left.textContent = "Typed so far: " + money(sum); left.className = "left"; return; }
      var diff = amount - sum;
      left.textContent = diff === 0 ? "Adds up. ✓" : diff > 0 ? money(diff) + " left to share out" : money(-diff) + " too much";
      left.className = "left " + (diff === 0 ? "ok" : "off");
      return;
    }
    if (!(amount > 0)) return;
    var r = readSplit(amount);
    if (!r.split) return;
    try {
      var owed = E.shareOf({ amount: amount, split: r.split }, state.expenses.length);
      Object.keys(owed).forEach(function (id) {
        var n = document.querySelector('#split-rows [data-each="' + id + '"]');
        if (n) n.textContent = money(owed[id]);
      });
    } catch (e) {}
  }

  document.querySelectorAll('input[name="mode"]').forEach(function (r) {
    r.addEventListener("change", function () { renderSplitRows(false); showError("split-error", ""); P.react("mode", { mode: mode() }); });
  });
  $("amount").addEventListener("input", preview);
  $("split-rows").addEventListener("input", preview);
  $("split-rows").addEventListener("change", preview);

  $("cost-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var amountInput = $("amount");
    var amount = E.parseAmount(amountInput.value);
    var bad = false;
    if (!(amount > 0)) { showError("amount-error", "Type how much it cost, like 1250 or 12.50.", amountInput); bad = true; }
    else if (amount > E.LIMITS.amount) { showError("amount-error", "That's more than EvenUp can handle in one cost.", amountInput); bad = true; }
    else showError("amount-error", "", amountInput);
    var r = readSplit(bad ? -1 : amount);
    showError("split-error", r.error || "");
    if (bad || r.error) {
      (bad ? amountInput : $("split-rows").querySelector("input") || amountInput).focus();
      P.react("oops");
      return;
    }
    if (!editing && state.expenses.length >= E.LIMITS.expenses) {
      showError("split-error", "That's the most costs one split can hold. Start a new split for the next trip.");
      return;
    }
    var what = $("what").value.replace(/\s+/g, " ").trim().slice(0, E.LIMITS.what) || "Cost " + (state.expenses.length + 1);
    var cost = { id: editing || uid("e"), what: what, amount: amount, paidBy: $("paid-by").value, split: r.split };
    if (editing) {
      var i = state.expenses.findIndex(function (e) { return e.id === editing; });
      state.expenses[i] = cost;
    } else {
      state.expenses.push(cost);
    }
    var wasEdit = !!editing;
    resetCostForm();
    commit();
    P.react(wasEdit ? "edited" : "cost", { what: cost.what, amount: money(cost.amount), payer: nameOf(cost.paidBy) });
    $("what").focus();
  });

  function resetCostForm() {
    editing = null;
    $("what").value = "";
    $("amount").value = "";
    $("cost-heading").textContent = "Add a cost";
    $("cost-submit").textContent = "Add cost";
    $("cost-cancel").hidden = true;
    document.querySelector('input[name="mode"][value="even"]').checked = true;
    pendingTicks = {};
    showError("amount-error", "", $("amount"));
    showError("split-error", "");
    renderSplitRows(false);
  }

  $("cost-cancel").addEventListener("click", function () { resetCostForm(); render(); });

  function startEdit(id) {
    var e = state.expenses.find(function (x) { return x.id === id; });
    if (!e) return;
    editing = id;
    $("what").value = e.what;
    $("amount").value = (e.amount / 100).toFixed(2);
    $("paid-by").value = e.paidBy;
    document.querySelector('input[name="mode"][value="' + e.split.mode + '"]').checked = true;
    renderSplitRows(false);
    document.querySelectorAll("#split-rows [data-person]").forEach(function (inp) {
      var pid = inp.getAttribute("data-person");
      if (e.split.mode === "even") inp.checked = e.split.among.indexOf(pid) !== -1;
      else if (e.split.mode === "shares") inp.value = e.split.shares[pid] || 0;
      else inp.value = e.split.exact[pid] ? (e.split.exact[pid] / 100).toFixed(2) : "";
    });
    preview();
    $("cost-heading").textContent = "Change a cost";
    $("cost-submit").textContent = "Save changes";
    $("cost-cancel").hidden = false;
    render();
    $("what").focus();
    $("cost-form").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  $("costs").addEventListener("click", function (ev) {
    var ed = ev.target.closest("[data-edit]");
    if (ed) return startEdit(ed.getAttribute("data-edit"));
    var del = ev.target.closest("[data-delete]");
    if (!del) return;
    var id = del.getAttribute("data-delete");
    var idx = state.expenses.findIndex(function (e) { return e.id === id; });
    var gone = state.expenses.splice(idx, 1)[0];
    if (editing === id) resetCostForm();
    commit();
    toast("Removed " + gone.what + ".", function () { state.expenses.splice(idx, 0, gone); commit(); });
    P.react("deleted", { what: gone.what });
  });

  // ---------- Title and currency ----------

  $("title").addEventListener("input", function () { state.title = this.value.slice(0, E.LIMITS.title); save(); });
  $("currency").addEventListener("change", function () { state.currency = this.value; commit(); });

  // ---------- Results ----------

  var lastResult = { payments: [] };

  $("payments").addEventListener("change", function (ev) {
    var box = ev.target.closest("[data-paid]");
    if (!box) return;
    var key = box.getAttribute("data-paid");
    if (box.checked) state.paid[key] = true; else delete state.paid[key];
    commit();
    var left = lastResult.payments.filter(function (p) { return !state.paid[E.paymentKey(p)]; }).length;
    if (box.checked) P.react(left ? "paid" : "allpaid", { left: left });
  });

  $("payments").addEventListener("click", function (ev) {
    var btn = ev.target.closest("[data-copy]");
    if (!btn) return;
    var who = btn.getAttribute("data-copy");
    var owes = lastResult.payments.filter(function (p) { return p.from === who && !state.paid[E.paymentKey(p)]; });
    if (!owes.length) owes = lastResult.payments.filter(function (p) { return p.from === who; });
    copy(E.reminder(nameOf(who), owes, namesMap(), money, state.title), "Message for " + nameOf(who) + " copied.");
  });

  $("copy-all").addEventListener("click", function () {
    var lines = [(state.title || "Our split") + ", settled with EvenUp:"];
    lastResult.payments.forEach(function (p) {
      lines.push((state.paid[E.paymentKey(p)] ? "✓ " : "• ") + nameOf(p.from) + " pays " + nameOf(p.to) + " " + money(p.amount));
    });
    copy(lines.join("\n"), "Copied. Paste it in your group chat.");
  });

  $("share").addEventListener("click", function () {
    var url = location.origin + location.pathname + "#s=" + E.pack(state);
    copy(url, "Share link copied. Anyone with it sees this split.");
  });

  $("reset").addEventListener("click", function () {
    if (!state.people.length && !state.expenses.length) return;
    if (!confirm("Start over? This clears every person and cost on this device.")) return;
    state = blank();
    resetCostForm();
    commit();
    P.react("reset");
  });

  $("load-example").addEventListener("click", function () {
    if ((state.people.length || state.expenses.length) && !confirm("Swap what you have for the example? Your split will be cleared.")) return;
    state = example();
    resetCostForm();
    commit();
    P.react("example");
    $("s-result").scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  function example() {
    var cur = state.currency;
    var k = cur === "PHP" ? 50 : cur === "JPY" ? 150 : cur === "KRW" ? 1300 : cur === "IDR" ? 15000 : cur === "VND" ? 25000 : cur === "INR" ? 80 : 1;
    var people = ["Ana", "Ben", "Cris", "Dina", "Eli", "Faye", "Gio"].map(function (n, i) { return { id: "p" + i, name: n }; });
    var all = people.map(function (p) { return p.id; });
    var c = function (n) { return Math.round(n * k) * 100; };
    return {
      title: "Beach weekend",
      currency: cur,
      people: people,
      expenses: [
        { id: "e0", what: "Beach house", amount: c(420), paidBy: "p0", split: { mode: "even", among: all } },
        { id: "e1", what: "Groceries", amount: c(126), paidBy: "p1", split: { mode: "even", among: all } },
        { id: "e2", what: "Gas", amount: c(48), paidBy: "p2", split: { mode: "even", among: ["p2", "p3", "p4"] } },
        { id: "e3", what: "Boat tour", amount: c(150), paidBy: "p3", split: { mode: "shares", shares: { p0: 1, p1: 1, p3: 2, p5: 1, p6: 1 } } },
        { id: "e4", what: "Dinner", amount: c(84), paidBy: "p6", split: { mode: "exact", exact: { p4: c(24), p5: c(30), p6: c(30) } } }
      ],
      paid: {}
    };
  }

  // ---------- Render ----------

  function commit() {
    save();
    render();
  }

  function render() {
    // Header fields
    if (document.activeElement !== $("title")) $("title").value = state.title;
    var cur = $("currency");
    if (!cur.options.length || cur.getAttribute("data-for") !== state.currency) {
      cur.textContent = "";
      var list = CURRENCIES.indexOf(state.currency) === -1 ? [state.currency].concat(CURRENCIES) : CURRENCIES;
      list.forEach(function (code) { cur.appendChild(el("option", { value: code, text: code })); });
      cur.value = state.currency;
      cur.setAttribute("data-for", state.currency);
    }

    // People
    var ul = $("people");
    ul.textContent = "";
    state.people.forEach(function (p) {
      ul.appendChild(el("li", { class: "chip" }, [
        el("span", { class: "face", "aria-hidden": "true", text: initials(p.name) }),
        el("span", { class: "nm", text: p.name }),
        el("button", { type: "button", class: "icon-btn del", "data-remove-person": p.id, "aria-label": "Remove " + p.name, text: "×" })
      ]));
    });
    $("people-empty").hidden = state.people.length > 0;

    // Cost form
    var ready = state.people.length >= 2;
    $("cost-fields").disabled = !ready;
    $("cost-locked").hidden = ready;
    var payer = $("paid-by"), was = payer.value;
    payer.textContent = "";
    state.people.forEach(function (p) { payer.appendChild(el("option", { value: p.id, text: p.name })); });
    if (state.people.some(function (p) { return p.id === was; })) payer.value = was;
    var rowIds = Object.keys(readRows()).join();
    if (rowIds !== state.people.map(function (p) { return p.id; }).join()) renderSplitRows(true);

    // Costs
    var costs = $("costs");
    costs.textContent = "";
    var total = 0;
    state.expenses.forEach(function (e) {
      total += e.amount;
      costs.appendChild(el("li", { class: "cost" + (editing === e.id ? " editing" : "") }, [
        el("div", { class: "body" }, [
          el("div", { class: "what", text: e.what }),
          el("div", { class: "meta", text: nameOf(e.paidBy) + " paid · " + splitLabel(e) })
        ]),
        el("span", { class: "amt", text: money(e.amount) }),
        el("button", { type: "button", class: "icon-btn", "data-edit": e.id, "aria-label": "Change " + e.what, text: "✎" }),
        el("button", { type: "button", class: "icon-btn del", "data-delete": e.id, "aria-label": "Remove " + e.what, text: "×" })
      ]));
    });
    $("costs-empty").hidden = state.expenses.length > 0;
    $("cost-count").textContent = state.expenses.length ? "(" + state.expenses.length + ")" : "";
    $("total").hidden = !state.expenses.length;
    $("total").textContent = "Total: " + money(total);

    renderResult();
    P.mood(moodFor());
  }

  function splitLabel(e) {
    var s = e.split;
    if (s.mode === "even") return s.among.length === state.people.length ? "split by everyone" : "split by " + s.among.map(nameOf).join(", ");
    if (s.mode === "shares") return "split by shares";
    return "exact amounts";
  }

  function renderResult() {
    var list = $("payments");
    list.textContent = "";
    var has = state.expenses.length > 0;
    $("payments-empty").hidden = has;
    $("result-actions").hidden = !has;
    $("people-sum-card").hidden = !has;
    $("saving").hidden = true;
    $("all-done").hidden = true;
    if (!has) { lastResult = { payments: [] }; return; }

    var bal = E.balances(state.people, state.expenses);
    var r = E.settle(bal);
    // Keep each person's payments together, so their message covers them all.
    r.payments.sort(function (a, b) { return nameOf(a.from).localeCompare(nameOf(b.from)) || b.amount - a.amount; });
    lastResult = r;
    // Drop ticks for payments that no longer exist.
    var live = {};
    r.payments.forEach(function (p) { live[E.paymentKey(p)] = true; });
    Object.keys(state.paid).forEach(function (k) { if (!live[k]) delete state.paid[k]; });

    if (!r.payments.length) {
      $("all-done").hidden = false;
      $("all-done").textContent = "Everyone is already even. Nobody pays anybody.";
    } else {
      var direct = E.directPayments(state.expenses);
      var s = $("saving");
      s.hidden = false;
      var n = r.payments.length;
      var lead = n === 1 ? "1 payment settles everything" : n + " payments settle everything";
      s.textContent = direct > n ? lead + ", instead of " + direct + " if everyone paid back each person directly." : lead + ".";
      if (!r.exact) s.textContent += " (Big group: this is close to the fewest, not always the fewest.)";
    }

    var firstFor = {};
    r.payments.forEach(function (p) {
      var key = E.paymentKey(p), done = !!state.paid[key];
      var box = el("input", { type: "checkbox", "data-paid": key });
      box.checked = done;
      var actions = el("div", { class: "actions" });
      if (!firstFor[p.from]) {
        firstFor[p.from] = true;
        actions.appendChild(el("button", { type: "button", class: "btn small", "data-copy": p.from, text: "Copy message for " + nameOf(p.from) }));
      }
      list.appendChild(el("li", { class: "pay" + (done ? " paid" : "") }, [
        el("span", { class: "arrow", "aria-hidden": "true", text: "→" }),
        el("span", { class: "line" }, [el("b", { text: nameOf(p.from) }), " pays ", el("b", { text: nameOf(p.to) }), " ", el("span", { class: "money", text: money(p.amount) })]),
        el("label", { class: "tick" }, [box, "Paid"]),
        actions.childNodes.length ? actions : null
      ]));
    });
    var allPaid = r.payments.length && r.payments.every(function (p) { return state.paid[E.paymentKey(p)]; });
    if (allPaid) {
      $("all-done").hidden = false;
      $("all-done").textContent = "All paid. Everyone is even!";
    }

    // Balances
    var ul = $("balances");
    ul.textContent = "";
    var max = 1;
    state.people.forEach(function (p) { max = Math.max(max, Math.abs(bal[p.id])); });
    state.people.forEach(function (p) {
      var v = bal[p.id];
      var bar = el("span", { class: "bar", "aria-hidden": "true" });
      if (v) {
        var fill = el("i", { class: v > 0 ? "up" : "down" });
        fill.style.width = (Math.abs(v) / max) * 50 + "%";
        bar.appendChild(fill);
      }
      ul.appendChild(el("li", { class: "bal" }, [
        el("span", { class: "nm", text: p.name }),
        bar,
        el("span", { class: "v " + (v > 0 ? "up" : v < 0 ? "down" : ""), text: v > 0 ? "gets back " + money(v) : v < 0 ? "owes " + money(-v) : "even" })
      ]));
    });
  }

  function moodFor() {
    if (!state.people.length) return "sleepy";
    if (!state.expenses.length) return "curious";
    var pays = lastResult.payments;
    if (!pays.length || pays.every(function (p) { return state.paid[E.paymentKey(p)]; })) return "party";
    return "happy";
  }

  // ---------- Toast and clipboard ----------

  var toastTimer = null;
  function toast(text, onUndo) {
    var t = $("toast");
    $("toast-text").textContent = text;
    undo = onUndo || null;
    $("toast-undo").hidden = !onUndo;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; undo = null; }, onUndo ? 6000 : 3500);
  }
  $("toast-undo").addEventListener("click", function () {
    if (undo) undo();
    undo = null;
    $("toast").hidden = true;
    P.react("undo");
  });

  function copy(text, done) {
    var ok = function () { toast(done); P.react("copied"); };
    var fallback = function () {
      var ta = el("textarea", { readonly: true, "aria-hidden": "true" });
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      var good = false;
      try { good = document.execCommand("copy"); } catch (e) {}
      ta.remove();
      if (good) ok(); else toast("Couldn't copy here. Long-press to copy instead.");
    };
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(text).then(ok, fallback);
    else fallback();
  }

  // ---------- Start ----------

  var how = loadSaved();
  resetCostForm();
  render();
  P.start(how, { people: state.people.length, costs: state.expenses.length });
  window.__evenup = { state: function () { return state; }, result: function () { return lastResult; } };
})();
