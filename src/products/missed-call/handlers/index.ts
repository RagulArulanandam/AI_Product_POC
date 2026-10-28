import type { ProductHandlers } from "@/engine/types";
import { callMissed } from "./call-missed";
import { expireConversation } from "./expire-conversation";
import { messageStatus } from "./message-status";
import { sendFirstMessage } from "./send-first-message";

/** Handlers keyed by event type or action type. `message.inbound` arrives in Phase 4. */
export const missedCallHandlers: ProductHandlers = {
  "call.missed": callMissed,
  send_first_message: sendFirstMessage,
  "message.status": messageStatus,
  expire_conversation: expireConversation,
};
