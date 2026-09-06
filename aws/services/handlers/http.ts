import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from "aws-lambda";
import { ZodError, type ZodType } from "zod";
import { ServiceError, badRequest } from "../errors.js";
import { audit, operationalError } from "../audit.js";

export type HttpHandler = (event: APIGatewayProxyEventV2, context: Context) => Promise<APIGatewayProxyResultV2>;

export const json = (statusCode: number, body: unknown, headers: Record<string, string> = {}): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  },
  body: JSON.stringify(body),
});

export function parseBody<T>(event: APIGatewayProxyEventV2, schema: ZodType<T>): T {
  if (!event.body) throw badRequest("body_required", "JSON request body is required");
  if (Buffer.byteLength(event.body, "utf8") > 512 * 1024) throw badRequest("body_too_large", "Request body exceeds 512 KiB");
  const contentType = event.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw badRequest("unsupported_content_type", "Content-Type must be application/json");
  try {
    return schema.parse(JSON.parse(event.body));
  } catch (error) {
    if (error instanceof SyntaxError) throw badRequest("invalid_json", "Request body is not valid JSON");
    throw error;
  }
}

export const pathWallet = (event: APIGatewayProxyEventV2): string => {
  const wallet = event.pathParameters?.wallet;
  if (!wallet) throw badRequest("wallet_required", "wallet path parameter is required");
  return wallet;
};

export const bearer = (event: APIGatewayProxyEventV2): string | undefined =>
  event.headers.authorization ?? event.headers.Authorization;

export function withHttpErrors(name: string, implementation: HttpHandler): HttpHandler {
  return async (event, context) => {
    try {
      return cors(event, await implementation(event, context));
    } catch (error) {
      if (error instanceof ZodError) {
        audit({ event: name, requestId: context.awsRequestId, outcome: "rejected", code: "validation_failed" });
        return cors(event, json(400, {
          code: "validation_failed",
          message: "Request validation failed",
          issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        }));
      }
      if (error instanceof ServiceError) {
        audit({ event: name, requestId: context.awsRequestId, outcome: "rejected", code: error.code });
        return cors(event, json(error.statusCode, { code: error.code, message: error.message, ...error.details }));
      }
      operationalError(name, error, { requestId: context.awsRequestId });
      return cors(event, json(500, { code: "internal_error", message: "Request could not be completed" }));
    }
  };
}

function cors(event: APIGatewayProxyEventV2, result: APIGatewayProxyResultV2): APIGatewayProxyResultV2 {
  if (typeof result === "string") return result;
  const origin = event.headers.origin;
  if (!origin) return result;
  let trusted: unknown;
  try {
    trusted = JSON.parse(process.env.TRUSTED_GAME_ORIGINS ?? "[]");
  } catch {
    trusted = [];
  }
  if (!Array.isArray(trusted) || !trusted.includes(origin)) return result;
  return {
    ...result,
    headers: {
      ...result.headers,
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      vary: "Origin",
    },
  };
}
