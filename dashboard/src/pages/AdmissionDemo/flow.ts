export const ADMISSION_FIELD_ORDER = [
  "contact_name",
  "relationship",
  "contact_phone",
  "address",
  "emergency_contact",
  "emergency_phone",
] as const;

export type AdmissionFieldName = (typeof ADMISSION_FIELD_ORDER)[number];
export type AdmissionFields = Partial<Record<AdmissionFieldName, string>>;
export type MockHisReceipt = {
  status: "success";
  receiptId: string;
  notificationSent: false;
  printSucceeded: false;
};

const ambiguous = /(?:或|或者|还是|\bor\b)/i;
const phone = /^1[3-9]\d{9}$/;

function explicitPhoneNumbers(text: string): string[] {
  const numbers = new Set<string>();
  for (const match of text.matchAll(/1[3-9](?:[ -]?\d){9}/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (/\d/.test(text[start - 1] || "") || /\d/.test(text[end] || ""))
      continue;
    numbers.add(match[0].replace(/\D/g, ""));
  }
  return [...numbers];
}

export function isValidAdmissionField(
  key: AdmissionFieldName,
  raw: string,
): boolean {
  const value = raw.trim();
  if (!value || value.length > 200 || ambiguous.test(value)) return false;
  if (key === "contact_phone" || key === "emergency_phone") {
    return phone.test(value);
  }
  if (key === "address") return value.length >= 5;
  return value.length <= 40;
}

export function mergeCandidates(
  current: AdmissionFields,
  candidates: Record<string, unknown>,
  sourceText = "",
): AdmissionFields {
  if (ambiguous.test(sourceText)) return { ...current };
  const merged = { ...current };
  const sourcePhones = explicitPhoneNumbers(sourceText);
  for (const key of ADMISSION_FIELD_ORDER) {
    const raw = candidates[key];
    if (typeof raw !== "string") continue;
    let value = raw.trim();
    if (key === "contact_phone" || key === "emergency_phone") {
      const visibleDigits = value.replace(/\D/g, "");
      if (visibleDigits.length === 11) {
        if (!sourcePhones.includes(visibleDigits)) continue;
        value = visibleDigits;
      } else if (visibleDigits.length === 4) {
        const matches = sourcePhones.filter((candidate) =>
          candidate.endsWith(visibleDigits),
        );
        if (matches.length !== 1) continue;
        value = matches[0];
      } else {
        continue;
      }
    }
    if (isValidAdmissionField(key, value)) {
      merged[key] = value;
    }
  }
  return merged;
}

export function firstMissingField(
  fields: AdmissionFields,
): AdmissionFieldName | null {
  return (
    ADMISSION_FIELD_ORDER.find(
      (key) => !fields[key] || !isValidAdmissionField(key, fields[key]!),
    ) ?? null
  );
}

/** Fields shown on the "补充必要信息" form; all of them are required to continue. */
export const REQUIRED_DETAILS_FIELDS = [
  "contact_phone",
  "emergency_contact",
  "emergency_phone",
  "relationship",
  "address",
] as const;

export function firstMissingRequired(
  fields: AdmissionFields,
): AdmissionFieldName | null {
  return (
    REQUIRED_DETAILS_FIELDS.find(
      (key) => !fields[key] || !isValidAdmissionField(key, fields[key]!),
    ) ?? null
  );
}

export function mockHisSubmit(applicationId: string): MockHisReceipt {
  return {
    status: "success",
    receiptId: `SIM-${applicationId}`,
    notificationSent: false,
    printSucceeded: false,
  };
}
