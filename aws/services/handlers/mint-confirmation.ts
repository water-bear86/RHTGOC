import { mintConfirmationSchema } from "../validation.js";
import { productionServices } from "../production.js";
import { bearer, json, parseBody, pathWallet, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("mint_confirmation", async (event) => {
  const wallet = pathWallet(event);
  const input = parseBody(event, mintConfirmationSchema);
  const services = productionServices();
  await services.auth.authenticate(wallet, bearer(event));
  return json(200, await services.scroll.confirmMint(wallet, input.intentId, input.transactionHash));
});
