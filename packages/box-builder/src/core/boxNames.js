// Box builder: what a box may be called, and the errors keeping one can raise.

export const BOX_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/u;

export function isValidBoxName(name) {
  return BOX_NAME_PATTERN.test(String(name || ""));
}

const KNOWN_ERROR_CODES = new Set([
  "quota_new",
  "quota_builds",
  "busy",
  "busy_account",
  "quota_global",
  "quota_disk",
  "quota_unavailable",
  "disk_full",
  "too_large",
  "unauthorized",
  "internal"
]);

// One sentence a person can act on, for any error an adapter raises.
// `t` is the box builder's translator (useBoxLanguage).
export function describeBoxError(error, t) {
  if (!error) {
    return "";
  }
  if (error.code === "bad_plan") {
    return t("error.bad_plan", { message: error.message });
  }
  if (KNOWN_ERROR_CODES.has(error.code)) {
    return t(`error.${error.code}`);
  }
  if (error.status === 401 || error.status === 403) {
    return t("error.unauthorized");
  }
  if (error.status === 429) {
    return t("error.too_many_requests");
  }
  return error.message || String(error);
}
