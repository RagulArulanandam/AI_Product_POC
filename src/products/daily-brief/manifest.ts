import { z } from "zod";
import type { ProductManifest } from "../types";

// "Coming soon" stub (spec.md section 2): shown as a card, not built in the POC.
const configSchema = z.object({});

export const dailyBriefManifest: ProductManifest = {
  key: "daily-brief",
  name: "Daily Brief",
  description: "A short daily summary of what needs your attention.",
  status: "coming_soon",
  configSchema,
  defaultConfig: configSchema.parse({}),
  handledEvents: [],
  handlers: {},
};
