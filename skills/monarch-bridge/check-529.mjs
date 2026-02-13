#!/usr/bin/env node
/**
 * check-529.mjs — Prototype script to verify Monarch API connectivity
 * and 529 account data access.
 *
 * Requires MONARCH_TOKEN in env.
 *
 * Usage:
 *   MONARCH_TOKEN=<token> node check-529.mjs
 */

if (!process.env.MONARCH_TOKEN) {
  console.error("ERROR: MONARCH_TOKEN not set. Run login.mjs first.");
  process.exit(1);
}

const { getAccounts, getAccountHoldings } = await import("monarch-money-api");

try {
  console.log("Fetching accounts…");
  const accountsResponse = await getAccounts();

  // The response shape may vary; handle both array and nested object forms.
  const accounts = Array.isArray(accountsResponse)
    ? accountsResponse
    : accountsResponse?.accounts ?? accountsResponse?.data?.accounts ?? [];

  console.log(`Total accounts returned: ${accounts.length}\n`);

  // Filter for 529-related accounts.
  const is529 = (acct) => {
    const subtypeName = (acct.subtype?.name ?? "").toLowerCase();
    const subtypeDisplay = (acct.subtype?.display ?? "").toLowerCase();
    const displayName = (acct.displayName ?? "").toLowerCase();
    return (
      subtypeName.includes("529") ||
      subtypeName.includes("education") ||
      subtypeDisplay.includes("529") ||
      subtypeDisplay.includes("education") ||
      displayName.includes("529")
    );
  };

  const matched = accounts.filter(is529);

  if (matched.length === 0) {
    console.log("No 529 accounts found.");
    console.log("\n── All account subtypes (for debugging) ──");
    for (const a of accounts) {
      console.log(
        `  ${a.displayName ?? a.name ?? "?"} | type=${a.type?.name ?? "?"} | subtype=${a.subtype?.name ?? "?"}`
      );
    }
    process.exit(0);
  }

  console.log(`── Found ${matched.length} 529 account(s) ──\n`);

  for (const acct of matched) {
    const balance = acct.currentBalance ?? acct.balance ?? "?";
    console.log(
      `[${acct.id}] ${acct.displayName ?? acct.name} — $${balance} (${acct.holdingsCount ?? "?"} holdings)`
    );
    console.log(
      `  type=${acct.type?.name ?? "?"} subtype=${acct.subtype?.name ?? "?"} institution=${acct.institution?.name ?? "?"}`
    );

    // Fetch holdings for this 529 account.
    try {
      console.log(`  Fetching holdings…`);
      const holdingsResponse = await getAccountHoldings(acct.id);
      const holdings = Array.isArray(holdingsResponse)
        ? holdingsResponse
        : holdingsResponse?.holdings ?? holdingsResponse?.data?.holdings ?? [];

      if (holdings.length === 0) {
        console.log("  (no holdings returned)");
      } else {
        for (const h of holdings) {
          const name = h.security?.name ?? h.name ?? "?";
          const ticker = h.security?.ticker ?? h.ticker ?? "";
          const value = h.totalValue ?? h.value ?? "?";
          const qty = h.quantity ?? "?";
          const basis = h.basis ?? "?";
          console.log(
            `    ${name}${ticker ? ` (${ticker})` : ""}: $${value} | ${qty} shares | basis $${basis}`
          );
        }
      }
    } catch (holdErr) {
      console.error(`  ERROR fetching holdings: ${holdErr.message ?? holdErr}`);
    }

    console.log();
  }
} catch (err) {
  console.error(`ERROR: ${err.message ?? err}`);
  if (err.response) {
    console.error(`  Status: ${err.response.status}`);
    console.error(`  Data: ${JSON.stringify(err.response.data)}`);
  }
  process.exit(1);
}
