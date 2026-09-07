import { productionServices } from "../production.js";
import { json, pathWallet, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("scroll_get", async (event) =>
  json(200, await productionServices().scroll.getScroll(pathWallet(event)), { "cache-control": "public, max-age=15" }),
);
