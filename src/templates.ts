import type { CardStyle, InlineKeyboardButton, Marketplace, PhotoMode, ReplyMarkup } from "./types.ts";
import { escapeHtml, marketplaceLabel } from "./utils.ts";

export const mainKeyboard: ReplyMarkup = {
  inline_keyboard: [
    [{ text: "✨ Создать карточку", callback_data: "create" }],
    [
      { text: "📊 Мой тариф", callback_data: "plan" },
      { text: "⭐ Подписка", callback_data: "subscribe" },
    ],
  ],
};

export const marketplaceKeyboard: ReplyMarkup = {
  inline_keyboard: [
    [
      { text: "Ozon", callback_data: "market:ozon" },
      { text: "Wildberries", callback_data: "market:wildberries" },
    ],
    [{ text: "Яндекс Маркет", callback_data: "market:yandex" }],
    [{ text: "Отмена", callback_data: "cancel" }],
  ],
};

export const photoModeKeyboard: ReplyMarkup = {
  inline_keyboard: [
    [{ text: "🖼 У меня готовое красивое фото", callback_data: "mode:ready" }],
    [{ text: "📦 Обычное фото товара", callback_data: "mode:product" }],
    [{ text: "Отмена", callback_data: "cancel" }],
  ],
};

export const featuresKeyboard: ReplyMarkup = {
  inline_keyboard: [
    [{ text: "Пропустить преимущества", callback_data: "features:skip" }],
    [{ text: "Отмена", callback_data: "cancel" }],
  ],
};

export const styleKeyboard: ReplyMarkup = {
  inline_keyboard: [
    [{ text: "🤍 Минимализм", callback_data: "style:minimal" }],
    [{ text: "🖤 Премиум", callback_data: "style:premium" }],
    [{ text: "🌈 Яркий", callback_data: "style:bright" }],
    [{ text: "Отмена", callback_data: "cancel" }],
  ],
};

export function urlKeyboard(text: string, url: string): ReplyMarkup {
  return { inline_keyboard: [[{ text, url }]] };
}

const styleTokens: Record<
  CardStyle,
  {
    background: string;
    ink: string;
    accent: string;
    muted: string;
    glass: string;
    line: string;
    readyOverlay: string;
    sceneOverlay: string;
    badgeInk: string;
  }
> = {
  minimal: {
    background: "linear-gradient(145deg,#f8fafc 0%,#e9eef7 58%,#dfe7f3 100%)",
    ink: "#101522",
    accent: "#3867ff",
    muted: "#687386",
    glass: "rgba(255,255,255,.82)",
    line: "rgba(17,24,39,.10)",
    readyOverlay: "linear-gradient(180deg,rgba(8,14,28,.12) 0%,rgba(8,14,28,.01) 42%,rgba(8,14,28,.76) 100%)",
    sceneOverlay: "linear-gradient(180deg,rgba(248,250,252,.30) 0%,rgba(248,250,252,.02) 40%,rgba(9,15,27,.34) 100%)",
    badgeInk: "#111827",
  },
  premium: {
    background: "radial-gradient(circle at 20% 12%,#413b31 0%,#181716 42%,#050505 100%)",
    ink: "#fffaf0",
    accent: "#d9b96e",
    muted: "#c8c0af",
    glass: "rgba(20,20,19,.76)",
    line: "rgba(255,255,255,.15)",
    readyOverlay: "linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,.01) 38%,rgba(0,0,0,.80) 100%)",
    sceneOverlay: "linear-gradient(180deg,rgba(0,0,0,.28) 0%,rgba(0,0,0,.01) 42%,rgba(0,0,0,.56) 100%)",
    badgeInk: "#fffaf0",
  },
  bright: {
    background: "linear-gradient(145deg,#fff173 0%,#ff9bcf 48%,#91e9ff 100%)",
    ink: "#241442",
    accent: "#8728ff",
    muted: "#5f4e79",
    glass: "rgba(255,255,255,.80)",
    line: "rgba(54,28,91,.13)",
    readyOverlay: "linear-gradient(180deg,rgba(35,17,66,.07) 0%,rgba(35,17,66,.01) 44%,rgba(35,17,66,.76) 100%)",
    sceneOverlay: "linear-gradient(180deg,rgba(255,255,255,.20) 0%,rgba(255,255,255,.01) 42%,rgba(36,20,66,.38) 100%)",
    badgeInk: "#25133f",
  },
};

export interface CardHtmlInput {
  marketplace: Marketplace;
  style: CardStyle;
  photoMode: PhotoMode;
  title: string;
  features: string[];
  sourceUrl: string;
  backgroundUrl?: string;
}

function benefitItems(features: string[]): string {
  const items = features.length ? features : ["Акцент на товаре", "Готово для публикации"];
  return items
    .map((feature) => `<li><i></i><span>${escapeHtml(feature)}</span></li>`)
    .join("");
}

function readyPhotoLayout(input: CardHtmlInput): string {
  return `<div class="ready-photo">
    <img class="ready-blur" src="${escapeHtml(input.sourceUrl)}" alt="">
    <img class="ready-main" src="${escapeHtml(input.sourceUrl)}" alt="Товар">
    <div class="ready-overlay"></div>
    <header class="ready-top">
      <div class="market-badge">${escapeHtml(marketplaceLabel(input.marketplace))}</div>
      <div class="format-label">MARKET CARD</div>
    </header>
    <section class="ready-copy">
      <h1>${escapeHtml(input.title)}</h1>
      <ul class="ready-benefits">${benefitItems(input.features)}</ul>
    </section>
  </div>`;
}

function fallbackProductVisual(input: CardHtmlInput): string {
  return `<section class="product-stage">
      <div class="halo"></div>
      <img class="product-image" src="${escapeHtml(input.sourceUrl)}" alt="Товар">
      <div class="pedestal"></div>
    </section>`;
}

