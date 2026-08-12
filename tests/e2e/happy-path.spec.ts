import { test, expect } from "@playwright/test";
import { signInAsNewUser } from "./helpers/auth";

/**
 * End-to-end happy path from BUILD_PROMPT.md section 8:
 * create trip -> add ghost members -> add a S$119.90 dinner with GST and
 * service charge split equally among 3 -> check balances -> record the
 * suggested settlements -> confirm every balance is zero.
 */
test("full trip lifecycle settles to zero", async ({ page }) => {
  await signInAsNewUser(page, "e2e-happy-path");

  // --- create trip -------------------------------------------------------
  await page.getByRole("button", { name: "New or join trip" }).click();
  await page.getByRole("button", { name: "Create a new trip" }).click();
  await page.getByLabel("Trip name").fill("Osaka Test Trip");
  await page.getByLabel("Home currency").selectOption("SGD");
  await page.getByRole("button", { name: "Create trip" }).click();
  await page.waitForURL(/\/trips\/[^/]+$/);
  const tripUrl = page.url();

  // --- add two ghost members so the dinner splits three ways ------------
  await page.goto(`${tripUrl}/settings`);
  for (const name of ["Bea", "Cy"]) {
    await page.getByPlaceholder("Add someone by name").fill(name);
    await page.getByRole("button", { name: "Add" }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }

  // --- add the dinner: S$100 subtotal, trip defaults 10% svc / 9% GST ---
  await page.goto(`${tripUrl}/expense/new`);
  await page.getByPlaceholder("0.00").first().fill("100");
  await page.getByPlaceholder("What was it for?").fill("Dinner");
  // trip defaults already apply 10% service charge / 9% GST, equal split, paid by me
  await expect(page.getByText(/\+10% svc, \+9% GST/)).toBeVisible();
  await page.getByRole("button", { name: "Add expense" }).click();
  await page.waitForURL(/\/expense\/[^/]+$/);
  await expect(page.getByText("$119.90", { exact: false })).toBeVisible();

  // --- balances: I'm owed, the other two owe me --------------------------
  await page.goto(`${tripUrl}/balances`);
  await expect(page.getByText(/is owed/)).toBeVisible();
  const recordButtons = page.getByRole("button", { name: "Record payment" });
  const count = await recordButtons.count();
  expect(count).toBeGreaterThan(0);

  // --- settle every suggested transfer -----------------------------------
  for (let i = 0; i < count; i++) {
    await page.getByRole("button", { name: "Record payment" }).first().click();
    await expect(page.getByRole("button", { name: "Recorded" }).first()).toBeVisible();
  }

  await page.reload();
  await expect(page.getByText("settled up").first()).toBeVisible();
  await expect(page.getByText(/^owes/)).toHaveCount(0);
  await expect(page.getByText(/^is owed/)).toHaveCount(0);
});
