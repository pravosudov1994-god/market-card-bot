import assert from "node:assert/strict";
import test from "node:test";
import { backgroundAiInput, workersAiErrorCode } from "../src/generation.ts";

test("Workers AI input only contains fields supported by FLUX Schnell", () => {
  const input = backgroundAiInput("minimal");

  assert.deepEqual(Object.keys(input).sort(), ["prompt", "steps"]);
  assert.equal(input.steps, 4);
  assert.match(input.prompt, /no text/i);
});

test("Workers AI errors are stored as safe stable codes", () => {
  assert.equal(workersAiErrorCode(new Error("3036: daily free allocation exhausted")), "workers_ai_3036");
  assert.equal(workersAiErrorCode(new Error("3040: out of capacity")), "workers_ai_3040");
  assert.equal(workersAiErrorCode({ status: 403 }), "workers_ai_http_403");
  assert.equal(workersAiErrorCode(new Error("some provider detail that should not be persisted")), "workers_ai_runtime");
});
