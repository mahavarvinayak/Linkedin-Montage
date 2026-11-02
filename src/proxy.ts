import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/privacy"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    if (isPublic(pathname)) return NextResponse.next();
    return NextResponse.redirect(new URL("/login?error=not_configured", request.url));
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  let allowed = false;
  if (user?.email) {
    const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
    const email = user.email.trim().toLowerCase();
    allowed = adminEmail ? email === adminEmail : true;

    if (allowed) {
      const { data } = await supabase
        .from("app_admins")
        .select("email")
        .eq("email", email)
        .maybeSingle();
      allowed = Boolean(data);
    }
  }

  if (isPublic(pathname)) {
    if (allowed) {
      return NextResponse.redirect(new URL("/overview", request.url));
    }
    return response;
  }

  if (!allowed) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set(
      "error",
      user ? "unauthorized" : "session_required",
    );
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
