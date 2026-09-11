import type {
  CardStyle,
  Draft,
  GenerationRow,
  Marketplace,
  PhotoMode,
  QuotaKind,
  SuccessfulPayment,
  TelegramUser,
  UserRow,
} from "./types.ts";
import { nowSeconds } from "./utils.ts";

export async function claimUpdate(db: D1Database, updateId: number): Promise<boolean> {
  const result = await db
    .prepare("INSERT OR IGNORE INTO processed_updates (update_id, processed_at) VALUES (?, ?)")
    .bind(updateId, nowSeconds())
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function ensureUser(db: D1Database, user: TelegramUser): Promise<void> {
  const now = nowSeconds();
  await db
    .prepare(
      `INSERT INTO users (telegram_id, username, first_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(telegram_id) DO UPDATE SET
         username = excluded.username,
         first_name = excluded.first_name,
         updated_at = excluded.updated_at`,
    )
    .bind(user.id, user.username ?? null, user.first_name, now, now)
    .run();
}

export async function getUser(db: D1Database, telegramId: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(telegramId).first<UserRow>();
}

export async function setFlow(
  db: D1Database,
  telegramId: number,
  state: string,
  draft: Draft,
): Promise<void> {
  await db
    .prepare("UPDATE users SET state = ?, draft_json = ?, updated_at = ? WHERE telegram_id = ?")
    .bind(state, JSON.stringify(draft), nowSeconds(), telegramId)
    .run();
}

export async function resetFlow(db: D1Database, telegramId: number): Promise<void> {
  await setFlow(db, telegramId, "idle", {});
}

export interface QuotaReservation {
  ok: boolean;
  kind?: QuotaKind;
  remaining?: number;
}

export async function reserveQuota(
  db: D1Database,
  telegramId: number,
  monthlyLimit: number,
  freeLimit: number,
): Promise<QuotaReservation> {
  const now = nowSeconds();
  let user = await getUser(db, telegramId);
  if (!user) return { ok: false };

  if ((user.subscription_until ?? 0) > now) {
    if (!user.quota_reset_at || user.quota_reset_at <= now) {
      await db
        .prepare(
          `UPDATE users
             SET quota_used = 0, quota_reset_at = subscription_until, updated_at = ?
           WHERE telegram_id = ? AND subscription_until > ?
             AND (quota_reset_at IS NULL OR quota_reset_at <= ?)`,
        )
        .bind(now, telegramId, now, now)
        .run();
      user = (await getUser(db, telegramId)) ?? user;
    }

    const result = await db
      .prepare(
        `UPDATE users SET quota_used = quota_used + 1, updated_at = ?
         WHERE telegram_id = ? AND subscription_until > ? AND quota_used < ?`,
      )
      .bind(now, telegramId, now, monthlyLimit)
      .run();
    if ((result.meta.changes ?? 0) > 0) {
      return { ok: true, kind: "subscription", remaining: Math.max(0, monthlyLimit - user.quota_used - 1) };
    }
    return { ok: false };
  }

  const result = await db
    .prepare(
      `UPDATE users SET free_used = free_used + 1, updated_at = ?
       WHERE telegram_id = ? AND free_used < ? AND (subscription_until IS NULL OR subscription_until <= ?)`,
    )
    .bind(now, telegramId, freeLimit, now)
    .run();
  if ((result.meta.changes ?? 0) > 0) {
    return { ok: true, kind: "free", remaining: Math.max(0, freeLimit - user.free_used - 1) };
  }
  return { ok: false };
}

export async function refundQuota(db: D1Database, telegramId: number, kind: QuotaKind): Promise<void> {
  const column = kind === "subscription" ? "quota_used" : "free_used";
  await db
    .prepare(`UPDATE users SET ${column} = MAX(0, ${column} - 1), updated_at = ? WHERE telegram_id = ?`)
    .bind(nowSeconds(), telegramId)
    .run();
}

export interface CreateGenerationInput {
  id: string;
  telegramId: number;
  chatId: number;
  marketplace: Marketplace;
  style: CardStyle;
  photoMode: PhotoMode;
  title: string;
  features: string[];
  sourceFileId: string;
  sourceMimeType?: string;
  quotaKind: QuotaKind;
}

export async function createGeneration(db: D1Database, input: CreateGenerationInput): Promise<void> {
  const now = nowSeconds();
  await db
    .prepare(
      `INSERT INTO generations (
         id, telegram_id, chat_id, marketplace, style, photo_mode, title, features_json,
         source_file_id, source_mime_type, status, quota_kind, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.telegramId,
      input.chatId,
      input.marketplace,
      input.style,
      input.photoMode,
      input.title,
      JSON.stringify(input.features),
      input.sourceFileId,
      input.sourceMimeType ?? null,
      input.quotaKind,
      now,
      now,
    )
    .run();
}

export async function getGeneration(db: D1Database, id: string): Promise<GenerationRow | null> {
  return db.prepare("SELECT * FROM generations WHERE id = ?").bind(id).first<GenerationRow>();
}

export async function startGeneration(db: D1Database, id: string): Promise<void> {
  await db
    .prepare("UPDATE generations SET status = 'processing', updated_at = ? WHERE id = ? AND status = 'queued'")
    .bind(nowSeconds(), id)
    .run();
}

export async function setGenerationAiResult(
  db: D1Database,
  id: string,
  used: boolean,
  aiErrorCode: string | null,
): Promise<void> {
  await db
    .prepare("UPDATE generations SET ai_used = ?, ai_error_code = ?, updated_at = ? WHERE id = ?")
    .bind(used ? 1 : 0, aiErrorCode, nowSeconds(), id)
    .run();
}

export async function completeGeneration(db: D1Database, id: string, fileId: string): Promise<void> {
  await db
    .prepare(
      `UPDATE generations
       SET status = 'completed', result_file_id = ?, error_code = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(fileId, nowSeconds(), id)
    .run();
}

export async function failGeneration(db: D1Database, id: string, code: string): Promise<void> {
  await db
    .prepare("UPDATE generations SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?")
    .bind(code, nowSeconds(), id)
    .run();
}

export async function failUnfinishedGeneration(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE generations SET status = 'failed', error_code = 'generation_timeout', updated_at = ?
       WHERE id = ? AND status IN ('queued', 'processing')`,
    )
    .bind(nowSeconds(), id)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function staleUnfinishedGenerations(
  db: D1Database,
  before: number,
): Promise<GenerationRow[]> {
  const result = await db
    .prepare("SELECT * FROM generations WHERE created_at < ? AND status IN ('queued', 'processing') LIMIT 100")
    .bind(before)
    .all<GenerationRow>();
  return result.results;
}

export async function recordPayment(
  db: D1Database,
  telegramId: number,
  payment: SuccessfulPayment,
  expiresAt: number,
): Promise<boolean> {
  const now = nowSeconds();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO payments (
         telegram_charge_id, telegram_id, invoice_payload, currency, amount,
         is_recurring, is_first_recurring, subscription_until, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      payment.telegram_payment_charge_id,
      telegramId,
      payment.invoice_payload,
      payment.currency,
      payment.total_amount,
      payment.is_recurring ? 1 : 0,
      payment.is_first_recurring ? 1 : 0,
      expiresAt,
      now,
    )
    .run();
  if ((inserted.meta.changes ?? 0) === 0) return false;

  await db
    .prepare(
      `UPDATE users SET
         subscription_until = MAX(COALESCE(subscription_until, 0), ?),
         subscription_charge_id = ?, quota_used = 0, quota_reset_at = ?, updated_at = ?
       WHERE telegram_id = ?`,
    )
    .bind(expiresAt, payment.telegram_payment_charge_id, expiresAt, now, telegramId)
    .run();
  return true;
}

export async function cleanupDatabase(db: D1Database, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM processed_updates WHERE processed_at < ?").bind(now - 7 * 86_400),
    db.prepare("DELETE FROM generations WHERE created_at < ?").bind(now - 90 * 86_400),
  ]);
}
