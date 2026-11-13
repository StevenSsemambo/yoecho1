// ── Scheduled every minute (see netlify.toml): sends due reminders and the occasional caring check-in ──
const L = require("./_push-lib");

const MORNING = ["Good morning, {n}. I hope today is gentle with you.", "Morning, {n}. Whatever today holds, you're not carrying it alone.", "Hi {n} — a new day. How are you waking up?"];
const MIDDAY = ["Hey {n}, just thinking of you. How's your day going so far?", "A small pause for you, {n}. Have you eaten and had some water?", "Hi {n}. If anything's on your mind today, I'm here."];
const EVENING = ["Hi {n}. How was your day? I'm here if you want to talk about it.", "Evening, {n}. You made it through today — want to tell me about it?", "Thinking of you tonight, {n}. How are you really feeling?"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const GAP = { daily: 20 * 3600e3, few: 44 * 3600e3, weekly: 6.5 * 86400e3 };

exports.handler = async () => {
  const now = new Date(), out = { reminders: 0, checkins: 0, errors: 0, noDevice: 0, failed: 0 }, log = [];
  try {
    const subs = await L.sb("push_subs?select=*&limit=2000") || [];
    const byProfile = {}; subs.forEach((s) => { (byProfile[s.profile_id] = byProfile[s.profile_id] || []).push(s); });
    const drop = async (s) => { try { await L.sb(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE" }); } catch (e) {} };

    // 1. reminders that are due (anything older than a day is skipped so old items never fire late at night)
    const dayAgo = new Date(now - 86400e3).toISOString();
    const due = await L.sb(`reminders?done=eq.false&notified_at=is.null&due_at=lte.${encodeURIComponent(now.toISOString())}&due_at=gte.${encodeURIComponent(dayAgo)}&select=*&limit=200`) || [];
    for (const r of due) {
      const mine = byProfile[r.profile_id] || []; if (!mine.length) { out.noDevice++; continue; }
      let sent = false;
      for (const s of mine) {
        try {
          const res = await L.sendPush(s, { kind: "reminder", id: r.id, title: "Reminder", body: r.title, tag: "rem-" + r.id }, { ttl: 6 * 3600, urgency: "high" });
          log.push({ kind: "reminder", profile_id: r.profile_id, ref: r.id, ok: !!res.ok, status: res.status, detail: res.gone ? "subscription gone" : null });
          if (res.ok) sent = true; else if (res.gone) await drop(s);
        } catch (e) { out.errors++; log.push({ kind: "reminder", profile_id: r.profile_id, ref: r.id, ok: false, status: 0, detail: String(e.message).slice(0, 160) }); }
      }
      if (!sent) { out.failed++; continue; }
      out.reminders++;
      if (r.repeat && r.repeat !== "none") await L.sb(`reminders?id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ due_at: L.nextDue(new Date(r.due_at), r.repeat, r.tz).toISOString() }) });
      else await L.sb(`reminders?id=eq.${encodeURIComponent(r.id)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ notified_at: now.toISOString() }) });
    }

    // 2. check-ins: opt-in, daytime only in the person's own time zone, spaced out, and never when they were just here
    for (const s of subs) {
      const p = s.prefs || {}, mode = p.checkins === undefined ? "few" : p.checkins, gap = GAP[mode]; if (!gap) continue;   // older records without a choice get the default; only an explicit "off" silences them
      const z = L.zoneParts(now, L.safeTz(s.tz)), startH = Math.min(14, Math.max(9, p.hour || 11));   // the daytime window always spans at least 7 hours (it used to shrink to 4 for people whose random hour was 17)
      if (z.h < startH || z.h >= 21) continue;
      const sinceCk = s.last_checkin ? now - new Date(s.last_checkin) : Infinity;
      if (sinceCk < gap) continue;
      // not right after they were here, unless a check-in is well overdue (someone who opens the app often would otherwise never get one)
      if (s.last_seen && now - new Date(s.last_seen) < 3 * 3600e3 && sinceCk < gap * 1.6) continue;
      const name = (p.name || "").trim() || "friend", pool = z.h < 11 ? MORNING : z.h < 17 ? MIDDAY : EVENING;
      try {
        const res = await L.sendPush(s, { kind: "checkin", title: "YoEcho", body: pick(pool).replace("{n}", name), tag: "checkin" }, { ttl: 4 * 3600, urgency: "low" });
        log.push({ kind: "checkin", profile_id: s.profile_id, ok: !!res.ok, status: res.status, detail: res.gone ? "subscription gone" : null });
        if (res.gone) { await drop(s); continue; }
        if (res.ok) { out.checkins++; await L.sb(`push_subs?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ last_checkin: now.toISOString() }) }); }
      } catch (e) { out.errors++; }
    }
  } catch (e) { console.error("[push-cron]", e.message); out.error = e.message; }
  await L.logPush(log);
  if (now.getUTCMinutes() === 7) { try { await L.sb(`push_log?ts=lt.${encodeURIComponent(new Date(now - 7 * 86400e3).toISOString())}`, { method: "DELETE" }); } catch (e) {} }   // keep a week of history
  console.log("[push-cron]", JSON.stringify(out));
  return { statusCode: 200, body: JSON.stringify(out) };
};
