import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { telegramRequest } from "../services/telegram-client.js";
import { TelegramMessage } from "../types.js";
import { MAX_CAPTION_LENGTH } from "../constants.js";

const chatIdSchema = z
  .union([z.string(), z.number()])
  .describe(
    "Target chat. Numeric chat ID (e.g. 123456789) or '@channel_username' for public channels."
  );

const captionSchema = z
  .string()
  .max(MAX_CAPTION_LENGTH, `caption must not exceed ${MAX_CAPTION_LENGTH} characters`)
  .optional()
  .describe("Optional caption shown below the media, up to 1024 characters");

export function registerMediaTools(server: McpServer): void {
  const SendPhotoInput = z
    .object({
      chat_id: chatIdSchema,
      photo: z
        .string()
        .url("photo must be a valid URL")
        .describe("Publicly accessible HTTPS URL of the image to send (e.g. 'https://example.com/chart.png')"),
      caption: captionSchema
    })
    .strict();
  type SendPhotoInputT = z.infer<typeof SendPhotoInput>;

  server.registerTool(
    "telegram_send_photo",
    {
      title: "Send Telegram Photo",
      description: `Send an image to a Telegram chat by URL, with an optional caption.

Args:
  - chat_id (string | number): Target chat
  - photo (string): Public HTTPS URL of the image. Telegram fetches it server-side.
  - caption (string, optional): Caption text, up to 1024 characters

Returns: Confirmation with the new message_id.

Error Handling:
  - "wrong file identifier/HTTP URL specified" -> the URL is not publicly reachable or not a
    supported image format (jpg, png, gif, webp).
  - "IMAGE_PROCESS_FAILED" -> the file is too large (Telegram limit: 10 MB for photos sent by URL).`,
      inputSchema: SendPhotoInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: SendPhotoInputT) => {
      const msg = await telegramRequest<TelegramMessage>("sendPhoto", {
        chat_id: params.chat_id,
        photo: params.photo,
        caption: params.caption
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Photo sent to chat ${msg.chat.id}. message_id: ${msg.message_id}`
          }
        ],
        structuredContent: { chat_id: msg.chat.id, message_id: msg.message_id }
      };
    }
  );

  const SendDocumentInput = z
    .object({
      chat_id: chatIdSchema,
      document: z
        .string()
        .url("document must be a valid URL")
        .describe("Publicly accessible HTTPS URL of the file to send (e.g. 'https://example.com/report.pdf')"),
      caption: captionSchema
    })
    .strict();
  type SendDocumentInputT = z.infer<typeof SendDocumentInput>;

  server.registerTool(
    "telegram_send_document",
    {
      title: "Send Telegram Document",
      description: `Send a file (PDF, CSV, ZIP, etc.) to a Telegram chat by URL, with an optional caption.

Args:
  - chat_id (string | number): Target chat
  - document (string): Public HTTPS URL of the file. Telegram fetches it server-side.
  - caption (string, optional): Caption text, up to 1024 characters

Returns: Confirmation with the new message_id.

Error Handling:
  - "wrong file identifier/HTTP URL specified" -> the URL is not publicly reachable.
  - Telegram limit for files sent by URL is 20 MB.`,
      inputSchema: SendDocumentInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (params: SendDocumentInputT) => {
      const msg = await telegramRequest<TelegramMessage>("sendDocument", {
        chat_id: params.chat_id,
        document: params.document,
        caption: params.caption
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Document sent to chat ${msg.chat.id}. message_id: ${msg.message_id}`
          }
        ],
        structuredContent: { chat_id: msg.chat.id, message_id: msg.message_id }
      };
    }
  );
}
