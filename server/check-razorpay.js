import { checkRazorpayReadiness } from "./payments.js";

const [, , mode, ...extra] = process.argv;
if (extra.length || !["test", "live"].includes(mode)) {
  console.error("Usage: npm run check:razorpay -- test|live");
  process.exitCode = 2;
} else {
  try {
    const report = await checkRazorpayReadiness(mode);
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.ready ? 0 : 1;
  } catch {
    console.error("Razorpay readiness check could not complete.");
    process.exitCode = 1;
  }
}
