// URL of the Cloudflare Worker (see worker/README.md). Leave empty to run without it:
// availability reports are then saved on this device only, and Google Sheets
// links fall back to Google's single-tab CSV export.
export const WORKER_URL = '';

// Plan loaded automatically when nobody has loaded their own yet. Set to '' to start on the upload screen.
export const DEFAULT_PLAN = 'data/my-plan.csv';
export const DEFAULT_PLAN_LABEL = "Adam's 4-year plan";
