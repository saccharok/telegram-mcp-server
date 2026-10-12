import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { telegramRequest } from "../services/telegram-client.js";
import { TelegramChat, TelegramUpdate, TelegramUser } from "../types.js";

export function registerChatTools(server: McpServer): void {
  server.registerTool(
    "telegram_get_me",
    {
      title: "Get Bot Info",
      description: `Return basic info about the bot itself (username, ID, display name).

Useful to verify the configured TELEGRAM_BOT_TOKEN is valid and to get the bot's @username so a
user can start a chat with it.

Args: none

Returns: JSON with id, username, first_name, is_bot.`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async () => {
      const me = await telegramRequest<TelegramUser>("getMe");
      return {
        content: [
          {
            type: "text" as const,
            text: `Bot: @${me.username} (id: ${me.id}, name: ${me.first_name})`
          }
        ],
        structuredContent: { id: me.id, username: me.username, first_name: me.first_name }
      };
    }
  );

  const GetChatInput = z
    .object({
      chat_id: z
        .union([z.string(), z.number()])
        .describe("Numeric chat ID or '@channel_username' to look up")
    })
    .strict();
  type GetChatInputT = z.infer<typeof GetChatInput>;

  server.registerTool(
    "telegram_get_chat",
    {
      title: "Get Telegram Chat Info",
      description: `Look up details about a chat: title/name, type (private/group/supergroup/channel),
description, and invite link if available.

Args:
  - chat_id (string | number): Numeric chat ID or '@channel_username'

Returns: JSON with id, type, title/name, description.

Error Handling:
  - "chat not found" -> the bot has never interacted with this chat. For private chats, the user
    must message the bot first; for groups/channels, the bot must be a member.`,
      inputSchema: GetChatInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: GetChatInputT) => {
      const chat = await telegramRequest<TelegramChat>("getChat", { chat_id: params.chat_id });
      const label = chat.title ?? [chat.first_name, chat.last_name].filter(Boolean).join(" ") ?? String(chat.id);

      const output = {
        id: chat.id,
        type: chat.type,
        title: chat.title,
        username: chat.username,
        description: chat.description
      };

      return {
        content: [
          { type: "text" as const, text: `${label} — type: ${chat.type}, id: ${chat.id}` }
        ],
        structuredContent: output
      };
    }
  );

  const GetUpdatesInput = z
    .object({
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of recent updates to return (1-100, default 20)"),
      offset: z
        .number()
        .int()
        .optional()
        .describe(
          "Only return updates with update_id greater than or equal to this value. Omit to get " +
            "the most recent updates."
        )
    })
    .strict();
  type GetUpdatesInputT = z.infer<typeof GetUpdatesInput>;

  server.registerTool(
    "telegram_get_updates",
    {
      title: "Get Recent Telegram Updates",
      description: `Fetch recent incoming updates the bot has received (messages sent to it, chats it was
added to, etc.). This is the primary way to discover a chat_id: ask the user to send any message to
the bot (or add it to a group), then call this tool to read the resulting update and find the
chat.id to use with telegram_send_message.

Note: calling this tool consumes the updates (Telegram's long-polling semantics), so previously
fetched updates won't reappear on the next call once acknowledged.

Args:
  - limit (number): Max updates to return, 1-100 (default: 20)
  - offset (number, optional): Only return updates at/after this update_id

Returns: JSON list of updates with chat_id, chat type/title, sender, and message text for each.`,
      inputSchema: GetUpdatesInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: GetUpdatesInputT) => {
      const updates = await telegramRequest<TelegramUpdate[]>("getUpdates", {
        limit: params.limit,
        offset: params.offset
      });

      if (!updates.length) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "No recent updates. Ask the user to send a message to the bot (or add it to a group/channel) " +
                "and try again."
            }
          ],
          structuredContent: { updates: [] }
        };
      }

      const simplified = updates.map((u) => {
        const msg = u.message ?? u.edited_message ?? u.channel_post;
        return {
          update_id: u.update_id,
          chat_id: msg?.chat.id ?? u.my_chat_member?.chat.id,
          chat_type: msg?.chat.type ?? u.my_chat_member?.chat.type,
          chat_title: msg?.chat.title ?? msg?.chat.username ?? msg?.chat.first_name,
          from: msg?.from?.username ?? msg?.from?.first_name,
          text: msg?.text ?? msg?.caption
        };
      });

      const summary = simplified
        .map(
          (u) =>
            `chat_id: ${u.chat_id} (${u.chat_type}${u.chat_title ? `, "${u.chat_title}"` : ""}) — ` +
            `${u.from ?? "unknown"}: ${u.text ?? "(no text)"}`
        )
        .join("\n");

      return {
        content: [{ type: "text" as const, text: summary }],
        structuredContent: { updates: simplified }
      };
    }
  );
}
