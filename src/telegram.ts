import type {
  Env,
  InlineKeyboardButton,
  ReplyMarkup,
  TelegramFile,
  TelegramMessage,
  TelegramUser,
} from "./types.ts";

interface TelegramApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

async function telegramApi<T>(
  env: Env,
  method: string,
  payload: Record<string, unknown> | FormData,
): Promise<T> {
  const isForm = payload instanceof FormData;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: isForm ? undefined : { "content-type": "application/json" },
    body: isForm ? payload : JSON.stringify(payload),
  });
  let data: TelegramApiResponse<T>;
  try {
    data = (await response.json()) as TelegramApiResponse<T>;
  } catch {
    throw new Error(`telegram_${method}_invalid_response`);
  }
  if (!response.ok || !data.ok || data.result === undefined) {
    const description = data.description?.replace(/[\r\n]+/g, " ").slice(0, 120) ?? "request_failed";
    throw new Error(`telegram_${method}_${data.error_code ?? response.status}_${description}`);
  }
  return data.result;
}

export async function getBotIdentity(env: Env, token: string): Promise<TelegramUser> {
  return telegramApi<TelegramUser>({ ...env, TELEGRAM_BOT_TOKEN: token }, "getMe", {});
}

export async function configureTelegramWebhook(env: Env, origin: string): Promise<void> {
  const commands = [
    { command: "create", description: "Создать изображение" },
    { command: "plan", description: "Мой тариф и лимиты" },
    { command: "subscribe", description: "Оформить подписку" },
    { command: "cancel", description: "Отменить текущую генерацию" },
    { command: "cancel_subscription", description: "Отключить автопродление" },
    { command: "paysupport", description: "Поддержка по оплате" },
    { command: "terms", description: "Условия использования" },
    { command: "privacy", description: "Политика конфиденциальности" },
  ];
  await telegramApi<boolean>(env, "setMyCommands", { commands });
  await telegramApi<boolean>(env, "setWebhook", {
    url: `${origin}/telegram/webhook`,
    secret_token: env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ["message", "callback_query", "pre_checkout_query"],
    max_connections: 20,
  });
}

export interface SendMessageOptions {
  replyMarkup?: ReplyMarkup;
  disablePreview?: boolean;
}

export async function sendMessage(
  env: Env,
  chatId: number,
  text: string,
  options: SendMessageOptions = {},
): Promise<TelegramMessage> {
  return telegramApi<TelegramMessage>(env, "sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    link_preview_options: { is_disabled: options.disablePreview ?? true },
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function answerCallbackQuery(env: Env, id: string, text?: string): Promise<boolean> {
  return telegramApi<boolean>(env, "answerCallbackQuery", {
    callback_query_id: id,
    ...(text ? { text } : {}),
  });
}

export async function sendChatAction(env: Env, chatId: number, action = "upload_photo"): Promise<boolean> {
  return telegramApi<boolean>(env, "sendChatAction", { chat_id: chatId, action });
}

export async function getTelegramFile(env: Env, fileId: string): Promise<TelegramFile> {
  return telegramApi<TelegramFile>(env, "getFile", { file_id: fileId });
}

export async function downloadTelegramFile(env: Env, filePath: string): Promise<Response> {
  return fetch(`https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${filePath}`);
}

export async function sendPhoto(
  env: Env,
  chatId: number,
  bytes: ArrayBuffer,
  caption: string,
  buttons?: InlineKeyboardButton[][],
  mimeType = "image/jpeg",
): Promise<TelegramMessage> {
  const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const form = new FormData();
  form.set("chat_id", String(chatId));
  form.set("photo", new Blob([bytes], { type: mimeType }), `market-card.${extension}`);
  form.set("caption", caption);
  form.set("parse_mode", "HTML");
  if (buttons) form.set("reply_markup", JSON.stringify({ inline_keyboard: buttons }));
  return telegramApi<TelegramMessage>(env, "sendPhoto", form);
}

export async function createSubscriptionLink(
  env: Env,
  userId: number,
  stars: number,
  monthlyGenerations: number,
): Promise<string> {
  return telegramApi<string>(env, "createInvoiceLink", {
    title: "Подписка на 30 дней",
    description: `${monthlyGenerations} AI-генераций на 30 дней`,
    payload: `subscription:${userId}:${crypto.randomUUID()}`,
    currency: "XTR",
    prices: [{ label: "Подписка на 30 дней", amount: stars }],
    subscription_period: 2_592_000,
  });
}

export async function answerPreCheckout(
  env: Env,
  queryId: string,
  ok: boolean,
  errorMessage?: string,
): Promise<boolean> {
  return telegramApi<boolean>(env, "answerPreCheckoutQuery", {
    pre_checkout_query_id: queryId,
    ok,
    ...(!ok && errorMessage ? { error_message: errorMessage } : {}),
  });
}

export async function setSubscriptionRenewal(
  env: Env,
  userId: number,
  chargeId: string,
  enabled: boolean,
): Promise<boolean> {
  return telegramApi<boolean>(env, "editUserStarSubscription", {
    user_id: userId,
    telegram_payment_charge_id: chargeId,
    is_canceled: !enabled,
  });
}
