import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { z } from "zod";
import { productionServices } from "../production.js";

const messageSchema = z.object({ wallet: z.string(), version: z.number().int().positive() }).strict();

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      await productionServices().relayer.process(messageSchema.parse(JSON.parse(record.body)));
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
