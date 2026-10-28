// Operator-only recovery. Read the new password from stdin, never argv/logs.
import { AccountStore } from "./accounts.js";
if (!process.env.TRYON_DATA_DIR || process.argv[2] !== "reset-password" || !process.argv[3]) {
  console.error("Usage: node server/account-admin.js reset-password account-email (new password on stdin; TRYON_DATA_DIR required)");
  process.exitCode = 1;
} else {
  const store = new AccountStore(process.env.TRYON_DATA_DIR);
  try {
    let password="";
    for await (const chunk of process.stdin) { password += chunk; if (password.length>1024) throw new Error("Password input is too long."); }
    await store.resetPassword(process.argv[3], password.replace(/[\r\n]+$/, ""));
    console.log("Password changed. All sessions for this account were revoked.");
  } catch (e) { console.error(e.status ? e.message : "Password reset failed. Check the account email, password length and database access."); process.exitCode=1; }
  finally { store.close(); }
}
