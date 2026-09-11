import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderCardHtml } from "../src/templates.ts";

describe("market card HTML", () => {
  it("renders a 1200 by 1600 product card and escapes user content", () => {
    const html = renderCardHtml({
      marketplace: "wildberries",
      style: "premium",
      photoMode: "product",
      title: "Чайник <лучший>",
      features: ["Сталь & стекло", "2 года"],
      sourceUrl: "https://example.test/source",
      backgroundUrl: "https://example.test/background",
    });

    assert.ok(html.includes("width:1200px;height:1600px"));
    assert.ok(html.includes("Wildberries"));
    assert.ok(html.includes("Чайник &lt;лучший&gt;"));
    assert.ok(html.includes("Сталь &amp; стекло"));
    assert.ok(!html.includes("Чайник <лучший>"));
    assert.ok(html.includes("https://example.test/background"));
    assert.ok(html.includes("product-stage"));
  });

  it("keeps a ready photo large and does not render an AI background layer", () => {
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
    assert.ok(!html.includes('class="ai-bg"'));
    assert.ok(!html.includes("background-that-must-not-render"));
  });
});
