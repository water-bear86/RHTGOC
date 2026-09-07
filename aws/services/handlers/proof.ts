import { z } from "zod";
import { productionServices } from "../production.js";
import { json, pathWallet, withHttpErrors } from "./http.js";

const proofCategory = z.enum(["state", "achievement", "finery", "equipment", "unlock"]);

export const handler = withHttpErrors("proof_get", async (event) => {
  const category = proofCategory.parse(event.queryStringParameters?.category ?? "state");
  const key = event.queryStringParameters?.key;
  return json(200, await productionServices().scroll.getProof(pathWallet(event), category, key));
});
