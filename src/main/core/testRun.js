import crypto from "node:crypto";

const TEST_KEY_HASH = "2037897f4b4c8befa9ffcc2721a05bc406e9024378214560eb1b8e3874b58f81";
const isTestRun = () =>
  !!process.env.CZ_TEST_KEY && crypto.createHash("sha256").update(process.env.CZ_TEST_KEY).digest("hex") === TEST_KEY_HASH;
