/* PROVE IT — core logic. Pure functions, no DOM, no storage.
   Runs in the browser (window.PI) and in node for tests (module.exports).
   THE THREE CLOCKS live here and are computed from dates, never typed:
     1) Season clock  — Coach's Day counts UP; days to Jan 1 count DOWN.
     2) Buyer clock   — each buyer's own 56-day receipts window from THEIR start.
     3) Mirror clock  — entitlement date for season-window purchases.
   They are never merged. */
(function (global) {
  'use strict';

  var SEASON = {
    startISO: '2026-11-12',        // Day 1 of 50
    endISO: '2027-01-01',          // season closes Jan 1, 2027
    coachAnchorISO: '2026-11-12',  // Coach's Day # on season start
    coachAnchorDay: 1290,          // Day 1,290 on Nov 12, 2026 (locked record)
    mirrorUnlockISO: '2026-12-31', // season-window buyers: Mirror free Dec 31
    clauseDays: 56,                // 28 Starter + 28 Mirror, back to back
    clauseRefund: 9.50,
    starterPrice: 19
  };

  /* ---------- date helpers (all UTC, date-only) ---------- */
  function parseISO(iso) {
    var p = iso.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]);
  }
  function toISO(date) {
    var d = new Date(date);
    var m = '' + (d.getUTCMonth() + 1), day = '' + d.getUTCDate();
    if (m.length < 2) m = '0' + m;
    if (day.length < 2) day = '0' + day;
    return d.getUTCFullYear() + '-' + m + '-' + day;
  }
  function todayISO(now) {
    return toISO(now ? now.getTime() : Date.now());
  }
  function diffDays(fromISO, toISO_) {
    return Math.round((parseISO(toISO_) - parseISO(fromISO)) / 86400000);
  }
  function addDays(iso, n) {
    return toISO(parseISO(iso) + n * 86400000);
  }
  function mondayOf(iso) {
    var dow = new Date(parseISO(iso)).getUTCDay(); // 0=Sun
    var back = (dow + 6) % 7;                       // days since Monday
    return addDays(iso, -back);
  }

  /* ---------- CLOCK 1: the season ---------- */
  function coachDayOn(iso) {
    return SEASON.coachAnchorDay + diffDays(SEASON.coachAnchorISO, iso);
  }
  function seasonDayOn(iso) { // 1..50 inside the season, else null
    var n = diffDays(SEASON.startISO, iso) + 1;
    return (n >= 1 && n <= 50) ? n : null;
  }
  function daysToJan1(iso) {
    return Math.max(0, diffDays(iso, SEASON.endISO));
  }

  /* ---------- CLOCK 2: the buyer's own 56 days ---------- */
  function buyerProgramDay(startISO, iso) {
    if (!startISO) return null;
    var n = diffDays(startISO, iso) + 1;
    return n < 1 ? null : n; // day 1 = their start date
  }
  function buyerWindowEnd(startISO) {
    return startISO ? addDays(startISO, SEASON.clauseDays - 1) : null;
  }
  function buyerPhase(startISO, iso) {
    var d = buyerProgramDay(startISO, iso);
    if (d === null) return 'not-started';
    if (d <= 28) return 'starter';
    if (d <= SEASON.clauseDays) return 'mirror';
    return 'finished';
  }

  /* ---------- CLOCK 3: the Mirror entitlement ---------- */
  function mirrorUnlocked(entitlement, iso) {
    if (!entitlement || !entitlement.mirror) return false;
    return diffDays(entitlement.mirrorUnlockISO || SEASON.mirrorUnlockISO, iso) >= 0;
  }
  function daysToMirror(entitlement, iso) {
    if (!entitlement || !entitlement.mirror) return null;
    return Math.max(0, diffDays(iso, entitlement.mirrorUnlockISO || SEASON.mirrorUnlockISO));
  }

  /* ---------- proof stats (one scored day per date, max) ---------- */
  function provenDates(checkins, userId, statusWanted) {
    var set = {};
    (checkins || []).forEach(function (c) {
      if (c.userId !== userId) return;
      if (statusWanted && c.status !== statusWanted) return;
      set[c.dateISO] = true; // one scored day per date, however many posts
    });
    return Object.keys(set).sort();
  }
  function currentStreak(dates, iso) {
    if (!dates.length) return 0;
    var sorted = dates.slice().sort();
    var last = sorted[sorted.length - 1];
    // streak is alive if the last proven day is today or yesterday
    if (diffDays(last, iso) > 1) return 0;
    var streak = 1;
    for (var i = sorted.length - 1; i > 0; i--) {
      if (diffDays(sorted[i - 1], sorted[i]) === 1) streak++;
      else break;
    }
    return streak;
  }
  function bestStreak(dates) {
    var sorted = dates.slice().sort(), best = 0, run = 0, prev = null;
    sorted.forEach(function (d) {
      run = (prev && diffDays(prev, d) === 1) ? run + 1 : 1;
      if (run > best) best = run;
      prev = d;
    });
    return best;
  }
  function userStats(checkins, userId, iso) {
    var verified = provenDates(checkins, userId, 'verified');
    var all = provenDates(checkins, userId, null);
    var posts = (checkins || []).filter(function (c) { return c.userId === userId; }).length;
    return {
      verifiedDays: verified.length,
      lifetimeDays: all.length,       // kept separate from streak, always
      streak: currentStreak(verified, iso),
      bestStreak: bestStreak(verified),
      proofPosts: posts
    };
  }

  /* ---------- leaderboard (proof-only ranking) ---------- */
  // Rank: verified days first, current streak second, proof posts third.
  // Never miles, never weight. Same math for Coach as for any buyer.
  function leaderboard(users, checkins, iso, window) {
    var from = window === 'week' ? mondayOf(iso) : null;
    var rows = (users || []).filter(function (u) {
      return (u.role === 'buyer' || u.role === 'coach') && u.boardOptIn;
    }).map(function (u) {
      var scoped = (checkins || []).filter(function (c) {
        return !from || diffDays(from, c.dateISO) >= 0;
      });
      var s = userStats(scoped, u.id, iso);
      return {
        userId: u.id,
        name: u.displayName || '—',
        isCoach: u.role === 'coach',
        verifiedDays: s.verifiedDays,
        streak: s.streak,
        proofPosts: s.proofPosts
      };
    });
    rows.sort(function (a, b) {
      return (b.verifiedDays - a.verifiedDays) ||
             (b.streak - a.streak) ||
             (b.proofPosts - a.proofPosts) ||
             (a.name < b.name ? -1 : 1);
    });
    rows.forEach(function (r, i) { r.rank = i + 1; });
    return rows;
  }

  /* ---------- redemption codes ---------- */
  var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes
  function makeCode(rand) {
    rand = rand || Math.random;
    function block() {
      var s = '';
      for (var i = 0; i < 4; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
      return s;
    }
    return 'PROVE-' + block() + '-' + block();
  }
  function normalizeCode(raw) {
    return (raw || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  var PI = {
    SEASON: SEASON,
    parseISO: parseISO, toISO: toISO, todayISO: todayISO,
    diffDays: diffDays, addDays: addDays, mondayOf: mondayOf,
    coachDayOn: coachDayOn, seasonDayOn: seasonDayOn, daysToJan1: daysToJan1,
    buyerProgramDay: buyerProgramDay, buyerWindowEnd: buyerWindowEnd, buyerPhase: buyerPhase,
    mirrorUnlocked: mirrorUnlocked, daysToMirror: daysToMirror,
    provenDates: provenDates, currentStreak: currentStreak, bestStreak: bestStreak,
    userStats: userStats, leaderboard: leaderboard,
    makeCode: makeCode, normalizeCode: normalizeCode
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PI;
  global.PI = PI;
})(typeof window !== 'undefined' ? window : globalThis);
