// Лимит сканов, реклама за сканы и подписка Pro.
// Реклама — AdMob (плагин @capacitor-community/admob), пока на тестовых id Google.
// Подписка — Google Play Billing, заработает после публикации (нужен товар в Play Console).
import { settings, saveSettings } from './store.js';

export const FREE_SCANS = 40;
export const AD_REWARD = 5;
export const PLANS = {
  month: { id: 'holoscan_pro_monthly', price: '$2.99' },
  year: { id: 'holoscan_pro_yearly', price: '$19.99', save: 44 },
};
// AdMob: аккаунт pub-5488107438895752, приложение ca-app-pub-5488107438895752~6190432341 (в AndroidManifest).
// live: false — тестовая реклама Google (за неё не платят, зато её можно смотреть самому).
// В сборке для Google Play поставить live: true — тогда пойдёт настоящая реклама из блока rewarded.
const ADS = {
  live: false,
  rewarded: 'ca-app-pub-5488107438895752/5807288960', // блок «+5 scans»
  test: 'ca-app-pub-3940256099942544/5224354917',
};
const LIVE = ADS.live && !!ADS.rewarded;
const REWARDED_AD_ID = LIVE ? ADS.rewarded : ADS.test;

settings.scansUsed ??= 0;
settings.bonusScans ??= 0;
settings.pro ??= false;

export const isPro = () => settings.pro === true;
export const scansLeft = () => Math.max(0, FREE_SCANS + settings.bonusScans - settings.scansUsed);
export const canScan = () => isPro() || scansLeft() > 0;
export function useScan() {
  if (isPro()) return;
  settings.scansUsed++;
  saveSettings();
}

const AdMob = () => window.Capacitor?.isNativePlatform?.() && window.Capacitor.Plugins?.AdMob;
let adInit;

// Показывает рекламу с вознаграждением. true — досмотрели, сканы начислены.
export async function watchAd(onFake) {
  const ad = AdMob();
  let rewarded = false;
  if (ad) {
    adInit ??= ad.initialize({ initializeForTesting: !LIVE }).catch(() => {});
    await adInit;
    const sub = await ad.addListener('onRewardedVideoAdReward', () => { rewarded = true; });
    try {
      await ad.prepareRewardVideoAd({ adId: REWARDED_AD_ID, isTesting: !LIVE });
      const r = await ad.showRewardVideoAd();
      if (r && (r.amount != null || r.type)) rewarded = true;
    } finally {
      sub?.remove?.();
    }
  } else {
    rewarded = await onFake(); // в браузере — заглушка, чтобы проверить сценарий
  }
  if (rewarded) {
    settings.bonusScans += AD_REWARD;
    saveSettings();
  }
  return rewarded;
}

// Покупка подписки. Пока приложения нет в Google Play, возвращаем 'unavailable'.
export async function subscribe(plan) {
  const store = window.CdvPurchase?.store;
  if (!store) return 'unavailable';
  const offer = store.get(PLANS[plan].id)?.getOffer();
  if (!offer) return 'unavailable';
  const err = await offer.order();
  return err ? 'error' : 'pending';
}
export async function restore() {
  const store = window.CdvPurchase?.store;
  if (!store) return 'unavailable';
  await store.restorePurchases();
  return 'ok';
}
