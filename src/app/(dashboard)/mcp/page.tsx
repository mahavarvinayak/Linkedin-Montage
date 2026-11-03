import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { McpDashboard } from "@/components/mcp-dashboard";
import { requireAdminPage } from "@/lib/auth";
import { getSupabaseEnv, isServiceRoleConfigured } from "@/lib/env";
import { listDestinations, listLinkedInAccounts } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "MCP Server Configuration",
};

export default async function McpPage() {
  await requireAdminPage();

  const [accounts, destinations] = await Promise.all([
    listLinkedInAccounts().catch(() => []),
    listDestinations().catch(() => []),
  ]);

  const supabaseEnv = getSupabaseEnv();
  const projectPath = process.cwd();

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="AI & Developer Tools"
        title="Model Context Protocol (MCP)"
        description="Connect your AI coding environment (Cursor, Claude Desktop, VS Code / Cline, Windsurf) to automate LinkedIn posts, bulk schedule from folders, and monitor publishing status directly through AI."
      />

      <McpDashboard
        projectPath={projectPath}
        supabaseUrl={supabaseEnv.url}
        hasServiceRoleKey={isServiceRoleConfigured()}
        accountsCount={accounts.length}
        destinationsCount={destinations.length}
      />
    </div>
  );
}
