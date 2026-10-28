import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js";

/** Normalises user input to E.164, or null when it is not a valid number. Defaults to the UK. */
export function toE164(input: string, defaultCountry: CountryCode = "GB"): string | null {
  const parsed = parsePhoneNumberFromString(input.trim(), defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

/** Display format for owners (UK national format for UK numbers, international otherwise). */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.countryCallingCode === "44" ? parsed.formatNational() : parsed.formatInternational();
}
