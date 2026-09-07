import { flushSchema } from "../validation.js";
import { productionServices } from "../production.js";
import { bearer, json, parseBody, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("checkpoint_flush", async (event, context) => {
  const input = parseBody(event, flushSchema);
  const services = productionServices();
  await services.auth.authenticate(input.wallet, bearer(event));
  return json(202, await services.scroll.flush(input.wallet, String(context.awsRequestId)));
});
