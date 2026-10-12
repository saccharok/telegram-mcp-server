# Telegram MCP Server

An MCP (Model Context Protocol) server that lets Claude send and manage messages in Telegram
through a bot. Built for **remote** deployment (Streamable HTTP) so it keeps working even when
your own computer is off — a requirement for using it inside Claude's scheduled routines/automations.

## What it can do

| Tool | Purpose |
|---|---|
| `telegram_send_message` | Send a text message (the main tool for automations/alerts) |
| `telegram_edit_message_text` | Edit a message the bot already sent |
| `telegram_delete_message` | Delete a message |
| `telegram_pin_chat_message` / `telegram_unpin_chat_message` | Pin/unpin a message |
| `telegram_send_photo` | Send an image by URL with an optional caption |
| `telegram_send_document` | Send a file (PDF, CSV, etc.) by URL with an optional caption |
| `telegram_get_me` | Check the bot's identity / verify the token works |
| `telegram_get_chat` | Look up info about a chat |
| `telegram_get_updates` | Discover a chat's `chat_id` by reading recent messages sent to the bot |

---

## Step 1 — Create a Telegram bot (2 minutes)

1. Open Telegram, search for **@BotFather**, and start a chat.
2. Send `/newbot`, give it a name and a username (must end in `bot`, e.g. `my_claude_alerts_bot`).
3. BotFather replies with a token that looks like `123456789:AAExampleTokenValueHere`. Copy it —
   this is your `TELEGRAM_BOT_TOKEN`. Keep it secret; anyone with it can control your bot.

---

## Step 2 — Deploy the server so it has a public URL

Since the server needs to run even when your computer is off, deploy it to a free hosting
platform. **Render.com** is the simplest option (no credit card needed for the free tier):

1. Push this folder to a new GitHub repository (create one at github.com if needed):
   ```bash
   cd telegram-mcp-server
   git init
   git add .
   git commit -m "Telegram MCP server"
   git branch -M main
   git remote add origin https://github.com/<your-username>/telegram-mcp-server.git
   git push -u origin main
   ```
2. Go to [render.com](https://render.com) → sign up/log in → **New +** → **Web Service**.
3. Connect your GitHub account and select the `telegram-mcp-server` repo.
4. Configure it:
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Under **Environment Variables**, add:
   - `TELEGRAM_BOT_TOKEN` = *(the token from BotFather)*
   - `TRANSPORT` = `http`
6. Click **Create Web Service**. After the first deploy finishes, Render gives you a URL like
   `https://telegram-mcp-server.onrender.com`. Your MCP endpoint is that URL + `/mcp`, e.g.
   `https://telegram-mcp-server.onrender.com/mcp`.

> Note: on Render's free tier the service sleeps after 15 minutes of inactivity and takes ~30-60s
> to wake up on the next request. That's fine for occasional routine use; upgrade to a paid
> instance ($7/mo) if you need it always warm.

(Railway, Fly.io, or any other Node-friendly host work the same way — build command
`npm install && npm run build`, start command `npm start`, and the same two env vars.)

---

## Step 3 — Connect it to Claude

In claude.ai: **Settings → Connectors → Add custom connector**, paste your `/mcp` URL from Step 2,
and save. The tools listed above will then be available to Claude, including inside scheduled
routines/automations.

---

## Step 4 — Find your chat_id

The bot can only message chats it already knows about:

- **To message yourself or a friend**: that person must open a chat with the bot (search its
  `@username` in Telegram) and send it any message, e.g. `/start`.
- **To message a group**: add the bot to the group.
- **To message a channel**: add the bot as an admin of the channel.

Then, in Claude, ask it to call `telegram_get_updates` — it will show the `chat_id` for every
chat/group/channel that has messaged the bot. Save that `chat_id`; you'll reuse it in your routine
(e.g. "send a Telegram message to chat_id 123456789 saying ...").

---

## Local development (optional)

```bash
npm install
cp .env.example .env   # fill in TELEGRAM_BOT_TOKEN
npm run build

# stdio mode (for Claude Desktop/Claude Code on your own machine)
npm start

# HTTP mode (matches what's deployed)
TRANSPORT=http PORT=3000 npm start
```

Test with the MCP Inspector:
```bash
npx @modelcontextprotocol/inspector
```

## Security notes

- Never commit `.env` or your bot token to git (`.gitignore` already excludes `.env`).
- The bot token grants full control of the bot — treat it like a password.
- This server only calls the official Telegram Bot API (`api.telegram.org`); it doesn't store any
  message content itself.
