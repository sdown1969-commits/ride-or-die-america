/* PROVE IT — data-access layer.
   The app talks ONLY to this Store API. Two adapters ship in v1-dev:
     - LocalAdapter  (browser localStorage) — the dev/default adapter.
     - MemoryAdapter (in-memory) — used by the node end-to-end tests.
   The production adapter is Supabase (see schema/supabase-schema.sql and
   RUNBOOK.md §Supabase hookup): implement the same Store surface against
   supabase-js and swap one line in app.js. Nothing else changes.
   Passwords here are a DEV-ONLY hash. Supabase Auth replaces them at hookup. */
(function (global) {
  'use strict';
  var PI = global.PI || (typeof require !== 'undefined' ? require('./core.js') : null);

  function devHash(str) { // DEV ONLY — not security. Replaced by Supabase Auth.
    var h1 = 5381, h2 = 52711;
    for (var i = 0; i < str.length; i++) {
      h1 = ((h1 << 5) + h1 + str.charCodeAt(i)) | 0;
      h2 = ((h2 << 5) + h2 - str.charCodeAt(i)) | 0;
    }
    return 'dev$' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
  }
  function uid(prefix) {
    return prefix + '_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  /* ---------------- adapters ---------------- */
  function LocalAdapter(key) { this.key = key || 'proveit_db_v1'; }
  LocalAdapter.prototype.read = function () {
    try {
      var raw = global.localStorage && global.localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  };
  LocalAdapter.prototype.write = function (db) {
    if (global.localStorage) global.localStorage.setItem(this.key, JSON.stringify(db));
  };

  function MemoryAdapter(seed) { this.db = seed || null; }
  MemoryAdapter.prototype.read = function () { return this.db ? JSON.parse(JSON.stringify(this.db)) : null; };
  MemoryAdapter.prototype.write = function (db) { this.db = JSON.parse(JSON.stringify(db)); };

  /* ---------------- seed ---------------- */
  function seedDB() {
    var adminId = 'usr_admin';
    var coachId = 'usr_coach';
    var db = {
      v: 1,
      codes: [],
      users: [
        {
          id: adminId, role: 'admin', email: 'admin@proveit.local',
          passHash: devHash('proveit-admin'), displayName: 'RODA (admin)',
          boardOptIn: false, createdISO: '2026-11-13'
        },
        {
          id: coachId, role: 'coach', email: 'coach@proveit.local',
          passHash: devHash('proveit-coach'), displayName: 'Coach — Midway, GA',
          boardOptIn: true, createdISO: PI.SEASON.startISO,
          entitlement: { starter: true, mirror: true, mirrorUnlockISO: PI.SEASON.mirrorUnlockISO, seasonWindow: true },
          programStartISO: PI.SEASON.startISO, transactionId: 'COACH'
        }
      ],
      checkins: [],
      freeChecks: []
    };
    // Coach's proof = his Day Sheet. Seeded for the two season days so far;
    // in production these rows are written from his real daily sheet.
    ['2026-11-12', '2026-11-13'].forEach(function (d, i) {
      db.checkins.push({
        id: uid('chk'), userId: coachId, dateISO: d,
        statement: i === 0 ? 'Day Sheet posted. Day 1,290 in the books.' : 'Day Sheet posted. Recovery day, ridden and proven.',
        proofType: 'link', proofRef: 'Day Sheet (daily package)',
        status: 'verified', createdAt: d + 'T20:00:00Z'
      });
    });
    // Pre-generated test codes (QA batch). Admin mints real batches in-app.
    ['PROVE-TEST-AAAA', 'PROVE-TEST-BBBB', 'PROVE-TEST-CCCC'].forEach(function (code) {
      db.codes.push({
        code: code, status: 'unused', seasonWindow: true,
        mirrorUnlockISO: PI.SEASON.mirrorUnlockISO, createdISO: '2026-11-13', redeemedBy: null
      });
    });
    // Demo buyers so the board reads like a board. TEST DATA — admin can wipe.
    var demos = [
      { name: 'Marcus — Savannah, GA', start: '2026-11-12', days: ['2026-11-12', '2026-11-13'] },
      { name: 'Denise — Jacksonville, FL', start: '2026-11-12', days: ['2026-11-12'] },
      { name: 'Tom — Charleston, SC', start: '2026-11-13', days: ['2026-11-13'] }
    ];
    demos.forEach(function (d, i) {
      var id = 'usr_demo' + (i + 1);
      db.users.push({
        id: id, role: 'buyer', email: 'demo' + (i + 1) + '@proveit.local',
        passHash: devHash('proveit-demo'), displayName: d.name, boardOptIn: true,
        createdISO: d.start,
        entitlement: { starter: true, mirror: true, mirrorUnlockISO: PI.SEASON.mirrorUnlockISO, seasonWindow: true },
        programStartISO: d.start, transactionId: 'TEST-ORDER-' + (1001 + i)
      });
      d.days.forEach(function (day) {
        db.checkins.push({
          id: uid('chk'), userId: id, dateISO: day,
          statement: 'Proof posted. Got it done today.',
          proofType: 'link', proofRef: 'group thread post',
          status: 'verified', createdAt: day + 'T18:00:00Z'
        });
      });
    });
    return db;
  }

  /* ---------------- store ---------------- */
  function Store(adapter) {
    this.adapter = adapter;
    this.db = adapter.read();
    if (!this.db) { this.db = seedDB(); this.save(); }
    this.sessionUserId = null;
  }
  Store.prototype.save = function () { this.adapter.write(this.db); };
  Store.prototype.userById = function (id) {
    return this.db.users.find(function (u) { return u.id === id; }) || null;
  };
  Store.prototype.userByEmail = function (email) {
    email = (email || '').trim().toLowerCase();
    return this.db.users.find(function (u) { return u.email === email; }) || null;
  };
  Store.prototype.session = function () {
    return this.sessionUserId ? this.userById(this.sessionUserId) : null;
  };

  /* ----- codes & activation ----- */
  Store.prototype.mintCodes = function (n, opts) {
    opts = opts || {};
    var made = [], guard = 0;
    while (made.length < n && guard++ < n * 50) {
      var code = PI.makeCode();
      if (this.db.codes.some(function (c) { return c.code === code; })) continue;
      var rec = {
        code: code, status: 'unused',
        seasonWindow: opts.seasonWindow !== false,
        mirrorUnlockISO: PI.SEASON.mirrorUnlockISO,
        createdISO: opts.todayISO || PI.todayISO(),
        redeemedBy: null
      };
      this.db.codes.push(rec); made.push(rec);
    }
    this.save();
    return made;
  };
  Store.prototype.redeemCode = function (rawCode, email, password, todayISO) {
    var code = PI.normalizeCode(rawCode);
    var rec = this.db.codes.find(function (c) { return c.code === code; });
    if (!rec) return { ok: false, error: 'That code doesn\u2019t read. Check it and try again.' };
    if (rec.status === 'redeemed') return { ok: false, error: 'That code\u2019s already been used. One code, one buyer.' };
    if (rec.status === 'revoked') return { ok: false, error: 'That code\u2019s been pulled. Talk to us and we\u2019ll sort it.' };
    email = (email || '').trim().toLowerCase();
    if (!email || !password) return { ok: false, error: 'Email and a password. That\u2019s the whole form.' };
    if (this.userByEmail(email)) return { ok: false, error: 'That email already has an account. Log in instead.' };
    var user = {
      id: uid('usr'), role: 'buyer', email: email, passHash: devHash(password),
      displayName: '', boardOptIn: false, createdISO: todayISO,
      entitlement: {
        starter: true,
        mirror: !!rec.seasonWindow,
        mirrorUnlockISO: rec.mirrorUnlockISO,
        seasonWindow: !!rec.seasonWindow
      },
      programStartISO: todayISO, // CLOCK 2 starts at activation = documented start
      transactionId: ''
    };
    this.db.users.push(user);
    rec.status = 'redeemed'; rec.redeemedBy = user.id;
    this.sessionUserId = user.id;
    this.save();
    return { ok: true, user: user };
  };
  Store.prototype.login = function (email, password) {
    var u = this.userByEmail(email);
    if (!u || u.passHash !== devHash(password || '')) {
      return { ok: false, error: 'Email or password doesn\u2019t read. Try again.' };
    }
    this.sessionUserId = u.id;
    return { ok: true, user: u };
  };
  Store.prototype.logout = function () { this.sessionUserId = null; };

  /* ----- emergency fallback: per-buyer private access link ----- */
  Store.prototype.mintRescueToken = function (userId) {
    var u = this.userById(userId);
    if (!u) return null;
    u.rescueToken = uid('rescue');
    this.save();
    return u.rescueToken;
  };
  Store.prototype.loginByRescueToken = function (token) {
    var u = this.db.users.find(function (x) { return x.rescueToken && x.rescueToken === token; });
    if (!u) return { ok: false, error: 'That rescue link doesn\u2019t read. Ask for a fresh one.' };
    u.rescueToken = null; // one-time
    this.sessionUserId = u.id;
    this.save();
    return { ok: true, user: u };
  };

  /* ----- check-ins ----- */
  Store.prototype.addCheckin = function (userId, data, todayISO) {
    var u = this.userById(userId);
    if (!u) return { ok: false, error: 'No account.' };
    var statement = (data.statement || '').trim();
    if (!statement) return { ok: false, error: 'One line. What did you prove today? No line, no receipt.' };
    if (!data.proofRef) return { ok: false, error: 'Proof or it didn\u2019t happen — a photo or a link. Attach one.' };
    var rec = {
      id: uid('chk'), userId: userId, dateISO: todayISO,
      statement: statement,
      proofType: data.proofType === 'photo' ? 'photo' : 'link',
      proofRef: data.proofRef,
      status: 'submitted', createdAt: new Date().toISOString()
    };
    this.db.checkins.push(rec);
    this.save();
    return { ok: true, checkin: rec };
  };
  Store.prototype.reviewCheckin = function (checkinId, status) {
    var c = this.db.checkins.find(function (x) { return x.id === checkinId; });
    if (!c) return { ok: false };
    c.status = status; // 'verified' | 'flagged' | 'submitted'
    this.save();
    return { ok: true, checkin: c };
  };
  Store.prototype.checkinsFor = function (userId) {
    return this.db.checkins.filter(function (c) { return c.userId === userId; })
      .sort(function (a, b) { return a.dateISO < b.dateISO ? 1 : -1; });
  };

  /* ----- stats / board / export ----- */
  Store.prototype.statsFor = function (userId, iso) {
    return PI.userStats(this.db.checkins, userId, iso || PI.todayISO());
  };
  Store.prototype.board = function (iso, window) {
    return PI.leaderboard(this.db.users, this.db.checkins, iso || PI.todayISO(), window || 'season');
  };
  Store.prototype.exportEvidence = function (userId) {
    var u = this.userById(userId);
    if (!u) return null;
    var iso = PI.todayISO();
    var stats = this.statsFor(userId, iso);
    return {
      buyer: u.displayName || u.email,
      email: u.email,
      transactionId: u.transactionId || '(not recorded)',
      programStartISO: u.programStartISO,
      windowEndISO: PI.buyerWindowEnd(u.programStartISO),
      daysProven: stats.lifetimeDays,
      verifiedDays: stats.verifiedDays,
      currentStreak: stats.streak,
      bestStreak: stats.bestStreak,
      entries: this.checkinsFor(userId).map(function (c) {
        return { date: c.dateISO, statement: c.statement, proof: c.proofType + ': ' + String(c.proofRef).slice(0, 80), review: c.status };
      }),
      clause: 'RECEIPTS CLAUSE: finish the Starter Manual and THE MIRROR back to back, 56 days, fully documented, submit, RODA audits; if they hold up, half the Starter price comes back by PayPal — $9.50. Story use is a separate permission, asked separately, declinable with every cent kept.',
      exportedISO: iso
    };
  };

  /* ----- admin ----- */
  Store.prototype.setEntitlement = function (userId, patch) {
    var u = this.userById(userId);
    if (!u) return { ok: false };
    u.entitlement = Object.assign({}, u.entitlement || {}, patch);
    this.save();
    return { ok: true, user: u };
  };
  Store.prototype.revokeCode = function (code) {
    var rec = this.db.codes.find(function (c) { return c.code === PI.normalizeCode(code); });
    if (!rec) return { ok: false };
    rec.status = 'revoked'; this.save();
    return { ok: true };
  };
  Store.prototype.setTransactionId = function (userId, txn) {
    var u = this.userById(userId);
    if (!u) return { ok: false };
    u.transactionId = txn; this.save();
    return { ok: true };
  };
  Store.prototype.wipeDemoData = function () {
    var demoIds = this.db.users.filter(function (u) { return /^usr_demo/.test(u.id); }).map(function (u) { return u.id; });
    this.db.users = this.db.users.filter(function (u) { return demoIds.indexOf(u.id) === -1; });
    this.db.checkins = this.db.checkins.filter(function (c) { return demoIds.indexOf(c.userId) === -1; });
    this.save();
  };

  /* ----- free front door: 24-Hour Mirror Check ----- */
  Store.prototype.addFreeCheck = function (statement, todayISO) {
    var s = (statement || '').trim();
    if (!s) return { ok: false, error: 'Write the one thing. That\u2019s the whole check.' };
    var rec = { id: uid('free'), dateISO: todayISO, statement: s, createdAt: new Date().toISOString() };
    this.db.freeChecks.push(rec);
    this.save();
    return { ok: true, freeCheck: rec };
  };

  /* ================= PRODUCTION: SupabaseStore =================
     Same Store surface, backed by Supabase (Auth + PostgREST + RPC).
     Hydrate-on-load: session user's own rows + the public board are pulled
     into the same db shape the dev Store uses, so every read in app.js and
     every clock/stat in core.js runs unchanged. Writes go through
     immediately (write-through) and update the local mirror on success.
     Code redemption / minting / review / entitlement / rescue run through
     SECURITY DEFINER RPC functions (golive/production-sql.sql) — the
     server-side equivalents of the Edge Functions in golive/functions/,
     which cannot be deployed from the build VM (no access token). */
  var SB_KEY = 'proveit_sb_v1';

  function SupabaseStore(config) {
    this.cfg = config;
    this.db = { v: 1, codes: [], users: [], checkins: [], freeChecks: [] };
    this.sessionUserId = null;
    this._sb = null;
    try { this._sb = JSON.parse(global.localStorage.getItem(SB_KEY) || 'null'); } catch (e) { this._sb = null; }
    this._boardFallback = null; // leaderboard-view rows if board_checkins is unavailable
    var self = this;
    this.ready = this._boot().catch(function () { /* boot logged-out; gate() handles it */ });
  }

  /* ----- transport ----- */
  SupabaseStore.prototype._headers = function (authed) {
    var h = { 'apikey': this.cfg.supabaseAnonKey, 'Content-Type': 'application/json' };
    h['Authorization'] = 'Bearer ' + (authed && this._sb && this._sb.access_token ? this._sb.access_token : this.cfg.supabaseAnonKey);
    return h;
  };
  SupabaseStore.prototype._fetch = function (url, opts) {
    opts = opts || {};
    return global.fetch(url, opts).then(function (res) {
      return res.text().then(function (txt) {
        var json = null;
        try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* non-JSON */ }
        if (!res.ok) {
          var msg = (json && (json.message || json.error_description || json.error)) || ('Request failed (' + res.status + ')');
          var err = new Error(msg); err.status = res.status; err.body = json;
          throw err;
        }
        return json;
      });
    });
  };
  SupabaseStore.prototype._rest = function (path, opts) {
    opts = opts || {};
    var headers = Object.assign(this._headers(opts.anon ? false : true), opts.headers || {});
    return this._fetch(this.cfg.supabaseUrl + '/rest/v1/' + path, {
      method: opts.method || 'GET', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
  };
  SupabaseStore.prototype._rpc = function (fn, args, anon) {
    return this._rest('rpc/' + fn, { method: 'POST', body: args || {}, anon: !!anon });
  };
  SupabaseStore.prototype._auth = function (path, body) {
    return this._fetch(this.cfg.supabaseUrl + '/auth/v1/' + path, {
      method: 'POST', headers: this._headers(false), body: JSON.stringify(body || {})
    });
  };
  SupabaseStore.prototype._saveTokens = function (data) {
    if (!data || !data.access_token) return;
    this._sb = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (data.expires_in || 3600) * 1000,
      user_id: data.user && data.user.id,
      email: data.user && data.user.email
    };
    try { global.localStorage.setItem(SB_KEY, JSON.stringify(this._sb)); } catch (e) {}
  };
  SupabaseStore.prototype._clearTokens = function () {
    this._sb = null;
    try { global.localStorage.removeItem(SB_KEY); global.localStorage.removeItem('proveit_session'); } catch (e) {}
  };
  SupabaseStore.prototype._ensureToken = function () {
    var self = this;
    if (!this._sb || !this._sb.refresh_token) return Promise.resolve(false);
    if (this._sb.expires_at && this._sb.expires_at > Date.now() + 30000) return Promise.resolve(true);
    return this._auth('token?grant_type=refresh_token', { refresh_token: this._sb.refresh_token })
      .then(function (data) { self._saveTokens(data); return true; })
      .catch(function () { self._clearTokens(); return false; });
  };
  SupabaseStore.prototype._signOut = function () {
    var tok = this._sb && this._sb.access_token;
    this._clearTokens();
    this.sessionUserId = null;
    if (tok) {
      global.fetch(this.cfg.supabaseUrl + '/auth/v1/logout', {
        method: 'POST',
        headers: { 'apikey': this.cfg.supabaseAnonKey, 'Authorization': 'Bearer ' + tok }
      }).catch(function () {});
    }
    return Promise.resolve();
  };

  /* ----- row mapping (server shape -> dev Store shape) ----- */
  function mapCheckin(r) {
    return {
      id: r.id, userId: r.user_id, dateISO: r.date, statement: r.statement,
      proofType: r.proof_type, proofRef: r.proof_ref, status: r.status, createdAt: r.created_at
    };
  }
  function mapUser(profile, entRows, email) {
    var ent = { starter: false, mirror: false, mirrorUnlockISO: null, seasonWindow: false };
    (entRows || []).forEach(function (e) {
      if (e.product === 'starter') ent.starter = !!e.granted;
      if (e.product === 'mirror') { ent.mirror = !!e.granted; ent.mirrorUnlockISO = e.unlock_on; }
      if (e.season_window) ent.seasonWindow = true;
    });
    return {
      id: profile.id, role: profile.role, email: email || '',
      displayName: profile.display_name || '', boardOptIn: !!profile.board_opt_in,
      createdISO: (profile.created_at || '').slice(0, 10),
      entitlement: ent, programStartISO: profile.program_start,
      transactionId: profile.transaction_id || ''
    };
  }
  function mapCode(r) {
    return {
      code: r.code, status: r.status, seasonWindow: !!r.season_window,
      mirrorUnlockISO: r.mirror_unlock_on, createdISO: (r.created_at || '').slice(0, 10),
      redeemedBy: r.redeemed_by
    };
  }

  /* ----- hydration ----- */
  SupabaseStore.prototype._boot = function () {
    var self = this;
    return this._ensureToken().then(function () { return self._hydrate(); });
  };
  SupabaseStore.prototype._hydrate = function () {
    var self = this;
    this.db = { v: 1, codes: [], users: [], checkins: [], freeChecks: [] };
    this.sessionUserId = null;
    var chain = Promise.resolve();
    if (this._sb && this._sb.user_id) {
      chain = chain.then(function () { return self._hydrateSessionUser(); });
    }
    return chain.then(function () { return self._hydrateBoard(); }).then(function () {
      if (self.sessionUserId) {
        var me = self.session();
        if (me && me.role === 'admin') return self._hydrateAdmin();
      }
    });
  };
  SupabaseStore.prototype._hydrateSessionUser = function () {
    var self = this, uid = this._sb.user_id;
    return Promise.all([
      this._rest('profiles?id=eq.' + uid + '&select=*'),
      this._rest('entitlements?user_id=eq.' + uid + '&select=*'),
      this._rest('checkins?user_id=eq.' + uid + '&select=*&order=created_at.desc')
    ]).then(function (res) {
      var prof = res[0] && res[0][0];
      if (!prof) { self.sessionUserId = null; return null; }
      var user = mapUser(prof, res[1], self._sb.email);
      self.db.users = self.db.users.filter(function (u) { return u.id !== uid; });
      self.db.users.push(user);
      self.db.checkins = self.db.checkins.filter(function (c) { return c.userId !== uid; });
      (res[2] || []).forEach(function (r) { self.db.checkins.push(mapCheckin(r)); });
      self.sessionUserId = uid;
      try { global.localStorage.setItem('proveit_session', uid); } catch (e) {}
      return user;
    });
  };
  SupabaseStore.prototype._hydrateBoard = function () {
    var self = this;
    return Promise.all([
      this._rest('leaderboard?select=*', { anon: !this.sessionUserId }),
      this._rest('board_checkins?select=*', { anon: !this.sessionUserId }).catch(function () { return null; })
    ]).then(function (res) {
      var rows = res[0] || [], days = res[1];
      if (!days) { // view not created yet (production SQL pending): counts-only board
        self._boardFallback = rows;
        rows.forEach(function (r) {
          if (!self.userById(r.user_id)) {
            self.db.users.push({
              id: r.user_id, role: r.is_coach ? 'coach' : 'buyer', email: '',
              displayName: r.name || '', boardOptIn: true, createdISO: '',
              entitlement: null, programStartISO: null, transactionId: ''
            });
          }
        });
        return;
      }
      self._boardFallback = null;
      var byId = {};
      rows.forEach(function (r) { byId[r.user_id] = r; });
      rows.forEach(function (r) {
        if (!self.userById(r.user_id)) {
          self.db.users.push({
            id: r.user_id, role: r.is_coach ? 'coach' : 'buyer', email: '',
            displayName: r.name || '', boardOptIn: true, createdISO: '',
            entitlement: null, programStartISO: null, transactionId: ''
          });
        }
      });
      var mine = self.sessionUserId;
      days.forEach(function (d) {
        if (d.user_id === mine) return; // own real rows already hydrated
        if (!byId[d.user_id]) return;
        self.db.checkins.push({
          id: 'syn-' + d.user_id + '-' + d.date + '-' + d.status + '-' + Math.random().toString(36).slice(2, 7),
          userId: d.user_id, dateISO: d.date, statement: '', proofType: 'link',
          proofRef: '', status: d.status, createdAt: d.date + 'T00:00:00Z'
        });
      });
    }).catch(function () { /* board is best-effort at boot */ });
  };
  SupabaseStore.prototype._hydrateAdmin = function () {
    var self = this;
    return Promise.all([
      this._rest('profiles?select=*&order=created_at.asc'),
      this._rest('entitlements?select=*'),
      this._rest('checkins?select=*&order=created_at.desc&limit=300'),
      this._rest('codes?select=*&order=created_at.desc&limit=100')
    ]).then(function (res) {
      var entsByUser = {};
      (res[1] || []).forEach(function (e) { (entsByUser[e.user_id] = entsByUser[e.user_id] || []).push(e); });
      var seen = {};
      self.db.users.forEach(function (u) { seen[u.id] = u; });
      (res[0] || []).forEach(function (p) {
        var existing = seen[p.id];
        var mapped = mapUser(p, entsByUser[p.id], existing ? existing.email : '');
        if (existing) { Object.keys(mapped).forEach(function (k) { existing[k] = mapped[k]; }); }
        else self.db.users.push(mapped);
      });
      // Admin sees the real rows (statements included) for the review queue.
      self.db.checkins = (res[2] || []).map(mapCheckin);
      self.db.codes = (res[3] || []).map(mapCode);
      self._boardFallback = null;
    }).catch(function () { /* admin extras are best-effort */ });
  };

  /* ----- reads over the hydrated mirror (same as dev) ----- */
  SupabaseStore.prototype.userById = function (id) {
    return this.db.users.find(function (u) { return u.id === id; }) || null;
  };
  SupabaseStore.prototype.userByEmail = function (email) {
    email = (email || '').trim().toLowerCase();
    return this.db.users.find(function (u) { return (u.email || '') === email; }) || null;
  };
  SupabaseStore.prototype.session = function () {
    return this.sessionUserId ? this.userById(this.sessionUserId) : null;
  };
  SupabaseStore.prototype.checkinsFor = Store.prototype.checkinsFor;
  SupabaseStore.prototype.statsFor = Store.prototype.statsFor;
  SupabaseStore.prototype.exportEvidence = Store.prototype.exportEvidence;
  SupabaseStore.prototype.board = function (iso, window) {
    if (this._boardFallback) {
      var rows = this._boardFallback.map(function (r) {
        return {
          userId: r.user_id, name: r.name || '—', isCoach: !!r.is_coach,
          verifiedDays: r.verified_days || 0, streak: 0, proofPosts: r.proof_posts || 0
        };
      });
      rows.sort(function (a, b) {
        return (b.verifiedDays - a.verifiedDays) || (b.proofPosts - a.proofPosts) ||
               (a.name < b.name ? -1 : 1);
      });
      rows.forEach(function (r, i) { r.rank = i + 1; });
      return rows;
    }
    return PI.leaderboard(this.db.users, this.db.checkins, iso || PI.todayISO(), window || 'season');
  };

  /* ----- auth ----- */
  SupabaseStore.prototype.login = function (email, password) {
    var self = this;
    email = (email || '').trim().toLowerCase();
    if (!email || !password) return Promise.resolve({ ok: false, error: 'Email or password doesn\u2019t read. Try again.' });
    return this._auth('token?grant_type=password', { email: email, password: password })
      .then(function (data) {
        self._saveTokens(data);
        return self._hydrateSessionUser();
      })
      .then(function (user) {
        if (!user) {
          return self._signOut().then(function () {
            return { ok: false, error: 'That account has no books yet. Activate with your code first.' };
          });
        }
        return self._hydrateBoard().then(function () { return { ok: true, user: user }; });
      })
      .catch(function () { return { ok: false, error: 'Email or password doesn\u2019t read. Try again.' }; });
  };
  SupabaseStore.prototype.logout = function () { this._signOut(); };
  SupabaseStore.prototype.redeemCode = function (rawCode, email, password, todayISO) {
    var self = this;
    var code = PI.normalizeCode(rawCode);
    email = (email || '').trim().toLowerCase();
    if (!code) return Promise.resolve({ ok: false, error: 'That code doesn\u2019t read. Check it and try again.' });
    if (!email || !password) return Promise.resolve({ ok: false, error: 'Email and a password. That\u2019s the whole form.' });
    if (password.length < 8) return Promise.resolve({ ok: false, error: 'Code, email, and a password of 8+ characters. That\u2019s the whole form.' });
    return this._auth('signup', { email: email, password: password })
      .then(function (data) {
        // Raw GoTrue shape: a live session is flat (access_token at top).
        // Confirm-email is OFF, so NO access_token back means email taken.
        if (!data || !data.access_token) {
          throw new Error('That email already has an account. Log in instead.');
        }
        self._saveTokens(data);
        return self._rpc('redeem_claim', { p_code: code, p_today: todayISO });
      })
      .then(function () { return self._hydrateSessionUser(); })
      .then(function (user) {
        if (!user) throw new Error('Account setup failed. Your code is still good — try again.');
        return self._hydrateBoard().then(function () { return { ok: true, user: user }; });
      })
      .catch(function (err) {
        var msg = (err && err.message) || 'Account creation failed. Try again.';
        if (/already|registered/i.test(msg) && !/code/i.test(msg)) {
          msg = 'That email already has an account. Log in instead.';
        }
        return self._signOut().then(function () { return { ok: false, error: msg }; });
      });
  };

  /* ----- emergency fallback -----
     DEVIATION (named): a database function cannot mint a Supabase Auth
     session, so the production rescue link validates + burns the token
     server-side and completes through Auth email recovery (the buyer sets
     a fresh password from the emailed link and is back in). No fake
     sessions are ever created client-side. */
  SupabaseStore.prototype.mintRescueToken = function (userId) {
    return this._rpc('mint_rescue_token', { p_user_id: userId });
  };
  SupabaseStore.prototype.loginByRescueToken = function (token) {
    var self = this;
    return this._rpc('redeem_rescue_token', { p_token: token }, true)
      .then(function (r) {
        if (!r || !r.ok) throw new Error('That rescue link doesn\u2019t read. Ask for a fresh one.');
        return self._auth('recover', { email: r.email }).catch(function () { return null; })
          .then(function () {
            return { ok: false, error: 'That link checked out. A fresh sign-in email is on its way to ' + r.email + ' — set a new password from it and you\u2019re back in.' };
          });
      })
      .catch(function (err) { return { ok: false, error: (err && err.message) || 'That rescue link doesn\u2019t read. Ask for a fresh one.' }; });
  };

  /* ----- check-ins ----- */
  SupabaseStore.prototype.addCheckin = function (userId, data, todayISO) {
    var self = this;
    var u = this.userById(userId);
    if (!u) return Promise.resolve({ ok: false, error: 'No account.' });
    var statement = (data.statement || '').trim();
    if (!statement) return Promise.resolve({ ok: false, error: 'One line. What did you prove today? No line, no receipt.' });
    if (!data.proofRef) return Promise.resolve({ ok: false, error: 'Proof or it didn\u2019t happen — a photo or a link. Attach one.' });
    return this._ensureToken().then(function () {
      return self._rest('checkins', {
        method: 'POST',
        headers: { 'Prefer': 'return=representation' },
        body: {
          user_id: userId, date: todayISO, statement: statement,
          proof_type: data.proofType === 'photo' ? 'photo' : 'link', proof_ref: data.proofRef
        }
      });
    }).then(function (rows) {
      var rec = mapCheckin(rows[0]);
      self.db.checkins.push(rec);
      return { ok: true, checkin: rec };
    }).catch(function (err) { return { ok: false, error: (err && err.message) || 'Could not file that receipt. Try again.' }; });
  };
  SupabaseStore.prototype.reviewCheckin = function (checkinId, status) {
    var self = this;
    return this._rpc('review_checkin', { p_checkin_id: checkinId, p_status: status })
      .then(function () {
        var c = self.db.checkins.find(function (x) { return x.id === checkinId; });
        if (c) c.status = status;
        return { ok: true, checkin: c };
      })
      .catch(function () { return { ok: false }; });
  };

  /* ----- free front door ----- */
  SupabaseStore.prototype.addFreeCheck = function (statement, todayISO) {
    var self = this;
    var s = (statement || '').trim();
    if (!s) return Promise.resolve({ ok: false, error: 'Write the one thing. That\u2019s the whole check.' });
    return this._rest('free_checks', {
      method: 'POST', anon: true, body: { date: todayISO, statement: s }
    }).then(function () {
      var rec = { id: 'free-remote', dateISO: todayISO, statement: s, createdAt: new Date().toISOString() };
      self.db.freeChecks.push(rec);
      return { ok: true, freeCheck: rec };
    }).catch(function (err) { return { ok: false, error: (err && err.message) || 'Could not file that. Try again.' }; });
  };

  /* ----- account writes (write-through) ----- */
  SupabaseStore.prototype.save = function () {
    var u = this.session();
    if (!u) return Promise.resolve();
    return this._rest('profiles?id=eq.' + u.id, {
      method: 'PATCH',
      body: { display_name: u.displayName || '', board_opt_in: !!u.boardOptIn }
    }).catch(function () { /* mirror already updated; next hydrate reconciles */ });
  };
  SupabaseStore.prototype.setTransactionId = function (userId, txn) {
    var u = this.userById(userId);
    if (!u) return Promise.resolve({ ok: false });
    u.transactionId = txn;
    if (userId !== this.sessionUserId) return Promise.resolve({ ok: true });
    return this._rest('profiles?id=eq.' + userId, {
      method: 'PATCH', body: { transaction_id: txn }
    }).then(function () { return { ok: true }; }).catch(function () { return { ok: false }; });
  };

  /* ----- admin actions (RPC) ----- */
  SupabaseStore.prototype.mintCodes = function (n, opts) {
    var self = this;
    opts = opts || {};
    return this._rpc('mint_codes', { p_count: n, p_season_window: opts.seasonWindow !== false })
      .then(function (codes) {
        var made = (codes || []).map(function (code) {
          var rec = {
            code: code, status: 'unused', seasonWindow: opts.seasonWindow !== false,
            mirrorUnlockISO: PI.SEASON.mirrorUnlockISO,
            createdISO: opts.todayISO || PI.todayISO(), redeemedBy: null
          };
          self.db.codes.push(rec);
          return rec;
        });
        return made;
      });
  };
  SupabaseStore.prototype.revokeCode = function (code) {
    var self = this;
    return this._rpc('revoke_code', { p_code: PI.normalizeCode(code) })
      .then(function () {
        var rec = self.db.codes.find(function (c) { return c.code === PI.normalizeCode(code); });
        if (rec) rec.status = 'revoked';
        return { ok: true };
      }).catch(function () { return { ok: false }; });
  };
  SupabaseStore.prototype.setEntitlement = function (userId, patch) {
    var self = this;
    var jobs = [];
    ['starter', 'mirror'].forEach(function (prod) {
      if (Object.prototype.hasOwnProperty.call(patch, prod)) {
        jobs.push(self._rpc('set_entitlement', { p_user_id: userId, p_product: prod, p_granted: !!patch[prod] }));
      }
    });
    return Promise.all(jobs).then(function () {
      var u = self.userById(userId);
      if (u) u.entitlement = Object.assign({}, u.entitlement || {}, patch);
      return { ok: true, user: u };
    }).catch(function () { return { ok: false }; });
  };
  SupabaseStore.prototype.wipeDemoData = function () {
    var self = this;
    return this._rpc('wipe_demo_data', {}).then(function () { return self._hydrate(); });
  };

  var API = {
    Store: Store, LocalAdapter: LocalAdapter, MemoryAdapter: MemoryAdapter,
    seedDB: seedDB, SupabaseStore: SupabaseStore
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  global.PIStore = API;
})(typeof window !== 'undefined' ? window : globalThis);