function productLayout(input: CardHtmlInput): string {
  const aiScene = input.backgroundUrl
    ? `<img class="ai-scene" src="${escapeHtml(input.backgroundUrl)}" alt="AI product scene">`
    : fallbackProductVisual(input);
  const sceneClass = input.backgroundUrl ? " has-ai-scene" : "";

  return `${aiScene}
    <div class="product-veil${sceneClass}"></div>
    <header class="product-top">
      <div class="market-badge">${escapeHtml(marketplaceLabel(input.marketplace))}</div>
      <div class="format-label">AI MARKET CARD</div>
    </header>
    <section class="product-copy${sceneClass}">
      <h1>${escapeHtml(input.title)}</h1>
    </section>
    <ul class="product-benefits${sceneClass}">${benefitItems(input.features)}</ul>`;
}

export function renderCardHtml(input: CardHtmlInput): string {
  const t = styleTokens[input.style];
  const body = input.photoMode === "ready" ? readyPhotoLayout(input) : productLayout(input);

  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=1200">
<style>
*{box-sizing:border-box}html,body{margin:0;width:1200px;height:1600px;overflow:hidden}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif;background:${t.background};color:${t.ink}}
.canvas{position:relative;width:1200px;height:1600px;overflow:hidden;isolation:isolate;background:${t.background}}
.market-badge{display:inline-flex;align-items:center;min-height:58px;padding:0 25px;border-radius:999px;background:${t.glass};border:1px solid ${t.line};backdrop-filter:blur(22px);font-size:25px;font-weight:850;letter-spacing:-.02em;color:${t.badgeInk};box-shadow:0 12px 40px rgba(0,0,0,.10)}
.format-label{font-size:18px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;opacity:.80}
h1{margin:0;font-size:72px;line-height:.96;letter-spacing:-.052em;font-weight:920;text-wrap:balance}

.ready-photo{position:absolute;inset:0;background:${t.background}}
.ready-blur{position:absolute;inset:-45px;width:1290px;height:1690px;object-fit:cover;filter:blur(38px) saturate(1.04);transform:scale(1.05);opacity:.78}
.ready-main{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;z-index:1}
.ready-overlay{position:absolute;inset:0;z-index:2;background:${t.readyOverlay}}
.ready-top{position:absolute;z-index:3;left:68px;right:68px;top:62px;display:flex;align-items:center;justify-content:space-between;color:white}
.ready-top .market-badge{background:rgba(255,255,255,.84);color:#121621;border-color:rgba(255,255,255,.42)}
.ready-copy{position:absolute;z-index:3;left:68px;right:68px;bottom:66px;color:white}
.ready-copy h1{max-width:1030px;text-shadow:0 7px 34px rgba(0,0,0,.28)}
.ready-benefits{list-style:none;margin:35px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:13px}
.ready-benefits li{display:flex;align-items:center;gap:12px;min-height:54px;padding:0 18px;border-radius:999px;background:rgba(15,18,26,.48);border:1px solid rgba(255,255,255,.19);backdrop-filter:blur(18px);font-size:21px;font-weight:720}
.ready-benefits i{width:9px;height:9px;border-radius:50%;background:${t.accent};box-shadow:0 0 0 5px rgba(255,255,255,.08)}

.ai-scene{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:-5}
.product-veil{position:absolute;inset:0;z-index:-4;background:${t.background}}
.product-veil.has-ai-scene{background:${t.sceneOverlay}}
.product-top{position:absolute;left:62px;right:62px;top:58px;z-index:5;display:flex;align-items:center;justify-content:space-between}
.product-copy{position:absolute;left:62px;right:62px;top:160px;z-index:5;max-width:1010px}
.product-copy.has-ai-scene{right:auto;max-width:920px;padding:30px 34px 34px;border-radius:34px;background:${t.glass};border:1px solid ${t.line};backdrop-filter:blur(22px);box-shadow:0 20px 60px rgba(0,0,0,.12)}
.product-copy h1{max-width:100%;text-shadow:0 2px 16px rgba(0,0,0,.05)}

.product-stage{position:absolute;left:38px;right:38px;top:380px;height:900px;display:flex;align-items:center;justify-content:center;overflow:visible}
.halo{position:absolute;width:820px;height:820px;border-radius:50%;background:${t.glass};border:1px solid ${t.line};box-shadow:0 50px 120px rgba(0,0,0,.12);backdrop-filter:blur(18px)}
.product-image{position:relative;z-index:3;width:94%;height:96%;object-fit:contain;filter:drop-shadow(0 30px 34px rgba(0,0,0,.24))}
.pedestal{position:absolute;z-index:2;width:680px;height:95px;bottom:25px;border-radius:50%;background:rgba(0,0,0,.16);filter:blur(24px)}

.product-benefits{position:absolute;left:62px;right:62px;bottom:58px;z-index:5;list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
.product-benefits.has-ai-scene{grid-template-columns:repeat(2,minmax(0,1fr))}
.product-benefits li{min-height:76px;padding:15px 21px;border-radius:24px;background:${t.glass};border:1px solid ${t.line};backdrop-filter:blur(22px);display:flex;align-items:center;gap:13px;font-size:22px;line-height:1.14;font-weight:760;box-shadow:0 14px 38px rgba(0,0,0,.10)}
.product-benefits i{width:11px;height:11px;border-radius:50%;background:${t.accent};flex:none;box-shadow:0 0 0 6px color-mix(in srgb,${t.accent} 14%,transparent)}
</style></head><body><main class="canvas">${body}</main></body></html>`;
}

export function buttons(...rows: InlineKeyboardButton[][]): ReplyMarkup {
  return { inline_keyboard: rows };
}
