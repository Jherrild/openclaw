/**
 * auth.mjs — Token validation and environment checks.
 */

export function requireToken() {
  const token = process.env.MONARCH_TOKEN;
  if (!token) {
    console.error("ERROR: MONARCH_TOKEN not set. Run login.mjs first.");
    process.exit(1);
  }
  return token;
}
