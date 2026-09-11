export type Marketplace = "ozon" | "wildberries" | "yandex";
export type CardStyle = "minimal" | "premium" | "bright";
export type PhotoMode = "ready" | "product";
export type TaskType = "market_card" | "edit_photo";
export type QuotaKind = "free" | "subscription";

export interface Draft {
  sourceFileId?: string;
  sourceMimeType?: string;
  sourceFileSize?: number;
  userPrompt?: string;
  // Legacy fields remain optional so old drafts can be parsed safely after the flow change.
  marketplace?: Marketplace;
  photoMode?: PhotoMode;
  title?: string;
  features?: string[];
}

export interface UserRow {
  telegram_id: number;
  username: string | null;
  first_name: string | null;
  state: string;
  draft_json: string;
  subscription_until: number | null;
  subscription_charge_id: string | null;
  quota_used: number;
  quota_reset_at: number | null;
  free_used: number;
  created_at: number;
  updated_at: number;
}

export interface GenerationRow {
  id: string;
  telegram_id: number;
  chat_id: number;
  marketplace: Marketplace;
  style: CardStyle;
  photo_mode: PhotoMode;
  title: string;
  features_json: string;
  source_file_id: string;
  source_mime_type: string | null;
  user_prompt: string;
  task_type: TaskType;
  status: string;
  quota_kind: QuotaKind;
  ai_used: number;
  ai_error_code: string | null;
  result_file_id: string | null;
  error_code: string | null;
  created_at: number;
  updated_at: number;
}

export interface BrowserBinding {
  quickAction(
    action: "screenshot",
    options: {
      html: string;
      viewport?: { width: number; height: number };
      screenshotOptions?: {
        type?: "jpeg" | "png";
        quality?: number;
        fullPage?: boolean;
        omitBackground?: boolean;
      };
    },
  ): Promise<Response>;
}

export interface AiBinding {
  run(model: string, inputs: Record<string, unknown>): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  AI: AiBinding;
  BROWSER: BrowserBinding;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  APP_ENCRYPTION_KEY?: string;
  BOT_NAME: string;
  SUPPORT_USERNAME?: string;
  SUBSCRIPTION_STARS: string;
  PRICE_LABEL_RUB: string;
  MONTHLY_GENERATIONS: string;
  FREE_GENERATIONS: string;
  SETUP_CODE_HASH: string;
}

export interface TelegramUser {
  id: number;
  is_bot?: boolean;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

export interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

export interface SuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
  subscription_expiration_date?: number;
  is_recurring?: boolean;
  is_first_recurring?: boolean;
}

export interface TelegramMessage {
  message_id: number;
  from?: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  document?: TelegramDocument;
  successful_payment?: SuccessfulPayment;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface PreCheckoutQuery {
  id: string;
  from: TelegramUser;
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
  pre_checkout_query?: PreCheckoutQuery;
}

export interface TelegramFile {
  file_id: string;
  file_unique_id: string;
  file_size?: number;
  file_path?: string;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface ReplyMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}
