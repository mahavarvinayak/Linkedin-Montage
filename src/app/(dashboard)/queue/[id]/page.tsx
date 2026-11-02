import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/page-header";
import { PostComposer } from "@/components/post-composer";
import { StatusBadge } from "@/components/status-badge";
import { getIntegrationStatus, getPost, listDestinations } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit post" };

export default async function EditPostPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [post, status, destinations] = await Promise.all([
    getPost(id),
    getIntegrationStatus(),
    listDestinations(),
  ]);

  if (!post) notFound();
  if (post.status === "published") redirect("/published");

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Queue"
        title={post.status === "draft" ? "Edit draft" : "Edit post"}
        description="Changes are saved to the private queue. Media order is preserved when publishing."
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={post.status} />
            <Link
              href="/queue"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <ArrowLeft />
              Back
            </Link>
          </div>
        }
      />

      <PostComposer
        mode="edit"
        post={post}
        authorName={status.settings?.linkedin_member_name}
        authorPicture={status.settings?.linkedin_member_picture}
        linkedinReady={status.linkedinReady}
        destinations={destinations}
        initialDestinationIds={(post.jobs ?? []).map((job) => job.destination_id)}
      />
    </div>
  );
}
