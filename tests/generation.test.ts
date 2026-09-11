import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFlux2Input,
  FLUX2_MODEL,
  productScenePrompt,
  workersAiErrorCode,
} from "../src/generation.ts";

test("FLUX.2 Klein uses the Cloudflare multipart binding format", async () => {
  const input = await buildFlux2Input(
    new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: "image/jpeg" }),
    "premium",
    "Крем для лица",
    ["Витамин C", "120 мл"],
  );

  assert.equal(FLUX2_MODEL, "@cf/black-forest-labs/flux-2-klein-4b");
  assert.deepEqual(Object.keys(input), ["multipart"]);

  const multipart = input.multipart as { body?: unknown; contentType?: unknown };
  assert.ok(multipart.body instanceof ReadableStream);
  assert.equal(typeof multipart.contentType, "string");
  assert.match(String(multipart.contentType), /^multipart\/form-data;\s*boundary=/i);
});

test("FLUX.2 prompt uses the product photo as a reference and avoids invented card text", () => {
  const prompt = productScenePrompt("minimal", "Крем для лица", ["Витамин C", "120 мл"]);

  assert.match(prompt, /input image 0/i);
  assert.match(prompt, /same product identity/i);
  assert.match(prompt, /do not translate, rewrite or invent packaging text/i);
  assert.match(prompt, /Крем для лица/);
  assert.match(prompt, /no people, hands, duplicate products/i);
});

test("Workers AI errors are stored as safe stable codes", () => {
  assert.equal(workersAiErrorCode(new Error("3036: daily free allocation exhausted")), "workers_ai_3036");
  assert.equal(workersAiErrorCode(new Error("3040: out of capacity")), "workers_ai_3040");
  assert.equal(workersAiErrorCode({ status: 403 }), "workers_ai_http_403");
  assert.equal(workersAiErrorCode(new Error("multipart encode failed")), "workers_ai_multipart");
  assert.equal(workersAiErrorCode(new Error("some provider detail that should not be persisted")), "workers_ai_runtime");
});
