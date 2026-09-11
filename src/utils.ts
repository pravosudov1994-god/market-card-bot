import type { CardStyle, Draft, Marketplace, PhotoMode } from "./types.ts";

export const MAX_SOURCE_BYTES = 5 * 1024 * 1024;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function parseDraft(value: string | null | undefined): Draft {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Draft) : {};
  } catch {
    return {};
  }
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function cleanSingleLine(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function parseFeatures(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s•·\-*\d.)]+/, "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 4)
    .map((line) => line.slice(0, 72));
}

export function isMarketplace(value: string): value is Marketplace {
  return value === "ozon" || value === "wildberries" || value === "yandex";
}

export function isCardStyle(value: string): value is CardStyle {
  return value === "minimal" || value === "premium" || value === "bright";
}

export function isPhotoMode(value: string): value is PhotoMode {
  return value === "ready" || value === "product";
}

export function marketplaceLabel(value: Marketplace): string {
  return {
    ozon: "Ozon",
    wildberries: "Wildberries",
    yandex: "Яндекс Маркет",
  }[value];
}

export function styleLabel(value: CardStyle): string {
  return {
    minimal: "Минимализм",
    premium: "Премиум",
    bright: "Яркий",
  }[value];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const clean = value.replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  const binary = atob(clean);
  const result = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) result[i] = binary.charCodeAt(i);
  return result;
}

export function randomToken(bytes = 24): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64(data).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export function errorCode(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 160);
  return String(error).slice(0, 160);
}

export function secureEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let i = 0; i < left.length; i += 1) mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return mismatch === 0;
}
