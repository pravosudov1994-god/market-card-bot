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
import { processGeneration } from "./generation.ts";
import {
  featuresKeyboard,
  mainKeyboard,
  marketplaceKeyboard,
  photoModeKeyboard,
  styleKeyboard,
  urlKeyboard,
} from "./templates.ts";
import {
  answerCallbackQuery,
  answerPreCheckout,
  createSubscriptionLink,
  sendMessage,
  setSubscriptionRenewal,
} from "./telegram.ts";
import type {
  CallbackQuery,
  CardStyle,
  Env,
  Marketplace,
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
  isCardStyle,
  isMarketplace,
  isPhotoMode,
  MAX_SOURCE_BYTES,
  nowSeconds,
  parseDraft,
  parseFeatures,
} from "./utils.ts";

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
      "Соберу вертикальную карточку 1200×1600 для Ozon, Wildberries или Яндекс Маркета. " +
      `Первые ${config.freeGenerations} генераций бесплатны, затем — подписка ${escapeHtml(config.priceLabelRub)} на 30 дней.`,
    { replyMarkup: mainKeyboard },
  );
}

async function startFlow(env: Env, userId: number, chatId: number): Promise<void> {
  await setFlow(env.DB, userId, "awaiting_photo", {});
  await sendMessage(
    env,
    chatId,
    "<b>Шаг 1 из 6. Пришлите фото товара.</b>\n\nЛучше всего подходит чёткий снимок на однотонном фоне до 5 МБ. Можно отправить как фото или файл PNG/JPEG/WebP.",
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
          [{ text: "✨ Создать карточку", callback_data: "create" }],
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
    { replyMarkup: { inline_keyboard: [[{ text: "✨ Создать карточку", callback_data: "create" }]] } },
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
    await sendMessage(env, message.chat.id, "Пришлите изображение товара: фото либо файл PNG/JPEG/WebP до 5 МБ.");
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
  await setFlow(env.DB, user.telegram_id, "awaiting_photo_mode", {
    sourceFileId: source.file_id,
    sourceMimeType: mimeType,
    sourceFileSize: source.file_size,
  });
  await sendMessage(
    env,
    message.chat.id,
    "<b>Шаг 2 из 6. Как использовать фото?</b>\n\n" +
      "Если снимок уже красивый и готовый — я сохраню его крупным. Если это обычное фото товара — соберу рекламную сцену вокруг него.",
    { replyMarkup: photoModeKeyboard },
  );
  return true;
}

async function acceptTextStep(env: Env, user: UserRow, message: TelegramMessage): Promise<boolean> {
  if (!message.text) return false;
  const draft = parseDraft(user.draft_json);
  if (user.state === "awaiting_title") {
    const title = cleanSingleLine(message.text, 72);
    if (title.length < 2) {
      await sendMessage(env, message.chat.id, "Название слишком короткое. Напишите от 2 до 72 символов.");
      return true;
    }
    await setFlow(env.DB, user.telegram_id, "awaiting_features", { ...draft, title });
    await sendMessage(
      env,
      message.chat.id,
      "<b>Шаг 5 из 6. Напишите до четырёх преимуществ.</b>\n\nКаждое — с новой строки, например:\nЛёгкий корпус\nГарантия 2 года\nДоставка завтра",
      { replyMarkup: featuresKeyboard },
    );
    return true;
  }
  if (user.state === "awaiting_features") {
    const features = parseFeatures(message.text);
    if (!features.length) {
      await sendMessage(env, message.chat.id, "Не вижу преимуществ. Напишите каждое с новой строки или нажмите «Пропустить».", {
        replyMarkup: featuresKeyboard,
      });
      return true;
    }
    await setFlow(env.DB, user.telegram_id, "awaiting_style", { ...draft, features });
    await sendMessage(env, message.chat.id, "<b>Шаг 6 из 6. Выберите стиль.</b>", {
      replyMarkup: styleKeyboard,
    });
    return true;
  }
  return false;
}

async function queueGeneration(
  env: Env,
  ctx: ExecutionContext,
  user: UserRow,
  chatId: number,
  style: CardStyle,
): Promise<void> {
  const config = getConfig(env);
  const draft = parseDraft(user.draft_json);
  if (!draft.sourceFileId || !draft.marketplace || !draft.title) {
    await resetFlow(env.DB, user.telegram_id);
    await sendMessage(env, chatId, "Черновик устарел. Начните создание карточки заново.", {
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
    await sendMessage(
      env,
      chatId,
      "Лимит генераций закончился. Оформите подписку, чтобы продолжить.",
      { replyMarkup: { inline_keyboard: [[{ text: "⭐ Оформить подписку", callback_data: "subscribe" }]] } },
    );
    return;
  }

  const id = crypto.randomUUID();
  try {
    await createGeneration(env.DB, {
      id,
      telegramId: user.telegram_id,
      chatId,
      marketplace: draft.marketplace,
      style,
      photoMode: draft.photoMode ?? "product",
      title: draft.title,
      features: draft.features ?? [],
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
    `Собираю карточку — обычно это занимает меньше минуты. После запуска осталось генераций: <b>${reservation.remaining ?? 0}</b>.`,
  );
  ctx.waitUntil(processGeneration(env, id));
}

async function handleCallback(
  env: Env,
  ctx: ExecutionContext,
  query: CallbackQuery,
  origin: string,
): Promise<void> {
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

  if (data.startsWith("mode:")) {
    const photoMode = data.slice("mode:".length);
    const draft = parseDraft(user.draft_json);
    if (user.state !== "awaiting_photo_mode" || !draft.sourceFileId || !isPhotoMode(photoMode)) {
      await sendMessage(env, chatId, "Этот шаг уже неактивен. Начните заново.", { replyMarkup: mainKeyboard });
      return;
    }
    await setFlow(env.DB, user.telegram_id, "awaiting_marketplace", { ...draft, photoMode });
    await sendMessage(env, chatId, "<b>Шаг 3 из 6. Для какой площадки делаем карточку?</b>", {
      replyMarkup: marketplaceKeyboard,
    });
    return;
  }

  if (data.startsWith("market:")) {
    const marketplace = data.slice("market:".length);
    const draft = parseDraft(user.draft_json);
    if (user.state !== "awaiting_marketplace" || !draft.sourceFileId || !isMarketplace(marketplace)) {
      await sendMessage(env, chatId, "Этот шаг уже неактивен. Начните заново.", { replyMarkup: mainKeyboard });
      return;
    }
    await setFlow(env.DB, user.telegram_id, "awaiting_title", {
      ...draft,
      marketplace: marketplace as Marketplace,
    });
    await sendMessage(
      env,
      chatId,
      "<b>Шаг 4 из 6. Напишите название товара.</b>\n\nКоротко и без характеристик — до 72 символов.",
    );
    return;
  }

  if (data === "features:skip") {
    const draft = parseDraft(user.draft_json);
    if (user.state !== "awaiting_features" || !draft.title) {
      await sendMessage(env, chatId, "Этот шаг уже неактивен. Начните заново.", { replyMarkup: mainKeyboard });
      return;
    }
    await setFlow(env.DB, user.telegram_id, "awaiting_style", { ...draft, features: [] });
    await sendMessage(env, chatId, "<b>Шаг 6 из 6. Выберите стиль.</b>", { replyMarkup: styleKeyboard });
    return;
  }

  if (data.startsWith("style:")) {
    const style = data.slice("style:".length);
    if (user.state !== "awaiting_style" || !isCardStyle(style)) {
      await sendMessage(env, chatId, "Этот шаг уже неактивен. Начните заново.", { replyMarkup: mainKeyboard });
      return;
    }
    await queueGeneration(env, ctx, user, chatId, style as CardStyle);
  }
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

async function handleMessage(env: Env, message: TelegramMessage, origin: string): Promise<void> {
  if (!message.from) return;
  if (message.chat.type !== "private") {
    await sendMessage(env, message.chat.id, "Для создания карточек откройте личный чат с ботом.");
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
  if (await acceptTextStep(env, user, message)) return;
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
    await handleCallback(env, ctx, update.callback_query, origin);
    return;
  }
  if (update.message) await handleMessage(env, update.message, origin);
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
