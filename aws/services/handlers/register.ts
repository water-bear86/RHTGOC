import { registerSchema } from "../validation.js";
import { productionServices } from "../production.js";
import { bearer, json, parseBody, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("player_register", async (event) => {
  const input = parseBody(event, registerSchema);
  const services = productionServices();
  await services.auth.authenticate(input.wallet, bearer(event));
  const result = await services.scroll.register(input.wallet);
  return json(result.created ? 201 : 200, result);
});
