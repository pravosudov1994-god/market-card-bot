import {
  cleanupDatabase,
  completeGeneration,
  failGeneration,
  failUnfinishedGeneration,
  getGeneration,
  refundQuota,
  setGenerationAiResult,
  startGeneration,
  staleUnfinishedGenerations,
} from "./db.ts";
import { renderCardHtml } from "./templates.ts";
import {
  downloadTelegramFile,
  getTelegramFile,
  sendChatAction,
  sendMessage,
  sendPhoto,
} from "./telegram.ts";
import type { CardStyle, Env } from "./types.ts";
import {
  base64ToBytes,
  bytesToBase64,
  errorCode,
  escapeHtml,
  marketplaceLabel,
  MAX_SOURCE_BYTES,
  nowSeconds,
} from "./utils.ts";

const AI_MODEL = "@cf/black-forest-labs/flux-1-schnell";
const MAX_RESULT_BYTES = 9 * 1024 * 1024;

function backgroundPrompt(style: CardStyle): string {
  const mood = {
    minimal: "clean airy light-gray studio, subtle soft blue geometry",
    premium: "luxury dark studio, warm gold rim light, elegant matte surfaces",
    bright: "colorful modern studio, playful gradients, pink cyan and yellow shapes",
  }[style];
  return [
    "Vertical ecommerce advertising background, 3:4 composition.",
    mood,
    "Large calm empty center area for a product card.",
    "Abstract background only, no product, no people, no text, no letters, no numbers, no logo, no watermark.",
    "Professional commercial lighting, high-end marketplace visual.",
  ].join(" ");
}

export function backgroundAiInput(style: CardStyle): { prompt: string; steps: number } {
  return { prompt: backgroundPrompt(style), steps: 4 };
}

interface AiImageExtraction {
  bytes: Uint8Array | null;
  errorCode: string | null;
}

function numericProperty(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "number" && Number.isInteger(candidate)) return candidate;
  }
  return null;
}

export function workersAiErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const knownInternalCode = message.match(
    /\b(3003|3006|3007|3008|3023|3036|3040|3041|3042|5004|5005|5007|5016|5018|5019|5035)\b/,
  )?.[1];
  if (knownInternalCode) return `workers_ai_${knownInternalCode}`;

  const objectCode = numericProperty(error, ["code", "errorCode", "internalCode"]);
  if (objectCode && objectCode >= 3000 && objectCode <= 5999) return `workers_ai_${objectCode}`;

  const status = numericProperty(error, ["status", "statusCode", "httpStatus"]);
  if (status && status >= 400 && status <= 599) return `workers_ai_http_${status}`;

  const normalized = message.toLowerCase();
  if (normalized.includes("daily free allocation") || normalized.includes("quota")) return "workers_ai_quota";
  if (normalized.includes("out of capacity")) return "workers_ai_capacity";
  if (normalized.includes("timeout") || normalized.includes("timed out")) return "workers_ai_timeout";
  if (normalized.includes("no such model") || normalized.includes("invalid model")) return "workers_ai_model";
  return "workers_ai_runtime";
}

function aiResultShape(result: unknown): string {
  if (result instanceof Response) return `response:${result.status}`;
  if (result instanceof ReadableStream) return "readable_stream";
  if (result && typeof result === "object") {
    return `object:${Object.keys(result as Record<string, unknown>).sort().slice(0, 8).join(",") || "empty"}`;
  }
  return typeof result;
}

async function extractAiImage(result: unknown): Promise<AiImageExtraction> {
  if (result instanceof Response) {
    if (!result.ok) return { bytes: null, errorCode: `workers_ai_http_${result.status}` };
    const bytes = new Uint8Array(await result.arrayBuffer());
    return bytes.byteLength
      ? { bytes, errorCode: null }
      : { bytes: null, errorCode: "workers_ai_empty_image" };
  }

  if (result && typeof result === "object" && "image" in result) {
    const image = (result as { image?: unknown }).image;
    if (typeof image !== "string" || image.length === 0) {
      return { bytes: null, errorCode: "workers_ai_invalid_image" };
    }
    try {
      const bytes = base64ToBytes(image);
      return bytes.byteLength
        ? { bytes, errorCode: null }
        : { bytes: null, errorCode: "workers_ai_empty_image" };
    } catch {
      return { bytes: null, errorCode: "workers_ai_invalid_base64" };
    }
  }

  if (result instanceof ReadableStream) {
    const bytes = new Uint8Array(await new Response(result).arrayBuffer());
    return bytes.byteLength
      ? { bytes, errorCode: null }
      : { bytes: null, errorCode: "workers_ai_empty_image" };
  }

  return { bytes: null, errorCode: "workers_ai_unexpected_response" };
}

function imageMime(bytes: Uint8Array, fallback = "image/jpeg"): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return fallback;
}

function largestPhotoFileId(message: Awaited<ReturnType<typeof sendPhoto>>): string | null {
  const photos = message.photo ?? [];
  return photos.at(-1)?.file_id ?? null;
}

