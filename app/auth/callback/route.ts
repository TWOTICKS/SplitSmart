import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/trips";
  const next = nextParam.startsWith("/") ? nextParam : "/trips"; // never redirect off-site

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    const cookieHeader = request.headers.get("cookie") ?? "";
    const cookieNames = cookieHeader
      .split(";")
      .map((c) => c.trim().split("=")[0])
      .filter(Boolean);
    console.error("auth callback: exchangeCodeForSession failed", {
      message: error.message,
      status: error.status,
      cookieNames,
      codeVerifierCookieCount: cookieNames.filter((n) => n.includes("code-verifier")).length,
    });
  } else {
    console.error("auth callback: no code param in request", { url: request.url });
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
