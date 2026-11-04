import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { QueueList } from "@/components/queue-list";
import { listPosts } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Content queue" };

export default async function QueuePage() {
  const posts = await listPosts(["draft", "scheduled", "publishing", "cancelled"], { limit: 500 });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Queue"
        title="Content queue"
        description="Drafts, scheduled posts and anything LinkedIn is currently processing. Times are in IST."
        actions={
          <Link href="/create" className={buttonVariants()}>
            <Plus />
            New post
          </Link>
        }
      />

      <QueueList posts={posts} />
    </div>
  );
}
