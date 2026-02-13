#!/usr/bin/env node
/**
 * monarch-bridge.mjs — Read-only CLI for Monarch Money.
 *
 * Commands:
 *   accounts              List all accounts with balances
 *   net-worth             Show net worth summary
 *   transactions [opts]   List transactions with optional filters
 *
 * Transaction filters:
 *   --limit N             Max results (default 25)
 *   --offset N            Pagination offset
 *   --search TEXT         Free-text search
 *   --start-date DATE     Start date (YYYY-MM-DD)
 *   --end-date DATE       End date (YYYY-MM-DD)
 *   --account-id ID       Filter by account ID
 *   --category-id ID      Filter by category ID
 *
 * Requires MONARCH_TOKEN env var.
 */

import { requireToken } from "./lib/auth.mjs";
import { listAccounts, netWorth } from "./lib/accounts.mjs";
import { listTransactions } from "./lib/transactions.mjs";

requireToken();

const args = process.argv.slice(2);
const command = args[0];

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--") && i + 1 < argv.length) {
      const key = arg
        .slice(2)
        .replace(/-([a-z])/g, (_, c) => c.toUpperCase()); // kebab → camelCase
      flags[key] = argv[++i];
    }
  }
  return flags;
}

try {
  switch (command) {
    case "accounts":
      await listAccounts();
      break;

    case "net-worth":
      await netWorth();
      break;

    case "transactions": {
      const flags = parseFlags(args.slice(1));
      if (flags.limit) flags.limit = Number(flags.limit);
      if (flags.offset) flags.offset = Number(flags.offset);
      await listTransactions(flags);
      break;
    }

    default:
      console.error(
        `Usage: monarch-bridge <command>\n\nCommands:\n  accounts       List all accounts\n  net-worth      Show net worth summary\n  transactions   List transactions (--search, --limit, --start-date, --end-date, --account-id, --category-id)`
      );
      process.exit(command ? 1 : 0);
  }
} catch (err) {
  const status = err?.response?.status;
  if (status === 401 || status === 403) {
    console.error("ERROR: Token expired or invalid. Re-run login.mjs.");
  } else {
    console.error(`ERROR: ${err.message ?? err}`);
  }
  process.exit(1);
}
