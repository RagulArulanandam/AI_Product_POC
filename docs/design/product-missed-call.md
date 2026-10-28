# Product 1: Missed Call -> WhatsApp Assistant

## Flow
Missed call -> voice webhook -> identify business and customer -> conditions -> scheduled WhatsApp template -> customer reply -> AI intent -> appointment / enquiry / escalation -> Google Calendar -> log.

## Events and webhooks
- `POST /api/webhooks/voice`: incoming-call webhook for the business's forwarding number. With conditional forwarding every call that arrives is already a missed call (see integrations.md). Verify signature. Resolve business from the dialled number. Reply quickly, work after saving.
- `POST /api/webhooks/whatsapp`: inbound customer message. Verify signature. Idempotent on provider message SID.
- `POST /api/dev/simulate-missed-call`: dev only, disabled in production.
- Worker endpoint: processes due `scheduled_actions` (protected by a secret).

## Conditions before the first message
1. Product enabled for the business and business active.
2. Dialled number maps to exactly one business.
3. Not a duplicate: no conversation for this customer started within the last N minutes (default 30).
4. Customer not opted out.
5. Outside business hours: follow config (`send_outside_hours`, default true, with a different message text).
Skipped events are logged with a reason.

## Conversation states (code owns state)
`pending_send` -> `awaiting_reply` -> `in_conversation` -> `offering_slots` -> `booked`
Terminal or side states: `enquiry_logged`, `escalated`, `opted_out`, `expired` (no reply after 24h), `failed`.

## Config (Zod schema, defaults)
| Field | Default |
|---|---|
| delay_minutes | 2 |
| first_message_template | "Hi, this is {{business_name}}. Sorry we missed your call. How can we help?" |
| outside_hours_template | "Hi, this is {{business_name}}. We missed your call and are closed now. How can we help? We'll reply when we reopen." |
| business_hours | per weekday open/close, business timezone |
| booking_enabled | false |
| appointment_duration_minutes | 30 |
| buffer_minutes | 0 |
| calendar_integration_id | null |
| escalation_email | owner's email |
| escalate_on | complaint, wants_human, low_confidence (all true) |
| business_blurb | short "what we do" text the AI may use |
Fixed in code (not configurable in POC): turn cap (default 8), guardrails, confidence threshold (default 0.6).

## AI contract
Input: business blurb and hours, conversation history (last N messages), current state, available slots (if offering), the latest customer message.
Output (validated JSON; on invalid output retry once, then escalate):
```json
{
  "intent": "book_appointment | enquiry | complaint | other | needs_human | opt_out",
  "confidence": 0.0,
  "extracted": { "name": null, "service": null, "preferred_date": null, "preferred_time": null },
  "next_action": "ask_question | offer_slots | confirm_booking | escalate | close",
  "reply": "text to send"
}
```
Code decides: the model only proposes `next_action`. Slots are always computed by code from the calendar, never invented by the model. A booking is created only after explicit customer confirmation of a specific slot.

## Guardrails
- No medical, legal or clinical advice. No price or discount promises. No promises of outcomes.
- Don't claim to be human. Say it's the business's assistant if asked.
- Escalate on complaints, anger, urgent/emergency wording, "speak to someone", low confidence, or turn cap.
- STOP/unsubscribe wording sets opt-out and ends the conversation with a short acknowledgement.
- Only use facts from the business blurb and config; otherwise say the team will follow up.

## Booking
1. Query free/busy for the next N days (default 7).
2. Compute slots in code from business hours, duration, buffer; offer 2-3.
3. On confirmation, re-check the slot is still free, create the event, store its ID, send confirmation.
4. If the slot was taken, offer new slots. If the calendar is disconnected or errors, escalate.

## Escalation
Set `conversation.escalated = true` with reason, email the owner via Resend (summary, customer number, link to conversation), log the event. Do not keep auto-replying after escalation except a short "the team will contact you" message.

## Failure handling
Provider send fails -> retry with backoff (max 3) -> mark action failed -> visible in admin failed-automations view. All steps write to `automation_logs` with status and error.

## Test scenarios
1. Missed call during hours -> message after delay.
2. Duplicate call within window -> no second conversation.
3. Provider retries the same webhook -> one stored message.
4. "I'd like a check-up Thursday" -> slots offered -> confirm -> event created.
5. Complaint -> escalated, owner emailed.
6. "Is this safe for my condition?" -> no advice, escalated.
7. "STOP" -> opted out, no further messages.
8. Invalid signature -> rejected.
9. Invalid model JSON -> retry then escalate.
10. Calendar disconnected -> escalate with reason.
