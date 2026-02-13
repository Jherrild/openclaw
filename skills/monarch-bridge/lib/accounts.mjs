/**
 * accounts.mjs — Account list and net-worth commands.
 */

import { getAccounts } from "monarch-money-api";
import { fmtMoney } from "./format.mjs";

/** Normalize the accounts response into an array. */
function extractAccounts(resp) {
  if (Array.isArray(resp)) return resp;
  return resp?.accounts ?? resp?.data?.accounts ?? [];
}

/** List all accounts with balances. */
export async function listAccounts() {
  const resp = await getAccounts();
  const accounts = extractAccounts(resp);

  if (accounts.length === 0) {
    console.log("No accounts found.");
    return;
  }

  for (const a of accounts) {
    const name = a.displayName ?? a.name ?? "?";
    const bal = fmtMoney(a.currentBalance ?? a.balance);
    const type = a.type?.name ?? "?";
    const subtype = a.subtype?.name ?? "";
    const inst = a.institution?.name ?? "";
    const nw = a.includeInNetWorth === false ? " [excluded]" : "";
    console.log(`${name} | ${bal} | ${type}${subtype ? "/" + subtype : ""} | ${inst}${nw}`);
  }
  console.log(`\nTotal: ${accounts.length} account(s)`);
}

/** Show net worth summary. */
export async function netWorth() {
  const resp = await getAccounts();
  const accounts = extractAccounts(resp);
  const included = accounts.filter((a) => a.includeInNetWorth !== false);

  let assets = 0;
  let liabilities = 0;

  for (const a of included) {
    const bal = Number(a.currentBalance ?? a.balance ?? 0);
    const typeName = (a.type?.name ?? "").toLowerCase();
    if (typeName === "credit" || typeName === "loan" || typeName === "liability") {
      liabilities += bal;
    } else {
      assets += bal;
    }
  }

  const nw = assets + liabilities; // liabilities are typically negative
  console.log(`Net Worth: ${fmtMoney(nw)} | Assets: ${fmtMoney(assets)} | Liabilities: ${fmtMoney(liabilities)}`);
}
