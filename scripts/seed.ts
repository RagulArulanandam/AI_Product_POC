import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import type { Database } from "@/lib/database.types";
import { getPublicEnv, getServerEnv } from "@/lib/env";

/**
 * Local seed data (database.md section 11): one platform admin, three businesses with an owner
 * each, and one staff member. Safe to run repeatedly. Refuses any non-local database.
 * The password is a throwaway constant that only exists in local data.
 */
export const SEED_PASSWORD = "Password123!";

export const SEED = {
  admin: { email: "admin@poc.local" },
  businesses: [
    { key: "a", name: "Bright Smile Dental", phone: "+447700900101", owner: "owner-a@poc.local" },
    { key: "b", name: "Glow Beauty Clinic", phone: "+447700900102", owner: "owner-b@poc.local" },
    { key: "c", name: "Fresh Cuts Studio", phone: "+447700900103", owner: "owner-c@poc.local" },
  ],
  staff: { email: "staff-a@poc.local", businessKey: "a" },
} as const;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

export function assertLocalDatabase(url: string): void {
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`Refusing to seed ${host}: seeding is only allowed against a local Supabase.`);
  }
}

type Admin = SupabaseClient<Database>;

async function findUserId(admin: Admin, email: string): Promise<string | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const match = data.users.find((u) => u.email === email);
    if (match) return match.id;
    if (data.users.length < 100) return null;
  }
  return null;
}

