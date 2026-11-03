"use client";

import { useId, useState } from "react";
import {
  Bot,
  Calendar,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Code2,
  Copy,
  Cpu,
  FileCode,
  Folder,
  Layers,
  Play,
  Search,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { TOOLS, type ToolDefinition } from "@/mcp/definitions";

interface McpDashboardProps {
  projectPath: string;
  supabaseUrl: string;
  hasServiceRoleKey: boolean;
  accountsCount: number;
  destinationsCount: number;
}

type IdeTab = "cursor" | "claude" | "cline" | "windsurf" | "http" | "terminal";

const IDE_INFO: Record<
  IdeTab,
  {
    name: string;
    icon: string;
    filePathWindows: string;
    filePathMac: string;
    instructions: string[];
  }
> = {
  cursor: {
    name: "Cursor",
    icon: "⚡",
    filePathWindows: ".cursor/mcp.json (in project root) OR Cursor Settings > Features > MCP",
    filePathMac: ".cursor/mcp.json (in project root) OR Cursor Settings > Features > MCP",
    instructions: [
      "Zero-config setup: A `.cursor/mcp.json` file is already created in this project root!",
      "If this folder is open in Cursor, go to Cursor Settings > Features > MCP to see 'cadence-linkedin' active.",
      "In Cursor Chat (Cmd+L / Ctrl+L) or Composer (Cmd+I / Ctrl+I), your agent can now automatically schedule, edit, and publish LinkedIn posts.",
    ],
  },
  claude: {
    name: "Claude Desktop",
    icon: "🤖",
    filePathWindows: "%APPDATA%\\Claude\\claude_desktop_config.json",
    filePathMac: "~/Library/Application Support/Claude/claude_desktop_config.json",
    instructions: [
      "Open or create the Claude Desktop configuration file at the path shown above.",
      "Paste the JSON snippet under the 'mcpServers' key.",
      "Fully restart Claude Desktop (Quit from system tray / menu bar, then reopen).",
      "Look for the hammer 🔨 icon in Claude chat to confirm all 15 Cadence tools are loaded.",
    ],
  },
  cline: {
    name: "VS Code / Cline",
    icon: "💻",
    filePathWindows: "%APPDATA%\\Code\\User\\globalStorage\\saoudrizwan.claude-dev\\settings\\cline_mcp_settings.json",
    filePathMac: "~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json",
    instructions: [
      "Open VS Code with the Cline or Roo Code extension installed.",
      "Click the MCP icon in the Cline panel or edit the settings JSON file directly.",
      "Add the 'cadence-linkedin' server configuration and save.",
      "Cline will show a green indicator next to Cadence with all tools available.",
    ],
  },
  windsurf: {
    name: "Windsurf",
    icon: "🏄",
    filePathWindows: "%USERPROFILE%\\.codeium\\windsurf\\mcp_config.json",
    filePathMac: "~/.codeium/windsurf/mcp_config.json",
    instructions: [
      "Open Windsurf and click the Cascade icon or open user settings.",
      "Open your `mcp_config.json` configuration file.",
      "Paste the snippet under 'mcpServers' and save.",
      "In Cascade, you can now instruct the assistant: 'Schedule my LinkedIn post via Cadence'.",
    ],
  },
  http: {
    name: "HTTP / Webhook API",
    icon: "🌐",
    filePathWindows: "/api/mcp (HTTP POST / GET)",
    filePathMac: "/api/mcp (HTTP POST / GET)",
    instructions: [
      "Cadence Studio also exposes an authenticated HTTP endpoint at `/api/mcp`.",
      "Send a GET request to `/api/mcp` to list all tools.",
      "Send a POST request with `{ \"name\": \"cadence_schedule_post\", \"args\": { ... } }` to execute any tool remotely.",
    ],
  },
  terminal: {
    name: "CLI / Inspector",
    icon: "📟",
    filePathWindows: "Terminal (cmd / PowerShell / bash)",
    filePathMac: "Terminal (zsh / bash)",
    instructions: [
      "Test via official MCP Inspector: run the inspector command below in your terminal.",
      "The Inspector will launch an interactive web UI at http://localhost:5173 where you can test each tool.",
      "Or run directly via stdio: `npm run mcp`.",
    ],
  },
};

const CATEGORY_LABELS: Record<ToolDefinition["category"], { label: string; color: string }> = {
  system: { label: "System & Accounts", color: "bg-blue-50 text-blue-700 ring-blue-200" },
  content: { label: "Content & Scheduling", color: "bg-purple-50 text-purple-700 ring-purple-200" },
  automation: { label: "Media & Batch Automation", color: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  publishing: { label: "Publishing & Recovery", color: "bg-amber-50 text-amber-700 ring-amber-200" },
};

export function McpDashboard({
  projectPath,
  supabaseUrl,
  hasServiceRoleKey,
  accountsCount,
  destinationsCount,
}: McpDashboardProps) {
  const [activeTab, setActiveTab] = useState<IdeTab>("cursor");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});

  const normalizedPath = projectPath.replace(/\\/g, "/");

  async function copyToClipboard(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(id);
      setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      setCopiedKey(null);
    }
  }

  function toggleTool(name: string) {
    setExpandedTools((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  // Generate configurations based on the selected IDE
  function getSnippet(tab: IdeTab): string {
    if (tab === "terminal") {
      return `# 1. Test using official MCP Inspector (recommended)
npx @modelcontextprotocol/inspector npx -y tsx src/mcp/index.ts

# 2. Or test running server directly via stdio
npm run mcp`;
    }

    if (tab === "cursor") {
      return JSON.stringify(
        {
          mcpServers: {
            "cadence-linkedin": {
              command: "npx",
              args: ["-y", "tsx", "src/mcp/index.ts"],
              cwd: normalizedPath,
            },
          },
        },
        null,
        2
      );
    }

    if (tab === "http") {
      return `# 1. List all exposed tools
curl -X GET http://localhost:3000/api/mcp

# 2. Execute any MCP tool via HTTP POST
curl -X POST http://localhost:3000/api/mcp \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "cadence_get_status",
    "args": {}
  }'`;
    }

    if (tab === "cline") {
      return JSON.stringify(
        {
          mcpServers: {
            "cadence-linkedin": {
              command: "npx",
              args: ["-y", "tsx", "src/mcp/index.ts"],
              cwd: normalizedPath,
              disabled: false,
              autoApprove: [],
            },
          },
        },
        null,
        2
      );
    }

    // Default for Claude & Windsurf
    return JSON.stringify(
      {
        mcpServers: {
          "cadence-linkedin": {
            command: "npx",
            args: ["-y", "tsx", "src/mcp/index.ts"],
            cwd: normalizedPath,
          },
        },
      },
      null,
      2
    );
  }

  const filteredTools = TOOLS.filter((tool) => {
    const matchesCategory = selectedCategory === "all" || tool.category === selectedCategory;
    const query = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !query ||
      tool.name.toLowerCase().includes(query) ||
      tool.description.toLowerCase().includes(query) ||
      tool.examplePrompt.toLowerCase().includes(query);
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-8">
      {/* Overview & System Status Bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4 bg-white/80">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Bot className="size-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                MCP Server
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                <p className="text-[14px] font-semibold text-foreground">Active (stdio)</p>
              </div>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-white/80">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
              <Workflow className="size-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Exposed Tools
              </p>
              <p className="text-[14px] font-semibold text-foreground mt-0.5">
                {TOOLS.length} Ready Tools
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-white/80">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <CheckCircle2 className="size-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Supabase & Vault
              </p>
              <p className="text-[14px] font-semibold text-foreground mt-0.5">
                {hasServiceRoleKey ? "Configured & Ready" : "Missing Service Key"}
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-white/80">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <Layers className="size-5" />
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Targets Available
              </p>
              <p className="text-[14px] font-semibold text-foreground mt-0.5">
                {accountsCount} Account{accountsCount === 1 ? "" : "s"} • {destinationsCount} Dest.
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Workspace Path Card */}
      <Card className="p-5 border-stone-200/80 bg-stone-50/50">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Folder className="size-4 text-stone-500" />
              <span className="text-[12px] font-semibold text-foreground uppercase tracking-wider">
                Detected Project Root Directory
              </span>
            </div>
            <code className="block rounded bg-stone-100 px-2.5 py-1 text-[12px] font-mono text-stone-800 break-all border border-stone-200">
              {projectPath}
            </code>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => copyToClipboard(normalizedPath, "path")}
            className="shrink-0 gap-1.5 text-[12px] h-8 bg-white"
          >
            {copiedKey === "path" ? (
              <>
                <Check className="size-3.5 text-emerald-600" />
                <span>Copied Path</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5 text-muted-foreground" />
                <span>Copy Path</span>
              </>
            )}
          </Button>
        </div>
      </Card>

      {/* Main Configuration Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-foreground">
            IDE & Client Configuration
          </h2>
          <p className="text-[13px] text-muted-foreground mt-1">
            Select your favorite editor or tool to copy the exact MCP configuration JSON.
          </p>
        </div>

        {/* Tab Buttons */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
          {(["cursor", "claude", "cline", "windsurf", "http", "terminal"] as IdeTab[]).map((tab) => {
            const info = IDE_INFO[tab];
            const active = activeTab === tab;
            return (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-[13px] font-medium transition-all",
                  active
                    ? "bg-stone-900 text-white shadow-sm"
                    : "bg-stone-100 text-stone-600 hover:bg-stone-200 hover:text-stone-900"
                )}
              >
                <span>{info.icon}</span>
                <span>{info.name}</span>
              </button>
            );
          })}
        </div>

        {/* Tab Panel */}
        <Card className="p-6 border-stone-200 bg-white">
          <div className="space-y-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="text-[15px] font-semibold text-foreground flex items-center gap-2">
                  <span>{IDE_INFO[activeTab].icon}</span>
                  <span>{IDE_INFO[activeTab].name} Setup Guide</span>
                </h3>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Target config path:{" "}
                  <code className="text-stone-800 font-mono bg-stone-100 px-1.5 py-0.5 rounded text-[11px]">
                    {IDE_INFO[activeTab].filePathWindows}
                  </code>
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => copyToClipboard(getSnippet(activeTab), `snippet-${activeTab}`)}
                  className="gap-1.5 bg-blue-600 hover:bg-blue-700 text-white h-8 text-[12px]"
                >
                  {copiedKey === `snippet-${activeTab}` ? (
                    <>
                      <Check className="size-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3.5" />
                      <span>Copy Configuration</span>
                    </>
                  )}
                </Button>
              </div>
            </div>

            {/* Code Box */}
            <div className="relative rounded-lg bg-stone-900 text-stone-100 p-4 font-mono text-[12px] leading-relaxed overflow-x-auto shadow-inner">
              <pre>{getSnippet(activeTab)}</pre>
            </div>

            {/* Step-by-step instructions */}
            <div className="space-y-2 pt-2 border-t border-stone-100">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
                Steps to activate:
              </p>
              <ul className="space-y-1.5">
                {IDE_INFO[activeTab].instructions.map((step, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2.5 text-[12.5px] text-stone-700 leading-normal"
                  >
                    <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[11px] font-semibold text-blue-700 mt-0.5">
                      {idx + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Card>
      </div>

      {/* AI Prompt Playbook */}
      <div className="space-y-4">
        <div>
          <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-foreground flex items-center gap-2">
            <Sparkles className="size-5 text-amber-500" />
            <span>AI Prompt Playbook</span>
          </h2>
          <p className="text-[13px] text-muted-foreground mt-1">
            Copy and paste these sample prompts directly into Cursor Composer, Claude, or Windsurf
            to orchestrate LinkedIn tasks.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            {
              title: "📅 Calendar & Queue Review",
              prompt:
                "Check the status of Cadence using cadence_get_status and list all posts currently scheduled for this upcoming week.",
            },
            {
              title: "✍️ Draft & Schedule Post",
              prompt:
                "Schedule a new post for tomorrow at 10:30 AM IST with caption: 'Excited to announce our open source LinkedIn automation suite!' and hashtags '#OpenSource #Engineering'.",
            },
            {
              title: "📁 Bulk Schedule from Assets",
              prompt:
                "Scan the folder 'C:/Content/November' and use cadence_bulk_schedule_from_folder to schedule all images daily at 11:00 AM IST.",
            },
            {
              title: "🔄 Audit & Retry Failed Jobs",
              prompt:
                "List all posts in 'failed' or 'manual_required' status, retrieve their recent error logs, and retry any failed publishing jobs.",
            },
          ].map((card, i) => (
            <Card key={i} className="p-4 bg-white flex flex-col justify-between gap-3 border-stone-200">
              <div className="space-y-1.5">
                <p className="text-[13px] font-semibold text-foreground">{card.title}</p>
                <p className="text-[12px] font-mono text-stone-600 bg-stone-50 p-2.5 rounded border border-stone-100 leading-relaxed">
                  &quot;{card.prompt}&quot;
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(card.prompt, `prompt-${i}`)}
                  className="gap-1.5 text-[11px] h-7 text-muted-foreground hover:text-foreground"
                >
                  {copiedKey === `prompt-${i}` ? (
                    <>
                      <Check className="size-3 text-emerald-600" />
                      <span>Copied Prompt</span>
                    </>
                  ) : (
                    <>
                      <Copy className="size-3" />
                      <span>Copy Prompt</span>
                    </>
                  )}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* Available Tools Explorer */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-foreground">
              Available MCP Tools Explorer ({filteredTools.length})
            </h2>
            <p className="text-[13px] text-muted-foreground mt-1">
              Browse all tools exposed to your AI assistant with their input schema and example usage.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search tools or parameters..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-[12px] h-8 bg-white"
              />
            </div>
          </div>
        </div>

        {/* Category Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          {[
            { id: "all", label: `All Tools (${TOOLS.length})` },
            { id: "system", label: "System & Accounts" },
            { id: "content", label: "Content & Scheduling" },
            { id: "automation", label: "Media & Batch" },
            { id: "publishing", label: "Publishing & Recovery" },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setSelectedCategory(cat.id)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[11.5px] font-medium transition-all",
                selectedCategory === cat.id
                  ? "bg-stone-900 text-white"
                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
              )}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Tools List */}
        <div className="space-y-2.5">
          {filteredTools.map((tool) => {
            const isExpanded = !!expandedTools[tool.name];
            const cat = CATEGORY_LABELS[tool.category];
            const propKeys = Object.keys(tool.inputSchema.properties || {});
            const requiredProps = new Set(tool.inputSchema.required || []);

            return (
              <Card
                key={tool.name}
                className="overflow-hidden border-stone-200 bg-white transition-all hover:border-stone-300"
              >
                <div
                  className="flex flex-col gap-2 p-4 cursor-pointer sm:flex-row sm:items-center sm:justify-between"
                  onClick={() => toggleTool(tool.name)}
                >
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-semibold text-blue-700">
                        {tool.name}
                      </span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-medium ring-1",
                          cat.color
                        )}
                      >
                        {cat.label}
                      </span>
                      {propKeys.length === 0 ? (
                        <span className="text-[10px] text-muted-foreground">No parameters</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">
                          {propKeys.length} parameter{propKeys.length === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground leading-relaxed">
                      {tool.description}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        copyToClipboard(tool.name, `tool-${tool.name}`);
                      }}
                      className="h-7 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
                    >
                      {copiedKey === `tool-${tool.name}` ? (
                        <>
                          <Check className="size-3 text-emerald-600" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" />
                          <span>Copy Name</span>
                        </>
                      )}
                    </Button>
                    <div className="p-1 text-stone-400">
                      {isExpanded ? (
                        <ChevronUp className="size-4" />
                      ) : (
                        <ChevronDown className="size-4" />
                      )}
                    </div>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t border-stone-100 bg-stone-50/60 p-4 space-y-4">
                    {/* Example Prompt */}
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                        Example AI Prompt:
                      </p>
                      <div className="flex items-center justify-between gap-2 rounded bg-white p-2.5 border border-stone-200">
                        <code className="text-[12px] font-mono text-stone-800">
                          &quot;{tool.examplePrompt}&quot;
                        </code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => copyToClipboard(tool.examplePrompt, `prompt-${tool.name}`)}
                          className="h-6 px-2 text-[11px]"
                        >
                          {copiedKey === `prompt-${tool.name}` ? "Copied" : "Copy"}
                        </Button>
                      </div>
                    </div>

                    {/* Parameters Table */}
                    {propKeys.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          Parameters:
                        </p>
                        <div className="rounded border border-stone-200 overflow-hidden bg-white">
                          <table className="w-full text-left text-[11.5px]">
                            <thead className="bg-stone-100 text-stone-700 font-semibold border-b border-stone-200">
                              <tr>
                                <th className="p-2">Name</th>
                                <th className="p-2">Type</th>
                                <th className="p-2">Required</th>
                                <th className="p-2">Description</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-stone-100">
                              {propKeys.map((key) => {
                                const prop = tool.inputSchema.properties[key];
                                const isRequired = requiredProps.has(key);
                                return (
                                  <tr key={key} className="hover:bg-stone-50/50">
                                    <td className="p-2 font-mono font-medium text-stone-800">
                                      {key}
                                    </td>
                                    <td className="p-2 text-stone-500 font-mono">
                                      {prop.type || "any"}
                                    </td>
                                    <td className="p-2">
                                      {isRequired ? (
                                        <span className="rounded bg-red-50 text-red-700 px-1.5 py-0.5 text-[10px] font-medium">
                                          Required
                                        </span>
                                      ) : (
                                        <span className="text-stone-400 text-[10px]">
                                          Optional
                                        </span>
                                      )}
                                    </td>
                                    <td className="p-2 text-stone-600">
                                      {prop.description || "—"}
                                      {prop.enum && (
                                        <span className="block mt-0.5 text-stone-400 font-mono text-[10.5px]">
                                          Options: {prop.enum.join(" | ")}
                                        </span>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
