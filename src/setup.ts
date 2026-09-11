import { isBotConfigured, markSetupComplete, saveBotSettings, verifySetupCode } from "./settings.ts";
import { configureTelegramWebhook, getBotIdentity } from "./telegram.ts";
import type { Env } from "./types.ts";
import { escapeHtml, randomToken } from "./utils.ts";

function page(content: string, status = 200): Response {
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Настройка MarketCard AI</title><style>body{font:17px/1.5 system-ui,sans-serif;max-width:620px;margin:0 auto;padding:42px 22px;color:#172033;background:#f6f8fc}main{background:#fff;padding:30px;border-radius:24px;box-shadow:0 18px 60px #23304a18}h1{line-height:1.1}label{display:block;margin:20px 0 7px;font-weight:700}input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #cbd3e1;border-radius:12px;font:inherit}button{margin-top:24px;width:100%;padding:15px;border:0;border-radius:12px;background:#245cff;color:#fff;font:700 17px system-ui;cursor:pointer}.note{color:#5d6879;font-size:14px}.error{color:#a51d2d;background:#fff0f2;padding:12px;border-radius:10px}</style></head>
<body><main>${content}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function form(error?: string): Response {
  return page(`<h1>Подключение Telegram-бота</h1>
${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
<p>Данные отправляются напрямую в ваш Cloudflare Worker. Токен шифруется перед записью в D1, а эта страница отключится после настройки.</p>
<form method="post" autocomplete="off">
<label for="code">Одноразовый код настройки</label><input id="code" name="code" required>
<label for="token">Токен от BotFather</label><input id="token" name="token" type="password" required>
<label for="support">Ваш Telegram username</label><input id="support" name="support" placeholder="@username" required>
<button type="submit">Подключить бота</button></form>
<p class="note">Не используйте пароль от Telegram. Нужен только токен нового бота, который выдаёт @BotFather.</p>`);
}

export async function handleSetup(request: Request, env: Env): Promise<Response> {
  if (await isBotConfigured(env)) {
    return page("<h1>Бот уже настроен</h1><p>Повторная отправка токена через эту страницу заблокирована.</p>", 409);
  }
  if (request.method === "GET") return form();
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!env.APP_ENCRYPTION_KEY) return page("<h1>Настройка ещё не готова</h1><p>Отсутствует ключ шифрования.</p>", 503);

  const body = await request.formData();
  const code = String(body.get("code") ?? "").trim();
  const token = String(body.get("token") ?? "").trim();
  const supportUsername = String(body.get("support") ?? "").trim();
  if (!(await verifySetupCode(env, code))) return form("Неверный или устаревший код настройки.");
  if (!/^\d{6,12}:[A-Za-z0-9_-]{30,}$/.test(token)) return form("Токен имеет неверный формат.");
  if (!/^@[A-Za-z0-9_]{5,32}$/.test(supportUsername)) {
    return form("Укажите Telegram username в формате @username.");
  }

  try {
    const bot = await getBotIdentity(env, token);
    if (!bot.username) throw new Error("bot_username_missing");
    const webhookSecret = randomToken(32);
    const runtimeEnv: Env = {
      ...env,
      TELEGRAM_BOT_TOKEN: token,
      TELEGRAM_WEBHOOK_SECRET: webhookSecret,
      SUPPORT_USERNAME: supportUsername,
    };
    await saveBotSettings(env, {
      botToken: token,
      webhookSecret,
      supportUsername,
      botUsername: bot.username,
    });
    await configureTelegramWebhook(runtimeEnv, new URL(request.url).origin);
    await markSetupComplete(env);
    return page(
      `<h1>Готово!</h1><p>Бот <b>@${escapeHtml(bot.username)}</b> подключён, webhook и команды установлены.</p><p><a href="https://t.me/${escapeHtml(bot.username)}">Открыть бота в Telegram</a></p>`,
    );
  } catch {
    return form("Telegram не принял токен или временно недоступен. Проверьте токен и попробуйте ещё раз.");
  }
}
