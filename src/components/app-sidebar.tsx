"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  CheckCircle2,
  Clock3,
  LayoutDashboard,
  LogOut,
  Menu,
  Network,
  PenLine,
  Settings,
} from "lucide-react";
import { Brand } from "@/components/brand";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { TIMEZONE_LABEL } from "@/lib/constants";
import { cn } from "@/lib/utils";

const items = [
  { key: "overview", href: "/overview", label: "Overview", icon: LayoutDashboard },
  { key: "create", href: "/create", label: "Create Post", icon: PenLine },
  { key: "queue", href: "/queue", label: "Content Queue", icon: CalendarClock },
  { key: "published", href: "/published", label: "Published Posts", icon: CheckCircle2 },
  { key: "failed", href: "/failed", label: "Failed Posts", icon: AlertTriangle },
  { key: "destinations", href: "/destinations", label: "Destinations", icon: Network },
  { key: "mcp", href: "/mcp", label: "MCP Server", icon: Bot },
  { key: "settings", href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavBody({
  pathname,
  counts,
  onNavigate,
}: {
  pathname: string;
  counts: { queue: number; failed: number };
  onNavigate?: () => void;
}) {
  return (
    <nav className="flex flex-col gap-1 px-3" aria-label="Primary">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        const Icon = item.icon;
        const count =
          item.key === "queue" ? counts.queue : item.key === "failed" ? counts.failed : null;

        return (
          <Link
            key={item.key}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "group relative flex h-9 items-center gap-3 rounded-md px-3 text-[13px] transition-colors",
              active
                ? "bg-stone-100 font-medium text-foreground"
                : "text-muted-foreground hover:bg-stone-50 hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            {active ? (
              <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-blue-600" />
            ) : null}
            <Icon className={cn("size-4", active ? "text-blue-700" : "text-stone-400")} />
            <span className="flex-1">{item.label}</span>
            {count ? (
              <span
                className={cn(
                  "nums rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                  item.key === "failed"
                    ? "bg-red-50 text-red-700"
                    : "bg-white text-stone-500 ring-1 ring-stone-200",
                )}
              >
                {count > 99 ? "99+" : count}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter({ email }: { email: string }) {
  return (
    <div className="mt-auto border-t border-border px-3 py-4">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-stone-100 text-[11px] font-medium uppercase text-stone-600 ring-1 ring-stone-200">
          {email.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-medium text-foreground">{email}</p>
          <p className="text-[10.5px] text-muted-foreground">Private admin</p>
        </div>
        <form action="/api/auth/logout" method="post">
          <button
            type="submit"
            className="rounded-md p-1.5 text-stone-400 transition-colors hover:bg-stone-100 hover:text-foreground"
            title="Sign out"
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
      <div className="mt-3 flex items-center gap-1.5 px-2 text-[10.5px] text-muted-foreground">
        <Clock3 className="size-3" />
        <span>{TIMEZONE_LABEL}</span>
      </div>
    </div>
  );
}

export function AppSidebar({
  email,
  counts,
}: {
  email: string;
  counts: { queue: number; failed: number };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[252px] flex-col border-r border-border bg-white lg:flex">
        <div className="flex flex-col gap-1 px-6 pb-6 pt-7">
          <Brand />
          <p className="ml-[38px] text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            LinkedIn Studio
          </p>
        </div>
        <div className="px-3 pb-2">
          <p className="px-3 pb-2 text-[9.5px] font-medium uppercase tracking-[0.16em] text-stone-400">
            Workspace
          </p>
        </div>
        <NavBody pathname={pathname} counts={counts} />
        <SidebarFooter email={email} />
      </aside>

      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-border bg-white px-4 lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-md border border-border p-2 text-stone-600 transition-colors hover:bg-stone-50"
          aria-label="Open navigation"
        >
          <Menu className="size-4" />
        </button>
      </header>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="left-0 top-0 flex h-full max-h-none w-[280px] max-w-[85vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-l-0 p-0">
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <DialogDescription className="sr-only">
            Move between sections of the Cadence dashboard.
          </DialogDescription>
          <div className="flex flex-col gap-1 px-6 pb-6 pt-7">
            <Brand />
            <p className="ml-[38px] text-[9.5px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              LinkedIn Studio
            </p>
          </div>
          <NavBody pathname={pathname} counts={counts} onNavigate={() => setOpen(false)} />
          <SidebarFooter email={email} />
        </DialogContent>
      </Dialog>
    </>
  );
}
