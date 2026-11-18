/**
 * Reusable Date & Timestamp Formatting Utility for CampusConnect 360 (Mobile)
 *
 * Prevents React Native runtime error:
 * "Objects are not valid as a React child (found: object with keys {seconds, nanoseconds})"
 *
 * Safely handles:
 * - Firestore Timestamp objects ({ seconds: number, nanoseconds: number })
 * - Firestore Timestamp instances with .toDate() or .toMillis()
 * - Native JavaScript Date objects
 * - ISO date/time strings ("2026-11-17", "2026-11-17T12:00:00Z")
 * - Numeric timestamps (milliseconds or seconds)
 * - null, undefined, empty strings, and unexpected objects
 */

/**
 * Format any timestamp or date into a readable date string (e.g., "Nov 17, 2026").
 * Guaranteed to NEVER return an object as a React child.
 */
export function formatDate(
  val: any,
  fallback = "Not set",
  options?: Intl.DateTimeFormatOptions
): string {
  if (val === null || val === undefined || val === "") {
    return fallback;
  }

  try {
    let dateObj: Date | null = null;

    // 1. JavaScript Date instance
    if (val instanceof Date) {
      dateObj = val;
    }
    // 2. Firestore Timestamp instance with .toDate()
    else if (typeof val?.toDate === "function") {
      dateObj = val.toDate();
    }
    // 3. Firestore Timestamp POJO ({ seconds, nanoseconds })
    else if (typeof val === "object" && typeof val.seconds === "number") {
      const ms = val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
      dateObj = new Date(ms);
    }
    // 4. Epoch timestamp (ms or seconds)
    else if (typeof val === "number") {
      dateObj = new Date(val < 1e11 ? val * 1000 : val);
    }
    // 5. String
    else if (typeof val === "string") {
      const trimmed = val.trim();
      if (!trimmed) return fallback;

      // Clean YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed;
      }

      const parsed = Date.parse(trimmed);
      if (!isNaN(parsed)) {
        dateObj = new Date(parsed);
      } else {
        return trimmed;
      }
    }

    if (dateObj && !isNaN(dateObj.getTime())) {
      const defaultOptions: Intl.DateTimeFormatOptions = options || {
        year: "numeric",
        month: "short",
        day: "numeric",
      };
      return dateObj.toLocaleDateString(undefined, defaultOptions);
    }

    // Safety fallback: if val is an unrecognized object, do NOT return it as an object
    if (typeof val === "object") {
      return fallback;
    }

    return String(val);
  } catch {
    return fallback;
  }
}

/**
 * Format any timestamp or date into a readable date and time string (e.g., "Nov 17, 2026, 02:30 PM").
 */
export function formatDateTime(
  val: any,
  fallback = "Not set"
): string {
  return formatDate(val, fallback, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Convert any timestamp/date/string into epoch milliseconds for sorting and comparisons.
 * Eliminates crashes when sorting objects (e.g. `b.date.localeCompare(a.date)` when `date` is a Timestamp).
 */
export function getTimestampMs(val: any): number {
  if (!val) return 0;
  try {
    if (typeof val?.toMillis === "function") return val.toMillis();
    if (typeof val?.toDate === "function") return val.toDate().getTime();
    if (typeof val === "object" && typeof val.seconds === "number") {
      return val.seconds * 1000 + Math.floor((val.nanoseconds || 0) / 1000000);
    }
    if (val instanceof Date) return val.getTime();
    if (typeof val === "number") return val < 1e11 ? val * 1000 : val;
    if (typeof val === "string") {
      const parsed = Date.parse(val);
      return isNaN(parsed) ? 0 : parsed;
    }
  } catch {
    return 0;
  }
  return 0;
}
