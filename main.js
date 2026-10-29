import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, setPersistence, browserLocalPersistence, browserSessionPersistence, sendEmailVerification, sendPasswordResetEmail, reauthenticateWithCredential, EmailAuthProvider, deleteUser, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getDatabase, ref, set, get, push, update, remove, onValue, query, orderByChild, equalTo, limitToLast, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { PRIVACY_CONTACT, POLICY_UPDATED, COOKIE_NOTICE_KEY, LEGAL_HASHES, LEGAL_PAGES } from './legal-content.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);

const DEFAULT_STATE = {
  v: 2,
  loggedIn: false,
  currentUser: { name: 'Me', email: '', username: '@me' },
  users: { me: { name: 'Me', email: '', username: '@me' } },
  posts: [],
  conversations: {},
  alerts: [],
  activeChat: null,
  activeView: 'home'
};

const state = loadState();
const authEl = document.getElementById('auth');
const appEl = document.getElementById('app');
const splash = document.getElementById('splash');
const authError = document.getElementById('authError');

let demoMode = false;
function saveState() {
  if (demoMode) return;
  localStorage.setItem('murmur-demo-state', JSON.stringify(state));
}

function loadState() {
  const fresh = () => JSON.parse(JSON.stringify(DEFAULT_STATE));
  try {
    const old = JSON.parse(localStorage.getItem('murmur-demo-state') || 'null');
    if (!old) return fresh();
    const st = fresh();
    st.loggedIn = !!old.loggedIn;
    st.activeView = old.activeView || 'home';
    if (old.currentUser && old.currentUser.uid) { st.currentUser = old.currentUser; st.users.me = { ...old.currentUser }; }
    if (old.v === 2) st.posts = old.posts || [];
    return st;
  } catch { return fresh(); }
}

function initials(name) {
  return (name || 'M').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || 'M';
}

