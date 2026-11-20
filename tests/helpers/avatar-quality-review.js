import { expect } from "@playwright/test";

/**
 * Simulate an explicit human quality review for synthetic browser-test avatars.
 * The production UI still requires every score and both confirmations.
 */
export async function approvePersonalizedAvatar(page) {
  const review = page.getByRole("group", { name: "Personalized avatar quality review" });
  await expect(review).toBeVisible();
  const criteria = review.locator("select");
  await expect(criteria).toHaveCount(6);
  for (const select of await criteria.all()) {
    await select.selectOption("4");
  }
  await review
    .getByLabel("The customer authorizes review and reuse of this personalized avatar.")
    .check();
  await review
    .getByLabel("I compared the result against the customer or reference photographs.")
    .check();
  await review.getByRole("button", { name: "Confirm quality review" }).click();
  const approval = page.getByLabel(
    "The customer approves the face, body and skin tone of this avatar.",
  );
  if (!(await approval.isChecked())) await approval.click();
  await expect(approval).toBeChecked();
}
