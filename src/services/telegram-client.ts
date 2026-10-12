import { TELEGRAM_API_BASE } from "../constants.js";
import { TelegramApiError, TelegramApiResponse } from "../types.js";

/**
 * Returns the bot token from the environment. Throws an actionable error
 * if it hasn't been configured, rather than failing with a confusing
 * network error later on.
 */
function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new TelegramApiError(
      "Server misconfiguration: TELEGRAM_BOT_TOKEN environment variable is not set. " +
        "Create a bot with @BotFather on Telegram, copy the token it gives you, and set it " +
        "as the TELEGRAM_BOT_TOKEN environment variable on the server."
    );
  }
  return token;
}

/**
 * Calls a Telegram Bot API method and returns the parsed `result`.
 * Centralizes auth, error handling, and rate-limit awareness so individual
 * tools stay focused on their own input validation and output formatting.
 */
export async function telegramRequest<T>(
  method: string,
  params: Record<string, unknown> = {}
): Promise<T> {
  const token = getBotToken();
  const url = `${TELEGRAM_API_BASE}/bot${token}/${method}`;

  // Drop undefined values so optional params aren't sent as "undefined"
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) body[key] = value;
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new TelegramApiError(
      `Network error while calling Telegram API method '${method}': ${
        err instanceof Error ? err.message : String(err)
      }. Check the server's network connectivity and try again.`
    );
  }

  let data: TelegramApiResponse<T>;
  try {
    data = (await response.json()) as TelegramApiResponse<T>;
  } catch {
    throw new TelegramApiError(
      `Telegram API returned a non-JSON response for method '${method}' (HTTP ${response.status}). ` +
        `This usually indicates an outage on Telegram's side; try again shortly.`
    );
  }

  if (!data.ok) {
    const code = data.error_code;
    const desc = data.description || "Unknown error";
    const retryAfter = data.parameters?.retry_after;

    let hint = "";
    if (code === 401) {
      hint = " The bot token is invalid or was revoked — generate a new one with @BotFather and update TELEGRAM_BOT_TOKEN.";
    } else if (code === 403) {
      hint =
        " The bot cannot message this chat. Make sure the target user has started a conversation with the bot " +
        "(sent it /start at least once), or that the bot is a member of the target group/channel.";
    } else if (code === 400 && /chat not found/i.test(desc)) {
      hint =
        " The chat_id is wrong or the bot has never seen this chat. Call telegram_get_updates after messaging " +
        "the bot to discover the correct chat_id.";
    } else if (code === 429) {
      hint = ` Telegram is rate-limiting this bot. Wait ${retryAfter ?? "a few"} seconds before retrying.`;
    }

    throw new TelegramApiError(`Telegram API error (${code}): ${desc}.${hint}`, code, retryAfter);
  }

  return data.result as T;
}