function showToast(message) {
  const toast = document.createElement('div');
  toast.textContent = message;
  toast.style.position = 'fixed';
  toast.style.bottom = '24px';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(20,33,61,0.88)';
  toast.style.color = '#fff';
  toast.style.padding = '10px 14px';
  toast.style.borderRadius = '999px';
  toast.style.zIndex = '300';
  toast.style.fontWeight = '700';
  toast.style.fontSize = '0.9rem';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

function showAuth() {
  authEl.hidden = false;
  appEl.hidden = true;
  document.getElementById('email').focus();
  authError.textContent = '';
}

function showApp() {
  authEl.hidden = true;
  appEl.hidden = false;
  renderAll();
}

function getCurrentUserName() {
  return state.currentUser?.name || 'Maya Chen';
}

function getUserById(id) {
  return state.users[id] || { name: 'Someone', email: '', username: '@someone' };
}

const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let remotePosts = null, unsubPosts = null, feedLoading = false;

function startPostsListener() {
  if (unsubPosts) return;
  const q = query(ref(db, 'posts'), orderByChild('createdAt'), limitToLast(50));
  feedLoading = true; renderPosts();
  unsubPosts = onValue(q, snap => {
    feedLoading = false;
    const v = snap.val() || {};
    Object.values(v).forEach(p => watchPhoto(p.authorUid));
    remotePosts = Object.entries(v).map(([id, p]) => ({ id, ...p })).sort((a, b) => (b.createdAt || Date.now()) - (a.createdAt || Date.now()));
    renderPosts();
  }, err => {
    console.warn('Shared posts unavailable (check Realtime Database rules):', err);
    feedLoading = false; remotePosts = null; unsubPosts = null; renderPosts();
  });
}
    function stopPostsListener() { if (unsubPosts) unsubPosts(); unsubPosts = null; remotePosts = null; }

function renderPosts() {
  const postsEl = document.getElementById('posts');
  postsEl.innerHTML = '';
  if (feedLoading && !remotePosts && !demoMode) { postsEl.innerHTML = '<div class="skeleton-post"><i></i><b></b><b></b></div>'.repeat(3); return; }
  const uid = meUid();
  const list = remotePosts
    ? remotePosts.map(p => ({ id: p.id, name: p.authorName || 'Someone', username: p.authorUsername || '', text: p.text || '', likes: Object.keys(p.likes || {}).length, liked: !!uid && !!(p.likes || {})[uid], mine: p.authorUid === uid, uid: p.authorUid, time: p.createdAt, remote: true }))
    : state.posts.map(p => { const a = getUserById(p.author); return { id: p.id, name: a.name, username: a.username || '@user', text: p.text, likes: p.likes, liked: p.liked, mine: false, remote: false }; });
  if (!list.length) { postsEl.innerHTML = '<div class="empty empty-rich"><span>✨</span><strong>Nothing here yet</strong>Be the first to share something with your friends.</div>'; return; }
  list.forEach(p => {
    const card = document.createElement('article');
    card.className = 'post';
    card.innerHTML = `
      <div class="post-head">${p.uid ? `<button type="button" class="person-link" data-profile="${esc(p.uid)}">` : '<div class="meta">'}
        ${avatarHtml(p.uid, p.name)}
        <div style="text-align:left"><strong>${esc(p.name)}</strong><br /><small>${esc(p.username)}${p.time ? ' · ' + timeAgo(p.time) : ''}</small></div>
      ${p.uid ? '</button>' : '</div>'}</div>
      <p>${esc(p.text)}</p>
      <div class="post-actions">
        <button class="${p.liked ? 'active' : ''}" data-like="${esc(p.id)}" type="button">♡ ${p.likes}</button>
        ${p.remote ? `<button type="button" data-comment="${esc(p.id)}">💬 Comment</button>` : ''}
        ${p.mine ? `<button type="button" data-del="${esc(p.id)}">Delete</button>` : (p.remote ? `<button type="button" data-report-post="${esc(p.id)}" data-name="${esc(p.name)}">Report</button>` : '')}
      </div>`;
    card.dataset.pid = p.id;
    postsEl.appendChild(card);
    if (p.remote && openComments.has(p.id)) attachComments(card, p.id);
  });
}

function renderVerify() {
  const cu = state.currentUser || {};
  document.getElementById('menuAvatar').textContent = initials(cu.name || '?');
  document.getElementById('menuName').textContent = cu.name || 'Your name';
  document.getElementById('menuUser').textContent = cu.username || '';
  applyOwnPhoto();
  const box = document.getElementById('verifyBanner');
  const user = auth.currentUser;
  box.hidden = !user || user.emailVerified;
  if (box.hidden) return;
  box.innerHTML = `Verify your email (${esc(user.email)}) to post. <button class="btn small ghost" type="button" id="resendVerify">Resend link</button> <button class="btn small primary" type="button" id="checkVerify">I've verified</button>`;
  document.getElementById('resendVerify').onclick = async () => { try { await sendEmailVerification(user); showToast('Verification email sent.'); } catch (e) { showToast(friendlyError(e)); } };
  document.getElementById('checkVerify').onclick = async () => { await user.reload(); renderVerify(); showToast(user.emailVerified ? 'Email verified!' : 'Not verified yet.'); };
}

let friendDocs = [], unsubFriends = null, activeChatUid = null, unsubMsgs = null, chatMsgs = [], searchResults = [];
const meUid = () => demoMode ? DEMO_ME : auth.currentUser?.uid;
const otherOf = d => ({ uid: d.uid, name: d.name, username: d.username });
const friendsOf = () => friendDocs.filter(d => d.status === 'accepted');
const incoming = () => friendDocs.filter(d => d.status === 'incoming');
const outgoing = () => friendDocs.filter(d => d.status === 'outgoing');
const chatIdOf = (a, b) => [a, b].sort().join('_');

const photoCache = {};
let photoSubs = {}, photoTick = false;
const photoFor = uid => uid && uid === meUid() ? state.currentUser?.photo : photoCache[uid];
const avatarHtml = (uid, name) => { const u = photoFor(uid); return okImg(u) ? `<div class="avatar" style="background-image:url('${u}');background-size:cover;background-position:center"></div>` : `<div class="avatar">${esc(initials(name))}</div>`; };
function refreshPhotoViews() {
  if (photoTick) return; photoTick = true;
  setTimeout(() => { photoTick = false; renderFriends(); renderChats(); renderPosts(); renderAlerts(); renderStories(); }, 120);
}
function watchPhoto(uid) {
  if (!uid || demoMode || photoSubs[uid]) return;
  photoSubs[uid] = onValue(ref(db, 'profiles/' + uid + '/photo'), snap => {
    const v = snap.val() || '';
    if (photoCache[uid] !== v) { photoCache[uid] = v; refreshPhotoViews(); }
  }, () => {});
}

function personRow(name, username, actions, uid, kind) {
  const left = `${avatarHtml(uid, name)}<div style="flex:1;min-width:0"><h4>${esc(name)}</h4><small>${esc(username)}</small></div>`;
  return `<div class="notice">${uid ? `<button type="button" class="person-link" ${kind === 'profile' ? 'data-profile' : 'data-msg'}="${esc(uid)}">${left}</button>` : left}<div class="row-actions">${actions}</div></div>`;
}

function renderFriends() {
  const req = incoming();
  document.getElementById('reqCard').hidden = !req.length;
  document.getElementById('reqList').innerHTML = req.map(d => personRow(d.name, d.username, `<button class="btn small primary" data-fr-accept="${esc(d.uid)}" type="button">Confirm</button><button class="btn small ghost" data-fr-del="${esc(d.uid)}" type="button">Delete</button>`, d.uid, 'profile')).join('');
  const list = document.getElementById('friendsList');
  const f = friendsOf();
  list.innerHTML = f.length ? f.map(d => { const o = otherOf(d); return personRow(o.name, o.username, `<button class="btn small primary" data-msg="${esc(o.uid)}" type="button">Message</button><button class="btn small ghost" data-fr-del="${esc(d.uid)}" type="button">Remove</button>`, o.uid, 'profile'); }).join('') : '<div class="empty">No friends yet. Search for a username above.</div>';
  const sent = outgoing();
  document.getElementById('sentCard').hidden = !sent.length;
  document.getElementById('sentList').innerHTML = sent.map(d => personRow(d.name, d.username, `<button class="btn small ghost" data-fr-del="${esc(d.uid)}" type="button">Cancel</button>`, d.uid, 'profile')).join('');
  document.getElementById('searchResults').innerHTML = searchResults.map((r, i) => {
    const rel = friendDocs.find(d => d.uid === r.uid);
    const act = rel ? `<small>${rel.status === 'accepted' ? 'Friends' : 'Request pending'}</small>` : `<button class="btn small primary" data-fr-add="${i}" type="button">Add friend</button>`;
    return personRow(r.name, r.username, act, r.uid, 'profile');
  }).join('');
}

function renderChats() {
  const list = document.getElementById('chatList');
  const f = friendsOf();
  list.innerHTML = f.length ? '' : '<div class="empty">Add a friend to start chatting.</div>';
  f.forEach(d => {
    const o = otherOf(d);
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'chat-item' + (activeChatUid === o.uid ? ' active' : '');
    item.innerHTML = `<div class="avatar-wrap">${avatarHtml(o.uid, o.name)}${isActive(o.uid) ? '<span class="active-dot"></span>' : ''}</div><div style="flex:1;min-width:0;text-align:left"><h4>${esc(o.name)}</h4><p>${esc(o.username)}</p></div>`;
    item.addEventListener('click', () => openChat(o.uid));
    list.appendChild(item);
  });
  renderActiveRow();
  document.querySelector('.chat-layout').classList.toggle('open', !!activeChatUid);
  const cur = f.map(otherOf).find(o => o.uid === activeChatUid);
  const ca = document.getElementById('chatAvatar');
  ca.textContent = cur ? initials(cur.name) : '?'; ca.style.backgroundImage = '';
  if (cur) setBg(ca, photoFor(cur.uid));
  document.getElementById('chatName').textContent = cur ? cur.name : 'No chat selected';
  document.getElementById('chatStatus').textContent = cur ? cur.username : 'Pick a friend to message';
}

function openChat(uid) {
  if (unsubMsgs) unsubMsgs();
  activeChatUid = uid; chatMsgs = [];
  if (location.hash !== '#chat') history.pushState(null, '', '#chat');
  renderChats(); renderConversation();
  if (demoMode) { chatMsgs = demoChats[uid] || []; renderConversation(); return; }
  const q = query(ref(db, `chats/${chatIdOf(meUid(), uid)}/messages`), orderByChild('createdAt'), limitToLast(200));
  unsubMsgs = onValue(q, snap => { chatMsgs = Object.values(snap.val() || {}).sort((a, b) => (a.createdAt || Date.now()) - (b.createdAt || Date.now())); renderConversation(); }, err => { console.warn('Chat unavailable (check Firestore rules):', err); showToast('Chat unavailable.'); });
}

function renderConversation() {
  const box = document.getElementById('messages');
  box.innerHTML = '';
  if (!activeChatUid) { box.innerHTML = '<div class="empty">Select a friend to start chatting.</div>'; return; }
  if (!chatMsgs.length) box.innerHTML = '<div class="empty">No messages yet. Say hi!</div>';
  chatMsgs.forEach(m => {
    const b = document.createElement('div');
    b.className = 'bubble ' + (m.from === meUid() ? 'me' : '');
    b.textContent = m.text;
    box.appendChild(b);
  });
  box.scrollTop = box.scrollHeight;
}

function renderAlerts() {
  const inc = incoming();
  const acc = [];
  const el = document.getElementById('alertsList');
  el.innerHTML = (inc.length || notes.length) ? '' : '<div class="empty">No alerts yet.</div>';
  inc.forEach(d => el.insertAdjacentHTML('beforeend', `<div class="notice"><button type="button" class="person-link" data-profile="${esc(d.uid)}">${avatarHtml(d.uid, d.name)}<div style="flex:1;min-width:0"><h4>${esc(d.name)} sent you a friend request</h4><small>${esc(d.username)}</small></div></button><div class="row-actions"><button class="btn small primary" data-fr-accept="${esc(d.uid)}" type="button">Confirm</button><button class="btn small ghost" data-fr-del="${esc(d.uid)}" type="button">Delete</button></div></div>`));
  acc.forEach(d => el.insertAdjacentHTML('beforeend', `<div class="notice"><span class="dot" style="background:rgba(20,33,61,0.3)"></span><div><h4>${esc(d.toName)} accepted your friend request</h4><small>${esc(d.toUsername)}</small></div></div>`));
  notes.forEach(n => el.insertAdjacentHTML('beforeend', `<div class="notice"><span class="dot" style="background:${n.read ? 'rgba(20,33,61,0.3)' : 'var(--acc)'}"></span><div><h4>${n.type === 'like' ? esc(n.text) : 'Message from Murmur'}</h4>${n.type === 'like' ? '' : `<p>${esc(n.text)}</p>`}</div></div>`));
  const unread = notes.filter(n => !n.read).length;
  document.title = (inc.length + unread ? `(${inc.length + unread}) ` : '') + 'Murmur – Chat, share and watch together';
  [['friendsBadge', inc.length], ['alertsBadge', inc.length + unread]].forEach(([id, c]) => { const b = document.getElementById(id); b.textContent = c; b.hidden = !c; });
}

async function ensureProfile(user) {
  try {
    const snap = await get(ref(db, 'users/' + user.uid));
    if (!snap.exists()) return;
    const p = snap.val();
    await set(ref(db, 'profiles/' + user.uid), { uid: user.uid, name: p.name || '', username: p.username || '', usernameLower: (p.username || '').toLowerCase(), bio: p.bio || '', school: p.school || '', location: p.location || '', interests: p.interests || [], createdAt: p.createdAt || '', photo: p.photo || '', cover: p.cover || '' });
    if (state.currentUser) { state.currentUser.photo = p.photo || ''; applyOwnPhoto(); }
  } catch (e) { console.warn('Profile sync failed (check Realtime Database rules):', e); }
}

function startFriendsListener(uid) {
  if (unsubFriends) return;
  unsubFriends = onValue(ref(db, 'friends/' + uid), snap => {
    friendDocs = Object.entries(snap.val() || {}).map(([id, d]) => ({ id, ...d }));
    if (activeChatUid && !friendsOf().some(d => d.uid === activeChatUid)) { if (unsubMsgs) unsubMsgs(); unsubMsgs = null; activeChatUid = null; chatMsgs = []; renderConversation(); }
    syncPresence();
    renderFriends(); renderChats(); renderAlerts(); renderProfileActions(); renderStories();
  }, err => console.warn('Friends unavailable (check Realtime Database rules):', err));
}
let presenceMap = {}, presenceSubs = {};
const isActive = u => Date.now() - (presenceMap[u] || 0) < 180000;
function syncPresence() {
  const want = new Set(friendsOf().map(d => d.uid));
  Object.keys(presenceSubs).forEach(u => { if (!want.has(u)) { presenceSubs[u](); delete presenceSubs[u]; delete presenceMap[u]; } });
  friendDocs.forEach(d => watchPhoto(d.uid));
  want.forEach(u => { if (!presenceSubs[u]) presenceSubs[u] = onValue(ref(db, 'presence/' + u), s => { presenceMap[u] = s.val() || 0; renderChats(); }, () => {}); });
}
setInterval(() => { if (!document.hidden && document.getElementById('activeRow')) renderChats(); }, 60000);
function renderActiveRow() {
  const row = document.getElementById('activeRow');
  const act = friendsOf().map(otherOf).filter(o => isActive(o.uid));
  row.hidden = !act.length;
  row.innerHTML = act.map(o => `<button type="button" class="active-friend" data-msg="${esc(o.uid)}"><span class="avatar-wrap">${avatarHtml(o.uid, o.name)}<span class="active-dot"></span></span><small>${esc(o.name.split(' ')[0])}</small></button>`).join('');
}
function stopFriendsListener() {
  Object.values(presenceSubs).forEach(u => u()); presenceSubs = {}; presenceMap = {};
  Object.values(photoSubs).forEach(u => u()); photoSubs = {};
  Object.values(storySubs).forEach(u => u()); storySubs = {}; storiesData = {}; renderStories();
  [unsubFriends, unsubMsgs].forEach(u => u && u());
  unsubFriends = unsubMsgs = null; friendDocs = []; activeChatUid = null; chatMsgs = []; searchResults = [];
  renderFriends(); renderChats(); renderConversation(); renderAlerts();
}

async function searchFriends() {
  const raw = document.getElementById('friendSearch').value.trim().toLowerCase().replace(/^@/, '');
  if (raw.length < 3) { showToast('Type at least 3 letters of a username.'); return; }
  if (demoMode) {
    const pool = [...Object.values(demoPeople), { uid: 'd-kai', name: 'Kai Lim', username: '@kai' }];
    searchResults = pool.filter(r => r.username.toLowerCase() === '@' + raw);
    if (!searchResults.length) showToast('No one found. Try @kai or @mia.');
    renderFriends(); return;
  }
  try {
    const snap = await get(query(ref(db, 'profiles'), orderByChild('usernameLower'), equalTo('@' + raw)));
    searchResults = Object.values(snap.val() || {}).filter(r => r.uid !== meUid());
    searchResults.forEach(r => watchPhoto(r.uid));
    if (!searchResults.length) showToast('No one found with that username.');
  } catch (e) { showToast(friendlyError(e, 'Search failed.')); }
  renderFriends();
}

async function sendFriendRequest(t) {
  const me = state.currentUser, u = meUid(), now = serverTimestamp();
  try {
    await update(ref(db), {
      [`friends/${u}/${t.uid}`]: { uid: t.uid, name: t.name, username: t.username, status: 'outgoing', createdAt: now },
      [`friends/${t.uid}/${u}`]: { uid: u, name: me.name, username: me.username, status: 'incoming', createdAt: now }
    });
    showToast('Friend request sent.');
  } catch (e) { showToast(friendlyError(e, 'Could not send request.')); }
}

function renderAll() {
  document.getElementById('composerAvatar').textContent = initials(getCurrentUserName());
  const navButtons = document.querySelectorAll('[data-view]');
  navButtons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === state.activeView);
  });
  document.querySelectorAll('.pane').forEach(pane => {
    pane.classList.toggle('active', pane.dataset.pane === state.activeView);
  });

  renderPosts();
  renderVerify();
  renderFriends();
  renderChats();
  renderConversation();
  renderAlerts();
}

function setView(view) {
  if (view === 'alerts') markNotesRead();
  state.activeView = view;
  saveState();
  renderAll();
}

function getPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;
  if (password.length >= 12) score += 1;
  if (score <= 2) return { score: 1, label: 'Weak', color: '#d84848' };
  if (score <= 4) return { score: 2, label: 'Fair', color: '#d18b14' };
  return { score: 3, label: 'Strong', color: '#14c8a0' };
}

function validateUsername(value) {
  const username = value.trim();
  if (!username) return 'Choose a username.';
  if (!/^@?[a-zA-Z0-9._-]{3,20}$/.test(username)) return 'Use 3–20 letters/numbers, periods, dashes, or underscores.';
  const normalized = username.startsWith('@') ? username : '@' + username;
  const taken = Object.values(state.users).some(user => (user.username || '').toLowerCase() === normalized.toLowerCase());
  if (taken) return 'That username is already taken.';
  return '';
}

function isAdult(dateString) {
  if (!dateString) return false;
  const birth = new Date(dateString);
  const now = new Date();
  const age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) return age - 1 >= 13;
  return age >= 13;
}

function saveProfileToFirestore(uid, profileData) {
  return set(ref(db, 'users/' + uid), profileData);
}

