import { createClerkClient } from "@clerk/backend";
import { clerk } from "@clerk/testing/playwright";
import type { Page } from "@playwright/test";

/**
 * Creates a fresh test user via Clerk's Backend API (needs CLERK_SECRET_KEY
 * — test-only, never expose this to the browser or commit it) with a
 * pre-verified email and a throwaway password, then signs the given page in
 * as that user through Clerk's own Playwright testing helper. This replaces
 * the old Supabase admin.generateLink approach from before the Clerk
 * migration — Clerk owns auth now, so tests authenticate through Clerk.
 */
export async function signInAsNewUser(page: Page, emailPrefix: string): Promise<string> {
  const email = `${emailPrefix}+${Date.now()}@example.com`;
  const password = `Test-${Date.now()}-!aA1`;

  const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY! });
  await clerkClient.users.createUser({
    emailAddress: [email],
    password,
    skipPasswordChecks: true,
  });

  await page.goto("/login");
  await clerk.signIn({
    page,
    signInParams: { strategy: "password", identifier: email, password },
  });
  await page.goto("/trips");
  await page.waitForURL("**/trips");
  return email;
}
