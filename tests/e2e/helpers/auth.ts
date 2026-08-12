import { createClient } from "@supabase/supabase-js";
import type { Page } from "@playwright/test";

/**
 * Signs a Playwright page in as a fresh test user, using the exact same
 * link a real magic-link email would contain — no cookie-forging, no route
 * bypassed. Requires SUPABASE_SERVICE_ROLE_KEY (server-only, test env only;
 * never expose this key to the browser or commit it) to mint the link,
 * since generating a sign-in link for an arbitrary email requires admin
 * privileges that the app itself never has.
 */
export async function signInAsNewUser(page: Page, emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}+${Date.now()}@example.com`;

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000"}/auth/callback` },
  });
  if (error || !data.properties?.action_link) {
    throw new Error(`could not generate a sign-in link for the test user: ${error?.message}`);
  }

  await page.goto(data.properties.action_link);
  await page.waitForURL("**/trips");
  return email;
}
