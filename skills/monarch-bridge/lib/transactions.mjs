/**
 * transactions.mjs — Transaction listing with filters.
 */

import { getTransactions } from "monarch-money-api";
import { fmtMoney, fmtDate, sanitize } from "./format.mjs";

/**
 * List transactions with optional filters.
 * @param {object} opts
 * @param {number}  [opts.limit=25]    Max results
 * @param {number}  [opts.offset=0]    Pagination offset
 * @param {string}  [opts.search]      Free-text search
 * @param {string}  [opts.startDate]   YYYY-MM-DD
 * @param {string}  [opts.endDate]     YYYY-MM-DD
 * @param {string}  [opts.accountId]   Filter by account ID
 * @param {string}  [opts.categoryId]  Filter by category ID
 */
export async function listTransactions(opts = {}) {
  const limit = opts.limit ?? 25;
  const filters = {
    limit,
    offset: opts.offset ?? 0,
  };
  if (opts.search) filters.search = opts.search;
  if (opts.startDate) filters.startDate = opts.startDate;
  if (opts.endDate) filters.endDate = opts.endDate;
  if (opts.accountId) filters.accountIds = [opts.accountId];
  if (opts.categoryId) filters.categoryIds = [opts.categoryId];

  const resp = await getTransactions(filters);
  const txns = Array.isArray(resp)
    ? resp
    : resp?.transactions ?? resp?.data?.allTransactions?.results ?? [];

  if (txns.length === 0) {
    console.log("No transactions found.");
    return;
  }

  for (const t of txns) {
    const date = fmtDate(t.date);
    const merchant = sanitize(t.merchant?.name ?? t.merchantName ?? "?");
    const amount = fmtMoney(t.amount);
    const cat = t.category?.name ?? "";
    const acct = t.account?.displayName ?? t.account?.name ?? "";
    console.log(`${date} | ${merchant} | ${amount} | ${cat} | ${acct}`);
  }
  console.log(`\nShowing ${txns.length} transaction(s)`);
}