async function ensureUser(admin: Admin, email: string): Promise<string> {
  const existing = await findUserId(admin, email);
  if (existing) return existing;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: SEED_PASSWORD,
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser ${email} failed: ${error?.message}`);
  return data.user.id;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

interface DemoMessage {
  sender: "customer" | "ai" | "system";
  body: string;
  /** Minutes after the conversation started. */
  at: number;
  intent?: string;
}

interface DemoConversation {
  phone: string;
  name: string | null;
  state: string;
  /** How long ago it started. */
  ago: number;
  intent?: string;
  escalation?: string;
  messages: DemoMessage[];
}

const OPENING = "Hi, this is Bright Smile Dental. Sorry we missed your call. How can we help?";

const DEMO: DemoConversation[] = [
  {
    phone: "+447700900311", name: "Priya Patel", state: "booked", ago: 2 * HOUR, intent: "book_appointment",
    messages: [
      { sender: "system", body: OPENING, at: 2 },
      { sender: "customer", body: "Hi, I'd like a check-up on Thursday afternoon please", at: 6, intent: "book_appointment" },
      { sender: "ai", body: "Thanks Priya! I've noted your request for Thursday afternoon and passed it to the team. They'll get back to you to confirm a time.", at: 7 },
    ],
  },
  {
    phone: "+447700900312", name: "Sam Jones", state: "escalated", ago: 5 * HOUR, intent: "complaint", escalation: "complaint",
    messages: [
      { sender: "system", body: OPENING, at: 2 },
      { sender: "customer", body: "I'm really unhappy, nobody called me back after my last visit", at: 9, intent: "complaint" },
      { sender: "ai", body: "Thanks for your message. I've passed this to the team and someone will be in touch with you shortly.", at: 10 },
    ],
  },
  {
    phone: "+447700900313", name: null, state: "awaiting_reply", ago: 25 * MIN,
    messages: [{ sender: "system", body: OPENING, at: 2 }],
  },
  {
    phone: "+447700900314", name: "Alex Morgan", state: "in_conversation", ago: DAY + 3 * HOUR, intent: "enquiry",
    messages: [
      { sender: "system", body: OPENING, at: 2 },
      { sender: "customer", body: "What time do you open on Saturday?", at: 15, intent: "enquiry" },
      { sender: "ai", body: "We are closed on Saturdays, but we're open Monday to Friday from 9am to 5pm. Would you like to leave your details so the team can get back to you?", at: 16 },
    ],
  },
  {
    phone: "+447700900315", name: null, state: "expired", ago: 3 * DAY,
    messages: [{ sender: "system", body: OPENING, at: 2 }],
  },
  {
    phone: "+447700900316", name: null, state: "opted_out", ago: 4 * DAY, intent: "opt_out",
    messages: [
      { sender: "system", body: OPENING, at: 2 },
      { sender: "customer", body: "STOP", at: 5, intent: "opt_out" },
      { sender: "ai", body: "You've been unsubscribed and won't receive any more messages from us. Thank you.", at: 6 },
    ],
  },
  {
    phone: "+447700900317", name: "Jordan Lee", state: "enquiry_logged", ago: 6 * DAY, intent: "enquiry",
    messages: [
      { sender: "system", body: OPENING, at: 2 },
      { sender: "customer", body: "Do you do teeth whitening?", at: 12, intent: "enquiry" },
      { sender: "ai", body: "Yes, we offer teeth whitening. The team will be happy to give you the details when they call you back.", at: 13 },
    ],
  },
];

/**
 * Example conversations for business A, so the dashboard and conversation screens have something
 * to show. Added once: nothing happens if the business already has conversations.
 */
async function seedDemoActivity(admin: Admin, businessId: string, productId: string): Promise<void> {
  const { count } = await admin.from("conversations").select("*", { count: "exact", head: true }).eq("business_id", businessId);
  if ((count ?? 0) > 0) return;

  const now = Date.now();
  for (const demo of DEMO) {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .upsert({ business_id: businessId, phone_e164: demo.phone, name: demo.name }, { onConflict: "business_id,phone_e164" })
      .select("id")
      .single();
    if (customerError || !customer) throw new Error(`demo customer failed: ${customerError?.message}`);

    const started = now - demo.ago;
    const lastCustomer = demo.messages.filter((m) => m.sender === "customer").at(-1);
    const { data: conversation, error } = await admin
      .from("conversations")
      .insert({
        business_id: businessId,
        customer_id: customer.id,
        product_id: productId,
        state: demo.state,
        started_at: new Date(started).toISOString(),
        last_outbound_at: new Date(started + 2 * MIN).toISOString(),
        last_inbound_at: lastCustomer ? new Date(started + lastCustomer.at * MIN).toISOString() : null,
        turn_count: demo.messages.filter((m) => m.sender === "customer").length,
        last_intent: demo.intent ?? null,
        escalation_reason: demo.escalation ?? null,
        escalated_at: demo.escalation ? new Date(started + 10 * MIN).toISOString() : null,
      })
      .select("id")
      .single();
    if (error || !conversation) throw new Error(`demo conversation failed: ${error?.message}`);

    const { error: messagesError } = await admin.from("messages").insert(
      demo.messages.map((m, i) => ({
        business_id: businessId,
        conversation_id: conversation.id,
        direction: m.sender === "customer" ? "inbound" : "outbound",
        sender: m.sender,
        body: m.body,
        status: m.sender === "customer" ? "received" : "delivered",
        intent: m.intent ?? null,
        provider_sid: `SMdemo${demo.phone.slice(-3)}${i}`,
        created_at: new Date(started + m.at * MIN).toISOString(),
      })),
    );
    if (messagesError) throw new Error(`demo messages failed: ${messagesError.message}`);
  }
}

export interface SeedResult {
  adminUserId: string;
  businesses: { key: string; id: string; name: string; ownerId: string }[];
  staffUserId: string;
}

export async function runSeed(): Promise<SeedResult> {
  const publicEnv = getPublicEnv();
  assertLocalDatabase(publicEnv.NEXT_PUBLIC_SUPABASE_URL);
  const options = { auth: { persistSession: false, autoRefreshToken: false } } as const;

  const admin = createClient<Database>(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    getServerEnv().SUPABASE_SERVICE_ROLE_KEY,
    options,
  );

  // Platform admin (not a member of any business).
  const adminUserId = await ensureUser(admin, SEED.admin.email);
  const { error: adminError } = await admin
    .from("platform_admins")
    .upsert({ user_id: adminUserId }, { onConflict: "user_id" });
  if (adminError) throw new Error(`platform_admins upsert failed: ${adminError.message}`);

  const { data: product, error: productError } = await admin
    .from("products")
    .select("id")
    .eq("key", "missed-call")
    .single();
  if (productError || !product) throw new Error("missed-call product is not seeded; run the migrations first.");

  const businesses: SeedResult["businesses"] = [];
  for (const b of SEED.businesses) {
    const ownerId = await ensureUser(admin, b.owner);

    // Create through the real onboarding RPC, as the owner, unless they already have a business.
    const { data: existing } = await admin
      .from("memberships")
      .select("business_id")
      .eq("user_id", ownerId)
      .eq("role", "owner")
      .maybeSingle();

    let businessId = existing?.business_id;
    if (!businessId) {
      const asOwner = createClient<Database>(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, options);
      const { error: signInError } = await asOwner.auth.signInWithPassword({ email: b.owner, password: SEED_PASSWORD });
      if (signInError) throw new Error(`sign in ${b.owner} failed: ${signInError.message}`);
      const { data, error } = await asOwner.rpc("create_business", {
        p_name: b.name,
        p_phone: b.phone,
        p_timezone: "Europe/London",
      });
      if (error || !data) throw new Error(`create_business for ${b.name} failed: ${error?.message}`);
      businessId = data;
    }
    businesses.push({ key: b.key, id: businessId, name: b.name, ownerId });
  }

  // Business A has Product 1 switched on, so the dashboard has something to show.
  const a = businesses.find((b) => b.key === "a")!;
  const { error: enableError } = await admin
    .from("business_products")
    .upsert({ business_id: a.id, product_id: product.id, enabled: true }, { onConflict: "business_id,product_id" });
  if (enableError) throw new Error(`enable product failed: ${enableError.message}`);

  // Map the Twilio voice number to business A so webhooks for it resolve to a business.
  const voiceNumber = process.env.TWILIO_VOICE_NUMBER;
  if (voiceNumber && /^\+[1-9]\d{6,14}$/.test(voiceNumber)) {
    const { error: numberError } = await admin
      .from("phone_numbers")
      .upsert({ business_id: a.id, e164: voiceNumber }, { onConflict: "e164" });
    if (numberError) throw new Error(`phone number mapping failed: ${numberError.message}`);
  }

  await seedDemoActivity(admin, a.id, product.id);

  // One staff member in business A.
  const staffUserId = await ensureUser(admin, SEED.staff.email);
  const { error: staffError } = await admin
    .from("memberships")
    .upsert({ business_id: a.id, user_id: staffUserId, role: "staff" }, { onConflict: "business_id,user_id" });
  if (staffError) throw new Error(`staff membership failed: ${staffError.message}`);

  return { adminUserId, businesses, staffUserId };
}

async function main(): Promise<void> {
  config({ path: ".env.local", quiet: true });
  const result = await runSeed();
  console.log("Seeded local data (password for every account: " + SEED_PASSWORD + ")");
  console.log(`  admin   ${SEED.admin.email}`);
  for (const b of SEED.businesses) console.log(`  owner   ${b.owner}  ->  ${b.name}`);
  console.log(`  staff   ${SEED.staff.email}  ->  ${result.businesses[0].name}`);
}

if (process.argv[1] && /seed\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
