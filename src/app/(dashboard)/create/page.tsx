import type { Metadata } from "next";
import { PageHeader } from "@/components/page-header";
import { PostComposer } from "@/components/post-composer";
import { getIntegrationStatus, listDestinations } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Create post" };

export default async function CreatePostPage() {
  const [status, destinations] = await Promise.all([
    getIntegrationStatus(),
    listDestinations(),
  ]);

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Compose"
        title="Create post"
        description="Write, attach images, choose the destinations and set an IST publish time. You can keep it as a draft or schedule it in one step."
      />

      <PostComposer
        mode="create"
        authorName={status.settings?.linkedin_member_name}
        authorPicture={status.settings?.linkedin_member_picture}
        linkedinReady={status.linkedinReady}
        destinations={destinations}
        initialDestinationIds={[]}
      />
    </div>
  );
}
