import { handleUpdate, reportUpdateFailure } from "./bot.ts";
import { getConfig } from "./config.ts";
import { claimUpdate } from "./db.ts";
import { scheduledCleanup } from "./generation.ts";
import { privacyPage, termsPage } from "./legal.ts";
import { handleSetup } from "./setup.ts";
import { isBotConfigured, loadRuntimeEnv } from "./settings.ts";
import type { Env, TelegramUpdate } from "./types.ts";
import { secureEqual } from "./utils.ts";

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

async function generationDiagnostics(env: Env): Promise<Response> {
  const row = await env.DB
    .prepare(
      `SELECT status, error_code, ai_used, ai_error_code, photo_mode, created_at, updated_at
       FROM generations ORDER BY created_at DESC LIMIT 1`,
    )
    .first<{
      status: string;
      error_code: string | null;
      ai_used: number;
      ai_error_code: string | null;
      photo_mode: string | null;
      created_at: number;
      updated_at: number;
    }>();
  return json({
    ok: true,
    latest: row
      ? {
          status: row.status,
          error_code: row.error_code,
          ai_used: row.ai_used,
          ai_error_code: row.ai_error_code,
          photo_mode: row.photo_mode,
          created_at: row.created_at,
          updated_at: row.updated_at,
        }
      : null,
  });
}

async function webhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET) {
    return json({ ok: false, error: "bot_not_configured" }, 503);
  }
  const suppliedSecret = request.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secureEqual(suppliedSecret, env.TELEGRAM_WEBHOOK_SECRET)) {
    return json({ ok: false }, 403);
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ ok: false, error: "content_type" }, 415);
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }
  if (!Number.isSafeInteger(update.update_id)) return json({ ok: false, error: "invalid_update" }, 400);

  // Telegram requires a pre-checkout answer within 10 seconds. Do not claim it
  // before answering: on a transient failure Telegram must be able to retry it.
  if (update.pre_checkout_query) {
    try {
      await handleUpdate(env, ctx, update, new URL(request.url).origin);
      return json({ ok: true });
    } catch {
      return json({ ok: false, error: "pre_checkout_failed" }, 503);
    }
  }
  if (!(await claimUpdate(env.DB, update.update_id))) return json({ ok: true, duplicate: true });

  const origin = new URL(request.url).origin;
  try {
    await handleUpdate(env, ctx, update, origin);
  } catch {
    ctx.waitUntil(reportUpdateFailure(env, update));
  }
  return json({ ok: true });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/setup") return handleSetup(request, env);
    const runtimeEnv = await loadRuntimeEnv(env);
    if (request.method === "GET" && url.pathname === "/") {
      const config = getConfig(runtimeEnv);
      return json({
        ok: true,
        service: config.botName,
        endpoints: ["/health", "/terms", "/privacy"],
      });
    }
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, configured: await isBotConfigured(env) });
    }
    if (request.method === "GET" && url.pathname === "/diagnostics/generation") {
      return generationDiagnostics(runtimeEnv);
    }
    if (request.method === "GET" && url.pathname === "/terms") return termsPage(getConfig(runtimeEnv));
    if (request.method === "GET" && url.pathname === "/privacy") return privacyPage(getConfig(runtimeEnv));
    if (request.method === "POST" && url.pathname === "/telegram/webhook") return webhook(request, runtimeEnv, ctx);
    return json({ ok: false, error: "not_found" }, 404);
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(scheduledCleanup(env));
  },
} satisfies ExportedHandler<Env>;
