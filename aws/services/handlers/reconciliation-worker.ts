import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import { z } from "zod";
import { productionServices } from "../production.js";

const messageSchema = z.object({ transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict();

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of event.Records) {
    try {
      const { transactionHash } = messageSchema.parse(JSON.parse(record.body));
      await productionServices().reconciler.process(transactionHash.toLowerCase() as `0x${string}`);
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
