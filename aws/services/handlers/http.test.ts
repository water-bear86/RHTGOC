import { afterEach, describe, expect, it } from "vitest";
import type { APIGatewayProxyEventV2, Context } from "aws-lambda";
import { json, withHttpErrors } from "./http.js";

const event = (origin: string): APIGatewayProxyEventV2 =>
  ({ headers: { origin }, requestContext: {}, version: "2.0", routeKey: "GET /", rawPath: "/", rawQueryString: "", isBase64Encoded: false } as unknown as APIGatewayProxyEventV2);
const context = { awsRequestId: "request" } as Context;

describe("HTTP CORS boundary", () => {
  afterEach(() => delete process.env.TRUSTED_GAME_ORIGINS);

  it("echoes only an explicitly trusted origin with credentials", async () => {
    process.env.TRUSTED_GAME_ORIGINS = JSON.stringify(["https://game.example"]);
    const handler = withHttpErrors("test", async () => json(200, { ok: true }));
    const trusted = await handler(event("https://game.example"), context);
    const untrusted = await handler(event("https://evil.example"), context);
    expect(typeof trusted === "object" && trusted.headers).toMatchObject({
      "access-control-allow-origin": "https://game.example",
      "access-control-allow-credentials": "true",
    });
    expect(typeof untrusted === "object" && untrusted.headers).not.toHaveProperty("access-control-allow-origin");
  });
});
