import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import express from "express";
import { registerMessagingTools } from "./tools/messaging.js";
import { registerMediaTools } from "./tools/media.js";
import { registerChatTools } from "./tools/chat.js";
import { TelegramApiError } from "./types.js";

function createServer(): McpServer {
  const server = new McpServer({
    name: "telegram-mcp-server",
    version: "1.0.0"
  });

  registerMessagingTools(server);
  registerMediaTools(server);
  registerChatTools(server);

  return server;
}

// Wrap every tool handler so TelegramApiError (and anything else) becomes a
// clean MCP error response instead of an unhandled exception / stack trace.
function installErrorHandling(server: McpServer): void {
  const original = (server as unknown as { registerTool: Function }).registerTool.bind(server);
  (server as unknown as { registerTool: Function }).registerTool = (
    name: string,
    config: unknown,
    handler: (...args: unknown[]) => Promise<unknown>
  ) => {
    const wrapped = async (...args: unknown[]) => {
      try {
        return await handler(...args);
      } catch (err) {
        const message =
          err instanceof TelegramApiError
            ? err.message
            : err instanceof Error
            ? err.message
            : String(err);
        return {
          content: [{ type: "text", text: `Error: ${message}` }],
          isError: true
        };
      }
    };
    return original(name, config, wrapped);
  };
}

async function runStdio(): Promise<void> {
  const server = createServer();
  installErrorHandling(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Telegram MCP server running on stdio");
}

async function runHTTP(): Promise<void> {
  const app = express();
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", server: "telegram-mcp-server" });
  });

  app.post("/mcp", async (req, res) => {
    try {
      const server = createServer();
      installErrorHandling(server);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error("Error handling MCP request:", err);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null
        });
      }
    }
  });

  const port = parseInt(process.env.PORT || "3000", 10);
  app.listen(port, () => {
    console.error(`Telegram MCP server listening on http://0.0.0.0:${port}/mcp`);
  });
}

const transport = process.env.TRANSPORT || "stdio";
if (transport === "http") {
  runHTTP().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    console.error("Server error:", error);
    process.exit(1);
  });
}
