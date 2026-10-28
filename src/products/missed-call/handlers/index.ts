import type { ProductHandlers } from "@/engine/types";
import { callMissed } from "./call-missed";
import { expireConversation } from "./expire-conversation";
import { messageInbound } from "./message-inbound";
import { messageStatus } from "./message-status";
import { sendEscalationEmail } from "./send-escalation-email";
import { sendFirstMessage } from "./send-first-message";

/** Handlers keyed by event type or action type. */
export const missedCallHandlers: ProductHandlers = {
  "call.missed": callMissed,
  "message.inbound": messageInbound,
  "message.status": messageStatus,
  send_first_message: sendFirstMessage,
  send_escalation_email: sendEscalationEmail,
  expire_conversation: expireConversation,
};
