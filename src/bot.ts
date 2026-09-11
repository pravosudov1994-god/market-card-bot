import { getConfig } from "./config.ts";
import {
  createGeneration,
  ensureUser,
  getUser,
  recordPayment,
  refundQuota,
  reserveQuota,
  resetFlow,
  setFlow,
} from "./db.ts";
import {
  detectMarketplace,
  detectStyle,
  detectTaskType,
  processGeneration,
} from "./generation.ts";
import { mainKeyboard, urlKeyboard } from "./templates.ts";
import {
  answerCallbackQuery,
  answerPreCheckout,
  createSubscriptionLink,
  sendMessage,
  setSubscriptionRenewal,
} from "./telegram.ts";
import type {
  CallbackQuery,
  Env,
  PreCheckoutQuery,
  SuccessfulPayment,
  TelegramMessage,
  TelegramUpdate,
  TelegramUser,
  UserRow,
} from "./types.ts";
import {
  cleanSingleLine,
  escapeHtml,
  MAX_SOURCE_BYTES,
  nowSeconds,
  parseDraft,
} from "./utils.ts";

const MAX_PROMPT_LENGTH = 1400;

function commandOf(text: string): string | null {
  if (!text.startsWith("/")) return null;
  const token = text.trim().split(/\s+/, 1)[0] ?? "";
  return token.split("@", 1)[0]?.toLowerCase() || null;
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(timestamp * 1000));
}

async function showWelcome(env: Env, chatId: number, firstName?: string): Promise<void> {
  const config = getConfig(env);
  const greeting = firstName ? `, ${escapeHtml(firstName)}` : "";
  await sendMessage(
    env,
    chatId,
    `<b>Привет${greeting}! Я ${escapeHtml(config.botName)}.</b>\n\n` +
      "Пришлите фото товара, а затем обычными словами напишите, что хотите получить. " +
      "Например: «Сделай премиальное рекламное фото на бежевом фоне» или «Сделай карточку для Ozon с текстом: 120 мл, витамин C».\n\n" +
      `Первые ${config.freeGenerations} генераций бесплатны, затем — подписка ${escapeHtml(config.priceLabelRub)} на 30 дней.`,
    { replyMarkup: mainKeyboard },
  );
}

async function startFlow(env: Env, userId: number, chatId: number): Promise<void> {
  await setFlow(env.DB, userId, "awaiting_photo", {});
  await sendMessage(
    env,
    chatId,
    "<b>Пришлите фото товара.</b>\n\nПодойдут JPEG, PNG или WebP до 5 МБ. После фото я попрошу одним сообщением описать, что нужно сделать.",
    { replyMarkup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] } },
  );
}

async function showPlan(env: Env, user: UserRow, chatId: number): Promise<void> {
  const config = getConfig(env);
  const now = nowSeconds();
  if ((user.subscription_until ?? 0) > now) {
    const remaining = Math.max(0, config.monthlyGenerations - user.quota_used);
    await sendMessage(
      env,
      chatId,
      `<b>Подписка активна до ${formatDate(user.subscription_until!)}</b>\n\n` +
        `Осталось генераций: <b>${remaining} из ${config.monthlyGenerations}</b>.`,
      { replyMarkup: mainKeyboard },
    );
    return;
  }
  const freeRemaining = Math.max(0, config.freeGenerations - user.free_used);
  await sendMessage(
    env,
    chatId,
    `<b>Бесплатный тариф</b>\n\nОсталось бесплатных генераций: <b>${freeRemaining}</b>. ` +
      `Подписка: ${config.subscriptionStars} ⭐ на 30 дней, ${config.monthlyGenerations} генераций (${escapeHtml(config.priceLabelRub)} ориентировочно).`,
    {
      replyMarkup: {
        inline_keyboard: [
          [{ text: "⭐ Оформить подписку", callback_data: "subscribe" }],
          [{ text: "✨ Создать", callback_data: "create" }],
        ],
      },
    },
  );
}

