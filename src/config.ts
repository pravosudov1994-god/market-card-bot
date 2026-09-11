import type { Env } from "./types.ts";

export interface AppConfig {
  botName: string;
  supportUsername: string;
  subscriptionStars: number;
  priceLabelRub: string;
  monthlyGenerations: number;
  freeGenerations: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getConfig(env: Env): AppConfig {
  return {
    botName: env.BOT_NAME || "MarketCard AI",
    supportUsername: env.SUPPORT_USERNAME || "@your_username",
    subscriptionStars: positiveInt(env.SUBSCRIPTION_STARS, 60),
    priceLabelRub: env.PRICE_LABEL_RUB || "≈99 ₽",
    monthlyGenerations: positiveInt(env.MONTHLY_GENERATIONS, 20),
    freeGenerations: positiveInt(env.FREE_GENERATIONS, 5),
  };
}
