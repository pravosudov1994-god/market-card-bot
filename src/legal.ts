import type { AppConfig } from "./config.ts";
import { escapeHtml } from "./utils.ts";

function page(title: string, body: string, config: AppConfig): Response {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>body{font:17px/1.6 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:36px 22px;color:#172033}h1{line-height:1.1}h2{margin-top:32px}a{color:#245cff}</style></head>
<body><h1>${escapeHtml(title)}</h1>${body}<hr><p>Поддержка: ${escapeHtml(config.supportUsername)}</p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public,max-age=3600" } });
}

export function termsPage(config: AppConfig): Response {
  return page(
    "Условия использования",
    `<p>Сервис ${escapeHtml(config.botName)} создаёт изображения карточек товаров по материалам пользователя.</p>
<h2>Подписка</h2><p>Подписка приобретается за ${config.subscriptionStars} Telegram Stars на 30 дней и включает до ${config.monthlyGenerations} генераций. Обозначение ${escapeHtml(config.priceLabelRub)} носит справочный характер: фактическая цена Stars показывается Telegram перед оплатой.</p>
<h2>Права и ответственность</h2><p>Загружая фото и текст, пользователь подтверждает право на их использование. Пользователь самостоятельно проверяет итоговую карточку и её соответствие правилам выбранного маркетплейса.</p>
<h2>Отмена</h2><p>Автопродление можно отключить командой /cancel_subscription. Доступ сохраняется до конца уже оплаченного периода. По вопросам платежей используйте /paysupport.</p>`,
    config,
  );
}

export function privacyPage(config: AppConfig): Response {
  return page(
    "Политика конфиденциальности",
    `<p>Бот обрабатывает Telegram ID, имя пользователя, команды, тексты карточек, сведения о подписке и загруженные изображения — только для работы сервиса.</p>
<h2>Хранение</h2><p>Исходное фото и AI-фон обрабатываются в оперативной памяти и не записываются в отдельное файловое хранилище сервиса. Telegram file_id и техническая история генераций могут сохраняться для учёта лимитов и повторной отправки.</p>
<h2>Передача</h2><p>Для генерации и компоновки изображения обрабатываются инфраструктурой Cloudflare и Telegram. Данные не продаются третьим лицам.</p>
<h2>Запросы</h2><p>Для вопросов об удалении или исправлении данных обратитесь в поддержку: ${escapeHtml(config.supportUsername)}.</p>`,
    config,
  );
}
