/* EventEase backend – zero dependencies. Run: node server.js
   Node is single-threaded and every rule below runs synchronously, so two phones/tabs can never
   slip past a check at the same time. Data is saved to data.json after every change. */
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const PORT = process.env.PORT || 3000, PIN = process.env.ORG_PIN || '1234';
const FILE = path.join(__dirname, 'data.json');

const seed = () => ({ seq: 1041, regs: [], events: [
  { id: 'e1', name: 'College Hackathon', desc: '24-hour build sprint. Teams of up to 4 ship a working prototype.', date: '2026-11-14T09:00', venue: 'College Auditorium', cap: 100, open: true },
  { id: 'e2', name: 'Cultural Fest', desc: 'Music, dance and art showcase from every department.', date: '2026-11-21T17:00', venue: 'Main Ground', cap: 200, open: true },
  { id: 'e3', name: 'Tiny Demo Day', desc: 'Only 2 seats – perfect for testing the "event full" rule.', date: '2026-11-28T11:00', venue: 'Seminar Hall B', cap: 2, open: true }] });

function persist() { const t = FILE + '.tmp'; fs.writeFileSync(t, JSON.stringify(db, null, 1)); fs.renameSync(t, FILE); }
let db; try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = seed(); persist(); }

const evOf = id => db.events.find(e => e.id === id);
const valid = id => db.regs.filter(r => r.eventId === id && r.status === 'valid');
const pub = e => ({ ...e, registered: valid(e.id).length, attended: db.regs.filter(r => r.eventId === e.id && r.checkedIn).length });

function register(f) {
  const name = String(f.name || '').trim().slice(0, 80), email = String(f.email || '').trim().toLowerCase().slice(0, 120),
        college = String(f.college || '').trim().slice(0, 120), e = evOf(f.eventId), errs = {};
  if (name.length < 2) errs.name = 'Enter your full name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) errs.email = 'Enter a valid email address.';
  if (college.length < 2) errs.college = 'Enter your college name.';
  if (!e) errs.eventId = 'Select an event.';
  if (Object.keys(errs).length) return { errs };
  if (!e.open) return { errs: { eventId: 'Registration for this event is closed.' } };
  if (valid(e.id).length >= e.cap) return { errs: { eventId: 'This event is full. No seats left.' } };
  if (valid(e.id).some(r => r.email === email)) return { errs: { email: 'This email is already registered for this event.' } };
  const reg = { id: 'ENTRY-' + (++db.seq), eventId: e.id, name, email, college, at: Date.now(), checkedIn: false, checkedAt: null, status: 'valid' };
  db.regs.push(reg); persist(); return { reg };
}

function checkIn(raw, evFilter) {
  const code = String(raw || '').trim().toUpperCase(), r = db.regs.find(x => x.id === code);
  if (!r) return { ok: false, title: 'Invalid code', msg: 'No registration found for this code.' };
  const e = evOf(r.eventId);
  if (r.checkedIn) return { ok: false, title: 'Already checked in', msg: 'Already checked in. This ticket has been used.', r, e };
  if (r.status !== 'valid' || !e) return { ok: false, title: 'Ticket not valid', msg: 'Invalid or cancelled ticket.', r, e };
  if (evFilter && r.eventId !== evFilter) return { ok: false, title: 'Wrong event', msg: 'This ticket is for ' + e.name + '.', r, e };
  if (pub(e).attended >= e.cap) return { ok: false, title: 'Capacity reached', msg: 'Event attendance is at capacity.', r, e };
  r.checkedIn = true; r.checkedAt = Date.now(); persist();
  return { ok: true, title: 'Accepted', msg: 'Check-in successful! Welcome to the event.', r, e };
}

function api(m, u, b, isOrg) {
  const p = u.pathname.slice(5).split('/').map(decodeURIComponent);
  // ---- public (participants) ----
  if (m === 'GET' && p[0] === 'events') return [200, { events: db.events.map(pub) }];
  if (m === 'POST' && p[0] === 'register') return [200, register(b)];
  if (m === 'GET' && p[0] === 'ticket') { const r = db.regs.find(x => x.id === String(p[1]).toUpperCase()); return r ? [200, { reg: r, event: evOf(r.eventId) }] : [404, { error: 'Ticket not found' }]; }
  if (m === 'GET' && p[0] === 'mine') { const em = String(u.searchParams.get('email') || '').trim().toLowerCase(); return [200, { regs: em ? db.regs.filter(r => r.email === em) : [] }]; }
  // ---- organizer only (x-pin header) ----
  if (!isOrg) return [401, { error: 'Organizer PIN required' }];
  if (p[0] === 'auth') return [200, { ok: true }];
  if (m === 'GET' && p[0] === 'regs') return [200, { regs: db.regs }];
  if (m === 'POST' && p[0] === 'events' && !p[1]) {
    const errs = {}, cap = Math.floor(+b.cap);
    if (String(b.name || '').trim().length < 3) errs.name = 'Enter an event name.';
    if (!b.date) errs.date = 'Pick a date and time.';
    if (!String(b.venue || '').trim()) errs.venue = 'Enter a venue.';
    if (!(cap >= 1 && cap <= 100000)) errs.cap = 'Capacity must be at least 1.';
    if (Object.keys(errs).length) return [200, { errs }];
    const e = { id: 'e' + Date.now(), name: b.name.trim().slice(0, 100), desc: String(b.desc || '').trim().slice(0, 500), date: b.date, venue: b.venue.trim().slice(0, 100), cap, open: true };
    db.events.push(e); persist(); return [200, { event: pub(e) }];
  }
  if (m === 'POST' && p[0] === 'events' && p[2] === 'toggle') { const e = evOf(p[1]); if (!e) return [404, { error: 'No such event' }]; e.open = !e.open; persist(); return [200, { event: pub(e) }]; }
  if (m === 'POST' && p[0] === 'regs' && p[2] === 'cancel') {
    const r = db.regs.find(x => x.id === p[1]); if (!r) return [404, { error: 'No such registration' }];
    if (r.checkedIn) return [200, { error: 'Already checked in – cannot cancel.' }];
    r.status = 'cancelled'; persist(); return [200, { reg: r }];
  }
  if (m === 'POST' && p[0] === 'checkin') return [200, checkIn(b.code, b.eventId)];
  if (m === 'POST' && p[0] === 'reset') { db = seed(); persist(); return [200, { ok: true }]; }
  return [404, { error: 'Not found' }];
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let body = '';
  req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
  req.on('end', () => {
    if (!u.pathname.startsWith('/api/')) {
      if (u.pathname === '/' || u.pathname === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }
      res.writeHead(404); return res.end('Not found');
    }
    let b = {}; try { b = body ? JSON.parse(body) : {}; } catch { b = null; }
    let out = [400, { error: 'Bad request' }];
    if (b) try { out = api(req.method, u, b, req.headers['x-pin'] === PIN); } catch (e) { console.error(e); out = [500, { error: 'Server error' }]; }
    res.writeHead(out[0], { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(out[1]));
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`\nEventEase running – organizer PIN: ${PIN}\n  This computer:  http://localhost:${PORT}`);
  for (const l of Object.values(os.networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`  Phones on same Wi-Fi:  http://${l.address}:${PORT}`);
});
