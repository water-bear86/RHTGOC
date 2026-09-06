import { productionServices } from "../production.js";
import { json, pathWallet, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("summary_get", async (event) =>
  json(200, await productionServices().scroll.getSummary(pathWallet(event)), { "cache-control": "public, max-age=15" }),
);