async function showSubscription(env: Env, userId: number, chatId: number): Promise<void> {
  const config = getConfig(env);
  const link = await createSubscriptionLink(
    env,
    userId,
    config.subscriptionStars,
    config.monthlyGenerations,
  );
  await sendMessage(
    env,
    chatId,
    `<b>${config.monthlyGenerations} генераций на 30 дней</b>\n\n` +
      `Стоимость: <b>${config.subscriptionStars} Telegram Stars</b> (${escapeHtml(config.priceLabelRub)} ориентировочно). ` +
      "Фактическую стоимость Stars Telegram покажет перед оплатой. Подписка продлевается автоматически; её можно отменить командой /cancel_subscription.",
    { replyMarkup: urlKeyboard(`Оплатить ${config.subscriptionStars} ⭐`, link) },
  );
}

async function showLegalLink(env: Env, chatId: number, origin: string, kind: "terms" | "privacy"): Promise<void> {
  const label = kind === "terms" ? "Условия использования" : "Политика конфиденциальности";
  await sendMessage(env, chatId, `<b>${label}</b>`, {
    replyMarkup: urlKeyboard(`Открыть: ${label}`, `${origin}/${kind}`),
  });
}

async function cancelSubscription(env: Env, user: UserRow, chatId: number): Promise<void> {
  const now = nowSeconds();
  if (!user.subscription_charge_id || (user.subscription_until ?? 0) <= now) {
    await sendMessage(env, chatId, "Активной возобновляемой подписки не найдено.", { replyMarkup: mainKeyboard });
    return;
  }
  await setSubscriptionRenewal(env, user.telegram_id, user.subscription_charge_id, false);
  await sendMessage(
    env,
    chatId,
    `Автопродление отключено. Доступ сохранится до <b>${formatDate(user.subscription_until!)}</b>.`,
    { replyMarkup: mainKeyboard },
  );
}

async function handleSuccessfulPayment(
  env: Env,
  user: TelegramUser,
  chatId: number,
  payment: SuccessfulPayment,
): Promise<void> {
  const config = getConfig(env);
  if (
    payment.currency !== "XTR" ||
    payment.total_amount !== config.subscriptionStars ||
    !payment.invoice_payload.startsWith(`subscription:${user.id}:`)
  ) {
    await sendMessage(
      env,
      chatId,
      `Платёж получен, но его параметры отличаются от текущего тарифа. Напишите в поддержку: ${escapeHtml(config.supportUsername)}.`,
    );
    return;
  }
  const expiresAt = payment.subscription_expiration_date ?? nowSeconds() + 2_592_000;
  const isNew = await recordPayment(env.DB, user.id, payment, expiresAt);
  if (!isNew) return;
  await sendMessage(
    env,
    chatId,
    `<b>Оплата прошла — подписка активна до ${formatDate(expiresAt)}.</b>\n\n` +
      `Доступно ${config.monthlyGenerations} генераций.`,
    { replyMarkup: { inline_keyboard: [[{ text: "✨ Создать", callback_data: "create" }]] } },
  );
}

async function handlePreCheckout(env: Env, query: PreCheckoutQuery): Promise<void> {
  const config = getConfig(env);
  const valid =
    query.currency === "XTR" &&
    query.total_amount === config.subscriptionStars &&
    query.invoice_payload.startsWith(`subscription:${query.from.id}:`);
  await answerPreCheckout(
    env,
    query.id,
    valid,
    valid ? undefined : "Тариф изменился. Закройте окно оплаты и создайте новый счёт в боте.",
  );
}

