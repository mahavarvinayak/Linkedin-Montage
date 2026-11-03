import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { TOOLS, executeTool } from "@/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  return NextResponse.json({
    tools: TOOLS,
  });
}

export async function POST(request: Request) {
  const auth = await requireAdminApi();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      tool?: string;
      name?: string;
      arguments?: Record<string, any>;
      args?: Record<string, any>;
      method?: string;
      params?: { name?: string; arguments?: Record<string, any> };
    };

    // Support standard JSON-RPC or simplified REST payload
    const toolName = body.tool || body.name || body.params?.name;
    const toolArgs = body.arguments || body.args || body.params?.arguments || {};

    if (body.method === "tools/list") {
      return NextResponse.json({ tools: TOOLS });
    }

    if (!toolName) {
      return NextResponse.json({ error: "Missing tool name in request body." }, { status: 400 });
    }

    const result = await executeTool(toolName, toolArgs);
    return NextResponse.json({
      ok: true,
      result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "MCP Tool execution failed.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
