import { sessionSchema } from "../validation.js";
import { productionServices } from "../production.js";
import { json, parseBody, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("auth_session", async (event) => {
  const input = parseBody(event, sessionSchema);
  return json(200, await productionServices().auth.createSession(input.wallet, input.challengeId, input.signature));
});
