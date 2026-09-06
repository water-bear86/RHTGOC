import { challengeSchema } from "../validation.js";
import { productionServices } from "../production.js";
import { json, parseBody, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("auth_challenge", async (event) => {
  const input = parseBody(event, challengeSchema);
  return json(200, await productionServices().auth.challenge(input.wallet, input.chainId));
});
