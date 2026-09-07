import { stateMutationSchema } from "../validation.js";
import { productionServices } from "../production.js";
import { bearer, json, parseBody, pathWallet, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("state_mutation", async (event) => {
  const wallet = pathWallet(event);
  const input = parseBody(event, stateMutationSchema);
  const services = productionServices();
  await services.auth.authenticate(wallet, bearer(event));
  return json(200, { state: await services.scroll.mutate(wallet, input.mutationId, input.expectedVersion, input.mutation) });
});
