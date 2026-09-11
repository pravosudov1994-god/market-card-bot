import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanSingleLine,
  escapeHtml,
  isCardStyle,
  isMarketplace,
  isPhotoMode,
  parseDraft,
  parseFeatures,
  secureEqual,
} from "../src/utils.ts";

describe("input normalization", () => {
  it("cleans a title and caps its length", () => {
    assert.equal(cleanSingleLine("  Умная   лампа \n для дома ", 15), "Умная лампа для");
  });

  it("accepts at most four non-empty benefits", () => {
    assert.deepEqual(parseFeatures("• Лёгкий\n2. Прочный\n\n- Гарантия\n* Быстро\nЛишнее"), [
      "Лёгкий",
      "Прочный",
      "Гарантия",
      "Быстро",
    ]);
  });

  it("recovers safely from invalid draft JSON", () => {
    assert.deepEqual(parseDraft("{"), {});
  });
});

describe("guards and escaping", () => {
  it("escapes markup", () => {
    assert.equal(escapeHtml('<script>"x" & y</script>'),
      "&lt;script&gt;&quot;x&quot; &amp; y&lt;/script&gt;",
    );
  });

  it("validates enum-like callback values", () => {
    assert.equal(isMarketplace("ozon"), true);
    assert.equal(isMarketplace("other"), false);
    assert.equal(isCardStyle("premium"), true);
    assert.equal(isCardStyle("neon"), false);
    assert.equal(isPhotoMode("ready"), true);
    assert.equal(isPhotoMode("product"), true);
    assert.equal(isPhotoMode("other"), false);
  });

  it("compares webhook secrets", () => {
    assert.equal(secureEqual("abc_123", "abc_123"), true);
    assert.equal(secureEqual("abc_123", "abc_124"), false);
    assert.equal(secureEqual("short", "longer"), false);
  });
});