async function acceptPhoto(env: Env, user: UserRow, message: TelegramMessage): Promise<boolean> {
  if (user.state !== "awaiting_photo") return false;
  const photo = message.photo?.length ? message.photo[message.photo.length - 1] : undefined;
  const document = message.document;
  const documentIsImage = Boolean(document?.mime_type?.startsWith("image/"));
  if (!photo && !documentIsImage) {
    await sendMessage(env, message.chat.id, "Сначала пришлите фото товара: PNG, JPEG или WebP до 5 МБ.");
    return true;
  }

  const source = photo ?? document!;
  if ((source.file_size ?? 0) > MAX_SOURCE_BYTES) {
    await sendMessage(env, message.chat.id, "Файл больше 5 МБ. Сожмите изображение и отправьте его ещё раз.");
    return true;
  }
  const mimeType = photo ? "image/jpeg" : document!.mime_type!;
  if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(mimeType)) {
    await sendMessage(env, message.chat.id, "Поддерживаются только PNG, JPEG и WebP.");
    return true;
  }

  await setFlow(env.DB, user.telegram_id, "awaiting_prompt", {
    sourceFileId: source.file_id,
    sourceMimeType: mimeType,
    sourceFileSize: source.file_size,
  });
  await sendMessage(
    env,
    message.chat.id,
    "<b>Теперь напишите, что нужно сделать с этим фото.</b>\n\n" +
      "Пишите свободно, как человеку. Например:\n" +
      "• Сделай премиальное рекламное фото косметики на бежевом фоне с мягким светом.\n" +
      "• Сделай карточку для Ozon, товар крупно, добавь текст: 120 мл, витамин C.\n" +
      "• Убери фон и поставь товар на белый мрамор, без текста.",
    { replyMarkup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] } },
  );
  return true;
}

async function queuePromptGeneration(
  env: Env,
  ctx: ExecutionContext,
  user: UserRow,
  chatId: number,
  userPrompt: string,
): Promise<void> {
  const config = getConfig(env);
  const draft = parseDraft(user.draft_json);
  if (!draft.sourceFileId) {
    await resetFlow(env.DB, user.telegram_id);
    await sendMessage(env, chatId, "Фото не найдено. Начните заново.", {
      replyMarkup: { inline_keyboard: [[{ text: "Начать", callback_data: "create" }]] },
    });
    return;
  }

  const reservation = await reserveQuota(
    env.DB,
    user.telegram_id,
    config.monthlyGenerations,
    config.freeGenerations,
  );
  if (!reservation.ok || !reservation.kind) {
    await resetFlow(env.DB, user.telegram_id);
    await sendMessage(env, chatId, "Лимит генераций закончился. Оформите подписку, чтобы продолжить.", {
      replyMarkup: { inline_keyboard: [[{ text: "⭐ Оформить подписку", callback_data: "subscribe" }]] },
    });
    return;
  }

  const id = crypto.randomUUID();
  const marketplace = detectMarketplace(userPrompt) ?? "ozon";
  const style = detectStyle(userPrompt);
  const taskType = detectTaskType(userPrompt);
  const title = cleanSingleLine(userPrompt, 72) || "AI photo edit";

  try {
    await createGeneration(env.DB, {
      id,
      telegramId: user.telegram_id,
      chatId,
      marketplace,
      style,
      title,
      userPrompt,
      taskType,
      sourceFileId: draft.sourceFileId,
      sourceMimeType: draft.sourceMimeType,
      quotaKind: reservation.kind,
    });
    await resetFlow(env.DB, user.telegram_id);
  } catch (error) {
    await refundQuota(env.DB, user.telegram_id, reservation.kind);
    throw error;
  }

  await sendMessage(
    env,
    chatId,
    `Принял запрос. Обрабатываю фото через AI — обычно это занимает меньше минуты. Осталось генераций: <b>${reservation.remaining ?? 0}</b>.`,
  );
  ctx.waitUntil(processGeneration(env, id));
}

async function acceptTextStep(
  env: Env,
  ctx: ExecutionContext,
  user: UserRow,
  message: TelegramMessage,
): Promise<boolean> {
  if (user.state !== "awaiting_prompt" || !message.text) return false;
  const prompt = message.text.replace(/\u0000/g, "").trim().slice(0, MAX_PROMPT_LENGTH);
  if (prompt.length < 5) {
    await sendMessage(env, message.chat.id, "Опишите задачу чуть подробнее — хотя бы несколько слов.");
    return true;
  }
  await queuePromptGeneration(env, ctx, user, message.chat.id, prompt);
  return true;
}

