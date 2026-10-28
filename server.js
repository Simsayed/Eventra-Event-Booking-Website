require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');
const path = require('path');

const PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
if (PROD && !process.env.JWT_SECRET) throw new Error('Set JWT_SECRET in production');
const DOMAINS = ['nmamit.in', 'nitte.edu.in'];

const db = new Database(process.env.DB_PATH || 'eventra.db');
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, hash TEXT NOT NULL,
  verified INTEGER DEFAULT 0, code TEXT, code_exp INTEGER);
CREATE TABLE IF NOT EXISTS venues(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, capacity INTEGER);
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  venue_id INTEGER NOT NULL REFERENCES venues(id), title TEXT NOT NULL, description TEXT,
  date TEXT NOT NULL, start TEXT NOT NULL, end TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_b ON bookings(venue_id, date);`);
// Placeholder venues: edit this list to match the real campus spaces.
const seed = db.prepare('INSERT OR IGNORE INTO venues(name,capacity) VALUES(?,?)');
[['Main Auditorium', 800], ['Seminar Hall', 200], ['Conference Room', 40],
 ['Open Air Theatre', 500], ['Sports Ground', 1000], ['Computer Lab', 60]].forEach(v => seed.run(...v));

const mailer = process.env.SMTP_HOST && nodemailer.createTransport({
  host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
async function sendCode(email, code) {
  if (!mailer) return console.log(`[dev] verification code for ${email}: ${code}`);
  await mailer.sendMail({ from: process.env.SMTP_USER, to: email, subject: 'Your Eventra code',
    text: `Your Eventra verification code is ${code}. It expires in 10 minutes.` });
}

const app = express();
app.use(express.json());
app.use('/api/register', rateLimit({ windowMs: 15 * 60e3, max: 20 }));
app.use('/api/login', rateLimit({ windowMs: 15 * 60e3, max: 30 }));
app.use('/api/verify', rateLimit({ windowMs: 15 * 60e3, max: 30 }));

const token = u => jwt.sign({ id: u.id, name: u.name, email: u.email }, SECRET, { expiresIn: '7d' });
const auth = (req, res, next) => {
  try { req.user = jwt.verify((req.headers.authorization || '').replace('Bearer ', ''), SECRET); next(); }
  catch { res.status(401).json({ error: 'Please log in again.' }); }
};
const okDomain = e => DOMAINS.includes(String(e).toLowerCase().split('@')[1]);
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

app.post('/api/register', async (req, res) => {
  const { name, password } = req.body; const email = String(req.body.email || '').trim().toLowerCase();
  if (!name || !okDomain(email)) return res.status(400).json({ error: 'Use your @nmamit.in or @nitte.edu.in email.' });
  if (!password || password.length < 8) return res.status(400).json({ error: 'Password needs at least 8 characters.' });
  const ex = db.prepare('SELECT verified FROM users WHERE email=?').get(email);
  if (ex && ex.verified) return res.status(409).json({ error: 'This email is already registered. Log in instead.' });
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const hash = bcrypt.hashSync(password, 10), exp = Date.now() + 10 * 60e3;
  if (ex) db.prepare('UPDATE users SET name=?,hash=?,code=?,code_exp=? WHERE email=?').run(name, hash, code, exp, email);
  else db.prepare('INSERT INTO users(name,email,hash,code,code_exp) VALUES(?,?,?,?,?)').run(name, email, hash, code, exp);
  try { await sendCode(email, code); } catch (e) { console.error(e); return res.status(500).json({ error: 'Could not send the code. Try again.' }); }
  res.json({ ok: true, ...(!PROD && !mailer ? { devCode: code } : {}) });
});

app.post('/api/verify', (req, res) => {
  const email = String(req.body.email || '').toLowerCase();
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (!u || u.code !== String(req.body.code) || u.code_exp < Date.now()) return res.status(400).json({ error: 'That code is wrong or expired.' });
  db.prepare('UPDATE users SET verified=1, code=NULL WHERE id=?').run(u.id);
  res.json({ token: token(u), user: { name: u.name, email: u.email } });
});

app.post('/api/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(req.body.email || '').toLowerCase());
  if (!u || !bcrypt.compareSync(String(req.body.password || ''), u.hash)) return res.status(401).json({ error: 'Email or password is incorrect.' });
  if (!u.verified) return res.status(403).json({ error: 'Verify your email first. Register again to get a new code.' });
  res.json({ token: token(u), user: { name: u.name, email: u.email } });
});

app.get('/api/venues', auth, (_, res) => res.json(db.prepare('SELECT * FROM venues ORDER BY name').all()));

app.get('/api/bookings', auth, (req, res) => {
  const m = /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : today().slice(0, 7);
  res.json(db.prepare(`SELECT b.id,b.title,b.description,b.date,b.start,b.end,b.venue_id,v.name venue,u.name host,
      (b.user_id=?) mine FROM bookings b JOIN venues v ON v.id=b.venue_id JOIN users u ON u.id=b.user_id
      WHERE b.date LIKE ? ORDER BY b.date,b.start`).all(req.user.id, m + '-%'));
});

app.post('/api/bookings', auth, (req, res) => {
  const { venue_id, title, description, date, start, end } = req.body;
  if (!venue_id || !title || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end))
    return res.status(400).json({ error: 'Fill in venue, title, date and times.' });
  if (date < today()) return res.status(400).json({ error: 'Pick today or a future date.' });
  if (start >= end) return res.status(400).json({ error: 'End time must be after start time.' });
  if (!db.prepare('SELECT 1 FROM venues WHERE id=?').get(venue_id)) return res.status(400).json({ error: 'Unknown venue.' });
  const insert = db.transaction(() => {
    const clash = db.prepare('SELECT title,start,end FROM bookings WHERE venue_id=? AND date=? AND start<? AND end>?').get(venue_id, date, end, start);
    if (clash) return { clash };
    return { id: db.prepare('INSERT INTO bookings(user_id,venue_id,title,description,date,start,end) VALUES(?,?,?,?,?,?,?)')
      .run(req.user.id, venue_id, title.trim().slice(0, 120), (description || '').slice(0, 500), date, start, end).lastInsertRowid };
  });
  const r = insert();
  if (r.clash) return res.status(409).json({ error: `Already booked: "${r.clash.title}" ${r.clash.start}–${r.clash.end}.` });
  res.status(201).json({ id: r.id });
});

app.delete('/api/bookings/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM bookings WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  r.changes ? res.json({ ok: true }) : res.status(404).json({ error: 'Booking not found, or it is not yours.' });
});

app.use(express.static(path.join(__dirname, 'public')));
app.listen(process.env.PORT || 3000, () => console.log('Eventra running on port ' + (process.env.PORT || 3000)));
