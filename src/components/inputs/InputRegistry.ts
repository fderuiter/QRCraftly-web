import { getPublicDomain } from "@/packages/core/site";
import type { ComponentType } from "react";
import { CryptoNetwork, SocialPlatform, type UrlData, type TextData, type EmailData, type VCardData, type PhoneData, type SmsData, type PaymentData, type EventData, CalendarProvider, type LocationData, type MeetingData, type SocialData, type BulkCsvData } from "@/packages/qr-payload";
import { QRType, WifiEncryption, type WifiData } from "@/packages/core/types";
import { QR_GENERATORS, CONTAINMENT_PROFILES, emailListError, cardFieldsFor, vCardFieldError, paymentRefusal } from "@/packages/qr-payload";
import { isDangerousUrl } from "@/packages/core/security";
import { findBlockingViolation } from "./linkViolations";

import { UrlInput } from "./UrlInput";
import { TextInput } from "./TextInput";
import { WifiInput } from "./WifiInput";
import { EmailInput } from "./EmailInput";
import { VCardInput } from "./VCardInput";
import { PhoneInput } from "./PhoneInput";
import { SmsInput } from "./SmsInput";
import { PaymentInput } from "./PaymentInput";
import { LazyEventInput } from "./LazyEventInput";
import { LocationInput } from "./LocationInput";
import { MeetingInput } from "./MeetingInput";
import { LazySocialInput } from "./LazySocialInput";
import { LazyBulkCsvInput } from "./LazyBulkCsvInput";

export type InputDataMap = {
  [QRType.URL]: UrlData;
  [QRType.TEXT]: TextData;
  [QRType.WIFI]: WifiData;
  [QRType.EVENT]: EventData;
  [QRType.EMAIL]: EmailData;
  [QRType.VCARD]: VCardData;
  [QRType.PHONE]: PhoneData;
  [QRType.SMS]: SmsData;
  [QRType.PAYMENT]: PaymentData;
  [QRType.LOCATION]: LocationData;
  [QRType.MEETING]: MeetingData;
  [QRType.SOCIAL]: SocialData;
  [QRType.BULK_CSV]: BulkCsvData;
};

/** Props every input component takes: the form data for its type and a patch callback. */
export interface InputProps<K extends QRType> {
  data: InputDataMap[K];
  onChange: (updates: Partial<InputDataMap[K]>) => void;
}

/** One QR type's input: its form, starting state, refusal check and payload conversion. */
export interface InputEntry<K extends QRType> {
  Component: ComponentType<InputProps<K>>;
  initialState: InputDataMap[K];
  /**
   * Why the form's content must not reach the preview, or null when it may. Only values that
   * can never become valid are refused, so typing never trips it halfway (AGENTS.md).
   */
  validate: (data: InputDataMap[K]) => string | null;
  construct: (data: InputDataMap[K]) => string;
  hydrate: (raw: string) => InputDataMap[K];
  canHydrate: (raw: string) => boolean;
}

export type Registry = {
  [K in QRType]: InputEntry<K>;
};

/** Accepts anything: the type has no field that the form refuses. */
const acceptAll = (): null => null;

/** Refuses a control or zero-width character in any WiFi field, which phones read differently. */
const validateWifi = (wifi: WifiData): string | null => {
  const fields = [wifi.ssid, wifi.password, wifi.eapIdentity];
  return fields.some((field) => field && CONTAINMENT_PROFILES.STRICT_NO_CONTROL.test(field)) ? 'CONTROL_CHARACTER_VIOLATION' : null;
};

/** Refuses a malformed recipient list once the form holds anything. */
const validateEmail = (message: EmailData): string | null => {
  const hasContent = [message.email, message.cc, message.bcc, message.subject, message.body].some((f) => f?.trim());
  if (!hasContent) return null;
  return emailListError(message.email, { required: true }) ?? emailListError(message.cc) ?? emailListError(message.bcc) ?? null;
};

/** Refuses the first card field its version cannot hold. */
const validateVCard = (vcard: VCardData): string | null => {
  for (const field of cardFieldsFor(vcard.version)) {
    const error = vCardFieldError(field, vcard[field]);
    if (error) return error;
  }
  return null;
};

/** Refuses a script or data link as the address, then anything the payment rules refuse. */
const validatePayment = (payment: PaymentData): string | null => {
  const address = payment.network === CryptoNetwork.EPC_SEPA ? (payment.iban || payment.address || '') : (payment.address || '');
  if (address && isDangerousUrl(address)) return 'URI_INJECTION_VIOLATION';
  return paymentRefusal(payment);
};

