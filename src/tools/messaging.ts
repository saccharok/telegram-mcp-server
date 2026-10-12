import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { telegramRequest } from "../services/telegram-client.js";
import { TelegramMessage } from "../types.js";
import { MAX_TEXT_LENGTH } from "../constants.js";

const chatIdSchema = z
  .union([z.string(), z.number()])
  .describe(
    "Target chat. Use a numeric chat ID (e.g. 123456789 for a user, -1001234567890 for a " +
      "supergroup/channel) or a public channel username with a leading '@' (e.g. '@my_channel'). " +
      "If unknown, call telegram_get_updates after the user messages the bot to discover it."
  );

const parseModeSchema = z
  .enum(["Markdown", "MarkdownV2", "HTML", "none"])
  .default("none")
  .describe(
    "Text formatting mode. 'HTML' supports <b>, <i>, <a href>, <code>, <pre>. 'MarkdownV2' requires " +
      "escaping special characters (_*[]()~`>#+-=|{}.!) with a backslash. 'none' sends plain text."
  );

function toApiParseMode(mode: string): string | undefined {
  return mode === "none" ? undefined : mode;
}

function formatMessageResult(msg: TelegramMessage): string {
  const chatLabel = msg.chat.title ?? msg.chat.username ?? msg.chat.first_name ?? String(msg.chat.id);
  return `Sent to ${chatLabel} (chat_id: ${msg.chat.id}). message_id: ${msg.message_id}`;
}

