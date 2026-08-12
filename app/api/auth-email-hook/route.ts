import { NextResponse } from "next/server";
import { Webhook } from "standardwebhooks";

/**
 * Supabase's "Send Email" Auth Hook: instead of Supabase sending the sign-in
 * email itself (via its dashboard-configured template, which — for reasons
 * that were never fully pinned down — kept sending the old link-only design
 * regardless of what the template editor showed), Supabase POSTs the code
 * here and this route sends the email directly through Resend, with a
 * template we fully control. Configure this in Supabase dashboard under
 * Authentication -> Hooks -> Send Email, pointing at this route's URL; the
 * secret it gives you goes in SUPABASE_AUTH_HOOK_SECRET.
 */

interface SendEmailPayload {
  user: { email: string };
  email_data: {
    token: string;
    email_action_type: string;
  };
}

export async function POST(request: Request) {
  const secret = process.env.SUPABASE_AUTH_HOOK_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!secret || !resendApiKey) {
    console.error("auth-email-hook: missing SUPABASE_AUTH_HOOK_SECRET or RESEND_API_KEY");
    return NextResponse.json({ error: "not configured" }, { status: 500 });
  }

  const body = await request.text();
  const headers = Object.fromEntries(request.headers);

  let payload: SendEmailPayload;
  try {
    const webhook = new Webhook(secret.replace("v1,whsec_", ""));
    payload = webhook.verify(body, headers) as SendEmailPayload;
  } catch (e) {
    console.error("auth-email-hook: signature verification failed", e);
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  const { email } = payload.user;
  const { token } = payload.email_data;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "SplitSmart <onboarding@resend.dev>",
      to: [email],
      subject: `${token} is your SplitSmart sign-in code`,
      html: `
        <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto;">
          <h2 style="margin-bottom: 4px;">Sign in to SplitSmart</h2>
          <p style="color: #555;">Enter this code in the app to sign in:</p>
          <p style="font-size: 32px; font-weight: 700; letter-spacing: 0.1em; margin: 16px 0;">${token}</p>
          <p style="color: #888; font-size: 13px;">This code expires shortly and can only be used once. If you didn't request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!res.ok) {
    const errorBody = await res.text();
    console.error("auth-email-hook: Resend send failed", { status: res.status, errorBody });
    return NextResponse.json({ error: "send failed" }, { status: 500 });
  }

  return NextResponse.json({});
}
