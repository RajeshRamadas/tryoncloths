export async function openStoreTools(page) {
  if (!(await page.getByRole("dialog", { name: "Store tools", exact: true }).isVisible())) {
    await page.getByRole("button", { name: "Store tools", exact: true }).click();
  }
}

export async function useProductSource(page) {
  await page.getByRole("button", { name: "Your products", exact: true }).click();
}

export async function useSampleSource(page) {
  await page.getByRole("button", { name: "Sample clothes", exact: true }).click();
}
