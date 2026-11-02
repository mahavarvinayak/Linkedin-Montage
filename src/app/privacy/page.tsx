import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Shield } from "lucide-react";
import { Brand } from "@/components/brand";

export const metadata: Metadata = {
  title: "Privacy Policy — Cadence Studio",
  description: "Privacy policy for Cadence LinkedIn publishing dashboard.",
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900 selection:bg-blue-100 selection:text-blue-900">
      <header className="border-b border-border bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Brand />
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            Back to app
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          <Shield className="size-4 text-blue-600" />
          <span>Legal</span>
        </div>

        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.02em] text-foreground sm:text-4xl">
          Privacy Policy
        </h1>
        <p className="mt-2 text-[13px] text-muted-foreground">
          Last updated: November 2026
        </p>

        <article className="mt-10 space-y-8 text-[14px] leading-relaxed text-stone-700">
          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
              1. Overview
            </h2>
            <p>
              Cadence is a private, personal content scheduling and publishing dashboard used exclusively
              by its authorized administrator to manage and schedule posts for their personal LinkedIn
              profile and connected LinkedIn Company Pages. Cadence is a private personal-use application
              and is not a public commercial SaaS product.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
              2. Information We Access and Process
            </h2>
            <p>
              When connecting your LinkedIn account via official OAuth 2.0 authorization, Cadence requests
              access to the following minimum scopes:
            </p>
            <ul className="list-disc space-y-1 pl-5 text-[13.5px]">
              <li>
                <strong>openid &amp; profile:</strong> Used solely to identify the authenticated member name,
                profile picture, and unique member ID URN.
              </li>
              <li>
                <strong>w_member_social:</strong> Used solely to publish author-composed text and image posts
                directly to your personal LinkedIn profile at the scheduled time.
              </li>
              <li>
                <strong>w_organization_social &amp; r_organization_admin:</strong> (If enabled) Used solely to
                discover and publish posts to authorized LinkedIn Company or Showcase Pages where you serve as
                an administrator.
              </li>
            </ul>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
              3. Data Storage and Security
            </h2>
            <p>
              All LinkedIn OAuth access tokens are securely stored server-side in encrypted vault storage
              (Supabase Vault). Access tokens are never exposed to the client-side browser. Uploaded static
              images are stored in a private Supabase Storage bucket and are automatically scheduled for
              deletion 48 hours after successful publishing.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
              4. Third-Party Sharing and Disclosures
            </h2>
            <p>
              Cadence does not sell, rent, monetize, or share your personal information, credentials, or post
              content with any third parties or marketing networks. Content is transmitted solely through
              official LinkedIn APIs to complete requested publishing tasks.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
              5. Disconnecting and Data Removal
            </h2>
            <p>
              You may disconnect your LinkedIn account at any time directly through the Settings dashboard.
              Disconnecting instantly deletes stored access tokens and authorization records from the database.
              You may also revoke Cadence’s access at any time through your LinkedIn account settings under
              <em> Permitted Services</em>.
            </p>
          </section>

          <section className="space-y-3">
            <h2 className="text-[17px] font-semibold tracking-tight text-foreground">
              6. Contact
            </h2>
            <p>
              For questions or privacy inquiries regarding this application, please reach out to the project
              administrator through your connected dashboard.
            </p>
          </section>
        </article>
      </main>

      <footer className="border-t border-border bg-white px-6 py-6 text-center text-[12px] text-muted-foreground">
        © {new Date().getFullYear()} Cadence Studio. All rights reserved.
      </footer>
    </div>
  );
}
