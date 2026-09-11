import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderCardHtml } from "../src/templates.ts";

describe("market card HTML", () => {
  it("renders an AI product scene full-bleed without duplicating the original product photo", () => {
    const html = renderCardHtml({
      marketplace: "wildberries",
      style: "premium",
      photoMode: "product",
      title: "Чайник <лучший>",
      features: ["Сталь & стекло", "2 года"],
      sourceUrl: "https://example.test/source",
      backgroundUrl: "https://example.test/generated-scene",
    });

    assert.ok(html.includes("width:1200px;height:1600px"));
    assert.ok(html.includes("Wildberries"));
    assert.ok(html.includes("Чайник &lt;лучший&gt;"));
    assert.ok(html.includes("Сталь &amp; стекло"));
    assert.ok(!html.includes("Чайник <лучший>"));
    assert.ok(html.includes("https://example.test/generated-scene"));
    assert.ok(html.includes('class="ai-scene"'));
    assert.ok(!html.includes('class="product-image" src="https://example.test/source"'));
  });

  it("falls back to the original product photo if Workers AI did not return a scene", () => {
    const html = renderCardHtml({
      marketplace: "yandex",
      style: "bright",
      photoMode: "product",
      title: "Товар",
      features: [],
      sourceUrl: "https://example.test/source",
    });

    assert.ok(html.includes("product-stage"));
    assert.ok(html.includes('class="product-image"'));
    assert.ok(html.includes("https://example.test/source"));
    assert.ok(!html.includes('class="ai-scene"'));
  });

  it("keeps a ready photo large and ignores an AI scene layer", () => {
    const html = renderCardHtml({
      marketplace: "ozon",
      style: "minimal",
      photoMode: "ready",
      title: "Готовое фото",
      features: ["Без лишней рамки"],
      sourceUrl: "https://example.test/source",
      backgroundUrl: "https://example.test/background-that-must-not-render",
    });

    assert.ok(html.includes("ready-main"));
    assert.ok(html.includes("ready-blur"));
    assert.ok(!html.includes('class="ai-scene"'));
    assert.ok(!html.includes("background-that-must-not-render"));
  });
});
