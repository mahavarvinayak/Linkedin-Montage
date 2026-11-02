import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import type { IntegrationStatus } from "@/lib/queries";

export function LinkHealthBanner({ status }: { status: IntegrationStatus }) {
  if (!status.environment.linkedin.configured) {
    return (
      <Alert
        tone="warning"
        title="LinkedIn API credentials are missing"
        action={
          <Link href="/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            View setup
          </Link>
        }
      >
        Add <code className="font-mono text-[11px]">LINKEDIN_CLIENT_ID</code> and{" "}
        <code className="font-mono text-[11px]">LINKEDIN_CLIENT_SECRET</code> to connect your
        profile. Scheduled posts will wait until LinkedIn is connected.
      </Alert>
    );
  }

  if (!status.settings?.linkedin_connected) {
    return (
      <Alert
        tone="warning"
        title="LinkedIn isn’t connected yet"
        action={
          <Link href="/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Connect
          </Link>
        }
      >
        Connect your profile to enable publishing. Until then, you can prepare drafts, schedule
        posts and publish them manually.
      </Alert>
    );
  }

  if (status.tokenExpired) {
    return (
      <Alert
        tone="danger"
        title="LinkedIn authorization has expired"
        action={
          <Link href="/settings" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            Reconnect
          </Link>
        }
      >
        Scheduled posts will not publish until you reconnect. You can still export any post and
        publish it manually from the Failed Posts page.
      </Alert>
    );
  }

  if (status.tokenExpiringSoon) {
    return (
      <Alert tone="info" title="LinkedIn authorization expires soon">
        Reconnect from Settings to keep unattended publishing running without interruption.
      </Alert>
    );
  }

  if (!status.bucketReady) {
    return (
      <Alert tone="warning" title="Media storage isn’t ready">
        The private <code className="font-mono text-[11px]">media</code> bucket is missing or
        unreachable. Run the Supabase migration or check your service role key.
      </Alert>
    );
  }

  return null;
}
