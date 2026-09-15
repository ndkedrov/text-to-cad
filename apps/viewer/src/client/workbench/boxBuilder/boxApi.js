// Box builder: the viewer server's /__cad/boxes routes.

const POST_GUARD_HEADERS = Object.freeze({ "x-cadgen-viewer": "1" });

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

// One sentence a person can act on, for any error these routes produce.
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

async function readJson(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const error = new Error(payload?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload?.code || "";
    throw error;
  }
  return payload;
}

function boxUrl(route, name) {
  return `/__cad/boxes${route}?name=${encodeURIComponent(name)}`;
}

export function boxFileUrl(name, part, format) {
  return `${boxUrl("/file", name)}&part=${encodeURIComponent(part)}&format=${encodeURIComponent(format)}`;
}

export async function listBoxes() {
  return readJson(await fetch("/__cad/boxes", { cache: "no-store" }));
}

export async function loadBox(name) {
  return readJson(await fetch(boxUrl("/spec", name), { cache: "no-store" }));
}

export async function fetchBoxStatus(name) {
  return readJson(await fetch(boxUrl("/status", name), { cache: "no-store" }));
}

export async function saveBox(name, { spec, plan }) {
  return readJson(await fetch(boxUrl("/save", name), {
    method: "POST",
    headers: { ...POST_GUARD_HEADERS, "content-type": "application/json" },
    body: JSON.stringify({ spec, plan })
  }));
}
