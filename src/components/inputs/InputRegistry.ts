import { getPublicDomain } from "../../utils/metadataEngine";
import React from "react";
import {
  QRType,
  UrlData,
  TextData,
  WifiData,
  EmailData,
  VCardData,
  PhoneData,
  SmsData,
  PaymentData,
  EventData,
  LocationData,
  MeetingData,
  SocialData,
  BulkCsvData,
} from "../../types";
import { QR_GENERATORS, getSamplePayload } from "@/packages/qr-payload";

import { UrlInput } from "./UrlInput";
import { TextInput } from "./TextInput";
import { WifiInput } from "./WifiInput";
import { EmailInput } from "./EmailInput";
import { VCardInput } from "./VCardInput";
import { PhoneInput } from "./PhoneInput";
import { SmsInput } from "./SmsInput";
import { PaymentInput } from "./PaymentInput";
import { EventInput } from "./EventInput";
import { LocationInput } from "./LocationInput";
import { MeetingInput } from "./MeetingInput";
import { SocialInput } from "./SocialInput";
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

interface InputRegistryEntry<T> {
  Component: React.ComponentType<{
    data: T;
    onChange: (updates: Partial<T>) => void;
  }>;
  initialState: T;
  constructFn: (data: T) => string;
  hydrateFn: (raw: string) => T;
  canHydrateFn: (raw: string) => boolean;
}

export type Registry = {
  [K in QRType]: InputRegistryEntry<InputDataMap[K]>;
};

export const INPUT_REGISTRY: Registry = {
  [QRType.URL]: {
    Component: UrlInput,
    initialState: {
      url: getPublicDomain(),
    } as UrlData,
    constructFn: QR_GENERATORS[QRType.URL].construct,
    hydrateFn: QR_GENERATORS[QRType.URL].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.URL].matches,
  },
  [QRType.TEXT]: {
    Component: TextInput,
    initialState: {
      text: "",
    } as TextData,
    constructFn: QR_GENERATORS[QRType.TEXT].construct,
    hydrateFn: QR_GENERATORS[QRType.TEXT].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.TEXT].matches,
  },
  [QRType.WIFI]: {
    Component: WifiInput,
    initialState: QR_GENERATORS[QRType.WIFI].hydrate(getSamplePayload(QRType.WIFI)),
    constructFn: QR_GENERATORS[QRType.WIFI].construct,
    hydrateFn: QR_GENERATORS[QRType.WIFI].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.WIFI].matches,
  },
  [QRType.EVENT]: {
    Component: EventInput,
    initialState: QR_GENERATORS[QRType.EVENT].hydrate(getSamplePayload(QRType.EVENT)),
    constructFn: QR_GENERATORS[QRType.EVENT].construct,
    hydrateFn: QR_GENERATORS[QRType.EVENT].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.EVENT].matches,
  },
  [QRType.EMAIL]: {
    Component: EmailInput,
    initialState: QR_GENERATORS[QRType.EMAIL].hydrate(getSamplePayload(QRType.EMAIL)),
    constructFn: QR_GENERATORS[QRType.EMAIL].construct,
    hydrateFn: QR_GENERATORS[QRType.EMAIL].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.EMAIL].matches,
  },
  [QRType.VCARD]: {
    Component: VCardInput,
    initialState: QR_GENERATORS[QRType.VCARD].hydrate(getSamplePayload(QRType.VCARD)),
    constructFn: QR_GENERATORS[QRType.VCARD].construct,
    hydrateFn: QR_GENERATORS[QRType.VCARD].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.VCARD].matches,
  },
  [QRType.PHONE]: {
    Component: PhoneInput,
    initialState: QR_GENERATORS[QRType.PHONE].hydrate(getSamplePayload(QRType.PHONE)),
    constructFn: QR_GENERATORS[QRType.PHONE].construct,
    hydrateFn: QR_GENERATORS[QRType.PHONE].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.PHONE].matches,
  },
  [QRType.SMS]: {
    Component: SmsInput,
    initialState: QR_GENERATORS[QRType.SMS].hydrate(getSamplePayload(QRType.SMS)),
    constructFn: QR_GENERATORS[QRType.SMS].construct,
    hydrateFn: QR_GENERATORS[QRType.SMS].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.SMS].matches,
  },
  [QRType.PAYMENT]: {
    Component: PaymentInput,
    initialState: QR_GENERATORS[QRType.PAYMENT].hydrate(getSamplePayload(QRType.PAYMENT)),
    constructFn: QR_GENERATORS[QRType.PAYMENT].construct,
    hydrateFn: QR_GENERATORS[QRType.PAYMENT].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.PAYMENT].matches,
  },
  [QRType.LOCATION]: {
    Component: LocationInput,
    initialState: QR_GENERATORS[QRType.LOCATION].hydrate(getSamplePayload(QRType.LOCATION)),
    constructFn: QR_GENERATORS[QRType.LOCATION].construct,
    hydrateFn: QR_GENERATORS[QRType.LOCATION].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.LOCATION].matches,
  },
  [QRType.MEETING]: {
    Component: MeetingInput,
    initialState: QR_GENERATORS[QRType.MEETING].hydrate(getSamplePayload(QRType.MEETING)),
    constructFn: QR_GENERATORS[QRType.MEETING].construct,
    hydrateFn: QR_GENERATORS[QRType.MEETING].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.MEETING].matches,
  },
  [QRType.SOCIAL]: {
    Component: SocialInput,
    initialState: QR_GENERATORS[QRType.SOCIAL].hydrate(getSamplePayload(QRType.SOCIAL)),
    constructFn: QR_GENERATORS[QRType.SOCIAL].construct,
    hydrateFn: QR_GENERATORS[QRType.SOCIAL].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.SOCIAL].matches,
  },
  [QRType.BULK_CSV]: {
    Component: LazyBulkCsvInput,
    initialState: {
      csvContent: "",
      payloadColumn: "",
      filenameColumn: "",
      exportFormat: "png",
    },
    constructFn: QR_GENERATORS[QRType.BULK_CSV].construct,
    hydrateFn: QR_GENERATORS[QRType.BULK_CSV].hydrate,
    canHydrateFn: QR_GENERATORS[QRType.BULK_CSV].matches,
  },
};