async function handleCallback(env: Env, query: CallbackQuery): Promise<void> {
  await answerCallbackQuery(env, query.id);
  const chatId = query.message?.chat.id ?? query.from.id;
  const user = await getUser(env.DB, query.from.id);
  if (!user) return;
  const data = query.data ?? "";

  if (data === "create") return startFlow(env, user.telegram_id, chatId);
  if (data === "plan") return showPlan(env, user, chatId);
  if (data === "subscribe") return showSubscription(env, user.telegram_id, chatId);
  if (data === "cancel") {
    await resetFlow(env.DB, user.telegram_id);
    await sendMessage(env, chatId, "Создание отменено.", { replyMarkup: mainKeyboard });
    return;
  }

  await sendMessage(env, chatId, "Эта кнопка относится к старой версии сценария. Нажмите «Создать» и пришлите фото заново.", {
    replyMarkup: mainKeyboard,
  });
}

async function handleCommand(
  env: Env,
  user: UserRow,
  message: TelegramMessage,
  command: string,
  origin: string,
): Promise<boolean> {
  switch (command) {
    case "/start":
    case "/help":
      await resetFlow(env.DB, user.telegram_id);
      await showWelcome(env, message.chat.id, user.first_name ?? undefined);
      return true;
    case "/create":
      await startFlow(env, user.telegram_id, message.chat.id);
      return true;
    case "/plan":
      await showPlan(env, user, message.chat.id);
      return true;
    case "/subscribe":
      await showSubscription(env, user.telegram_id, message.chat.id);
      return true;
    case "/cancel":
      await resetFlow(env.DB, user.telegram_id);
      await sendMessage(env, message.chat.id, "Создание отменено.", { replyMarkup: mainKeyboard });
      return true;
    case "/cancel_subscription":
      await cancelSubscription(env, user, message.chat.id);
      return true;
    case "/paysupport": {
      const config = getConfig(env);
      await sendMessage(
        env,
        message.chat.id,
        `По вопросам оплаты напишите: ${escapeHtml(config.supportUsername)}. Укажите Telegram ID <code>${user.telegram_id}</code> и не отправляйте пароли или коды подтверждения.`,
      );
      return true;
    }
    case "/terms":
      await showLegalLink(env, message.chat.id, origin, "terms");
      return true;
    case "/privacy":
      await showLegalLink(env, message.chat.id, origin, "privacy");
      return true;
    default:
      return false;
  }
}

async function handleMessage(
  env: Env,
  ctx: ExecutionContext,
  message: TelegramMessage,
  origin: string,
): Promise<void> {
  if (!message.from) return;
  if (message.chat.type !== "private") {
    await sendMessage(env, message.chat.id, "Для создания изображений откройте личный чат с ботом.");
    return;
  }
  const user = await getUser(env.DB, message.from.id);
  if (!user) return;
  if (message.successful_payment) {
    await handleSuccessfulPayment(env, message.from, message.chat.id, message.successful_payment);
    return;
  }
  const command = message.text ? commandOf(message.text) : null;
  if (command && (await handleCommand(env, user, message, command, origin))) return;
  if (await acceptPhoto(env, user, message)) return;
  if (await acceptTextStep(env, ctx, user, message)) return;

  if (user.state === "awaiting_prompt") {
    await sendMessage(env, message.chat.id, "После фото напишите текстом, что нужно сделать с изображением.");
    return;
  }
  await sendMessage(env, message.chat.id, "Выберите действие в меню.", { replyMarkup: mainKeyboard });
}

function updateUser(update: TelegramUpdate): TelegramUser | undefined {
  return update.message?.from ?? update.callback_query?.from ?? update.pre_checkout_query?.from;
}

export async function handleUpdate(
  env: Env,
  ctx: ExecutionContext,
  update: TelegramUpdate,
  origin: string,
): Promise<void> {
  const telegramUser = updateUser(update);
  if (telegramUser) await ensureUser(env.DB, telegramUser);
  if (update.pre_checkout_query) {
    await handlePreCheckout(env, update.pre_checkout_query);
    return;
  }
  if (update.callback_query) {
    await handleCallback(env, update.callback_query);
    return;
  }
  if (update.message) await handleMessage(env, ctx, update.message, origin);
}

export async function reportUpdateFailure(env: Env, update: TelegramUpdate): Promise<void> {
  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (!chatId) return;
  try {
    await sendMessage(env, chatId, "Произошла техническая ошибка. Попробуйте ещё раз через минуту.");
  } catch {
    // Nothing else can be delivered to the user at this point.
  }
}
