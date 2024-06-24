import { fork } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { dirname, resolve as resolvePath } from "node:path";
import { attachment, step } from "allure-js-commons";
import type { AllureResults } from "allure-js-commons/sdk";
import { MessageReader } from "allure-js-commons/sdk/reporter";

export const runCodeceptJsInlineTest = async (
  files: Record<string, string | Buffer>,
  env?: Record<string, string>,
): Promise<AllureResults> => {
  const testFiles = {
    "codecept.conf.js": await readFile(resolvePath(__dirname, "./fixtures/codecept.conf.js"), "utf-8"),
    "helper.js": await readFile(resolvePath(__dirname, "./fixtures/helper.js"), "utf-8"),
    ...files,
  };
  const testDir = join(__dirname, "temp", randomUUID());

  await step(`create test dir ${testDir}`, async () => {
    await mkdir(testDir, { recursive: true });
  });

  for (const file of Object.keys(testFiles)) {
    await step(file, async () => {
      const filePath = join(testDir, file);

      await mkdir(dirname(filePath), { recursive: true });
      const content = testFiles[file as keyof typeof testFiles];
      await writeFile(filePath, content, "utf8");
      await attachment(file, content, { encoding: "utf-8", contentType: "text/plain", fileExtension: extname(file) });
    });
  }

  const modulePath = await step("resolve codeceptjs", () => {
    return require.resolve("codeceptjs/bin/codecept.js");
  });
  const args = ["run", "-c", testDir];
  const testProcess = await step(`${modulePath} ${args.join(" ")}`, () => {
    return fork(modulePath, args, {
      env: {
        ...process.env,
        ...env,
      },
      cwd: testDir,
      stdio: "pipe",
    });
  });

  testProcess.stdout?.setEncoding("utf8").on("data", (chunk) => {
    process.stdout.write(String(chunk));
  });
  testProcess.stderr?.setEncoding("utf8").on("data", (chunk) => {
    process.stderr.write(String(chunk));
  });
  const messageReader = new MessageReader();

  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  testProcess.on("message", messageReader.handleMessage);

  testProcess.on("close", async () => {
    await rm(testDir, { recursive: true });
  });

  return new Promise((resolve) => {
    testProcess.on("exit", () => {
      messageReader.attachResults();
      return resolve(messageReader.results);
    });
  });
};