function friendlyError(e, fallback) {
  const code = String((e && e.code) || '');
  const map = {
    'auth/email-already-in-use': 'That email is already registered. Try logging in instead.',
    'auth/invalid-email': 'Use a valid email address.',
    'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
    'auth/network-request-failed': 'No internet connection. Check your connection and try again.',
    'auth/too-many-requests': 'Too many tries. Please wait a moment and try again.',
    'auth/invalid-credential': 'The email or password is incorrect.',
    'auth/wrong-password': 'The email or password is incorrect.',
    'auth/user-not-found': 'The email or password is incorrect.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/operation-not-allowed': 'Sign up is not available right now. Please try again later.',
    'auth/requires-recent-login': 'Please log in again and try once more.',
    'auth/unauthorized-domain': 'This website address is not allowed to sign in yet.'
  };
  if (map[code]) return map[code];
  const msg = String((e && e.message) || '');
  if (/permission/i.test(code + ' ' + msg)) return 'You do not have permission to do that.';
  if (!msg || /firebase|auth\/|database|firestore/i.test(msg)) return fallback || 'Something went wrong. Please try again.';
  return msg;
}

let registerOverlay = null;

function closeRegisterWizard(fromHash) {
  if (!registerOverlay) return;
  registerOverlay.remove();
  registerOverlay = null;
  document.body.style.overflow = '';
  if (!fromHash && location.hash === '#create-account') history.back();
}

window.addEventListener('hashchange', () => {
  const h = location.hash;
  if (h === '#profile') return;
  if (profileOverlay) closeProfile(true);
  if (h === '#chat') return;
  if (activeChatUid) closeChat();
  if (LEGAL_HASHES[h]) { openLegal(LEGAL_HASHES[h]); return; }
  if (legalOverlay) closeLegal(true);
  if (h === '#create-account') {
    if (forgotOverlay) closeForgotPassword(true);
    if (!registerOverlay && !state.loggedIn) openRegisterWizard();
  } else if (h === '#forgot-password') {
    if (registerOverlay) closeRegisterWizard(true);
    if (!forgotOverlay && !state.loggedIn) openForgotPassword();
  } else {
    if (registerOverlay) closeRegisterWizard(true);
    if (forgotOverlay) closeForgotPassword(true);
  }
});

