import type { ProductManifest } from "../types";
import { missedCallConfigSchema } from "./config";

export const missedCallManifest: ProductManifest = {
  key: "missed-call",
  name: "Missed Call to WhatsApp Assistant",
  description: "Texts customers on WhatsApp after a missed call, answers questions and books appointments.",
  status: "available",
  configSchema: missedCallConfigSchema,
  defaultConfig: missedCallConfigSchema.parse({}),
  handledEvents: ["call.missed", "message.inbound", "message.status"],
};
