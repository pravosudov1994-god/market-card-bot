import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlux2Input,
  buildImagePrompt,
  detectMarketplace,
  detectStyle,
  detectTaskType,
  FLUX2_MODEL,
  workersAiErrorCode,
} from "../src/generation.ts";

test("prompt-driven flow uses FLUX.2 Klein 4B", () => {
  assert.equal(FLUX2_MODEL, "@cf/black-forest-labs/flux-2-klein-4b");
  assert.equal(detectMarketplace("Сделай карточку для Ozon"), "ozon");
  assert.equal(detectMarketplace("для Wildberries"), "wildberries");
  assert.equal(detectMarketplace("Яндекс-Маркет"), "yandex");
  assert.equal(detectTaskType("Убери фон и сделай мягкий свет"), "edit_photo");
  assert.equal(detectTaskType("Сделай карточку для Ozon"), "market_card");
  assert.equal(detectStyle("яркая карточка"), "bright");
  assert.equal(detectStyle("минималистичный белый фон"), "minimal");
});

test("AI prompt follows the user's instruction and protects product identity", () => {
  const prompt = buildImagePrompt("Сделай премиальный бежевый фон без текста", "edit_photo");
  assert.match(prompt, /USER REQUEST: Сделай премиальный бежевый фон без текста/);
  assert.match(prompt, /source of truth/i);
  assert.match(prompt, /Do not translate, rewrite or invent packaging text/i);
  assert.match(prompt, /Do not add captions/i);
});

test("FLUX.2 input is serialized as multipart with a reference image", async () => {
  const input = await buildFlux2Input(
    new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" }),
    "Сделай красивое рекламное фото",
    "edit_photo",
  );
  assert.deepEqual(Object.keys(input), ["multipart"]);
  const multipart = input.multipart as { body?: ReadableStream; contentType?: string };
  assert.ok(multipart.body instanceof ReadableStream);
  assert.match(multipart.contentType ?? "", /^multipart\/form-data; boundary=/i);
});

test("Workers AI errors are stored as safe stable codes", () => {
  assert.equal(workersAiErrorCode(new Error("3036: daily free allocation exhausted")), "workers_ai_3036");
  assert.equal(workersAiErrorCode(new Error("3040: out of capacity")), "workers_ai_3040");
  assert.equal(workersAiErrorCode({ status: 403 }), "workers_ai_http_403");
  assert.equal(workersAiErrorCode(new Error("workers_ai_empty_image")), "workers_ai_empty_image");
  assert.equal(workersAiErrorCode(new Error("some provider detail that should not be persisted")), "workers_ai_runtime");
});