function openRegisterWizard() {
  if (registerOverlay) return;
  if (location.hash !== '#create-account') history.pushState(null, '', '#create-account');

  const STEPS = [
    { title: 'Name', hint: 'Who you are' },
    { title: 'Account', hint: 'Username & email' },
    { title: 'Password', hint: 'Keep it secure' },
    { title: 'Profile', hint: 'Photo & bio' },
    { title: 'Details', hint: 'Location & interests' },
    { title: 'Review', hint: 'Confirm & create' }
  ];
  const TOTAL = STEPS.length;

  const overlay = document.createElement('div');
  registerOverlay = overlay;
  document.body.style.overflow = 'hidden';
  overlay.className = 'screen-registration';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'register-title');
  overlay.innerHTML = `
    <aside class="reg-side">
      <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
      <div class="reg-side-intro">
        <h2>Join the social space built for people you actually know.</h2>
        <p>Work through each tab at your own pace. You can jump back to any step before you create your account.</p>
      </div>
      <nav class="reg-tabs" role="tablist" aria-label="Sign up steps">
        ${STEPS.map((s, i) => `
          <button type="button" class="reg-tab" role="tab" data-tab="${i + 1}">
            <span class="num">${i + 1}</span>
            <span>${s.title}<small>${s.hint}</small></span>
          </button>`).join('')}
      </nav>
    </aside>

    <section class="reg-main">
      <div class="reg-topbar">
        <div>
          <strong id="register-title">Create account</strong>
          <small data-step-label>Step 1 of ${TOTAL}</small>
        </div>
        <button class="close-btn" type="button" aria-label="Close and go back to login">×</button>
      </div>
      <div class="reg-progress"><div data-progress></div></div>

      <div class="reg-body" data-body>
        <div class="reg-content">

          <div class="reg-step active" data-step="1">
            <div class="reg-step-head">
              <h3>What should we call you?</h3>
              <p>Use the name your friends know you by.</p>
            </div>
            <div class="row">
              <div class="field"><label for="reg-first">First name</label><input id="reg-first" name="firstName" type="text" autocomplete="given-name" placeholder="First name" /></div>
              <div class="field"><label for="reg-last">Last name</label><input id="reg-last" name="lastName" type="text" autocomplete="family-name" placeholder="Last name" /></div>
            </div>
            <div class="row">
              <div class="field"><label for="reg-middle">Middle name (optional)</label><input id="reg-middle" name="middleName" type="text" autocomplete="additional-name" placeholder="Middle name" /></div>
              <div class="field"><label for="reg-birthday">Birthday</label><input id="reg-birthday" name="birthday" type="date" autocomplete="bday" /></div>
            </div>
            <div class="field-hint">You must be at least 13 to use Murmur.</div>
          </div>

          <div class="reg-step" data-step="2">
            <div class="reg-step-head">
              <h3>Set up your account</h3>
              <p>Pick a username and the email you'll log in with.</p>
            </div>
            <div class="field">
              <label for="reg-username">Username</label>
              <input id="reg-username" name="username" type="text" autocomplete="username" placeholder="@jian123" />
              <div class="error" data-user-error></div>
            </div>
            <div class="field">
              <label for="reg-email">Email address</label>
              <input id="reg-email" name="email" type="email" autocomplete="email" placeholder="you@example.com" />
            </div>
          </div>

          <div class="reg-step" data-step="3">
            <div class="reg-step-head">
              <h3>Create a password</h3>
              <p>Make it at least 8 characters. A mix of letters, numbers and symbols is stronger.</p>
            </div>
            <div class="field">
              <label for="reg-password">Password</label>
              <div class="password-wrap">
                <input id="reg-password" name="password" type="password" autocomplete="new-password" placeholder="Create a password" />
                <button class="password-toggle" type="button">Show</button>
              </div>
              <div class="strength-bar"><div class="strength-fill"></div></div>
              <div class="password-feedback"></div>
            </div>
            <div class="field">
              <label for="reg-confirm">Confirm password</label>
              <div class="password-wrap">
                <input id="reg-confirm" name="confirmPassword" type="password" autocomplete="new-password" placeholder="Confirm your password" />
                <button class="password-toggle" type="button">Show</button>
              </div>
            </div>
          </div>

          <div class="reg-step" data-step="4">
            <div class="reg-step-head">
              <h3>Build your profile</h3>
              <p>Everything on this tab is optional. You can change it later.</p>
            </div>
            <div class="field">
              <label for="reg-photo">Profile photo</label>
              <input id="reg-photo" name="photo" type="file" accept="image/*" />
            </div>
            <div class="field">
              <label for="reg-bio">Short bio</label>
              <textarea id="reg-bio" name="bio" placeholder="Tell people a little about yourself..."></textarea>
            </div>
            <div class="field">
              <label for="reg-gender">Gender</label>
              <select id="reg-gender" name="gender">
                <option value="">Prefer not to say</option>
                <option>Female</option>
                <option>Male</option>
                <option>Non-binary</option>
                <option>Other</option>
              </select>
            </div>
          </div>

          <div class="reg-step" data-step="5">
            <div class="reg-step-head">
              <h3>A few more details</h3>
              <p>Help friends find you. All optional.</p>
            </div>
            <div class="row">
              <div class="field"><label for="reg-location">Location</label><input id="reg-location" name="location" type="text" autocomplete="address-level2" placeholder="City, Country" /></div>
              <div class="field"><label for="reg-school">School</label><input id="reg-school" name="school" type="text" placeholder="School or university" /></div>
            </div>
            <div class="field">
              <label for="reg-phone">Phone number</label>
              <input id="reg-phone" name="phone" type="tel" autocomplete="tel" placeholder="Optional" />
            </div>
            <div class="section-label">Hobbies &amp; interests</div>
            <div class="interest-grid">
              ${['Music','Gaming','Anime','Writing','Photography','Sports','Technology','Travel','Art'].map(t => `<button type="button" class="interest-option" aria-pressed="false">${t}</button>`).join('')}
            </div>
          </div>

          <div class="reg-step" data-step="6">
            <div class="reg-step-head">
              <h3>Review &amp; create</h3>
              <p>Check everything looks right. Use Edit to jump back to any section.</p>
            </div>
            <div class="profile-preview">
              <div class="avatar" data-preview-avatar>U</div>
              <div>
                <h4 data-preview-name>Your name</h4>
                <p data-preview-username>@yourname</p>
              </div>
            </div>
            <dl class="review-list" data-review-list style="margin:0"></dl>
            <label class="checkbox-row">
              <input type="checkbox" id="termsCheck" />
              <span>I agree to the <a href="#terms">Terms of Service</a>, <a href="#privacy">Privacy Policy</a> and <a href="#cookies">Cookie Policy</a>, and I am 13+ years old.</span>
            </label>
          </div>

        </div>
      </div>

      <div class="reg-footer">
        <button type="button" class="btn ghost" data-action="back">Back</button>
        <div class="reg-error" role="alert" aria-live="polite" data-reg-error></div>
        <button type="button" class="btn primary" data-action="next">Continue</button>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);

  let step = 1;
  const completed = new Set();
  const $ = sel => overlay.querySelector(sel);
  const field = name => overlay.querySelector(`[name="${name}"]`);
  const tabs = [...overlay.querySelectorAll('.reg-tab')];
  const panes = [...overlay.querySelectorAll('.reg-step')];
  const nextButton = $('[data-action="next"]');
  const backButton = $('[data-action="back"]');
  const errorBox = $('[data-reg-error]');
  const bodyEl = $('[data-body]');
  const usernameInput = field('username');
  const passwordInput = field('password');
  const confirmInput = field('confirmPassword');

  const selectedInterests = new Set();
  overlay.querySelectorAll('.interest-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const text = opt.textContent.trim();
      if (selectedInterests.has(text)) selectedInterests.delete(text);
      else selectedInterests.add(text);
      const on = selectedInterests.has(text);
      opt.classList.toggle('selected', on);
      opt.setAttribute('aria-pressed', String(on));
    });
  });

  function setError(message) { errorBox.textContent = message || ''; }
  function normUser(v) { const t = v.trim(); return t.startsWith('@') ? t : '@' + t; }

  function validateStep(n) {
    if (n === 1) {
      if (!field('firstName').value.trim() || !field('lastName').value.trim()) return 'Add your first and last name.';
      const b = field('birthday').value;
      if (!b) return 'Add your birthday.';
      if (!isAdult(b)) return 'You must be at least 13 to create an account.';
    }
    if (n === 2) {
      const userErr = validateUsername(usernameInput.value);
      if (userErr) return userErr;
      const email = field('email').value.trim();
      if (!email) return 'Add your email address.';
      if (!email.includes('@')) return 'Use a valid email address.';
    }
    if (n === 3) {
      if (!passwordInput.value || passwordInput.value.length < 8) return 'Password must be at least 8 characters long.';
      if (passwordInput.value !== confirmInput.value) return 'Passwords do not match.';
    }
    if (n === 6) {
      if (!$('#termsCheck').checked) return 'You must accept the terms before creating your account.';
    }
    return '';
  }

  function renderReview() {
    const first = field('firstName').value.trim();
    const middle = field('middleName').value.trim();
    const last = field('lastName').value.trim();
    const name = [first, last].filter(Boolean).join(' ') || 'Your name';
    const fullName = [first, middle, last].filter(Boolean).join(' ') || 'Your name';
    const username = usernameInput.value.trim() ? normUser(usernameInput.value) : '@yourname';
    $('[data-preview-name]').textContent = name;
    $('[data-preview-avatar]').textContent = initials(name);
    $('[data-preview-username]').textContent = username;

    const rows = [
      ['Name', fullName, 1],
      ['Birthday', field('birthday').value, 1],
      ['Username', username, 2],
      ['Email', field('email').value.trim(), 2],
      ['Password', '•'.repeat(Math.min(passwordInput.value.length, 12)), 3],
      ['Bio', field('bio').value.trim(), 4],
      ['Gender', field('gender').value, 4],
      ['Location', field('location').value.trim(), 5],
      ['School', field('school').value.trim(), 5],
      ['Phone', field('phone').value.trim(), 5],
      ['Interests', [...selectedInterests].join(', '), 5]
    ];
    const list = $('[data-review-list]');
    list.innerHTML = '';
    rows.forEach(([label, value, target]) => {
      const row = document.createElement('div');
      row.className = 'review-row';
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value || 'Not added';
      if (!value) dd.className = 'empty-val';
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.textContent = 'Edit';
      edit.addEventListener('click', () => goTo(target));
      row.append(dt, dd, edit);
      list.appendChild(row);
    });
  }

  function updateUI() {
    tabs.forEach((tab, i) => {
      const n = i + 1;
      const isDone = completed.has(n) && n !== step;
      tab.classList.toggle('active', n === step);
      tab.classList.toggle('done', isDone);
      tab.setAttribute('aria-selected', String(n === step));
      tab.querySelector('.num').textContent = isDone ? '✓' : n;
    });
    panes.forEach(p => p.classList.toggle('active', Number(p.dataset.step) === step));
    backButton.style.visibility = step === 1 ? 'hidden' : 'visible';
    nextButton.textContent = step === TOTAL ? 'Create account' : 'Continue';
    $('[data-step-label]').textContent = `Step ${step} of ${TOTAL} · ${STEPS[step - 1].title}`;
    $('[data-progress]').style.width = `${(step / TOTAL) * 100}%`;
    setError('');
    if (step === TOTAL) renderReview();
    bodyEl.scrollTop = 0;
    const firstInput = panes[step - 1].querySelector('input:not([type="file"]):not([type="checkbox"]), textarea, select');
    if (firstInput) setTimeout(() => firstInput.focus({ preventScroll: true }), 30);
  }

  function goTo(target) {
    if (target < step) { step = target; updateUI(); return; }
    for (let n = step; n < target; n++) {
      const err = validateStep(n);
      if (err) {
        step = n;
        updateUI();
        setError(err);
        return;
      }
      completed.add(n);
    }
    step = target;
    updateUI();
  }

  function updateStrength() {
    const password = passwordInput.value;
    const strength = getPasswordStrength(password);
    const fill = $('.strength-fill');
    fill.style.width = `${password ? (strength.score / 3) * 100 : 0}%`;
    fill.style.background = strength.color;
    $('.password-feedback').innerHTML = password
      ? `<strong style="color:${strength.color}">${strength.label}</strong> Use 8+ characters and mix letters, numbers, symbols.`
      : 'Use 8+ characters and mix letters, numbers, symbols.';
  }

  async function submit() {
    const err = validateStep(TOTAL);
    if (err) { setError(err); return; }
    for (let n = 1; n < TOTAL; n++) {
      const e = validateStep(n);
      if (e) { goTo(n); setError(e); return; }
    }

    const first = field('firstName').value.trim();
    const middle = field('middleName').value.trim();
    const last = field('lastName').value.trim();
    const fullName = [first, middle, last].filter(Boolean).join(' ');
    const normalizedUser = normUser(usernameInput.value);
    const email = field('email').value.trim();
    const password = passwordInput.value;
    const userProfile = {
      firstName: first,
      middleName: middle,
      lastName: last,
      name: fullName,
      username: normalizedUser,
      email,
      birthday: field('birthday').value,
      gender: field('gender').value,
      school: field('school').value.trim(),
      location: field('location').value.trim(),
      phone: field('phone').value.trim(),
      bio: field('bio').value.trim(),
      interests: [...selectedInterests],
      createdAt: new Date().toISOString(),
      coverPhoto: '',
      profilePhoto: ''
    };

    nextButton.disabled = true;
    nextButton.textContent = 'Creating...';
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const uid = userCredential.user.uid;
      try {
        await saveProfileToFirestore(uid, userProfile);
        await ensureProfile(userCredential.user);
      } catch (profileErr) { console.warn('Profile save skipped:', profileErr); }
      try {
        if (!userCredential.user.emailVerified) await sendEmailVerification(userCredential.user);
      } catch (mailErr) { console.warn('Verification email skipped:', mailErr); }
      state.loggedIn = true;
      state.currentUser = { name: fullName, email, username: normalizedUser, uid };
      state.users.me = { ...state.currentUser };
      state.activeView = 'home';
      saveState();
      registerOverlay.remove();
      registerOverlay = null;
      document.body.style.overflow = '';
      history.replaceState(null, '', location.pathname + location.search);
      showApp();
      window.scrollTo(0, 0);
      showToast('Welcome to Murmur! Your account is ready.');
    } catch (error) {
      console.error('Create account failed:', error);
      setError(friendlyError(error, 'Unable to create account.'));
      nextButton.disabled = false;
      nextButton.textContent = 'Create account';
    }
  }

  overlay.querySelectorAll('.password-toggle').forEach(button => {
    button.addEventListener('click', () => {
      const input = button.closest('.password-wrap').querySelector('input');
      const hidden = input.type === 'password';
      input.type = hidden ? 'text' : 'password';
      button.textContent = hidden ? 'Hide' : 'Show';
    });
  });

  usernameInput.addEventListener('input', () => {
    $('[data-user-error]').textContent = usernameInput.value ? validateUsername(usernameInput.value) : '';
  });
  passwordInput.addEventListener('input', updateStrength);
  overlay.addEventListener('input', () => setError(''));

  tabs.forEach(tab => tab.addEventListener('click', () => goTo(Number(tab.dataset.tab))));
  nextButton.addEventListener('click', () => { step === TOTAL ? submit() : goTo(step + 1); });
  backButton.addEventListener('click', () => { if (step > 1) goTo(step - 1); });
  $('.close-btn').addEventListener('click', () => closeRegisterWizard(false));

  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeRegisterWizard(false); return; }
    if (e.key === 'Enter' && e.target.matches('input:not([type="checkbox"]):not([type="file"])')) {
      e.preventDefault();
      nextButton.click();
    }
  });

  updateUI();
  updateStrength();
}

async function login(email, password) {
  const normalized = String(email || '').trim();
  if (!normalized || !String(password || '').trim()) {
    authError.textContent = 'Enter both email and password.';
    return;
  }
  if (!normalized.includes('@')) {
    authError.textContent = 'Use a valid email address.';
    return;
  }
  try {
    try { await setPersistence(auth, document.getElementById('rememberMe').checked ? browserLocalPersistence : browserSessionPersistence); } catch {}
    const userCredential = await signInWithEmailAndPassword(auth, normalized, password);
    const userDoc = await get(ref(db, 'users/' + userCredential.user.uid));
    const profile = userDoc.exists() ? userDoc.val() : {};
    state.loggedIn = true;
    state.currentUser = {
      uid: userCredential.user.uid,
      name: profile.name || userCredential.user.displayName || 'Maya Chen',
      email: userCredential.user.email || normalized,
      username: profile.username || '@maya'
    };
    state.users.me = { ...state.currentUser };
    saveState();
    showApp();
  } catch (error) {
    console.error('Login failed:', error);
    authError.textContent = friendlyError(error, 'Login failed. Please try again.');
  }
}

let forgotOverlay = null;

function closeForgotPassword(fromHash) {
  if (!forgotOverlay) return;
  forgotOverlay.remove();
  forgotOverlay = null;
  document.body.style.overflow = '';
  if (!fromHash && location.hash === '#forgot-password') history.back();
}

function openForgotPassword() {
  if (forgotOverlay) return;
  if (location.hash !== '#forgot-password') history.pushState(null, '', '#forgot-password');

  const overlay = document.createElement('div');
  forgotOverlay = overlay;
  document.body.style.overflow = 'hidden';
  overlay.className = 'screen-forgot';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'forgot-title');
  overlay.innerHTML = `
    <aside class="forgot-side">
      <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
      <div>
        <h2>Locked out? It happens.</h2>
        <p>Enter the email you signed up with and we'll send you a link to choose a new password.</p>
      </div>
      <span></span>
    </aside>
    <section class="forgot-main">
      <div class="forgot-top">
        <button class="close-btn" type="button" aria-label="Close and go back to login">×</button>
      </div>
      <div class="forgot-body">
        <div class="forgot-content">
          <h3 id="forgot-title">Reset your password</h3>
          <p data-forgot-intro>We'll email you a reset link.</p>
          <div class="field">
            <label for="forgot-email">Email address</label>
            <input id="forgot-email" type="email" autocomplete="email" placeholder="you@example.com" />
          </div>
          <div class="error" role="alert" aria-live="polite" data-forgot-error></div>
          <div class="forgot-success" data-forgot-success hidden></div>
          <button class="btn primary" type="button" data-forgot-send>Send reset link</button>
          <button class="btn ghost" type="button" data-forgot-back>Back to login</button>
        </div>
      </div>
    </section>
  `;
  document.body.appendChild(overlay);

  const $ = sel => overlay.querySelector(sel);
  const emailInput = $('#forgot-email');
  const errorBox = $('[data-forgot-error]');
  const successBox = $('[data-forgot-success]');
  const sendBtn = $('[data-forgot-send]');
  emailInput.value = (document.getElementById('email').value || '').trim();

  async function send() {
    const email = emailInput.value.trim();
    errorBox.textContent = '';
    successBox.hidden = true;
    if (!email) { errorBox.textContent = 'Add your email address first.'; return; }
    if (!email.includes('@')) { errorBox.textContent = 'Use a valid email address.'; return; }
    sendBtn.disabled = true;
    sendBtn.textContent = 'Sending...';
    try {
      await sendPasswordResetEmail(auth, email);
      successBox.textContent = 'If an account exists for ' + email + ', a reset link is on its way. Check your inbox and spam folder.';
      successBox.hidden = false;
      sendBtn.textContent = 'Send again';
    } catch (error) {
      console.error('Password reset failed:', error);
      errorBox.textContent = error.code === 'auth/invalid-email'
        ? 'Use a valid email address.'
        : (friendlyError(error, 'Unable to send the reset email.'));
      sendBtn.textContent = 'Send reset link';
    }
    sendBtn.disabled = false;
  }

  sendBtn.addEventListener('click', send);
  $('[data-forgot-back]').addEventListener('click', () => closeForgotPassword(false));
  $('.close-btn').addEventListener('click', () => closeForgotPassword(false));
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeForgotPassword(false);
    if (e.key === 'Enter' && e.target === emailInput) { e.preventDefault(); send(); }
  });
  emailInput.addEventListener('input', () => { errorBox.textContent = ''; });
  setTimeout(() => emailInput.focus(), 30);
}

let legalOverlay = null;
let legalDirect = false;

function closeLegal(fromHash) {
  if (!legalOverlay) return;
  legalOverlay.remove();
  legalOverlay = null;
  const stillLocked = registerOverlay || forgotOverlay;
  if (!stillLocked) document.body.style.overflow = '';
  if (fromHash) return;
  if (legalDirect) {
    history.replaceState(null, '', location.pathname + location.search);
    legalDirect = false;
  } else if (LEGAL_HASHES[location.hash]) {
    history.back();
  }
}

function openLegal(page, direct) {
  if (!LEGAL_PAGES[page]) return;
  if (!legalOverlay) {
    legalDirect = !!direct;
    const overlay = document.createElement('div');
    legalOverlay = overlay;
    document.body.style.overflow = 'hidden';
    overlay.className = 'screen-legal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Privacy and cookies');
    overlay.innerHTML = `
      <div class="legal-top">
        <div class="brand-row"><span class="brand-mark" aria-hidden="true"></span><span>Murmur</span></div>
        <nav class="legal-tabs" role="tablist" aria-label="Legal pages">
          <button type="button" class="legal-tab" role="tab" data-legal-tab="terms">Terms</button>
          <button type="button" class="legal-tab" role="tab" data-legal-tab="privacy">Privacy Policy</button>
          <button type="button" class="legal-tab" role="tab" data-legal-tab="cookies">Cookie Policy</button>
        </nav>
        <button class="close-btn" type="button" aria-label="Close">×</button>
      </div>
      <div class="legal-body" data-legal-body><article class="legal-doc" data-legal-doc></article></div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelectorAll('[data-legal-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.legalTab;
        history.replaceState(null, '', '#' + target);
        renderLegal(target);
      });
    });
    overlay.querySelector('.close-btn').addEventListener('click', () => closeLegal(false));
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeLegal(false); });
    overlay.addEventListener('click', e => {
      if (e.target.closest('[data-reset-cookie-notice]')) {
        try { localStorage.removeItem(COOKIE_NOTICE_KEY); } catch {}
        showCookieNotice();
        showToast('Cookie notice will show again.');
      }
    });
    overlay.querySelector('.close-btn').focus();
  }
  renderLegal(page);
}

