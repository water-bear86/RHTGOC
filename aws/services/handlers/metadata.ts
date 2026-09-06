import { badRequest } from "../errors.js";
import { productionServices } from "../production.js";
import { json, withHttpErrors } from "./http.js";

export const handler = withHttpErrors("scroll_metadata", async (event) => {
  const tokenId = event.pathParameters?.tokenId;
  if (!tokenId) throw badRequest("token_id_required", "tokenId path parameter is required");
  return json(200, await productionServices().scroll.metadata(tokenId), { "cache-control": "public, max-age=30" });
});
