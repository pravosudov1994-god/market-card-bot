import type { Env } from "./types.ts";
import { base64ToBytes, bytesToBase64, nowSeconds, secureEqual } from "./utils.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.APP_ENCRYPTION_KEY) throw new Error("encryption_key_missing");
  const raw = base64ToBytes(env.APP_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("encryption_key_invalid");
  return crypto.subtle.importKey("raw", asArrayBuffer(raw), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(env: Env, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(env),
    encoder.encode(plaintext),
  );
  return `${bytesToBase64(iv)}.${bytesToBase64(new Uint8Array(encrypted))}`;
}

async function decrypt(env: Env, value: string): Promise<string> {
  const [ivPart, encryptedPart] = value.split(".");
  if (!ivPart || !encryptedPart) throw new Error("encrypted_setting_invalid");
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asArrayBuffer(base64ToBytes(ivPart)) },
    await encryptionKey(env),
    asArrayBuffer(base64ToBytes(encryptedPart)),
  );
  return decoder.decode(decrypted);
}

async function setting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM app_settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function isBotConfigured(env: Env): Promise<boolean> {
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET) return true;
  return (await setting(env.DB, "setup_complete")) === "1";
}

export async function verifySetupCode(env: Env, code: string): Promise<boolean> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(code.trim()));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return secureEqual(hex, env.SETUP_CODE_HASH || "");
}

export async function saveBotSettings(
  env: Env,
  values: { botToken: string; webhookSecret: string; supportUsername: string; botUsername: string },
): Promise<void> {
  const now = nowSeconds();
  const encrypted = await Promise.all([
    encrypt(env, values.botToken),
    encrypt(env, values.webhookSecret),
    encrypt(env, values.supportUsername),
    encrypt(env, values.botUsername),
  ]);
  const keys = ["telegram_bot_token", "telegram_webhook_secret", "support_username", "bot_username"];
  await env.DB.batch(
    keys.map((key, index) =>
      env.DB
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(key, encrypted[index], now),
    ),
  );
}

export async function markSetupComplete(env: Env): Promise<void> {
  await env.DB
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES ('setup_complete', '1', ?)
       ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at`,
    )
    .bind(nowSeconds())
    .run();
}

export async function loadRuntimeEnv(env: Env): Promise<Env> {
  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_WEBHOOK_SECRET) return env;
  if (!env.APP_ENCRYPTION_KEY) return env;
  const result = await env.DB
    .prepare(
      `SELECT key, value FROM app_settings
       WHERE key IN ('telegram_bot_token', 'telegram_webhook_secret', 'support_username')`,
    )
    .all<{ key: string; value: string }>();
  const values = new Map(result.results.map((row) => [row.key, row.value]));
  const token = values.get("telegram_bot_token");
  const webhookSecret = values.get("telegram_webhook_secret");
  if (!token || !webhookSecret) return env;
  const support = values.get("support_username");
  return {
    ...env,
    TELEGRAM_BOT_TOKEN: await decrypt(env, token),
    TELEGRAM_WEBHOOK_SECRET: await decrypt(env, webhookSecret),
    ...(support ? { SUPPORT_USERNAME: await decrypt(env, support) } : {}),
  };
}