function renderLegal(page) {
  if (!legalOverlay || !LEGAL_PAGES[page]) return;
  legalOverlay.querySelectorAll('[data-legal-tab]').forEach(tab => {
    const on = tab.dataset.legalTab === page;
    tab.classList.toggle('active', on);
    tab.setAttribute('aria-selected', String(on));
  });
  legalOverlay.querySelector('[data-legal-doc]').innerHTML = LEGAL_PAGES[page]();
  legalOverlay.querySelector('[data-legal-body]').scrollTop = 0;
}

function showCookieNotice() {
  if (document.querySelector('.cookie-notice')) return;
  const box = document.createElement('div');
  box.className = 'cookie-notice';
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', 'Cookie notice');
  box.innerHTML = `
    <div>
      <strong>We use cookies 🍪</strong>
      <p>Murmur only uses essential cookies and browser storage to keep you signed in and remember your settings. We don't use advertising or tracking cookies. See our <a href="#cookies">Cookie Policy</a> and <a href="#privacy">Privacy Policy</a>.</p>
    </div>
    <div class="cookie-actions">
      <button type="button" class="btn primary" data-cookie-ok>Got it</button>
      <button type="button" class="btn ghost" data-cookie-more>Learn more</button>
    </div>
  `;
  document.body.appendChild(box);
  box.querySelector('[data-cookie-ok]').addEventListener('click', () => {
    try { localStorage.setItem(COOKIE_NOTICE_KEY, 'seen'); } catch {}
    box.remove();
  });
  box.querySelector('[data-cookie-more]').addEventListener('click', () => {
    location.hash = '#cookies';
  });
}

function maybeShowCookieNotice() {
  let seen = false;
  try { seen = localStorage.getItem(COOKIE_NOTICE_KEY) === 'seen'; } catch {}
  if (!seen) showCookieNotice();
}

let demoChats = {};
let profileOverlay = null;
function closeProfile(fromHash) {
  if (!profileOverlay) return;
  profileOverlay.remove(); profileOverlay = null;
  if (!fromHash && location.hash === '#profile') history.back();
}
let profileUid = null;
const offlineBar = Object.assign(document.createElement('div'), { id: 'offlineBar', hidden: true, textContent: 'You are offline. Messages and posts will not send until you reconnect.' });
offlineBar.setAttribute('role', 'status');
document.body.appendChild(offlineBar);
const syncOnline = () => { offlineBar.hidden = navigator.onLine; };
window.addEventListener('online', syncOnline); window.addEventListener('offline', syncOnline); syncOnline();

/* ---------- Stories (photos, 24 hours) ---------- */
let storySubs = {}, storiesData = {}, storyTimer = null;
const storyFile = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', hidden: true });
document.body.appendChild(storyFile);
function watchStories(uid) {
  if (demoMode || storySubs[uid]) return;
  storySubs[uid] = onValue(ref(db, 'stories/' + uid), snap => {
    storiesData[uid] = Object.entries(snap.val() || {}).map(([id, v]) => ({ id, ...v })).filter(x => (x.createdAt || Date.now()) > Date.now() - 864e5).sort((a, b) => (a.createdAt || Date.now()) - (b.createdAt || Date.now()));
    renderStories();
  }, () => {});
}
function renderStories() {
  const row = document.getElementById('storiesRow'), me = meUid();
  if (!row) return;
  if (demoMode || !me) { row.innerHTML = ''; return; }
  [me, ...friendsOf().map(d => d.uid)].forEach(watchStories);
  const card = (uid, name, label) => { const list = storiesData[uid] || []; if (!list.length) return ''; const last = list[list.length - 1].photo; return okImg(last) ? `<button type="button" class="story" data-story-view="${esc(uid)}" style="background-image:url('${last}')"><span class="story-av">${avatarHtml(uid, name)}</span><b>${esc(label)}</b></button>` : ''; };
  row.innerHTML = '<button type="button" class="story add" data-story-add><span>＋</span><b>Add story</b></button>' + card(me, state.currentUser?.name || '', 'Your story') + friendsOf().map(d => card(d.uid, d.name, d.name.split(' ')[0])).join('');
}
function viewStory(uid) {
  const list = storiesData[uid] || []; if (!list.length) return;
  let i = 0;
  const el = document.createElement('div');
  el.className = 'story-view';
  document.body.appendChild(el);
  const close = () => { clearTimeout(storyTimer); el.remove(); };
  const show = () => {
    clearTimeout(storyTimer);
    if (i >= list.length) return close();
    const st = list[i], mine = uid === meUid(), name = mine ? 'Your story' : (friendsOf().find(d => d.uid === uid) || {}).name || '';
    el.innerHTML = `<div class="story-bars">${list.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div><div class="story-top"><strong>${esc(name)}</strong><span>${timeAgo(st.createdAt)}</span>${mine ? '<button type="button" data-sdel>Delete</button>' : ''}<button type="button" data-sclose aria-label="Close">×</button></div><img alt="" src="${okImg(st.photo) ? st.photo : ''}" /><button class="story-prev" type="button" aria-label="Previous"></button><button class="story-next" type="button" aria-label="Next"></button>`;
    el.querySelector('[data-sclose]').onclick = close;
    el.querySelector('.story-next').onclick = () => { i++; show(); };
    el.querySelector('.story-prev').onclick = () => { i = Math.max(0, i - 1); show(); };
    const del = el.querySelector('[data-sdel]');
    if (del) del.onclick = async () => { try { await remove(ref(db, `stories/${uid}/${st.id}`)); showToast('Story deleted.'); } catch (e) { showToast(friendlyError(e, 'Could not delete.')); } close(); };
    storyTimer = setTimeout(() => { i++; show(); }, 5000);
  };
  show();
}
storyFile.addEventListener('change', async () => {
  const f = storyFile.files[0]; storyFile.value = ''; if (!f || !meUid()) return;
  showToast('Uploading your story…');
  try {
    const photo = await fileToDataUrl(f, 360, 640);
    await push(ref(db, 'stories/' + meUid()), { photo, createdAt: serverTimestamp() });
    showToast('Story added. Friends can see it for 24 hours.');
  } catch (e) { showToast(friendlyError(e, 'Could not add your story.')); }
});
document.addEventListener('click', e => {
  if (e.target.closest('[data-story-add]')) { storyFile.click(); return; }
  const v = e.target.closest('[data-story-view]'); if (v) viewStory(v.dataset.storyView);
});
const timeAgo = t => { if (!t || typeof t !== 'number') return ''; const m = Math.floor((Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + 'm'; const h = Math.floor(m / 60); return h < 24 ? h + 'h' : Math.floor(h / 24) + 'd'; };

/* ---------- Comments ---------- */
const openComments = new Set(), commentSubs = {}, commentData = {}, commentDraft = {};
function toggleComments(id) {
  if (openComments.has(id)) { openComments.delete(id); if (commentSubs[id]) { commentSubs[id](); delete commentSubs[id]; } }
  else {
    openComments.add(id);
    if (!demoMode && !commentSubs[id]) commentSubs[id] = onValue(query(ref(db, 'comments/' + id), orderByChild('createdAt'), limitToLast(50)), snap => {
      commentData[id] = Object.entries(snap.val() || {}).map(([cid, c]) => ({ cid, ...c })).sort((a, b) => (a.createdAt || Date.now()) - (b.createdAt || Date.now()));
      commentData[id].forEach(c => watchPhoto(c.uid));
      const card = document.querySelector(`[data-pid="${CSS.escape(id)}"]`);
      if (card) attachComments(card, id);
    }, () => {});
  }
  renderPosts();
}
function attachComments(card, id) {
  card.querySelector('.comments')?.remove();
  if (!openComments.has(id)) return;
  const box = document.createElement('div');
  box.className = 'comments';
  const list = commentData[id] || [];
  box.innerHTML = (list.map(c => `<div class="comment">${avatarHtml(c.uid, c.name)}<div><button type="button" class="person-link" data-profile="${esc(c.uid)}"><b>${esc(c.name)}</b></button> ${esc(c.text)} <small>${timeAgo(c.createdAt)}</small></div></div>`).join('') || '<small>No comments yet.</small>') +
    '<div class="comment-form"><input type="text" maxlength="300" placeholder="Write a comment…" data-cinput /><button class="btn small primary" type="button" data-csend>Send</button></div>';
  const inp = box.querySelector('[data-cinput]');
  inp.value = commentDraft[id] || '';
  inp.addEventListener('input', () => { commentDraft[id] = inp.value; });
  const send = async () => {
    const text = inp.value.trim(); if (!text) return;
    if (demoMode) { (commentData[id] = commentData[id] || []).push({ cid: 'c' + Date.now(), uid: DEMO_ME, name: 'Demo User', text, createdAt: Date.now() }); commentDraft[id] = ''; attachComments(card, id); return; }
    const u = auth.currentUser; if (!u) return;
    if (!u.emailVerified) { showToast('Verify your email to comment.'); return; }
    try { await push(ref(db, 'comments/' + id), { uid: u.uid, name: state.currentUser?.name || 'Someone', text, createdAt: serverTimestamp() }); commentDraft[id] = ''; inp.value = ''; }
    catch (e) { showToast(friendlyError(e, 'Could not comment.')); }
  };
  box.querySelector('[data-csend]').onclick = send;
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); send(); } });
  card.appendChild(box);
}
document.addEventListener('click', e => { const c = e.target.closest('[data-comment]'); if (c) toggleComments(c.dataset.comment); });

