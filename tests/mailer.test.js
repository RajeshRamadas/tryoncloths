import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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

const exec = promisify(execFile);
const cli = fileURLToPath(new URL("../server/check-smtp.js", import.meta.url));

function runSmtpCheck(args, config = {}) {
  return exec(process.execPath, [cli, ...args], {
    timeout: 5000,
    env: { ...process.env, SMTP_URL: "", SMTP_FROM: "", MAIL_FROM: "", ...config },
  });
}

test("SMTP CLI can submit one test message and keeps connection verification read-only", async (t) => {
  const sessions = [];
  let rejectMessage = false;
  const server = createServer((socket) => {
    const lines = [];
    sessions.push(lines);
    socket.write("220 localhost SMTP\r\n");
    let readingMessage = false;
    createInterface({ input: socket, crlfDelay: Infinity }).on("line", (line) => {
      lines.push(line);
      if (readingMessage) {
        if (line === ".") {
          readingMessage = false;
          socket.write(rejectMessage ? "554 Private relay diagnostic\r\n" : "250 Accepted\r\n");
        }
      } else if (line === "DATA") {
        readingMessage = true;
        socket.write("354 Send message\r\n");
      } else if (line === "QUIT") {
        socket.end("221 Bye\r\n");
      } else {
        socket.write("250 OK\r\n");
      }
    });
  });
  t.after(() => server.close());
  await once(server.listen(0, "127.0.0.1"), "listening");
  const config = {
    SMTP_URL: `smtp://127.0.0.1:${server.address().port}`,
    MAIL_FROM: "Forme <sender@example.test>",
  };

  const verification = await runSmtpCheck([], config);
  assert.match(verification.stdout, /No email was sent/);
  assert.ok(sessions[0].every((line) => !line.startsWith("MAIL FROM:") && line !== "DATA"));

  const args = ["--send-to", "operator+smtp@example.test"];
  const delivery = await runSmtpCheck(args, config);
  assert.match(delivery.stdout, /SMTP server accepted/);
  assert.deepEqual(
    sessions[1].filter((line) => /^(MAIL FROM:|RCPT TO:|DATA$)/.test(line)),
    ["MAIL FROM:<sender@example.test>", "RCPT TO:<operator+smtp@example.test>", "DATA"],
  );
  assert.ok(sessions[1].includes("Subject: Forme SMTP delivery test"));

  rejectMessage = true;
  await assert.rejects(runSmtpCheck(args, config), (error) => {
    assert.equal(error.code, 1);
    assert.equal(error.stdout, "");
    assert.match(error.stderr, /SMTP delivery check failed/);
    assert.doesNotMatch(error.stderr, /Private relay diagnostic/);
    return true;
  });
  assert.equal(sessions.length, 3);
});

test("SMTP CLI rejects ambiguous recipients and explains missing configuration", async () => {
  for (const args of [
    ["--send-to"],
    ["--send-to", "first@example.test,second@example.test"],
    ["--send-to", "first@example.test\r\nBcc: second@example.test"],
    ["--send-to", "first@example.test", "--send-to", "second@example.test"],
  ]) {
    await assert.rejects(runSmtpCheck(args), { code: 2, stderr: /Usage:/ });
  }
  await assert.rejects(runSmtpCheck(["--send-to", "operator@example.test"]), {
    code: 1,
    stderr: /Configure SMTP_URL and SMTP_FROM/,
  });
});
