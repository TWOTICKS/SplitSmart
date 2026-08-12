import { test, expect } from "@playwright/test";
import { signInAsNewUser } from "./helpers/auth";

/**
 * Offline queue behaviour from BUILD_PROMPT.md section 8/4: queue writes
 * while offline, they render immediately with a "not synced" indicator,
 * and reconnecting flushes the queue exactly once per item — replaying the
 * outbox twice must not create duplicate rows (client-generated ids make
 * the server-side write an upsert, so a retried flush is a no-op).
 *
 * Note: Next.js App Router client navigation fetches the destination
 * route's RSC payload from the server, which can itself fail while
 * network-offline. This test stays offline only for the writes and their
 * immediate optimistic render, then restores the network before navigating
 * anywhere — that ordering has to hold for the assertions below to be
 * meaningful, not just for the queueing itself.
 */
test("expenses queued offline sync exactly once on reconnect", async ({ page, context }) => {
  await signInAsNewUser(page, "e2e-offline-sync");

  await page.getByRole("button", { name: "New or join trip" }).click();
  await page.getByRole("button", { name: "Create a new trip" }).click();
  await page.getByLabel("Trip name").fill("Offline Test Trip");
  await page.getByLabel("Home currency").selectOption("SGD");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[^/]+$/);
  const tripUrl = page.url();

  await page.goto(`${tripUrl}/expense/new`);

  await context.setOffline(true);

  for (const description of ["Offline coffee", "Offline taxi"]) {
    await page.getByPlaceholder("0.00").first().fill("10");
    await page.getByPlaceholder("What was it for?").fill(description);
    await page.getByRole("button", { name: "Add expense" }).click();
    // queued writes render immediately without waiting on the network
    await page.waitForURL(new RegExp(`${tripUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await page.goto(`${tripUrl}/expense/new`);
  }

  await page.goto(tripUrl);
  await expect(page.getByText("Offline coffee")).toBeVisible();
  await expect(page.getByText("Offline taxi")).toBeVisible();
  await expect(page.getByText("waiting to sync").first()).toBeVisible();

  await context.setOffline(false);

  // the outbox flushes automatically on the 'online' event (lib/offline/sync.ts)
  await expect(page.getByText("waiting to sync")).toHaveCount(0, { timeout: 15_000 });

  await page.reload();
  const coffeeRows = page.getByText("Offline coffee");
  const taxiRows = page.getByText("Offline taxi");
  await expect(coffeeRows).toHaveCount(1);
  await expect(taxiRows).toHaveCount(1);
});
