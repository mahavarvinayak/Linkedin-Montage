"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  className,
  variant = "ghost",
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: "ghost" | "secondary";
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      onClick={copy}
      className={cn("text-muted-foreground", className)}
      aria-label={label}
    >
      {copied ? <Check className="text-emerald-600" /> : <Copy />}
      <span>{copied ? "Copied" : label}</span>
    </Button>
  );
}
