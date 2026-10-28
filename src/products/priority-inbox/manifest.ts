import { z } from "zod";
import type { ProductManifest } from "../types";

// "Coming soon" stub (spec.md section 2): shown as a card, not built in the POC.
const configSchema = z.object({});

export const priorityInboxManifest: ProductManifest = {
  key: "priority-inbox",
  name: "Priority Inbox",
  description: "Sorts incoming email by importance and drafts replies.",
  status: "coming_soon",
  configSchema,
  defaultConfig: configSchema.parse({}),
  handledEvents: [],
};
