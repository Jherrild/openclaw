#!/usr/bin/env node
/**
 * login.mjs — Semi-Autonomous login to Monarch Money.
 *
 * Tries to log in using environment variables (MONARCH_EMAIL, MONARCH_PASSWORD).
 * If MFA is required, it checks MONARCH_MFA_SECRET to generate a code.
 * If interactive, falls back to prompting.
 */

import { createInterface } from "node:readline/promises";
import { stdin, stdout, env } from "node:process";

// monarch-money-api expects MONARCH_TOKEN at import time;
// clear it so we get a fresh login flow.
delete env.MONARCH_TOKEN;

const { loginUser, multiFactorAuthenticate } = await import("monarch-money-api");
const { authenticator } = await import("otplib");

const rl = createInterface({ input: stdin, output: stdout });

async function getCred(envVar, prompt) {
  if (env[envVar]) return env[envVar];
  return await rl.question(prompt);
}

try {
  const email = await getCred("MONARCH_EMAIL", "Monarch email: ");
  const password = await getCred("MONARCH_PASSWORD", "Monarch password: ");

  let token;
  try {
    console.log(`Attempting login for ${email}...`);
    token = await loginUser(email, password);
  } catch (err) {
    // If MFA is required the library throws; prompt for TOTP code.
    if (
      err?.message?.toLowerCase().includes("mfa") ||
      err?.message?.toLowerCase().includes("multi") ||
      err?.response?.status === 403
    ) {
      console.log("MFA Required.");
      let mfaCode;
      
      if (env.MONARCH_MFA_SECRET) {
        console.log("Generating TOTP from secret...");
        mfaCode = authenticator.generate(env.MONARCH_MFA_SECRET);
      } else {
        mfaCode = await rl.question("MFA code: ");
      }
      
      token = await multiFactorAuthenticate(email, password, mfaCode);
    } else {
      throw err;
    }
  }

  if (token) {
    console.log("\n── Token ──");
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
