import { productionServices } from "../production.js";
import { bearer, json, pathWallet, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("mint_intent", async (event) => {
  const wallet = pathWallet(event);
  const services = productionServices();
  await services.auth.authenticate(wallet, bearer(event));
  return json(200, await services.scroll.requestMint(wallet));
});
