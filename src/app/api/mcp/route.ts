import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { TOOLS, executeTool } from "@/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    jsonrpc: "2.0",
    result: { tools: TOOLS },
    tools: TOOLS,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      jsonrpc?: string;
      id?: string | number;
      tool?: string;
      name?: string;
      arguments?: Record<string, any>;
      args?: Record<string, any>;
      method?: string;
      params?: { name?: string; arguments?: Record<string, any> };
    };

    // 1. MCP Handshake / Initialization
    if (body.method === "initialize") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id ?? 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: "cadence-linkedin-studio",
            version: "1.0.0",
          },
        },
      });
    }

    // 2. Ping
    if (body.method === "ping") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {},
      });
    }

    // 3. List tools
    if (body.method === "tools/list") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: TOOLS },
        tools: TOOLS,
      });
    }

    // 4. Tool Execution (MCP JSON-RPC or REST)
    const toolName = body.params?.name || body.name || body.tool;
    const toolArgs = body.params?.arguments || body.arguments || body.args || {};

    if (!toolName) {
      return NextResponse.json(
        {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32600, message: "Missing tool name in request body." },
        },
        { status: 400 },
      );
    }

    const result = await executeTool(toolName, toolArgs);

    // If caller used standard JSON-RPC
    if (body.jsonrpc || body.method === "tools/call") {
      return NextResponse.json({
        jsonrpc: "2.0",
        id: body.id,
        result: {
          content: [
            {
              type: "text",
              text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
            },
          ],
        },
      });
    }

    // Simplified REST format
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP Tool execution failed.";
    return NextResponse.json(
      {
        ok: false,
        error: { code: -32603, message },
      },
      { status: 500 },
    );
  }
}

