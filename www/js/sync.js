// Вход через Google (Firebase Auth) и синхронизация коллекции и счётчика сканов
// через Firestore: документ users/{uid}. Работает только в приложении (нативные плагины).
import * as store from './store.js';

const P = () => window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins : null;
const Auth = () => P()?.FirebaseAuthentication;
const Db = () => P()?.FirebaseFirestore;

let user = null;
const listeners = new Set();
export const onUser = (f) => listeners.add(f);
export const currentUser = () => user;
export const available = () => !!Auth();
function setUser(u) {
  user = u ? { uid: u.uid, name: u.displayName || '', email: u.email || '', photo: u.photoUrl || '' } : null;
  listeners.forEach((f) => f(user));
}

const ref = () => `users/${user.uid}`;
// фото сканов в облако не кладём — документ Firestore ограничен 1 МБ
// и историю цены каждой карты укорачиваем до 14 точек
const plainItems = () => store.all().map(({ photo, hist, ...rest }) => ({ ...rest, hist: (hist || []).slice(-14) }));
const SYNCED = ['scansUsed', 'bonusScans', 'pro'];

// Слияние при входе: карты объединяем (берём большее количество), счётчики — по максимуму,
// чтобы переустановка приложения не обнуляла использованные сканы.
async function pull() {
  const snap = await Db().getDocument({ reference: ref() });
  const remote = snap?.snapshot?.data;
  if (!remote) return;
  store.importBinders(remote.binders);
  store.importWish(remote.wish);
  store.importHistory(remote.history);
  const key = (i) => `${i.lang}:${i.id}:${i.variant}:${i.binder || ''}`;
  const local = new Map(store.all().map((i) => [key(i), i]));
  for (const r of remote.items || []) {
    const l = local.get(key(r));
    if (!l) store.importItem(r);
    else if (r.qty > l.qty) store.setQty(l.uid, r.qty);
  }
  const st = store.settings;
  const rs = remote.settings || {};
  st.scansUsed = Math.max(st.scansUsed || 0, rs.scansUsed || 0);
  st.bonusScans = Math.max(st.bonusScans || 0, rs.bonusScans || 0);
  st.pro = st.pro || rs.pro === true;
  store.saveSettings();
  store.flush();
}

let pushTimer;
export function schedulePush() {
  if (!user || !Db()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 2000);
}
async function push() {
  if (!user) return;
  const settings = Object.fromEntries(SYNCED.map((k) => [k, store.settings[k] ?? null]));
  const data = {
    items: plainItems(), settings, updatedAt: Date.now(),
    binders: store.allBinders(), wish: store.wishlist(), history: store.valueHistory().slice(-365),
  };
  await Db().setDocument({ reference: ref(), data, merge: true })
    .catch((e) => console.warn('sync push', e));
}

export async function init() {
  if (!Auth()) return;
  try {
    const r = await Auth().getCurrentUser();
    if (r?.user) { setUser(r.user); await pull().catch((e) => console.warn('sync pull', e)); }
  } catch (e) { console.warn('auth init', e); }
  store.onChange(schedulePush);
  store.onSettings(schedulePush);
}

export async function signIn() {
  if (!Auth()) throw new Error('unavailable');
  const r = await Auth().signInWithGoogle();
  setUser(r.user);
  await pull().catch((e) => console.warn('sync pull', e));
  await push();
  return user;
}

export async function signOut() {
  await push().catch(() => {});
  await Auth()?.signOut();
  setUser(null);
}
