export const TELEGRAM_API_BASE = "https://api.telegram.org";

// Telegram hard limits, used to validate input before hitting the API
export const MAX_TEXT_LENGTH = 4096;
export const MAX_CAPTION_LENGTH = 1024;

// Cap how much text we echo back into tool responses to keep context small
export const CHARACTER_LIMIT = 4000;
