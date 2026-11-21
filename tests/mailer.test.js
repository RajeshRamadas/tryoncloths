import assert from "node:assert/strict";
import test from "node:test";
import { checkSmtp } from "../server/mailer.js";

test("SMTP readiness checks the configured transport without sending mail", async () => {
  const smtpUrl = "smtps://test-user:test-password@smtp.example.test";
  let verifies = 0;
  const result = await checkSmtp({
    smtpUrl,
    from: "store@example.test",
    createTransport: (url) => {
      assert.equal(url, smtpUrl);
      return {
        async verify() {
          verifies++;
          return true;
        },
        sendMail() {
          assert.fail("The readiness check must never send mail");
        },
      };
    },
  });

  assert.equal(result, "verified");
  assert.equal(verifies, 1);
});

test("SMTP readiness reports missing sender config before opening a connection", async () => {
  let connections = 0;
  assert.equal(
    await checkSmtp({
      smtpUrl: "smtp://smtp.example.test",
      from: "",
      createTransport: () => connections++,
    }),
    "missing_configuration",
  );
  assert.equal(connections, 0);
});

test("SMTP readiness does not expose transport diagnostics or credentials", async () => {
  assert.equal(
    await checkSmtp({
      smtpUrl: "smtp://smtp.example.test",
      from: "store@example.test",
      createTransport: () => ({
        async verify() {
          throw new Error("test-password");
        },
      }),
    }),
    "failed",
  );
});
