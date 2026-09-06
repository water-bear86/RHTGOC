import { productionServices } from "../production.js";

export async function handler(): Promise<{ enqueued: number }> {
  return { enqueued: await productionServices().sweep.run() };
}