export function registerMessagingTools(server: McpServer): void {
  const SendMessageInput = z
    .object({
      chat_id: chatIdSchema,
      text: z
        .string()
        .min(1, "text must not be empty")
        .max(MAX_TEXT_LENGTH, `text must not exceed ${MAX_TEXT_LENGTH} characters`)
        .describe("Message text to send, e.g. 'Deploy finished successfully ✅'"),
      parse_mode: parseModeSchema,
      disable_notification: z
        .boolean()
        .default(false)
        .describe("If true, sends the message silently (no notification sound for recipients)"),
      reply_to_message_id: z
        .number()
        .int()
        .optional()
        .describe("If set, sends this message as a reply to the given message_id in the same chat")
    })
    .strict();
  type SendMessageInputT = z.infer<typeof SendMessageInput>;

  server.registerTool(
    "telegram_send_message",
    {
      title: "Send Telegram Message",
      description: `Send a text message to a Telegram chat, group, channel, or user via the bot.

This is the primary tool for pushing notifications, alerts, or updates into Telegram — e.g. from a
scheduled routine or automation.

Args:
  - chat_id (string | number): Target chat ID or '@channel_username'
  - text (string): Message body, 1-4096 characters
  - parse_mode ('Markdown' | 'MarkdownV2' | 'HTML' | 'none'): Text formatting (default: 'none')
  - disable_notification (boolean): Send silently (default: false)
  - reply_to_message_id (number, optional): Reply to a specific earlier message

Returns: Confirmation text including the chat and the new message_id (needed later to edit/delete/pin it).

Error Handling:
  - "chat not found" -> the chat_id is wrong, or the user has never started a chat with the bot.
    Ask the user to send /start to the bot first, or use telegram_get_updates to find the right chat_id.
  - 403 Forbidden -> the bot was blocked by the user or removed from the group/channel.`,
      inputSchema: SendMessageInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: SendMessageInputT) => {
      const msg = await telegramRequest<TelegramMessage>("sendMessage", {
        chat_id: params.chat_id,
        text: params.text,
        parse_mode: toApiParseMode(params.parse_mode),
        disable_notification: params.disable_notification,
        reply_to_message_id: params.reply_to_message_id
      });

      const output = {
        chat_id: msg.chat.id,
        message_id: msg.message_id,
        date: msg.date
      };

      return {
        content: [{ type: "text" as const, text: formatMessageResult(msg) }],
        structuredContent: output
      };
    }
  );

  const EditMessageInput = z
    .object({
      chat_id: chatIdSchema,
      message_id: z.number().int().describe("ID of the message to edit (returned by telegram_send_message)"),
      text: z
        .string()
        .min(1)
        .max(MAX_TEXT_LENGTH, `text must not exceed ${MAX_TEXT_LENGTH} characters`)
        .describe("New text for the message"),
      parse_mode: parseModeSchema
    })
    .strict();
  type EditMessageInputT = z.infer<typeof EditMessageInput>;

  server.registerTool(
    "telegram_edit_message_text",
    {
      title: "Edit Telegram Message",
      description: `Edit the text of a previously sent bot message.

Only messages sent by this bot can be edited, and only if they were sent less than 48 hours ago.

Args:
  - chat_id (string | number): Chat containing the message
  - message_id (number): ID of the message to edit
  - text (string): Replacement text, 1-4096 characters
  - parse_mode ('Markdown' | 'MarkdownV2' | 'HTML' | 'none'): Text formatting (default: 'none')

Returns: Confirmation that the message was updated.

Error Handling:
  - "message to edit not found" -> wrong chat_id/message_id, or the message is older than 48 hours.
  - "message is not modified" -> the new text is identical to the current text.`,
      inputSchema: EditMessageInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: EditMessageInputT) => {
      const msg = await telegramRequest<TelegramMessage>("editMessageText", {
        chat_id: params.chat_id,
        message_id: params.message_id,
        text: params.text,
        parse_mode: toApiParseMode(params.parse_mode)
      });

      return {
        content: [
          { type: "text" as const, text: `Message ${msg.message_id} in chat ${msg.chat.id} updated.` }
        ],
        structuredContent: { chat_id: msg.chat.id, message_id: msg.message_id }
      };
    }
  );

  const DeleteMessageInput = z
    .object({
      chat_id: chatIdSchema,
      message_id: z.number().int().describe("ID of the message to delete")
    })
    .strict();
  type DeleteMessageInputT = z.infer<typeof DeleteMessageInput>;

  server.registerTool(
    "telegram_delete_message",
    {
      title: "Delete Telegram Message",
      description: `Permanently delete a message from a chat. This cannot be undone.

Bots can always delete their own messages. Deleting other users' messages requires the bot to have
admin/delete rights in a group or channel.

Args:
  - chat_id (string | number): Chat containing the message
  - message_id (number): ID of the message to delete

Returns: Confirmation of deletion.

Error Handling:
  - "message to delete not found" -> already deleted or too old (regular messages older than 48h
    generally can't be deleted by bots without admin rights).
  - "not enough rights" -> the bot needs admin permissions in this chat to delete others' messages.`,
      inputSchema: DeleteMessageInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: DeleteMessageInputT) => {
      await telegramRequest<true>("deleteMessage", {
        chat_id: params.chat_id,
        message_id: params.message_id
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Deleted message ${params.message_id} from chat ${params.chat_id}.`
          }
        ],
        structuredContent: { chat_id: params.chat_id, message_id: params.message_id, deleted: true }
      };
    }
  );

  const PinMessageInput = z
    .object({
      chat_id: chatIdSchema,
      message_id: z.number().int().describe("ID of the message to pin"),
      disable_notification: z
        .boolean()
        .default(false)
        .describe("If true, pins silently without notifying chat members")
    })
    .strict();
  type PinMessageInputT = z.infer<typeof PinMessageInput>;

  server.registerTool(
    "telegram_pin_chat_message",
    {
      title: "Pin Telegram Message",
      description: `Pin a message at the top of a chat. Requires the bot to have pin permissions in
groups/channels (not required for private chats with the bot).

Args:
  - chat_id (string | number): Target chat
  - message_id (number): ID of the message to pin
  - disable_notification (boolean): Pin silently (default: false)

Returns: Confirmation of pinning.

Error Handling:
  - "not enough rights" -> the bot needs the 'can_pin_messages' admin permission in this chat.`,
      inputSchema: PinMessageInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: PinMessageInputT) => {
      await telegramRequest<true>("pinChatMessage", {
        chat_id: params.chat_id,
        message_id: params.message_id,
        disable_notification: params.disable_notification
      });

      return {
        content: [
          { type: "text" as const, text: `Pinned message ${params.message_id} in chat ${params.chat_id}.` }
        ],
        structuredContent: { chat_id: params.chat_id, message_id: params.message_id, pinned: true }
      };
    }
  );

  const UnpinMessageInput = z
    .object({
      chat_id: chatIdSchema,
      message_id: z
        .number()
        .int()
        .optional()
        .describe("ID of the message to unpin. Omit to unpin the chat's most recent pinned message.")
    })
    .strict();
  type UnpinMessageInputT = z.infer<typeof UnpinMessageInput>;

  server.registerTool(
    "telegram_unpin_chat_message",
    {
      title: "Unpin Telegram Message",
      description: `Unpin a message (or the most recent pin) in a chat.

Args:
  - chat_id (string | number): Target chat
  - message_id (number, optional): Specific pinned message to unpin. If omitted, unpins the most
    recently pinned message.

Returns: Confirmation of unpinning.`,
      inputSchema: UnpinMessageInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true
      }
    },
    async (params: UnpinMessageInputT) => {
      await telegramRequest<true>("unpinChatMessage", {
        chat_id: params.chat_id,
        message_id: params.message_id
      });

      return {
        content: [{ type: "text" as const, text: `Unpinned message in chat ${params.chat_id}.` }],
        structuredContent: { chat_id: params.chat_id, unpinned: true }
      };
    }
  );
}