/* ---------- Dark mode ---------- */
function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  const b = document.getElementById('themeBtn'); if (b) b.textContent = t === 'dark' ? '☀️ Light mode' : '🌙 Dark mode';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#121820' : '#14c8a0');
}
let savedTheme = 'light'; try { savedTheme = localStorage.getItem('murmur-theme') || 'light'; } catch {}
applyTheme(savedTheme);
document.getElementById('themeBtn').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('murmur-theme', t); } catch {}
  applyTheme(t);
});
const demoDetails = {
  'd-ava': { bio: 'Coffee lover ☕ Photographer in training.', school: 'Ateneo High School', location: 'Manila, PH', interests: ['Music', 'Photography'], createdAt: '2026-01-12T08:00:00Z' },
  'd-leo': { bio: 'Runner. Gamer. Always hungry.', school: 'De La Salle University', location: 'Quezon City, PH', interests: ['Sports', 'Gaming'], createdAt: '2026-02-03T08:00:00Z' },
  'd-noah': { bio: 'Movie nights are my love language 🍿', school: 'UP Diliman', location: 'Cebu, PH', interests: ['Anime', 'Travel'], createdAt: '2026-03-20T08:00:00Z' },
  'd-mia': { bio: 'New here, say hi!', school: 'FEU', location: 'Cavite, PH', interests: ['Art', 'Writing'], createdAt: '2026-10-01T08:00:00Z' },
  'd-zoe': { bio: 'Tech + tacos.', school: 'Mapua University', location: 'Laguna, PH', interests: ['Technology'], createdAt: '2026-08-15T08:00:00Z' },
  'd-kai': { bio: 'Surf, sunsets and good music.', school: 'Silliman University', location: 'Dumaguete, PH', interests: ['Music', 'Travel'], createdAt: '2026-09-09T08:00:00Z' }
};
const okImg = u => typeof u === 'string' && u.startsWith('data:image/') && !/["')\s]/.test(u);
function fileToDataUrl(file, w, h) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const r = Math.max(w / img.width, h / img.height), dw = img.width * r, dh = img.height * r;
      c.getContext('2d').drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.75));
    };
    img.onerror = () => rej(new Error('Could not read that image.'));
    img.src = url;
  });
}
function setBg(el, url) { if (okImg(url)) { el.style.backgroundImage = `url("${url}")`; el.style.backgroundSize = 'cover'; el.style.backgroundPosition = 'center'; el.textContent = ''; return true; } return false; }
function applyOwnPhoto() {
  const u = state.currentUser || {};
  ['menuAvatar', 'composerAvatar'].forEach(id => { const el = document.getElementById(id); if (el && !setBg(el, u.photo)) el.style.backgroundImage = ''; });
}

async function openEditProfile() {
  const u = meUid();
  let d = {};
  if (demoMode) d = demoSelf; else { try { d = (await get(ref(db, 'users/' + u))).val() || {}; } catch {} }
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal-card" style="max-height:92vh;overflow:auto" role="dialog" aria-modal="true"><h3>Edit profile</h3>
    <div class="edit-cover" data-cover></div>
    <label class="btn ghost small edit-pick">Change cover photo<input type="file" accept="image/*" hidden data-file="cover" /></label>
    <div class="edit-avatar avatar" data-avatar></div>
    <label class="btn ghost small edit-pick">Change profile photo<input type="file" accept="image/*" hidden data-file="photo" /></label>
    <div class="field"><label>Bio</label><textarea data-f="bio" maxlength="160"></textarea></div>
    <div class="field"><label>School</label><input data-f="school" type="text" maxlength="60" /></div>
    <div class="field"><label>Location</label><input data-f="location" type="text" maxlength="60" /></div>
    <div class="error" role="alert" data-err></div>
    <div class="upload-status" data-up hidden><div class="splash-bar" data-upbar><i></i></div><strong data-uptext></strong></div>
    <div class="row-actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-save>Save</button></div></div>`;
  document.body.appendChild(back);
  const q = sel => back.querySelector(sel), pending = {};
  ['bio', 'school', 'location'].forEach(k => { q(`[data-f="${k}"]`).value = d[k] || ''; });
  if (!setBg(q('[data-cover]'), d.cover)) q('[data-cover]').style.backgroundImage = '';
  if (!setBg(q('[data-avatar]'), d.photo)) q('[data-avatar]').textContent = initials(state.currentUser?.name || '?');
  back.querySelectorAll('[data-file]').forEach(inp => inp.addEventListener('change', async () => {
    const f = inp.files[0]; if (!f) return;
    try {
      const kind = inp.dataset.file;
      pending[kind] = await fileToDataUrl(f, kind === 'photo' ? 160 : 720, kind === 'photo' ? 160 : 240);
      setBg(q(kind === 'photo' ? '[data-avatar]' : '[data-cover]'), pending[kind]);
    } catch (e) { q('[data-err]').textContent = friendlyError(e, 'Could not use that image.'); }
  }));
  q('[data-cancel]').onclick = () => back.remove();
  q('[data-save]').onclick = async () => {
    const data = { bio: q('[data-f="bio"]').value.trim(), school: q('[data-f="school"]').value.trim(), location: q('[data-f="location"]').value.trim(), ...pending };
    const btn = q('[data-save]'); btn.disabled = true; btn.textContent = 'Saving...';
    const hasImg = !!(pending.photo || pending.cover), t0 = Date.now(), delay = ms => new Promise(r => setTimeout(r, ms));
    q('[data-err]').textContent = '';
    if (hasImg) { q('[data-up]').hidden = false; q('[data-uptext]').textContent = 'Uploading your photo… please wait a few seconds.'; back.querySelectorAll('input,textarea,button').forEach(x => { x.disabled = true; }); }
    try {
      if (demoMode) Object.assign(demoSelf, data);
      else {
        const upd = {};
        Object.entries(data).forEach(([k, v]) => { upd[`users/${u}/${k}`] = v; upd[`profiles/${u}/${k}`] = v; });
        await update(ref(db), upd);
      }
      if (hasImg) {
        const wait = 2000 - (Date.now() - t0); if (wait > 0) await delay(wait);
        q('[data-upbar]').hidden = true; q('[data-uptext]').textContent = '✅ Uploaded! Your friends can now see your new photo.';
        await delay(1300);
      }
      if (data.photo) state.currentUser.photo = data.photo;
      applyOwnPhoto(); back.remove();
      if (profileOverlay && profileUid === u) loadProfileDetails(u);
      showToast('Profile updated.');
    } catch (e) { q('[data-err]').textContent = friendlyError(e, 'Could not save your profile.'); back.querySelectorAll('input,textarea,button').forEach(x => { x.disabled = false; }); q('[data-up]').hidden = true; btn.textContent = 'Save'; }
  };
}

const demoSelf = { bio: 'Just trying out Murmur!', school: 'Demo High School', location: 'Manila, PH', interests: ['Music', 'Travel'], createdAt: new Date().toISOString(), birthday: '2000-05-17', gender: 'Prefer not to say', email: 'demo@example.com', phone: '0900 000 0000' };
function findPerson(uid) {
  if (uid === meUid()) return { uid, name: state.currentUser?.name || 'You', username: state.currentUser?.username || '' };
  const d = friendDocs.find(x => x.uid === uid) || searchResults.find(x => x.uid === uid);
  return d ? { uid, name: d.name, username: d.username } : null;
}
const relationOf = uid => (friendDocs.find(x => x.uid === uid) || {}).status || 'none';

function renderProfileActions() {
  if (!profileOverlay) return;
  if (profileUid === meUid()) {
    profileOverlay.querySelector('[data-p-actions]').innerHTML = '<button class="btn primary" type="button" data-p-edit>Edit profile</button>';
    profileOverlay.querySelector('[data-p-rel]').textContent = 'This is you';
    return;
  }
  const rel = relationOf(profileUid), person = findPerson(profileUid) || {};
  const B = (cls, attr, label) => `<button class="btn ${cls}" type="button" ${attr}>${label}</button>`;
  const main = rel === 'accepted' ? B('primary', 'data-p-msg', 'Message') + B('ghost', 'data-p-remove', 'Remove friend')
    : rel === 'incoming' ? B('primary', 'data-p-accept', 'Confirm request') + B('ghost', 'data-p-remove', 'Delete')
    : rel === 'outgoing' ? B('ghost', 'data-p-remove', 'Cancel request')
    : B('primary', 'data-p-add', 'Add friend');
  profileOverlay.querySelector('[data-p-actions]').innerHTML = main + B('ghost', `data-report-user="${esc(profileUid)}" data-name="${esc(person.name || '')}"`, 'Report');
  profileOverlay.querySelector('[data-p-rel]').textContent = { accepted: isActive(profileUid) ? 'Friends · Active now' : 'Friends', incoming: 'Sent you a friend request', outgoing: 'Friend request sent', none: 'Not your friend yet' }[rel];
  const dot = profileOverlay.querySelector('[data-p-dot]');
  if (dot) dot.hidden = !(rel === 'accepted' && isActive(profileUid));
}

async function loadProfileDetails(uid) {
  let d = null;
  const self = uid === meUid();
  if (demoMode) d = self ? demoSelf : demoDetails[uid];
  else { try { d = (await get(ref(db, (self ? 'users/' : 'profiles/') + uid))).val(); } catch {} }
  if (!profileOverlay || profileUid !== uid) return;
  const cover = profileOverlay.querySelector('.p-cover'), av = profileOverlay.querySelector('.avatar.big');
  if (okImg(d?.cover)) setBg(cover, d.cover); else cover.style.backgroundImage = '';
  if (okImg(d?.photo)) setBg(av, d.photo);
  const rows = [];
  if (d?.bio) rows.push(['📝', esc(d.bio)]);
  if (d?.school) rows.push(['🎓', 'Studies at <b>' + esc(d.school) + '</b>']);
  if (d?.location) rows.push(['📍', 'Lives in <b>' + esc(d.location) + '</b>']);
  const ints = Array.isArray(d?.interests) ? d.interests : Object.values(d?.interests || {});
  if (ints.length) rows.push(['❤️', ints.map(esc).join(', ')]);
  const joined = d?.createdAt ? new Date(d.createdAt) : null;
  if (joined && !isNaN(joined)) rows.push(['🗓️', 'Joined ' + joined.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })]);
  if (self && d) {
    if (d.birthday) { const b = new Date(d.birthday + 'T00:00:00'); if (!isNaN(b)) rows.push(['🎂', 'Born ' + b.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })]); }
    if (d.gender) rows.push(['🧑', esc(d.gender)]);
    if (d.email) rows.push(['✉️', esc(d.email)]);
    if (d.phone) rows.push(['📞', esc(d.phone)]);
  }
  profileOverlay.querySelector('[data-p-details]').innerHTML = rows.length ? rows.map(r => `<div class="p-row"><span>${r[0]}</span><div>${r[1]}</div></div>`).join('') : '<div class="empty">This person has not added any details yet.</div>';
}

