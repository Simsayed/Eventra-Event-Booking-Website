'use strict';
const $ = s => document.querySelector(s);
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; // local date, no UTC shift
const state = { token: localStorage.getItem('eventra_token'), user: JSON.parse(localStorage.getItem('eventra_user') || 'null'),
  month: new Date(), selected: ymd(new Date()), bookings: [], venues: [], pendingEmail: '' };
state.month.setDate(1);

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, { method,
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: 'Bearer ' + state.token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token) { logout(); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}
const say = (el, text, ok) => { el.textContent = text; el.classList.toggle('ok', !!ok); };
const form = f => Object.fromEntries(new FormData(f));

/* ---------- Auth ---------- */
document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
  ['loginF', 'registerF', 'verifyF'].forEach(id => $('#' + id).hidden = id !== b.dataset.tab);
  say($('#amsg'), '');
});
function session(r) {
  state.token = r.token; state.user = r.user;
  localStorage.setItem('eventra_token', r.token); localStorage.setItem('eventra_user', JSON.stringify(r.user));
  start();
}
$('#loginF').onsubmit = async e => { e.preventDefault();
  try { session(await api('/login', 'POST', form(e.target))); } catch (err) { say($('#amsg'), err.message); } };
$('#registerF').onsubmit = async e => { e.preventDefault();
  try {
    const d = form(e.target), r = await api('/register', 'POST', d);
    state.pendingEmail = d.email; $('#vmail').textContent = d.email;
    $('#registerF').hidden = true; $('#verifyF').hidden = false; document.querySelector('.tabs').hidden = true;
    say($('#amsg'), r.devCode ? `Dev mode: your code is ${r.devCode}` : 'Check your inbox for the code.', true);
  } catch (err) { say($('#amsg'), err.message); } };
$('#verifyF').onsubmit = async e => { e.preventDefault();
  try { session(await api('/verify', 'POST', { email: state.pendingEmail, code: form(e.target).code })); }
  catch (err) { say($('#amsg'), err.message); } };
function logout() {
  state.token = state.user = null; localStorage.removeItem('eventra_token'); localStorage.removeItem('eventra_user'); location.reload();
}
$('#logout').onclick = logout;

/* ---------- App ---------- */
async function start() {
  if (!state.token) return;
  $('#auth').hidden = true; $('#app').hidden = false; $('#who').hidden = false; $('#uname').textContent = state.user.name;
  state.venues = await api('/venues');
  const opts = state.venues.map(v => `<option value="${v.id}">${v.name} (${v.capacity})</option>`).join('');
  $('#bvenue').innerHTML = opts;
  $('#vfilter').innerHTML = '<option value="">All venues</option>' + opts;
  $('#bdate').min = ymd(new Date()); $('#bdate').value = state.selected;
  load();
}
async function load() {
  const m = `${state.month.getFullYear()}-${pad(state.month.getMonth() + 1)}`;
  try { state.bookings = await api('/bookings?month=' + m); } catch (e) { state.bookings = []; }
  render();
}
const visible = () => { const v = $('#vfilter').value; return state.bookings.filter(b => !v || b.venue_id == v); };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render() {
  const y = state.month.getFullYear(), m = state.month.getMonth();
  $('#mlabel').textContent = state.month.toLocaleString('en-IN', { month: 'long', year: 'numeric' });
  const first = new Date(y, m, 1).getDay(), days = new Date(y, m + 1, 0).getDate(), todayS = ymd(new Date());
  let h = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('');
  for (let i = 0; i < first; i++) h += '<div class="cell blank"></div>';
  const list = visible();
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${pad(m + 1)}-${pad(d)}`, bs = list.filter(b => b.date === date);
    h += `<button class="cell${date === todayS ? ' today' : ''}${date === state.selected ? ' sel' : ''}${date < todayS ? ' past' : ''}" data-date="${date}">
      <span class="n">${d}</span>${bs.slice(0, 2).map(b => `<span class="bar${b.mine ? ' mine' : ''}">${b.start} ${esc(b.title)}</span>`).join('')}
      ${bs.length > 2 ? `<span class="more">+${bs.length - 2} more</span>` : ''}</button>`;
  }
  $('#grid').innerHTML = h;
  document.querySelectorAll('.cell[data-date]').forEach(c => c.onclick = () => {
    state.selected = c.dataset.date; $('#bdate').value = state.selected; render(); });
  renderDay(list);
}
function renderDay(list) {
  const day = new Date(state.selected + 'T00:00');
  $('#dlabel').textContent = day.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const bs = list.filter(b => b.date === state.selected);
  $('#dlist').innerHTML = bs.length ? bs.map(b => `<li class="${b.mine ? 'mine' : ''}"><b>${esc(b.title)}</b>
    <small>${b.start}–${b.end} · ${esc(b.venue)} · ${esc(b.host)}</small>${b.description ? `<div>${esc(b.description)}</div>` : ''}
    ${b.mine ? `<button data-id="${b.id}">Cancel booking</button>` : ''}</li>`).join('')
    : '<li class="empty">Nothing booked. This day is open.</li>';
  document.querySelectorAll('.dlist button').forEach(btn => btn.onclick = async () => {
    if (!confirm('Cancel this booking?')) return;
    try { await api('/bookings/' + btn.dataset.id, 'DELETE'); load(); } catch (e) { alert(e.message); } });
}

$('#prev').onclick = () => { state.month.setMonth(state.month.getMonth() - 1); load(); };
$('#next').onclick = () => { state.month.setMonth(state.month.getMonth() + 1); load(); };
$('#vfilter').onchange = render;
$('#bookF').onsubmit = async e => { e.preventDefault();
  const d = form(e.target), msg = $('#bmsg');
  try {
    await api('/bookings', 'POST', d);
    say(msg, 'Booked. It now shows on the shared calendar.', true);
    state.selected = d.date; state.month = new Date(d.date + 'T00:00'); state.month.setDate(1);
    e.target.title.value = e.target.description.value = ''; load();
  } catch (err) { say(msg, err.message); } };

start();
