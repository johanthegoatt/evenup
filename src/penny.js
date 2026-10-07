// Penny, the coin who helps you split. She watches your pointer, blinks,
// hops when tapped, gives a tip that fits where you are, reacts to what you
// do, and throws coins when everyone has paid. Everything she says is also
// announced to screen readers through the bubble's live region.
(function () {
  "use strict";
  var btn = document.getElementById("penny");
  var bubble = document.getElementById("penny-bubble");
  var dock = document.getElementById("penny-dock");
  var hide = document.getElementById("penny-hide");
  if (!btn) return;

  var still = matchMedia("(prefers-reduced-motion: reduce)");
  var baseMood = "sleepy";
  var flashing = false, flashTimer = null, bubbleTimer = null, tapTimes = [], tipIndex = {};
  var context = { people: 0, costs: 0 };

  var TIPS = {
    sleepy: [
      "Hi, I'm Penny! Add the people first. Don't forget yourself.",
      "Tap \"See an example\" to watch me split a beach trip.",
      "No sign up. Everything stays on this phone."
    ],
    curious: [
      "Now add a cost. What did someone pay for?",
      "Someone had more? Use \"By shares\" and give them a 2.",
      "Paid for just a few people? Untick the ones who weren't there."
    ],
    happy: [
      "Tap \"Copy message\" and I'll write the \"you owe me\" text for you.",
      "Tick \"Paid\" when the money comes in.",
      "Send the share link to the group so everyone sees the same thing.",
      "Fewer payments means fewer fees and fewer reminders."
    ],
    party: [
      "Everyone's even. Go enjoy your next trip!",
      "All square. I love a happy ending.",
      "Want to start a new one? \"Start over\" is at the bottom."
    ]
  };

  function setMood(m) {
    btn.setAttribute("data-mood", m);
  }

  function say(text, ms) {
    if (dock.classList.contains("tucked")) return;
    bubble.textContent = text;
    bubble.classList.remove("pop");
    void bubble.offsetWidth; // restart the pop animation
    bubble.classList.add("pop");
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(function () { bubble.textContent = ""; }, ms || 7000);
  }

  // A short face change that falls back to the real mood.
  function flash(m, ms) {
    setMood(m);
    flashing = true;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { flashing = false; setMood(baseMood); }, ms || 1400);
  }

  function play(cls) {
    if (still.matches) return;
    btn.classList.remove("hop", "spin");
    void btn.offsetWidth;
    btn.classList.add(cls);
  }
  btn.addEventListener("animationend", function () { btn.classList.remove("hop", "spin"); });

  function mood(m) {
    var was = baseMood;
    baseMood = m === "curious" ? "happy" : m;
    tipKey = m;
    if (!flashing) setMood(baseMood);
    if (m === "party" && was !== "party" && context.costs) coins();
  }
  var tipKey = "sleepy";

  function nextTip() {
    var list = TIPS[tipKey] || TIPS.happy;
    var i = tipIndex[tipKey] || 0;
    tipIndex[tipKey] = (i + 1) % list.length;
    return list[i];
  }

  // Tap: hop and a tip. Five quick taps: a coin flip.
  btn.addEventListener("click", function () {
    if (dock.classList.contains("tucked")) {
      dock.classList.remove("tucked");
      remember(false);
      say("I'm back! Tap me any time for a tip.");
      play("hop");
      return;
    }
    var now = Date.now();
    tapTimes = tapTimes.filter(function (t) { return now - t < 1600; });
    tapTimes.push(now);
    if (tapTimes.length >= 5) {
      tapTimes = [];
      play("spin");
      flash("wow", 1200);
      say("Wheee! Heads or tails? (It's always heads. I'm all face.)");
      return;
    }
    play("hop");
    if (baseMood === "sleepy") flash("happy", 1600);
    say(nextTip());
  });

  hide.addEventListener("click", function () {
    dock.classList.add("tucked");
    bubble.textContent = "";
    remember(true);
  });

  function remember(tucked) {
    try { localStorage.setItem("evenup.pennyTucked", tucked ? "1" : ""); } catch (e) {}
  }

  // Eyes follow the pointer, a few pixels at most.
  var pupils = btn.querySelectorAll(".p-pupil");
  var target = null, frame = 0;
  function look() {
    frame = 0;
    if (!target) return;
    var r = btn.getBoundingClientRect();
    var cx = r.left + r.width / 2, cy = r.top + r.height * 0.45;
    var dx = target.x - cx, dy = target.y - cy;
    var d = Math.hypot(dx, dy) || 1;
    var reach = Math.min(1, d / 220);
    var x = (dx / d) * 3 * reach, y = (dy / d) * 3.5 * reach;
    pupils.forEach(function (p) { p.style.transform = "translate(" + x.toFixed(2) + "px," + y.toFixed(2) + "px)"; });
  }
  window.addEventListener("pointermove", function (ev) {
    target = { x: ev.clientX, y: ev.clientY };
    if (!frame) frame = requestAnimationFrame(look);
  }, { passive: true });
  // On a phone there is no hover, so she looks at whatever you tap or type in.
  document.addEventListener("focusin", function (ev) {
    var r = ev.target.getBoundingClientRect && ev.target.getBoundingClientRect();
    if (!r || ev.target === btn) return;
    target = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    if (!frame) frame = requestAnimationFrame(look);
  });

  // Blink every few seconds, unless asleep.
  (function blink() {
    setTimeout(function () {
      if (baseMood !== "sleepy" && !document.hidden) {
        btn.classList.add("blink");
        setTimeout(function () { btn.classList.remove("blink"); }, 140);
      }
      blink();
    }, 2600 + Math.random() * 3800);
  })();

  // Coins rain from Penny when everyone is even.
  function coins() {
    if (still.matches) return;
    var r = btn.getBoundingClientRect();
    for (var i = 0; i < 18; i++) {
      var c = document.createElement("span");
      c.className = "confetti";
      c.style.left = r.left + r.width / 2 + "px";
      c.style.top = r.top + r.height / 3 + "px";
      document.body.appendChild(c);
      var ang = -Math.PI / 2 + (Math.random() - 0.5) * 2.2, sp = 160 + Math.random() * 200;
      var dx = Math.cos(ang) * sp, dy = Math.sin(ang) * sp;
      var a = c.animate([
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: "translate(" + dx + "px," + dy + "px) scale(1)", opacity: 1, offset: 0.45 },
        { transform: "translate(" + dx * 1.3 + "px," + (dy + 420) + "px) scale(0.6)", opacity: 0 }
      ], { duration: 1300 + Math.random() * 500, easing: "cubic-bezier(.2,.6,.4,1)" });
      a.onfinish = (function (n) { return function () { n.remove(); }; })(c);
    }
  }

  // What she says when you do things. Short and plain.
  function react(what, d) {
    d = d || {};
    switch (what) {
      case "person":
        play("hop");
        if (d.count === 1) say("Hi " + d.name + "! Who else is in?");
        else if (d.count === 2) say("Hi " + d.name + "! Two people. Now you can add costs.");
        else say("Hi " + d.name + "! That's " + d.count + " people.");
        break;
      case "cost":
        play("hop");
        flash("wow", 900);
        say("Got it: " + d.what + ", " + d.amount + ", paid by " + d.payer + ".");
        break;
      case "edited": say("Saved. I redid the maths."); break;
      case "deleted": flash("worried", 1200); say("Poof, " + d.what + " is gone. Changed your mind? Tap Undo."); break;
      case "undo": play("hop"); say("And it's back!"); break;
      case "mode":
        say(d.mode === "shares" ? "Shares are handy when someone had more. 2 means double." :
          d.mode === "exact" ? "Type what each person had. I'll tell you when it adds up." :
          "Everyone ticked pays the same. I'll handle the odd cent.");
        break;
      case "oops": flash("worried", 1600); say("Hmm, one thing to fix. Look for the red note."); break;
      case "blocked": flash("worried", 1600); break;
      case "copied": play("hop"); flash("wow", 900); say("Copied! Paste it in your chat. No awkward texts needed."); break;
      case "paid": play("hop"); say(d.left === 1 ? "Nice! Just one payment left." : "Nice! " + d.left + " payments left."); break;
      case "allpaid": say("Everyone paid! You're all even. 🎉", 9000); break;
      case "example": play("hop"); say("Here's a beach trip with 7 friends. Look how few payments it takes!"); break;
      case "reset": flash("sleepy", 1200); say("Fresh start. Who's in?"); break;
    }
  }

  function start(how, info) {
    context = info || context;
    try { if (localStorage.getItem("evenup.pennyTucked")) dock.classList.add("tucked"); } catch (e) {}
    setTimeout(function () {
      if (how === "link") say("You opened a shared split. Everything is here, on your phone now.");
      else if (how === "badlink") { flash("worried", 2000); say("That link looks broken, so I couldn't open it. Ask for a new one?"); }
      else if (how === "saved" && info.costs) say("Welcome back! I kept your split right where you left it.");
      else if (!info.people) say("Hi, I'm Penny! I'll help you split costs. Tap me for tips.");
    }, 600);
  }

  window.Penny = {
    say: say,
    mood: function (m) { context.costs = document.querySelectorAll("#costs li").length; mood(m); },
    react: react,
    start: start
  };
})();