function openProfile(uid) {
  const person = findPerson(uid);
  if (!person) return;
  closeProfile(true);
  profileUid = uid;
  if (location.hash !== '#profile') history.pushState(null, '', '#profile');
  const el = document.createElement('div');
  profileOverlay = el;
  el.className = 'screen-legal';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Profile');
  el.innerHTML = `
    <div class="legal-top"><button class="chat-back" style="display:grid;place-items:center" type="button" data-p-close aria-label="Back">←</button><strong style="flex:1;text-align:center;font-size:1.1rem">${esc(person.name)}</strong><span style="width:40px"></span></div>
    <div class="legal-body" style="padding:0"><div class="p-wrap">
      <div class="p-cover"></div>
      <div class="avatar-wrap p-avatar"><div class="avatar big">${esc(initials(person.name))}</div><span class="active-dot big" data-p-dot hidden></span></div>
      <h1 class="p-name">${esc(person.name)}</h1>
      <p class="p-sub">${esc(person.username)}</p>
      <p class="p-sub" data-p-rel></p>
      <div class="p-actions" data-p-actions></div>
      <h2 class="p-h">Personal details</h2>
      <div class="p-details" data-p-details><div class="empty">Loading…</div></div>
    </div></div>`;
  document.body.appendChild(el);
  el.querySelector('[data-p-close]').onclick = () => closeProfile(false);
  el.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfile(false); });
  el.addEventListener('click', async e => {
    const t = e.target.closest('[data-p-msg],[data-p-add],[data-p-accept],[data-p-remove],[data-p-edit]');
    if (!t) return;
    const u = meUid(), rel = relationOf(uid);
    if (t.hasAttribute('data-p-edit')) { openEditProfile(); return; }
    try {
      if (t.hasAttribute('data-p-msg')) { closeProfile(true); history.replaceState(null, '', location.pathname + location.search); setView('chats'); openChat(uid); return; }
      if (t.hasAttribute('data-p-add')) {
        if (demoMode) { friendDocs.push({ id: uid, ...person, status: 'outgoing' }); showToast('Friend request sent.'); }
        else await sendFriendRequest(person);
      } else if (t.hasAttribute('data-p-accept')) {
        if (demoMode) friendDocs.find(x => x.uid === uid).status = 'accepted';
        else await update(ref(db), { [`friends/${u}/${uid}/status`]: 'accepted', [`friends/${uid}/${u}/status`]: 'accepted' });
      } else {
        if (rel === 'accepted' && !confirm('Remove ' + person.name + ' from your friends?')) return;
        if (demoMode) friendDocs = friendDocs.filter(x => x.uid !== uid);
        else await update(ref(db), { [`friends/${u}/${uid}`]: null, [`friends/${uid}/${u}`]: null });
      }
      renderFriends(); renderChats(); renderAlerts(); renderProfileActions();
    } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
  });
  renderProfileActions();
  loadProfileDetails(uid);
  el.querySelector('[data-p-close]').focus();
}
['.menu-me', '#composerAvatar'].forEach(sel => {
  const node = document.querySelector(sel);
  if (!node) return;
  node.style.cursor = 'pointer';
  node.addEventListener('click', () => openProfile(meUid()));
});
document.addEventListener('click', e => { const pr = e.target.closest('[data-profile]'); if (pr) openProfile(pr.dataset.profile); });
function closeChat() {
  if (unsubMsgs) unsubMsgs();
  unsubMsgs = null; activeChatUid = null; chatMsgs = [];
  renderChats(); renderConversation();
}
document.getElementById('chatBack').addEventListener('click', () => { if (location.hash === '#chat') history.back(); else closeChat(); });
document.getElementById('chatProfileBtn').addEventListener('click', () => { if (activeChatUid) openProfile(activeChatUid); });
['chatAvatar', 'chatName'].forEach(id => {
  const node = document.getElementById(id);
  node.style.cursor = 'pointer';
  node.addEventListener('click', () => { if (activeChatUid) openProfile(activeChatUid); });
});
const DEMO_ME = 'demo-me';
const demoPeople = {
  ava: { uid: 'd-ava', name: 'Ava Santos', username: '@ava' },
  leo: { uid: 'd-leo', name: 'Leo Reyes', username: '@leo' },
  noah: { uid: 'd-noah', name: 'Noah Cruz', username: '@noah' },
  mia: { uid: 'd-mia', name: 'Mia Garcia', username: '@mia' },
  zoe: { uid: 'd-zoe', name: 'Zoe Tan', username: '@zoe' }
};

function startDemo() {
  const P = demoPeople, now = Date.now();
  demoMode = true;
  state.loggedIn = true;
  state.currentUser = { name: 'Demo User', email: '', username: '@demo', uid: DEMO_ME };
  state.users.me = { ...state.currentUser };
  state.activeView = 'home';
  const fr = (p, status) => ({ id: p.uid, ...p, status });
  friendDocs = [fr(P.ava, 'accepted'), fr(P.leo, 'accepted'), fr(P.noah, 'accepted'), fr(P.mia, 'incoming'), fr(P.zoe, 'outgoing')];
  presenceMap = { [P.ava.uid]: now + 1e12, [P.noah.uid]: now + 1e12 };
  const post = (id, a, text, ago, likes) => ({ id, authorUid: a.uid, authorName: a.name, authorUsername: a.username, text, createdAt: now - ago, likes: Object.fromEntries(likes.map(l => [l, true])) });
  remotePosts = [
    post('p1', P.ava, 'Coffee, a good playlist and a quiet morning. Perfect start to the week ☕', 36e5, [P.leo.uid, P.noah.uid]),
    post('p2', P.leo, 'Just finished my first 10k run! Legs are jelly but I feel amazing 🏃', 3 * 36e5, [P.ava.uid]),
    post('p3', P.noah, 'Anyone up for a movie night this Friday? I will bring the popcorn 🍿', 8 * 36e5, []),
    post('p4', P.ava, 'Welcome to Murmur! Say hi, share something, and meet your friends here.', 24 * 36e5, [P.leo.uid, P.noah.uid, DEMO_ME])
  ];
  demoChats = {
    [P.ava.uid]: [{ from: P.ava.uid, text: 'Hey! Welcome to Murmur 👋', createdAt: now - 6e5 }, { from: DEMO_ME, text: 'Thanks! Just looking around.', createdAt: now - 5e5 }, { from: P.ava.uid, text: 'Try posting something on Home!', createdAt: now - 4e5 }],
    [P.leo.uid]: [{ from: P.leo.uid, text: 'Are you coming Friday?', createdAt: now - 9e5 }]
  };
  annList = [{ id: 'a1', title: 'Welcome to the Murmur demo', body: 'Everything here is sample data. Nothing is saved or sent.', kind: 'info', pinned: true, createdAt: now }];
  notes = [{ id: 'n1', text: 'Try posting, liking, accepting Mia’s friend request and sending a message.', read: false, createdAt: now }];
  document.getElementById('demoBar').hidden = false;
  showApp();
  renderAnnouncements();
  window.scrollTo(0, 0);
}
function exitDemo() {
  demoMode = false; demoChats = {};
  remotePosts = null; friendDocs = []; presenceMap = {}; chatMsgs = []; activeChatUid = null; searchResults = [];
  annList = []; notes = [];
  state.loggedIn = false;
  state.currentUser = { ...DEFAULT_STATE.currentUser };
  state.users.me = { ...DEFAULT_STATE.currentUser };
  document.getElementById('demoBar').hidden = true;
  renderAnnouncements();
  showAuth();
}
function demoLikeDelete(likeBtn, delBtn) {
  if (delBtn) remotePosts = remotePosts.filter(p => p.id !== delBtn.dataset.del);
  else if (likeBtn) {
    const p = remotePosts.find(x => x.id === likeBtn.dataset.like);
    if (!p) return;
    p.likes = p.likes || {};
    if (p.likes[DEMO_ME]) delete p.likes[DEMO_ME]; else p.likes[DEMO_ME] = true;
  } else return;
  renderPosts();
}
function demoFriendAction({ add, acc, del, msg }) {
  if (add) { const r = searchResults[Number(add.dataset.frAdd)]; friendDocs.push({ id: r.uid, ...r, status: 'outgoing' }); showToast('Friend request sent.'); }
  else if (acc) { const d = friendDocs.find(x => x.uid === acc.dataset.frAccept); if (d) d.status = 'accepted'; }
  else if (del) friendDocs = friendDocs.filter(x => x.uid !== del.dataset.frDel);
  else if (msg) { setView('chats'); openChat(msg.dataset.msg); return; }
  else return;
  renderFriends(); renderChats(); renderAlerts(); renderProfileActions();
}
document.getElementById('demoBtn').addEventListener('click', startDemo);
document.getElementById('demoExit').addEventListener('click', exitDemo);

let annList = [], notes = [], suspendedInfo = null, extraSubs = [], presenceTimer = null;

