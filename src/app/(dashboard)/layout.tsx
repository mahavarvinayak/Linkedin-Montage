import { requireAdminPage } from "@/lib/auth";
import { getNavCounts } from "@/lib/queries";
import { AppSidebar } from "@/components/app-sidebar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdminPage();
  const counts = await getNavCounts();

  return (
    <div className="min-h-screen">
      <AppSidebar email={user.email ?? "admin"} counts={counts} />
      <div className="lg:pl-[252px]">
        <main className="mx-auto w-full max-w-[1180px] px-5 py-8 sm:px-8 lg:px-10 lg:py-11">
          {children}
        </main>
      </div>
    </div>
  );
}
