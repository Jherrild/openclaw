#!/usr/bin/env node
/**
 * login.mjs — Interactive login to Monarch Money.
 *
 * Prompts for email, password, and optional MFA code,
 * then prints the session token for storage in 1Password.
 *
 * Usage:
 *   node login.mjs
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout, env } from "node:process";

// monarch-money-api expects MONARCH_TOKEN at import time;
// clear it so we get a fresh login flow.
delete env.MONARCH_TOKEN;

const { loginUser, multiFactorAuthenticate } = await import("monarch-money-api");

const rl = createInterface({ input: stdin, output: stdout });

try {
  const email = await rl.question("Monarch email: ");
  const password = await rl.question("Monarch password: ");

  let token;
  try {
    token = await loginUser(email, password);
  } catch (err) {
    // If MFA is required the library throws; prompt for TOTP code.
    if (
      err?.message?.toLowerCase().includes("mfa") ||
      err?.message?.toLowerCase().includes("multi") ||
      err?.response?.status === 403
    ) {
      const mfaCode = await rl.question("MFA code: ");
      token = await multiFactorAuthenticate(email, password, mfaCode);
    } else {
      throw err;
    }
  }

  if (token) {
    console.log("\n── Token (store in 1Password) ──");
    console.log(token);
  } else {
    console.error("ERROR: Login succeeded but no token was returned.");
    process.exit(1);
  }
} catch (err) {
  console.error(`ERROR: ${err.message ?? err}`);
  process.exit(1);
} finally {
  rl.close();
}