function startExtras(uid) {
  stopExtras();
  const off = () => {};
  extraSubs = [
    onValue(query(ref(db, 'announcements'), orderByChild('createdAt'), limitToLast(20)), s => { annList = Object.entries(s.val() || {}).map(([id, a]) => ({ id, ...a })); renderAnnouncements(); }, off),
    onValue(ref(db, 'notifications/' + uid), s => { notes = Object.entries(s.val() || {}).map(([id, n]) => ({ id, ...n })).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); renderAlerts(); }, off),
    onValue(ref(db, 'suspended/' + uid), s => { suspendedInfo = s.exists() ? s.val() : null; renderSuspended(); }, off)
  ];
  const ping = () => set(ref(db, 'presence/' + uid), serverTimestamp()).catch(() => {});
  ping();
  presenceTimer = setInterval(() => { if (!document.hidden) ping(); }, 60000);
}
function stopExtras() {
  extraSubs.forEach(u => u()); extraSubs = [];
  clearInterval(presenceTimer); presenceTimer = null;
  annList = []; notes = []; suspendedInfo = null;
  renderAnnouncements(); renderSuspended();
}
function renderAnnouncements() {
  const box = document.getElementById('announceBox');
  const live = annList.filter(a => !a.expiresAt || a.expiresAt > Date.now()).sort((a, b) => (!!b.pinned - !!a.pinned) || ((b.createdAt || 0) - (a.createdAt || 0)));
  box.innerHTML = live.map(a => `<div class="tip ann ${esc(a.kind || 'info')}"><strong>${esc(a.title)}</strong><br />${esc(a.body)}</div>`).join('');
}
function renderSuspended() {
  document.getElementById('suspendedScreen')?.remove();
  if (!suspendedInfo) return;
  const el = document.createElement('div');
  el.id = 'suspendedScreen';
  el.className = 'modal-back';
  el.style.zIndex = '900';
  el.innerHTML = `<div class="modal-card"><h3>Your account is suspended</h3><p>${esc(suspendedInfo.reason || 'You broke the Murmur rules.')}</p><p>If you think this is a mistake, email ${esc(PRIVACY_CONTACT)}.</p><button class="btn primary" type="button">Log out</button></div>`;
  el.querySelector('button').onclick = () => document.getElementById('logoutBtn').click();
  document.body.appendChild(el);
}
function markNotesRead() {
  const u = meUid(); if (!u) return;
  if (demoMode) { notes.forEach(n => { n.read = true; }); return; }
  const upd = {};
  notes.filter(n => !n.read).forEach(n => { upd[`notifications/${u}/${n.id}/read`] = true; });
  if (Object.keys(upd).length) update(ref(db), upd).catch(() => {});
}
document.addEventListener('click', async e => {
  const rp = e.target.closest('[data-report-post],[data-report-user]');
  if (!rp) return;
  if (demoMode) { showToast('Reports are turned off in the demo.'); return; }
  const isPost = !!rp.dataset.reportPost;
  const reason = prompt('Why are you reporting this ' + (isPost ? 'post' : 'person') + '? (for example: spam, harassment)');
  if (!reason || !reason.trim()) return;
  try {
    await push(ref(db, 'reports'), { type: isPost ? 'post' : 'user', targetId: isPost ? rp.dataset.reportPost : rp.dataset.reportUser, targetName: rp.dataset.name || '', reason: reason.trim().slice(0, 60), details: '', by: meUid(), byName: state.currentUser?.name || 'someone', createdAt: serverTimestamp(), status: 'open' });
    showToast('Report sent. Thank you.');
  } catch (err) { showToast(friendlyError(err, 'Could not send report.')); }
});

async function sendMessage() {
  const input = document.getElementById('messageInput');
  const text = input.value.trim();
  if (!text || !activeChatUid) return;
  input.value = '';
  if (demoMode) {
    const to = activeChatUid, list = (demoChats[to] = demoChats[to] || []);
    list.push({ from: DEMO_ME, text, createdAt: Date.now() });
    chatMsgs = list; renderConversation();
    setTimeout(() => {
      if (!demoMode) return;
      list.push({ from: to, text: ['Haha nice!', 'Sounds good 😄', 'Tell me more!', 'Same here!'][Math.floor(Math.random() * 4)], createdAt: Date.now() });
      if (activeChatUid === to) { chatMsgs = list; renderConversation(); }
    }, 1200);
    return;
  }
  try { await push(ref(db, `chats/${chatIdOf(meUid(), activeChatUid)}/messages`), { from: meUid(), text, createdAt: serverTimestamp() }); }
  catch (e) { input.value = text; showToast(friendlyError(e, 'Message failed.')); }
}

async function createPost() {
  const input = document.getElementById('postInput');
  const text = input.value.trim();
  if (!text) return;
  if (demoMode) {
    remotePosts.unshift({ id: 'p' + Date.now(), authorUid: DEMO_ME, authorName: 'Demo User', authorUsername: '@demo', text, createdAt: Date.now(), likes: {} });
    input.value = ''; renderPosts(); return;
  }
  const user = auth.currentUser;
  if (user && remotePosts) {
    if (!user.emailVerified) { showToast('Verify your email to post.'); return; }
    try {
      await push(ref(db, 'posts'), { authorUid: user.uid, authorName: state.currentUser?.name || 'Someone', authorUsername: state.currentUser?.username || '', text, createdAt: serverTimestamp() });
      input.value = '';
    } catch (e) { showToast(friendlyError(e, 'Could not post.')); }
    return;
  }
  state.posts.unshift({ id: Date.now(), author: 'me', text, likes: 0, liked: false });
  input.value = '';
  saveState();
  renderPosts();
}

document.getElementById('loginBtn').addEventListener('click', () => {
  login(document.getElementById('email').value, document.getElementById('password').value);
});
document.getElementById('createBtn').addEventListener('click', openRegisterWizard);
document.getElementById('resetBtn').addEventListener('click', openForgotPassword);
document.getElementById('postBtn').addEventListener('click', createPost);
document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('logoutBtn').addEventListener('click', async () => {
  if (demoMode) { exitDemo(); return; }
  try {
    await signOut(auth);
  } catch (error) {
    console.warn('Sign out failed:', error);
  }
  state.loggedIn = false;
  saveState();
  showAuth();
});
document.getElementById('messageInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') sendMessage();
});
document.getElementById('postInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') createPost();
});
document.getElementById('chatSearch').addEventListener('input', e => {
  const q = e.target.value.trim().toLowerCase();
  const list = document.getElementById('chatList');
  list.querySelectorAll('.chat-item').forEach(item => {
    const name = item.textContent.toLowerCase();
    item.style.display = q && !name.includes(q) ? 'none' : 'flex';
  });
});

document.querySelectorAll('[data-view]').forEach(btn => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

document.getElementById('friendSearchBtn').addEventListener('click', searchFriends);
document.getElementById('friendSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchFriends(); });
document.addEventListener('click', async e => {
  const add = e.target.closest('[data-fr-add]'), acc = e.target.closest('[data-fr-accept]'), del = e.target.closest('[data-fr-del]'), msg = e.target.closest('[data-msg]');
  try {
    if (demoMode) { demoFriendAction({ add, acc, del, msg }); return; }
    if (add) { await sendFriendRequest(searchResults[Number(add.dataset.frAdd)]); return; }
    if (acc) { const o = acc.dataset.frAccept, u = meUid(); await update(ref(db), { [`friends/${u}/${o}/status`]: 'accepted', [`friends/${o}/${u}/status`]: 'accepted' }); return; }
    if (del) { const o = del.dataset.frDel, u = meUid(); await update(ref(db), { [`friends/${u}/${o}`]: null, [`friends/${o}/${u}`]: null }); return; }
    if (msg) { setView('chats'); openChat(msg.dataset.msg); return; }
  } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
});
document.addEventListener('click', async e => {
  const likeBtn = e.target.closest('[data-like]');
  const delBtn = e.target.closest('[data-del]');
  const uid = auth.currentUser?.uid;
  try {
    if (demoMode) { demoLikeDelete(likeBtn, delBtn); return; }
    if (delBtn && remotePosts) { await remove(ref(db, 'posts/' + delBtn.dataset.del)); return; }
    if (!likeBtn) return;
    if (remotePosts && uid) {
      const post = remotePosts.find(p => p.id === likeBtn.dataset.like);
      if (!post) return;
      const lr = ref(db, `posts/${post.id}/likes/${uid}`);
      const had = !!(post.likes || {})[uid];
      await (had ? remove(lr) : set(lr, true));
      if (!had && post.authorUid && post.authorUid !== uid) set(ref(db, `notifications/${post.authorUid}/like_${post.id}_${uid}`), { type: 'like', postId: post.id, from: uid, text: `${state.currentUser?.name || 'Someone'} liked your post`, createdAt: serverTimestamp(), read: false }).catch(() => {});
      return;
    }
    const post = state.posts.find(p => p.id === Number(likeBtn.dataset.like));
    if (!post) return;
    post.liked = !post.liked;
    post.likes += post.liked ? 1 : -1;
    saveState();
    renderPosts();
  } catch (err) { showToast(friendlyError(err, 'Action failed.')); }
});

document.getElementById('hdrAdd').addEventListener('click', () => { setView('home'); setTimeout(() => document.getElementById('postInput').focus(), 50); });
document.getElementById('hdrSearch').addEventListener('click', () => { setView('friends'); setTimeout(() => document.getElementById('friendSearch').focus(), 50); });

function openDeleteAccount() {
  if (demoMode) { showToast('Not available in the demo.'); return; }
  const user = auth.currentUser;
  if (!user) return;
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal-card" role="dialog" aria-modal="true"><h3>Delete your account?</h3>
    <p>This permanently deletes your profile and your posts. It can't be undone. Enter your password to confirm.</p>
    <input type="password" autocomplete="current-password" placeholder="Password" />
    <div class="error" role="alert"></div>
    <div class="cookie-actions"><button class="btn ghost" type="button" data-cancel>Cancel</button><button class="btn primary" type="button" data-confirm style="background:var(--danger);color:#fff">Delete forever</button></div></div>`;
  document.body.appendChild(back);
  const pw = back.querySelector('input'), err = back.querySelector('.error'), ok = back.querySelector('[data-confirm]');
  back.querySelector('[data-cancel]').onclick = () => back.remove();
  pw.focus();
  ok.onclick = async () => {
    err.textContent = '';
    if (!pw.value) { err.textContent = 'Enter your password.'; return; }
    ok.disabled = true; ok.textContent = 'Deleting...';
    try {
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, pw.value));
      const mine = await get(query(ref(db, 'posts'), orderByChild('authorUid'), equalTo(user.uid)));
      const wipe = {};
      Object.keys(mine.val() || {}).forEach(id => { wipe['posts/' + id] = null; });
      friendDocs.forEach(d => { wipe[`friends/${user.uid}/${d.uid}`] = null; wipe[`friends/${d.uid}/${user.uid}`] = null; });
      wipe['profiles/' + user.uid] = null; wipe['presence/' + user.uid] = null; wipe['notifications/' + user.uid] = null; wipe['users/' + user.uid] = null;
      await update(ref(db), wipe);
      await deleteUser(user);
      stopPostsListener();
      state.loggedIn = false; state.currentUser = { ...DEFAULT_STATE.currentUser };
      saveState(); back.remove(); showAuth(); showToast('Your account was deleted.');
    } catch (e) {
      err.textContent = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential' ? 'Wrong password.' : (friendlyError(e, 'Could not delete account.'));
      ok.disabled = false; ok.textContent = 'Delete forever';
    }
  };
}
document.getElementById('deleteAccountBtn').addEventListener('click', openDeleteAccount);

onAuthStateChanged(auth, (user) => {
  if (user) { startPostsListener(); startFriendsListener(user.uid); startExtras(user.uid); ensureProfile(user); } else { stopPostsListener(); stopFriendsListener(); stopExtras(); }
  renderVerify();
  if (user) {
    state.loggedIn = true;
    state.currentUser = {
      uid: user.uid,
      name: state.currentUser?.name || 'Maya Chen',
      email: user.email || state.currentUser?.email || 'maya@example.com',
      username: state.currentUser?.username || '@maya'
    };
    saveState();
  }
});

setTimeout(() => {
  splash.classList.add('hide');
  setTimeout(() => splash.remove(), 500);
  if (state.loggedIn) showApp();
  else {
    showAuth();
    if (location.hash === '#create-account') openRegisterWizard();
    else if (location.hash === '#forgot-password') openForgotPassword();
  }
  if (LEGAL_HASHES[location.hash]) openLegal(LEGAL_HASHES[location.hash], true);
  maybeShowCookieNotice();
}, 1100);
