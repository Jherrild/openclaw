/**
 * format.mjs — Output formatting helpers.
 */

/** Format a number as currency. */
export function fmtMoney(value) {
  if (value == null || value === "") return "?";
  const num = Number(value);
  if (Number.isNaN(num)) return String(value);
  return num.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  });
}

/** Strip non-ASCII / control chars from merchant names / notes. */
export function sanitize(text) {
  if (!text) return "";
  return text.replace(/[^\x20-\x7E]/g, "").trim();
}

/** Format an ISO date string as YYYY-MM-DD. */
export function fmtDate(iso) {
  if (!iso) return "?";
  return iso.slice(0, 10);
}