export async function processGeneration(env: Env, generationId: string): Promise<void> {
  const job = await getGeneration(env.DB, generationId);
  if (!job || job.status !== "queued") return;

  try {
    await startGeneration(env.DB, job.id);
    await sendChatAction(env, job.chat_id);

    const telegramFile = await getTelegramFile(env, job.source_file_id);
    if (!telegramFile.file_path) throw new Error("source_file_path_missing");
    if ((telegramFile.file_size ?? 0) > MAX_SOURCE_BYTES) throw new Error("source_file_too_large");

    const sourceResponse = await downloadTelegramFile(env, telegramFile.file_path);
    if (!sourceResponse.ok) throw new Error(`source_download_${sourceResponse.status}`);
    const declaredLength = Number(sourceResponse.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_SOURCE_BYTES) throw new Error("source_file_too_large");
    const sourceBytes = await sourceResponse.arrayBuffer();
    if (sourceBytes.byteLength > MAX_SOURCE_BYTES) throw new Error("source_file_too_large");

    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
    const candidateType = job.source_mime_type || sourceResponse.headers.get("content-type") || "image/jpeg";
    const sourceType = allowedTypes.has(candidateType) ? candidateType : "image/jpeg";
    const sourceUrl = `data:${sourceType};base64,${bytesToBase64(new Uint8Array(sourceBytes))}`;

    let backgroundUrl: string | undefined;
    if (job.photo_mode === "product") {
      try {
        const aiResult = await env.AI.run(AI_MODEL, backgroundAiInput(job.style));
        const extraction = await extractAiImage(aiResult);
        if (extraction.bytes?.byteLength) {
          backgroundUrl = `data:${imageMime(extraction.bytes)};base64,${bytesToBase64(extraction.bytes)}`;
          await setGenerationAiResult(env.DB, job.id, true, null);
        } else {
          const code = extraction.errorCode ?? "workers_ai_empty_image";
          console.warn("workers_ai_background_unusable", {
            generationId: job.id,
            code,
            shape: aiResultShape(aiResult),
          });
          await setGenerationAiResult(env.DB, job.id, false, code);
        }
      } catch (error) {
        const code = workersAiErrorCode(error);
        console.warn("workers_ai_background_failed", { generationId: job.id, code });
        await setGenerationAiResult(env.DB, job.id, false, code);
      }
    } else {
      await setGenerationAiResult(env.DB, job.id, false, null);
    }

    const html = renderCardHtml({
      marketplace: job.marketplace,
      style: job.style,
      photoMode: job.photo_mode,
      title: job.title,
      features: JSON.parse(job.features_json) as string[],
      sourceUrl,
      ...(backgroundUrl ? { backgroundUrl } : {}),
    });

    const screenshot = await env.BROWSER.quickAction("screenshot", {
      html,
      viewport: { width: 1200, height: 1600 },
      screenshotOptions: { type: "jpeg", quality: 90, fullPage: false },
    });
    if (!screenshot.ok) throw new Error(`browser_screenshot_${screenshot.status}`);
    const resultBytes = await screenshot.arrayBuffer();
    if (!resultBytes.byteLength || resultBytes.byteLength > MAX_RESULT_BYTES) {
      throw new Error("result_file_invalid_size");
    }

    const resultMessage = await sendPhoto(
      env,
      job.chat_id,
      resultBytes,
      `✅ <b>Карточка для ${escapeHtml(marketplaceLabel(job.marketplace))} готова</b>\n\n` +
        "Товар на исходном фото не перерисовывался. Проверьте текст и требования площадки перед публикацией.",
      [
        [{ text: "✨ Создать ещё", callback_data: "create" }],
        [{ text: "📊 Мой тариф", callback_data: "plan" }],
      ],
    );
    const resultFileId = largestPhotoFileId(resultMessage);
    if (!resultFileId) throw new Error("telegram_result_file_id_missing");
    await completeGeneration(env.DB, job.id, resultFileId);
  } catch (error) {
    const current = (await getGeneration(env.DB, generationId)) ?? job;
    await failGeneration(env.DB, generationId, errorCode(error));
    await refundQuota(env.DB, current.telegram_id, current.quota_kind);
    try {
      await sendMessage(
        env,
        current.chat_id,
        "Не получилось собрать карточку. Лимит возвращён — попробуйте ещё раз через минуту.",
        { replyMarkup: { inline_keyboard: [[{ text: "Повторить", callback_data: "create" }]] } },
      );
    } catch {
      // Telegram may be temporarily unavailable; the failure is already recorded.
    }
  }
}

export async function scheduledCleanup(env: Env): Promise<void> {
  const now = nowSeconds();
  const unfinished = await staleUnfinishedGenerations(env.DB, now - 15 * 60);
  for (const job of unfinished) {
    if (await failUnfinishedGeneration(env.DB, job.id)) {
      await refundQuota(env.DB, job.telegram_id, job.quota_kind);
    }
  }
  await cleanupDatabase(env.DB, now);
}