export const INPUT_REGISTRY: Registry = {
  [QRType.URL]: {
    Component: UrlInput,
    initialState: {
      url: getPublicDomain(),
    },
    validate: (data) => findBlockingViolation(QRType.URL, data),
    construct: QR_GENERATORS[QRType.URL].construct,
    hydrate: QR_GENERATORS[QRType.URL].hydrate,
    canHydrate: QR_GENERATORS[QRType.URL].matches,
  },
  [QRType.TEXT]: {
    Component: TextInput,
    initialState: {
      text: "",
    },
    validate: (data) => findBlockingViolation(QRType.TEXT, data),
    construct: QR_GENERATORS[QRType.TEXT].construct,
    hydrate: QR_GENERATORS[QRType.TEXT].hydrate,
    canHydrate: QR_GENERATORS[QRType.TEXT].matches,
  },
  [QRType.WIFI]: {
    Component: WifiInput,
    initialState: {
      ssid: "",
      password: "",
      encryption: WifiEncryption.WPA,
      hidden: false,
      eapIdentity: "",
    },
    validate: validateWifi,
    construct: QR_GENERATORS[QRType.WIFI].construct,
    hydrate: QR_GENERATORS[QRType.WIFI].hydrate,
    canHydrate: QR_GENERATORS[QRType.WIFI].matches,
  },
  [QRType.EVENT]: {
    Component: LazyEventInput,
    initialState: {
      title: "",
      startDate: "",
      endDate: "",
      timezone: "",
      location: "",
      description: "",
      provider: CalendarProvider.ICAL,
    },
    validate: acceptAll,
    construct: QR_GENERATORS[QRType.EVENT].construct,
    hydrate: QR_GENERATORS[QRType.EVENT].hydrate,
    canHydrate: QR_GENERATORS[QRType.EVENT].matches,
  },
  [QRType.EMAIL]: {
    Component: EmailInput,
    initialState: {
      email: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
    },
    validate: validateEmail,
    construct: QR_GENERATORS[QRType.EMAIL].construct,
    hydrate: QR_GENERATORS[QRType.EMAIL].hydrate,
    canHydrate: QR_GENERATORS[QRType.EMAIL].matches,
  },
  [QRType.VCARD]: {
    Component: VCardInput,
    initialState: {
      version: "3.0",
      firstName: "",
      lastName: "",
      organization: "",
      title: "",
      phone: "",
      email: "",
      website: "",
      street: "",
      city: "",
      zip: "",
      country: "",
    },
    validate: validateVCard,
    construct: QR_GENERATORS[QRType.VCARD].construct,
    hydrate: QR_GENERATORS[QRType.VCARD].hydrate,
    canHydrate: QR_GENERATORS[QRType.VCARD].matches,
  },
  [QRType.PHONE]: {
    Component: PhoneInput,
    initialState: {
      number: "",
    },
    validate: acceptAll,
    construct: QR_GENERATORS[QRType.PHONE].construct,
    hydrate: QR_GENERATORS[QRType.PHONE].hydrate,
    canHydrate: QR_GENERATORS[QRType.PHONE].matches,
  },
  [QRType.SMS]: {
    Component: SmsInput,
    initialState: {
      number: "",
      message: "",
    },
    validate: acceptAll,
    construct: QR_GENERATORS[QRType.SMS].construct,
    hydrate: QR_GENERATORS[QRType.SMS].hydrate,
    canHydrate: QR_GENERATORS[QRType.SMS].matches,
  },
  [QRType.PAYMENT]: {
    Component: PaymentInput,
    initialState: {
      network: CryptoNetwork.BITCOIN,
      address: "",
      amount: "",
      label: "",
    },
    validate: validatePayment,
    construct: QR_GENERATORS[QRType.PAYMENT].construct,
    hydrate: QR_GENERATORS[QRType.PAYMENT].hydrate,
    canHydrate: QR_GENERATORS[QRType.PAYMENT].matches,
  },
  [QRType.LOCATION]: {
    Component: LocationInput,
    initialState: {
      latitude: "",
      longitude: "",
    },
    validate: acceptAll,
    construct: QR_GENERATORS[QRType.LOCATION].construct,
    hydrate: QR_GENERATORS[QRType.LOCATION].hydrate,
    canHydrate: QR_GENERATORS[QRType.LOCATION].matches,
  },
  [QRType.MEETING]: {
    Component: MeetingInput,
    initialState: {
      url: "",
    },
    validate: (data) => findBlockingViolation(QRType.MEETING, data),
    construct: QR_GENERATORS[QRType.MEETING].construct,
    hydrate: QR_GENERATORS[QRType.MEETING].hydrate,
    canHydrate: QR_GENERATORS[QRType.MEETING].matches,
  },
  [QRType.SOCIAL]: {
    Component: LazySocialInput,
    initialState: {
      platform: SocialPlatform.INSTAGRAM,
      handle: "",
    },
    validate: acceptAll,
    construct: QR_GENERATORS[QRType.SOCIAL].construct,
    hydrate: QR_GENERATORS[QRType.SOCIAL].hydrate,
    canHydrate: QR_GENERATORS[QRType.SOCIAL].matches,
  },
  [QRType.BULK_CSV]: {
    Component: LazyBulkCsvInput,
    initialState: {
      csvContent: "",
      payloadColumn: "",
      filenameColumn: "",
      exportFormat: "png",
    },
    validate: acceptAll,
    construct: QR_GENERATORS[QRType.BULK_CSV].construct,
    hydrate: QR_GENERATORS[QRType.BULK_CSV].hydrate,
    canHydrate: QR_GENERATORS[QRType.BULK_CSV].matches,
  },
};

/** The payload string for a type's form data. */
export const constructInput = <K extends QRType>(type: K, data: InputDataMap[K]): string => INPUT_REGISTRY[type].construct(data);

/** Why a type's form data must not reach the preview, or null when it may. */
export const validateInput = <K extends QRType>(type: K, data: InputDataMap[K]): string | null => INPUT_REGISTRY[type].validate(data);

/** The form data a payload string holds, or null when the type cannot read it. Throws if parsing fails. */
export const hydrateInput = <K extends QRType>(type: K, raw: string): InputDataMap[K] | null => {
  const entry: InputEntry<K> = INPUT_REGISTRY[type];
  return entry.canHydrate(raw) ? entry.hydrate(raw) : null;
};
