/* PROVE IT — app. Hash router, views, reader, check-ins, receipts, board, admin.
   Data comes only through PIStore (js/store.js). Clocks only through PI (js/core.js). */
(function () {
  'use strict';
  var PI = window.PI, PS = window.PIStore;
  // Production backend everywhere EXCEPT localhost, where the dev adapter
  // and its seeded test accounts run (see RUNBOOK "Run it locally").
  var isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var store = (!isLocal && window.PROVE_IT_CONFIG && window.PROVE_IT_CONFIG.supabaseUrl && PS.SupabaseStore)
    ? new PS.SupabaseStore(window.PROVE_IT_CONFIG)
    : new PS.Store(new PS.LocalAdapter());
  var BOOKS = { starter: null, mirror: null };

  var PERMISSION_LINE = 'Your proof, your call. Posting in this thread is for this room \u2014 it counts, and it\u2019s seen here. Nothing you post here gets carried anywhere else \u2014 not the Pages, not the profile, not a film \u2014 unless you say yes to that, separately, in so many words. Finishing earns exactly what the clause says either way. Being featured is always a separate yes, and no is always a complete sentence here.';
  var ASK_RODA = 'Not sure it\u2019s for you? Ask RODA \u2014 rideordieamerica.com/proving-season.html#ask-roda \u2014 real answer, usually the same day.';

  /* ---------- session + prefs ---------- */
  function restoreSession() {
    try {
      var id = localStorage.getItem('proveit_session');
      if (id && store.userById(id)) store.sessionUserId = id;
    } catch (e) {}
  }
  function persistSession() {
    try {
      if (store.sessionUserId) localStorage.setItem('proveit_session', store.sessionUserId);
      else localStorage.removeItem('proveit_session');
    } catch (e) {}
  }
  function me() { return store.session(); }
  // Store actions are sync on the dev adapter, Promises on the production
  // (Supabase) adapter. settle() keeps dev behavior byte-identical (the
  // callback runs in the same tick) and awaits the promise in production.
  function settle(val, fn) {
    if (val && typeof val.then === 'function') val.then(fn);
    else fn(val);
  }
  function pref(key, fallback) {
    try { var v = localStorage.getItem('proveit_pref_' + key); return v === null ? fallback : JSON.parse(v); }
    catch (e) { return fallback; }
  }
  function setPref(key, v) { try { localStorage.setItem('proveit_pref_' + key, JSON.stringify(v)); } catch (e) {} }

  /* ---------- tiny DOM helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function view() { return document.getElementById('view'); }
  function html(h) { view().innerHTML = h; window.scrollTo(0, 0); }
  function today() { return PI.todayISO(); }

  function seasonChip() {
    var t = today();
    document.getElementById('season-chip').textContent =
      'COACH: DAY ' + PI.coachDayOn(t).toLocaleString('en-US') + ' · ' + PI.daysToJan1(t) + ' TO JAN 1';
  }
  function setTab(name) {
    document.querySelectorAll('#tabbar a').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-tab') === name);
    });
  }
  function sig() {
    return '<div class="sig smallcaps">a little discipline from the road, every day.<br>become your own coach.<br><br>outgrow yesterday.</div>';
  }
  function gate() { // returns true if logged in, else renders the door
    if (me()) return true;
    html(
      '<h1>The door\u2019s right here.</h1>' +
      '<p>Got your code from your order? Put it in and the books open \u2014 yours, in here, any time. No PDFs. No lost emails.</p>' +
      '<a class="btn" href="#/activate">I\u2019ve got my code</a>' +
      '<a class="btn secondary" href="#/login">I already have an account</a>' +
      '<div class="card"><h2 style="margin-top:0">No code yet?</h2>' +
      '<p>The Starter Manual is <strong>$19</strong>, one door only: <a href="https://PayPal.Me/SDowning225" rel="noopener">PayPal.Me/SDowning225</a>. Buy before Dec 31 and THE MIRROR rides free on the 31st. Your code comes with your order.</p>' +
      '<p class="dim">' + esc(ASK_RODA) + '</p></div>' +
      '<div class="card"><h2 style="margin-top:0">Not ready? Prove one day.</h2>' +
      '<p>The 24-Hour Mirror Check is free. One day, one honest look, one receipt. No purchase, no capture.</p>' +
      '<a class="btn secondary" href="#/free">Run the free check</a></div>' + sig()
    );
    return false;
  }

  /* ---------- HOME ---------- */
  function vHome() {
    setTab('home');
    var t = today(), u = me();
    var seasonDay = PI.seasonDayOn(t);
    var head =
      '<h1>Two clocks.<br><span class="gold">One question.</span></h1>' +
      '<div class="clocks">' +
      '<div class="clock"><div class="num">' + PI.coachDayOn(t).toLocaleString('en-US') + '</div><div class="lbl">Coach\u2019s day \u2014 counting up</div></div>' +
      '<div class="clock"><div class="num">' + PI.daysToJan1(t) + '</div><div class="lbl">Days to Jan 1 \u2014 counting down</div></div></div>' +
      '<p style="text-align:center" class="dim">' + (seasonDay ? 'Day ' + seasonDay + ' of 50 \u00b7 the Proving Season' : 'The Proving Season') + '</p>' +
      '<div class="card" style="text-align:center"><p style="font-size:20px;margin:.2em 0">What did you prove today?</p>' +
      '<p class="dim" style="margin:.2em 0">Intentions don\u2019t count. Receipts do.</p></div>';
    if (!u) {
      html(head +
        '<a class="btn" href="#/activate">Open the books with my code</a>' +
        '<a class="btn secondary" href="#/free">Free: the 24-Hour Mirror Check</a>' +
        '<div class="card"><p class="dim" style="margin:0">' + esc(ASK_RODA) + '</p></div>' + sig());
      return;
    }
    var s = store.statsFor(u.id, t);
    var pd = PI.buyerProgramDay(u.programStartISO, t);
    var mine =
      '<div class="card"><h2 style="margin-top:0">Your clock</h2>' +
      '<div class="stat-row">' +
      '<div class="stat"><div class="n">' + (pd ? Math.min(pd, 56) : '\u2014') + '</div><div class="l">Your day of 56</div></div>' +
      '<div class="stat"><div class="n">' + s.streak + '</div><div class="l">Streak</div></div>' +
      '<div class="stat"><div class="n">' + s.verifiedDays + '</div><div class="l">Days proven</div></div></div>' +
      '<p class="dim">Phase: ' + esc(PI.buyerPhase(u.programStartISO, t)) + ' \u00b7 your window closes ' + esc(PI.buyerWindowEnd(u.programStartISO) || '\u2014') + '</p></div>' +
      '<a class="btn" href="#/checkin">Prove today</a>' +
      '<a class="btn secondary" href="#/receipts">See my receipts card</a>';
    html(head + mine + sig());
  }

  /* ---------- ACTIVATE / LOGIN ---------- */
  function vActivate() {
    setTab('home');
    html('<h1>Your code is the key.</h1>' +
      '<p>One code, one buyer. It opens your account and the Starter with it. THE MIRROR unlocks itself Dec 31 \u2014 it rode free with your season purchase.</p>' +
      '<form id="f-activate"><label>Access code</label><input type="text" id="a-code" autocomplete="off" placeholder="PROVE-XXXX-XXXX" required>' +
      '<label>Email</label><input type="email" id="a-email" required>' +
      '<label>Set a password</label><input type="password" id="a-pass" required>' +
      '<div id="a-err"></div><button class="btn" type="submit">Open my books</button></form>' +
      '<p class="dim">Already in? <a href="#/login">Log in</a>.</p>' + sig());
    document.getElementById('f-activate').addEventListener('submit', function (e) {
      e.preventDefault();
      settle(store.redeemCode(
        document.getElementById('a-code').value,
        document.getElementById('a-email').value,
        document.getElementById('a-pass').value, today()), function (r) {
        if (!r.ok) { document.getElementById('a-err').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; }
        persistSession();
        location.hash = '#/account?welcome=1';
      });
    });
  }
  function vLogin() {
    setTab('home');
    html('<h1>Back in.</h1><form id="f-login">' +
      '<label>Email</label><input type="email" id="l-email" required>' +
      '<label>Password</label><input type="password" id="l-pass" required>' +
      '<div id="l-err"></div><button class="btn" type="submit">Log in</button></form>' +
      '<p class="dim">Lost your password or code? Codes get re-issued from your order record \u2014 ask through the door and we\u2019ll sort it. No circus.</p>' + sig());
    document.getElementById('f-login').addEventListener('submit', function (e) {
      e.preventDefault();
      settle(store.login(document.getElementById('l-email').value, document.getElementById('l-pass').value), function (r) {
        if (!r.ok) { document.getElementById('l-err').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; }
        persistSession();
        location.hash = '#/';
      });
    });
  }
  function vAccount() {
    setTab('receipts');
    if (!gate()) return;
    var u = me();
    var welcome = location.hash.indexOf('welcome=1') > -1;
    html((welcome ? '<div class="ok">You\u2019re in. The Starter is open \u2014 bottom nav, \u201cBooks.\u201d First job: your name for the board, if you want on it.</div>' : '') +
      '<h1>Your account</h1><form id="f-account">' +
      '<label>Name for the board (first name + town reads best)</label>' +
      '<input type="text" id="ac-name" value="' + esc(u.displayName || '') + '" placeholder="Marcus \u2014 Savannah, GA">' +
      '<label style="text-transform:none; letter-spacing:0; font-size:15px; color:var(--ink)">' +
      '<input type="checkbox" id="ac-board" ' + (u.boardOptIn ? 'checked' : '') + ' style="width:auto"> Put me on the leaderboard \u2014 proof numbers only, never my journal, never my photos.</label>' +
      '<label>PayPal transaction ID (for your receipts file \u2014 speeds up any audit)</label>' +
      '<input type="text" id="ac-txn" value="' + esc(u.transactionId || '') + '">' +
      '<button class="btn" type="submit">Save</button></form>' +
      '<div class="card"><div class="kv"><span>Starter Manual</span><strong>' + (u.entitlement && u.entitlement.starter ? 'Open' : 'Locked') + '</strong></div>' +
      '<div class="kv"><span>THE MIRROR</span><strong>' + (u.entitlement && u.entitlement.mirror ? 'Unlocks ' + esc(u.entitlement.mirrorUnlockISO) : 'Not on this purchase') + '</strong></div>' +
      '<div class="kv"><span>Your 56 started</span><strong>' + esc(u.programStartISO || '\u2014') + '</strong></div></div>' +
      '<button class="btn secondary" id="btn-logout">Log out</button>' + sig());
    document.getElementById('f-account').addEventListener('submit', function (e) {
      e.preventDefault();
      u.displayName = document.getElementById('ac-name').value.trim();
      u.boardOptIn = document.getElementById('ac-board').checked;
      settle(store.save(), function () {
        settle(store.setTransactionId(u.id, document.getElementById('ac-txn').value.trim()), function () {
          location.hash = '#/receipts';
        });
      });
    });
    document.getElementById('btn-logout').addEventListener('click', function () {
      store.logout(); persistSession(); location.hash = '#/';
    });
  }

  /* ---------- LIBRARY + READER ---------- */
  function vRead() {
    setTab('read');
    if (!gate()) return;
    var u = me(), t = today();
    var starter = BOOKS.starter, mirror = BOOKS.mirror;
    var mirrorOpen = PI.mirrorUnlocked(u.entitlement, t);
    var chRows = starter.chapters.map(function (c, i) {
      return '<div class="kv"><a href="#/read/starter/' + c.id + '">' + esc(c.title) + '</a><span class="dim">' + esc(c.unit || '') + '</span></div>';
    }).join('');
    html('<h1>The shelf</h1>' +
      '<div class="card"><h2 style="margin-top:0">' + esc(starter.title) + '</h2><p class="dim">' + esc(starter.subtitle) + '</p>' + chRows + '</div>' +
      '<div class="card"><h2 style="margin-top:0">' + esc(mirror.title) + '</h2><p class="dim">' + esc(mirror.subtitle) + '</p>' +
      (mirrorOpen
        ? '<p class="good">Open. It\u2019s Dec 31 \u2014 the Mirror is yours.</p>'
        : '<p>Locked. ' + esc(mirror.lockedNote) + '</p><p class="gold">' + PI.daysToMirror(u.entitlement, t) + ' days to the unlock.</p>') +
      '</div>' +
      '<p class="dim">Everything on this shelf reads offline once you\u2019ve opened it \u2014 dead zones don\u2019t get a vote.</p>' + sig());
  }
  function vChapter(bookId, chId) {
    setTab('read');
    if (!gate()) return;
    var u = me();
    var book = BOOKS[bookId];
    var idx = book.chapters.findIndex(function (c) { return c.id === chId; });
    if (idx === -1) { location.hash = '#/read'; return; }
    var ch = book.chapters[idx];
    var key = 'reader_' + u.id + '_' + bookId + '_' + chId;
    var fontKey = 'reader_font';
    var size = pref(fontKey, 19);
    var paras = ch.body.map(function (p) { return '<p>' + esc(p) + '</p>'; }).join('');
    var prev = idx > 0 ? '<a class="btn secondary small" href="#/read/' + bookId + '/' + book.chapters[idx - 1].id + '">\u2190 Prev</a>' : '';
    var next = idx < book.chapters.length - 1 ? '<a class="btn secondary small" href="#/read/' + bookId + '/' + book.chapters[idx + 1].id + '">Next \u2192</a>' : '';
    html('<p class="dim" style="margin-bottom:0"><a href="#/read">The shelf</a> \u00b7 ' + esc(ch.unit || '') + '</p>' +
      '<h1 style="font-size:24px">' + esc(ch.title) + '</h1>' +
      '<div class="reader-tools"><span class="dim">Text size</span>' +
      '<button class="ghost-btn" id="f-minus">A\u2212</button><button class="ghost-btn" id="f-plus">A+</button>' +
      '<span class="dim" id="resume-note"></span></div>' +
      '<div class="reader" id="reader-body" style="--reader-size:' + size + 'px; font-size:' + size + 'px">' + paras + '</div>' +
      '<div style="display:flex; gap:8px; justify-content:space-between; margin-top:18px">' + prev + next + '</div>' + sig());
    function applySize(s) {
      size = Math.max(15, Math.min(26, s));
      document.getElementById('reader-body').style.fontSize = size + 'px';
      setPref(fontKey, size);
    }
    document.getElementById('f-minus').addEventListener('click', function () { applySize(size - 1); });
    document.getElementById('f-plus').addEventListener('click', function () { applySize(size + 1); });
    // resume position: restore scroll fraction, then keep saving it
    var saved = pref(key, 0);
    if (saved > 0.02) {
      document.getElementById('resume-note').textContent = 'Picked up where you left off.';
      requestAnimationFrame(function () {
        window.scrollTo(0, saved * (document.body.scrollHeight - innerHeight));
      });
    }
    var ticking = false;
    window.onscroll = function () {
      if (ticking) return; ticking = true;
      setTimeout(function () {
        var max = document.body.scrollHeight - innerHeight;
        if (max > 0) setPref(key, Math.min(1, window.scrollY / max));
        ticking = false;
      }, 250);
    };
  }

  /* ---------- CHECK-IN ---------- */
  function vCheckin() {
    setTab('checkin');
    if (!gate()) return;
    var u = me(), t = today();
    var mine = store.checkinsFor(u.id).filter(function (c) { return c.dateISO === t; });
    var done = mine.length > 0;
    html('<h1>Prove today.</h1>' +
      (done ? '<div class="ok">Today\u2019s receipt is in \u2014 status: ' + esc(mine[0].status) + '. Add another and it stacks as a proof post; the day still counts once.</div>' : '') +
      '<form id="f-checkin">' +
      '<label>One line \u2014 what did you prove today?</label>' +
      '<textarea id="c-statement" required placeholder="Ran the miles. Did the work. No excuses."></textarea>' +
      '<label>Proof \u2014 photo or link. Proof or it didn\u2019t happen.</label>' +
      '<div class="seg" style="margin-bottom:8px"><button type="button" id="pt-photo" class="on">Photo</button><button type="button" id="pt-link">Link</button></div>' +
      '<div id="proof-photo-row"><input type="file" id="c-photo" accept="image/*"></div>' +
      '<div id="proof-link-row" hidden><input type="url" id="c-link" placeholder="https://\u2026 (workout post, video, group thread)"></div>' +
      '<div id="c-err"></div><button class="btn" type="submit">File my receipt</button></form>' +
      '<div class="perm">' + esc(PERMISSION_LINE) + '</div>' + sig());
    var mode = 'photo';
    document.getElementById('pt-photo').addEventListener('click', function () {
      mode = 'photo';
      this.classList.add('on'); document.getElementById('pt-link').classList.remove('on');
      document.getElementById('proof-photo-row').hidden = false; document.getElementById('proof-link-row').hidden = true;
    });
    document.getElementById('pt-link').addEventListener('click', function () {
      mode = 'link';
      this.classList.add('on'); document.getElementById('pt-photo').classList.remove('on');
      document.getElementById('proof-photo-row').hidden = true; document.getElementById('proof-link-row').hidden = false;
    });
    document.getElementById('f-checkin').addEventListener('submit', function (e) {
      e.preventDefault();
      var statement = document.getElementById('c-statement').value;
      function finish(proofRef) {
        settle(store.addCheckin(u.id, { statement: statement, proofType: mode, proofRef: proofRef }, t), function (r) {
          if (!r.ok) { document.getElementById('c-err').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; }
          location.hash = '#/receipts';
        });
      }
      if (mode === 'link') { finish(document.getElementById('c-link').value.trim()); return; }
      var f = document.getElementById('c-photo').files[0];
      if (!f) { finish(''); return; } // addCheckin will reject with the proof error
      var reader = new FileReader();
      reader.onload = function () { finish(reader.result); };
      reader.readAsDataURL(f);
    });
  }

  /* ---------- RECEIPTS CARD + SHARE ---------- */
  function vReceipts() {
    setTab('receipts');
    if (!gate()) return;
    var u = me(), t = today();
    var s = store.statsFor(u.id, t);
    var pd = PI.buyerProgramDay(u.programStartISO, t);
    html('<h1>Your receipts.</h1>' +
      '<div class="card" id="rcard" style="text-align:center">' +
      '<div class="smallcaps dim">' + esc(u.displayName || u.email) + '</div>' +
      '<div style="font-family:Impact,\'Arial Black\',sans-serif; font-size:34px; letter-spacing:.05em; margin:6px 0">DAY ' + (pd || '\u2014') + ' OF 56</div>' +
      '<div class="stat-row">' +
      '<div class="stat"><div class="n">' + s.verifiedDays + '</div><div class="l">Days proven</div></div>' +
      '<div class="stat"><div class="n">' + s.streak + '</div><div class="l">Streak</div></div>' +
      '<div class="stat"><div class="n">' + s.proofPosts + '</div><div class="l">Proof posts</div></div></div>' +
      '<p class="dim">Lifetime days proven: ' + s.lifetimeDays + ' \u00b7 best streak: ' + s.bestStreak + '<br>Coach is on Day ' + PI.coachDayOn(t).toLocaleString('en-US') + '. ' + PI.daysToJan1(t) + ' days to Jan 1.<br>A mirror, not a trophy.</p></div>' +
      '<button class="btn" id="btn-share">Download my card (share it your call)</button>' +
      '<canvas id="share-canvas" width="1080" height="1350"></canvas>' +
      '<a class="btn secondary" href="#/history">My proof history + finisher file</a>' +
      '<a class="btn secondary" href="#/account">Account + board name</a>' + sig());
    document.getElementById('btn-share').addEventListener('click', function () { drawShareCard(u, s, pd, t); });
  }
  function drawShareCard(u, s, pd, t) {
    var c = document.getElementById('share-canvas'), x = c.getContext('2d');
    x.fillStyle = '#0b0b0d'; x.fillRect(0, 0, 1080, 1350);
    x.strokeStyle = '#d9a441'; x.lineWidth = 6; x.strokeRect(36, 36, 1008, 1278);
    x.fillStyle = '#d9a441'; x.textAlign = 'center';
    x.font = '92px Impact, sans-serif'; x.fillText('PROVE IT', 540, 210);
    x.fillStyle = '#f2ede3'; x.font = '44px Georgia, serif';
    x.fillText(u.displayName || 'A Proving Season buyer', 540, 320);
    x.font = '120px Impact, sans-serif'; x.fillStyle = '#d9a441';
    x.fillText('DAY ' + (pd || '\u2014') + ' OF 56', 540, 510);
    x.fillStyle = '#f2ede3'; x.font = '58px Georgia, serif';
    x.fillText(s.verifiedDays + ' days proven  \u00b7  streak ' + s.streak, 540, 650);
    x.fillText(s.proofPosts + ' proof posts on file', 540, 740);
    x.font = '40px Georgia, serif'; x.fillStyle = '#a89f8d';
    x.fillText('Coach: Day ' + PI.coachDayOn(t).toLocaleString('en-US') + ' \u00b7 ' + PI.daysToJan1(t) + ' days to Jan 1', 540, 900);
    x.fillText('A mirror, not a trophy.', 540, 990);
    x.font = '34px Georgia, serif';
    x.fillText('OUTGROW YESTERDAY \u00b7 rideordieamerica.com', 540, 1210);
    var a = document.createElement('a');
    a.download = 'my-receipts-day' + (pd || 0) + '.png';
    a.href = c.toDataURL('image/png');
    a.click();
  }

  /* ---------- LEADERBOARD ---------- */
  function vBoard() {
    setTab('board');
    if (!gate()) return;
    var u = me(), t = today();
    var win = location.hash.indexOf('week') > -1 ? 'week' : 'season';
    function rows(winKey) {
      return store.board(t, winKey).map(function (r) {
        return '<tr class="' + (r.isCoach ? 'coach-row' : '') + (r.userId === u.id ? ' me-row' : '') + '">' +
          '<td>' + r.rank + '</td><td>' + esc(r.name) + (r.isCoach ? ' <span class="tag">COACH</span>' : '') + '</td>' +
          '<td>' + r.verifiedDays + '</td><td>' + r.streak + '</td><td>' + r.proofPosts + '</td></tr>';
      }).join('');
    }
    html('<h1>Outgrow Yesterday.</h1>' +
      '<p class="dim">Your yesterday is the first opponent. The pack is just pressure. Ranked on proof only \u2014 verified days, streak, proof posts. Never miles, never weight. Coach runs the same math.</p>' +
      '<div class="seg"><button id="b-season" class="' + (win === 'season' ? 'on' : '') + '">All season</button><button id="b-week" class="' + (win === 'week' ? 'on' : '') + '">This week</button></div>' +
      '<table><tr><th>#</th><th>Name</th><th>Days</th><th>Streak</th><th>Posts</th></tr>' + rows(win) + '</table>' +
      (u.boardOptIn ? '' : '<div class="card"><p style="margin:0">You\u2019re not on the board. <a href="#/account">Turn it on in your account</a> \u2014 numbers only, your call.</p></div>') +
      '<div class="perm">' + esc(PERMISSION_LINE) + '</div>' + sig());
    document.getElementById('b-season').addEventListener('click', function () { location.hash = '#/board'; });
    document.getElementById('b-week').addEventListener('click', function () { location.hash = '#/board/week'; });
  }

  /* ---------- HISTORY + FINISHER FILE EXPORT ---------- */
  function vHistory() {
    setTab('receipts');
    if (!gate()) return;
    var u = me();
    var rows = store.checkinsFor(u.id).map(function (c) {
      return '<tr><td>' + esc(c.dateISO) + '</td><td>' + esc(c.statement) + '</td><td>' + esc(c.proofType) + '</td>' +
        '<td><span class="pill ' + c.status + '">' + c.status + '</span></td></tr>';
    }).join('');
    html('<h1>My proof history.</h1><p class="dim">Private. Yours. This is the file the receipts-clause audit reads at Day 56 \u2014 it builds itself as you go.</p>' +
      (rows ? '<table><tr><th>Date</th><th>Line</th><th>Proof</th><th>Review</th></tr>' + rows + '</table>'
            : '<div class="card">Nothing filed yet. <a href="#/checkin">Prove today</a>.</div>') +
      '<button class="btn" id="btn-export">Download my finisher file (evidence export)</button>' + sig());
    document.getElementById('btn-export').addEventListener('click', function () {
      var ev = store.exportEvidence(u.id);
      var text = 'PROVE IT \u2014 FINISHER FILE / RECEIPTS-CLAUSE EVIDENCE\n' +
        'Buyer: ' + ev.buyer + ' <' + ev.email + '>\nTransaction ID: ' + ev.transactionId +
        '\nProgram start: ' + ev.programStartISO + ' \u00b7 window closes: ' + ev.windowEndISO +
        '\nDays proven (all): ' + ev.daysProven + ' \u00b7 verified: ' + ev.verifiedDays +
        ' \u00b7 current streak: ' + ev.currentStreak + ' \u00b7 best streak: ' + ev.bestStreak +
        '\nExported: ' + ev.exportedISO + '\n\n' + ev.clause + '\n\nENTRIES (newest first):\n' +
        ev.entries.map(function (e) { return e.date + ' \u00b7 [' + e.review + '] ' + e.statement + ' \u00b7 proof: ' + e.proof; }).join('\n');
      var a = document.createElement('a');
      a.download = 'finisher-file.txt';
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
  }

  /* ---------- ADMIN ---------- */
  function vAdmin() {
    setTab('home');
    var u = me();
    if (!u || u.role !== 'admin') {
      html('<h1>Not your door.</h1><p class="dim">Admin signs in with the admin account.</p><a class="btn secondary" href="#/login">Log in</a>');
      return;
    }
    var pending = store.db.checkins.filter(function (c) { return c.status === 'submitted'; });
    var codes = store.db.codes.slice(-20).reverse();
    var buyers = store.db.users.filter(function (x) { return x.role !== 'admin'; });
    html('<h1>Admin \u2014 the back room.</h1>' +
      '<div class="card"><h2 style="margin-top:0">Mint codes</h2>' +
      '<label>How many</label><input type="text" id="ad-n" value="10">' +
      '<button class="btn small" id="ad-mint">Mint season-window codes</button>' +
      '<div id="ad-codes">' + codes.map(function (c) {
        return '<div class="kv"><span>' + c.code + '</span><span class="pill ' + (c.status === 'unused' ? 'submitted' : c.status === 'redeemed' ? 'verified' : 'flagged') + '">' + c.status + '</span></div>';
      }).join('') + '</div></div>' +
      '<div class="card"><h2 style="margin-top:0">Proof review (' + pending.length + ' waiting)</h2>' +
      (pending.length ? pending.map(function (c) {
        var who = store.userById(c.userId);
        return '<div class="kv"><span>' + esc(c.dateISO) + ' \u00b7 ' + esc(who ? (who.displayName || who.email) : '?') + ' \u2014 ' + esc(c.statement) + '</span>' +
          '<span><button class="ghost-btn rv" data-id="' + c.id + '" data-s="verified">Verify</button> ' +
          '<button class="ghost-btn rv" data-id="' + c.id + '" data-s="flagged">Flag</button></span></div>';
      }).join('') : '<p class="dim">Queue\u2019s clear.</p>') + '</div>' +
      '<div class="card"><h2 style="margin-top:0">Buyers</h2>' +
      buyers.map(function (b) {
        return '<div class="kv"><span>' + esc(b.displayName || b.email) + ' <span class="dim">(' + b.role + ')</span></span>' +
          '<span><button class="ghost-btn rescue" data-id="' + b.id + '">Rescue link</button> ' +
          '<button class="ghost-btn ent" data-id="' + b.id + '">' + (b.entitlement && b.entitlement.starter ? 'Revoke Starter' : 'Grant Starter') + '</button></span></div>';
      }).join('') +
      '<div id="ad-out"></div>' +
      '<button class="btn secondary small" id="ad-wipe">Wipe demo buyers (test data)</button></div>' + sig());
    document.getElementById('ad-mint').addEventListener('click', function () {
      var n = parseInt(document.getElementById('ad-n').value, 10) || 0;
      settle(store.mintCodes(n, { todayISO: today() }), function (made) {
        var out = document.getElementById('ad-out');
        if (out) out.innerHTML = '<div class="ok">Minted: ' + made.map(function (m) { return m.code; }).join(', ') + '</div>';
        // refresh the codes list in place — never re-render the whole view
        // (a stray re-render would stomp whatever route the admin moved to)
        var list = document.getElementById('ad-codes');
        if (list) list.innerHTML = store.db.codes.slice(-20).reverse().map(function (c) {
          return '<div class="kv"><span>' + c.code + '</span><span class="pill ' + (c.status === 'unused' ? 'submitted' : c.status === 'redeemed' ? 'verified' : 'flagged') + '">' + c.status + '</span></div>';
        }).join('');
      });
    });
    document.querySelectorAll('.rv').forEach(function (b) {
      b.addEventListener('click', function () {
        settle(store.reviewCheckin(b.getAttribute('data-id'), b.getAttribute('data-s')), function () { vAdmin(); });
      });
    });
    document.querySelectorAll('.rescue').forEach(function (b) {
      b.addEventListener('click', function () {
        settle(store.mintRescueToken(b.getAttribute('data-id')), function (tok) {
          var out = document.getElementById('ad-out');
          if (out) out.innerHTML = '<div class="ok">Rescue link (one-time, send it privately): ' +
            location.origin + location.pathname + '#/rescue/' + tok + '</div>';
        });
      });
    });
    document.querySelectorAll('.ent').forEach(function (b) {
      b.addEventListener('click', function () {
        var usr = store.userById(b.getAttribute('data-id'));
        settle(store.setEntitlement(usr.id, { starter: !(usr.entitlement && usr.entitlement.starter) }),
          function () { vAdmin(); });
      });
    });
    document.getElementById('ad-wipe').addEventListener('click', function () {
      settle(store.wipeDemoData(), function () { vAdmin(); });
    });
  }

  /* ---------- FREE FRONT DOOR: 24-HOUR MIRROR CHECK ---------- */
  function vFree() {
    setTab('home');
    html('<h1>The 24-Hour Mirror Check.</h1>' +
      '<p>Free. No purchase, no capture. One day, one honest look in the mirror, one receipt. This is the front door \u2014 walk through it and see if the season\u2019s for you.</p>' +
      '<div class="card"><p style="margin-top:0"><strong>The check:</strong> pick the one thing you\u2019ve been avoiding. Do it today \u2014 the smallest real version of it. Then write the line and file it here. That\u2019s a receipt. That\u2019s Day 1 energy, whether you ever buy a thing.</p>' +
      '<form id="f-free"><label>Your one thing, done \u2014 one line</label>' +
      '<textarea id="fr-statement" required placeholder="Walked the mile I\u2019ve been skipping for a month."></textarea>' +
      '<div id="fr-err"></div><button class="btn" type="submit">File my free receipt</button></form><div id="fr-done"></div></div>' +
      '<div class="card"><h2 style="margin-top:0">Want the whole 56?</h2>' +
      '<p>The Starter Manual is $19 at <a href="https://PayPal.Me/SDowning225" rel="noopener">PayPal.Me/SDowning225</a> \u2014 the only door. Buy before Dec 31 and THE MIRROR rides free on the 31st. Finish both, documented, and the receipts clause sends $9.50 back. The app keeps every receipt for you.</p>' +
      '<p class="dim">' + esc(ASK_RODA) + '</p></div>' + sig());
    document.getElementById('f-free').addEventListener('submit', function (e) {
      e.preventDefault();
      settle(store.addFreeCheck(document.getElementById('fr-statement').value, today()), function (r) {
        if (!r.ok) { document.getElementById('fr-err').innerHTML = '<div class="err">' + esc(r.error) + '</div>'; return; }
        document.getElementById('fr-done').innerHTML = '<div class="ok">Filed. That\u2019s a receipt \u2014 one day, proven. Imagine 56 of them stacked. The door\u2019s above when you\u2019re ready.</div>';
      });
    });
  }

  /* ---------- RESCUE (emergency fallback link) ---------- */
  function vRescue(token) {
    settle(store.loginByRescueToken(token), function (r) {
      if (r.ok) { persistSession(); location.hash = '#/'; return; }
      html('<h1>That link\u2019s spent.</h1><p>' + esc(r.error) + '</p>' + sig());
    });
  }

  /* ---------- ROUTER + BOOT ---------- */
  function route() {
    window.onscroll = null;
    seasonChip();
    var h = location.hash || '#/';
    var parts = h.replace(/^#\//, '').split('/');
    var head = (parts[0] || '').split('?')[0];
    if (head === '' ) vHome();
    else if (head === 'activate') vActivate();
    else if (head === 'login') vLogin();
    else if (head === 'account') vAccount();
    else if (head === 'read' && parts[1] && parts[2]) vChapter(parts[1], parts[2]);
    else if (head === 'read') vRead();
    else if (head === 'checkin') vCheckin();
    else if (head === 'receipts') vReceipts();
    else if (head === 'board') vBoard();
    else if (head === 'history') vHistory();
    else if (head === 'admin') vAdmin();
    else if (head === 'free') vFree();
    else if (head === 'rescue' && parts[1]) vRescue(parts[1]);
    else vHome();
  }
  function loadBook(name) {
    return fetch('content/' + name + '.json').then(function (r) { return r.json(); })
      .catch(function () { return { title: name, subtitle: '', chapters: [] }; });
  }
  restoreSession();
  Promise.all([loadBook('starter'), loadBook('mirror')]).then(function (b) {
    BOOKS.starter = b[0]; BOOKS.mirror = b[1];
    route();
    // Production store hydrates async (session + board): re-route when ready.
    if (store.ready) store.ready.then(function () { restoreSession(); route(); });
  });
  window.addEventListener('hashchange', route);

  /* theme */
  var themeBtn = document.getElementById('theme-btn');
  function applyTheme(th) { document.documentElement.setAttribute('data-theme', th); }
  applyTheme(pref('theme', 'dark'));
  themeBtn.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    applyTheme(next); setPref('theme', next);
  });

  /* install banner */
  if (!pref('install_dismissed', false)) {
    document.getElementById('install-banner').hidden = false;
    document.getElementById('install-dismiss').addEventListener('click', function () {
      document.getElementById('install-banner').hidden = true;
      setPref('install_dismissed', true);
    });
  }

  /* service worker (PWA offline) */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
