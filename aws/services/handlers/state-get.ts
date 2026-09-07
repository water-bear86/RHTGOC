import { productionServices } from "../production.js";
import { bearer, json, pathWallet, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("state_get", async (event) => {
  const wallet = pathWallet(event);
  const services = productionServices();
  await services.auth.authenticate(wallet, bearer(event));
  return json(200, await services.scroll.getState(wallet));
});
