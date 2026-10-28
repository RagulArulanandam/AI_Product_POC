-- What the customer asked to book (for example "check-up"), remembered between the message that
-- names it and the message that picks a time. Written by the service role with the booking.
alter table public.conversations add column booking_service text;
