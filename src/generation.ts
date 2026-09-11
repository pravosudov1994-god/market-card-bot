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
import {
  downloadTelegramFile,
  getTelegramFile,
  sendChatAction,
  sendMessage,
  sendPhoto,
} from "./telegram.ts";
import type { CardStyle, Env, Marketplace, TaskType } from "./types.ts";
import {
  base64ToBytes,
  bytesToBase64,
  errorCode,
  escapeHtml,
  MAX_SOURCE_BYTES,
  nowSeconds,
} from "./utils.ts";

export const FLUX2_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
const MAX_RESULT_BYTES = 9 * 1024 * 1024;
const AI_REFERENCE_SIZE = 480;
const AI_OUTPUT_WIDTH = 768;
const AI_OUTPUT_HEIGHT = 1024;

export function detectMarketplace(prompt: string): Marketplace | null {
  const value = prompt.toLowerCase();
  if (/\bozon\b|озон/.test(value)) return "ozon";
  if (/wildberries|вайлдберр|вайлдбериз|\bwb\b/.test(value)) return "wildberries";
  if (/yandex\s*market|яндекс(?:\s+|-)маркет/.test(value)) return "yandex";
  return null;
}

export function detectStyle(prompt: string): CardStyle {
  const value = prompt.toLowerCase();
  if (/минимал|minimal|чист(?:ый|ая|ое)\s+(?:бел|светл)|white background/.test(value)) return "minimal";
  if (/ярк|bright|colorful|неон|сочн/.test(value)) return "bright";
  return "premium";
}

export function detectTaskType(prompt: string): TaskType {
  const value = prompt.toLowerCase();
  if (
    /карточ|маркетплейс|marketplace|\bozon\b|озон|wildberries|вайлдберр|\bwb\b|yandex\s*market|яндекс(?:\s+|-)маркет|добав(?:ь|ить).*текст|надпис/.test(
      value,
    )
  ) {
    return "market_card";
  }
  return "edit_photo";
}

export function buildImagePrompt(userPrompt: string, taskType: TaskType): string {
  const request = userPrompt.replace(/\s+/g, " ").trim().slice(0, 1400);
  const taskDirection =
    taskType === "market_card"
      ? [
          "Create a polished ecommerce marketplace visual, not a picture pasted inside a template.",
          "Make the product visually dominant, with a professional composition and no large meaningless empty areas.",
          "If the user asks for text, render only the requested text, preserve its language and spelling, and keep it readable. Do not invent prices, claims, badges or extra marketing text.",
        ].join(" ")
      : [
          "Create a polished commercial photo edit that follows the user's requested scene, background, lighting and mood.",
          "Do not add captions, badges or promotional text unless the user explicitly asks for them.",
        ].join(" ");

  return [
    "Edit input image 0 according to the user's request.",
    "Treat input image 0 as the source of truth for the main product.",
    "Unless the user explicitly asks to alter the product itself, preserve its identity, silhouette, proportions, dominant colors, packaging shape, cap shape, logo placement and visible label layout as faithfully as possible.",
    "Do not replace the product with a different product and do not create duplicate products unless explicitly requested.",
    "Do not translate, rewrite or invent packaging text. If tiny packaging lettering cannot be reproduced accurately, keep it visually unobtrusive rather than inventing readable words.",
    taskDirection,
    "Produce one coherent vertical 3:4 advertising image. No screenshot frame, phone frame, browser UI, watermark or random logo.",
    `USER REQUEST: ${request}`,
  ].join(" ");
}

export async function buildFlux2Input(
  reference: Blob,
  userPrompt: string,
  taskType: TaskType,
): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append("prompt", buildImagePrompt(userPrompt, taskType));
  form.append("input_image_0", reference, "product-reference.jpg");
  form.append("guidance", "3.5");
  form.append("width", String(AI_OUTPUT_WIDTH));
  form.append("height", String(AI_OUTPUT_HEIGHT));

  const serialized = new Response(form);
  const body = serialized.body;
  const contentType = serialized.headers.get("content-type");
  if (!body || !contentType) throw new Error("workers_ai_multipart_encode");

  return {
    multipart: {
      body,
      contentType,
    },
  };
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
  if (normalized.startsWith("ai_reference_") || normalized.startsWith("workers_ai_")) return normalized.slice(0, 80);
  if (normalized.includes("multipart")) return "workers_ai_multipart";
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

async function makeAiReference(env: Env, sourceUrl: string): Promise<Blob> {
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{margin:0;width:${AI_REFERENCE_SIZE}px;height:${AI_REFERENCE_SIZE}px;overflow:hidden;background:#f3f4f6}
    img{display:block;width:100%;height:100%;object-fit:contain;background:#f3f4f6}
  </style></head><body><img src="${escapeHtml(sourceUrl)}" alt=""></body></html>`;

  const screenshot = await env.BROWSER.quickAction("screenshot", {
    html,
    viewport: { width: AI_REFERENCE_SIZE, height: AI_REFERENCE_SIZE },
    screenshotOptions: { type: "jpeg", quality: 90, fullPage: false },
  });
  if (!screenshot.ok) throw new Error(`ai_reference_screenshot_${screenshot.status}`);
  const bytes = await screenshot.arrayBuffer();
  if (!bytes.byteLength) throw new Error("ai_reference_empty");
  return new Blob([bytes], { type: "image/jpeg" });
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

    const userPrompt = (job.user_prompt || job.title || "Improve this product photo").trim();
    const taskType: TaskType = job.task_type === "market_card" ? "market_card" : "edit_photo";

    let extraction: AiImageExtraction;
    try {
      const reference = await makeAiReference(env, sourceUrl);
      const aiInput = await buildFlux2Input(reference, userPrompt, taskType);
      const aiResult = await env.AI.run(FLUX2_MODEL, aiInput);
      extraction = await extractAiImage(aiResult);
      if (!extraction.bytes?.byteLength) {
        const code = extraction.errorCode ?? "workers_ai_empty_image";
        console.warn("workers_ai_prompt_result_unusable", {
          generationId: job.id,
          model: FLUX2_MODEL,
          code,
          shape: aiResultShape(aiResult),
        });
        await setGenerationAiResult(env.DB, job.id, false, code);
        throw new Error(code);
      }
    } catch (error) {
      const code = workersAiErrorCode(error);
      await setGenerationAiResult(env.DB, job.id, false, code);
      console.warn("workers_ai_prompt_failed", { generationId: job.id, model: FLUX2_MODEL, code });
      throw new Error(code);
    }

    const result = extraction.bytes;
    if (!result.byteLength || result.byteLength > MAX_RESULT_BYTES) throw new Error("result_file_invalid_size");
    await setGenerationAiResult(env.DB, job.id, true, null);

    const resultBuffer = result.slice().buffer;
    const mimeType = imageMime(result);
    const resultMessage = await sendPhoto(
      env,
      job.chat_id,
      resultBuffer,
      "✅ <b>Готово</b>\n\nAI обработал исходное фото по вашему запросу. Перед публикацией проверьте мелкий текст, логотип и маркировку товара.",
      [
        [{ text: "✨ Создать ещё", callback_data: "create" }],
        [{ text: "📊 Мой тариф", callback_data: "plan" }],
      ],
      mimeType,
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
        "Не получилось обработать фото через AI. Лимит возвращён — измените описание или попробуйте ещё раз через минуту.",
        { replyMarkup: { inline_keyboard: [[{ text: "Попробовать ещё", callback_data: "create" }]] } },
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
