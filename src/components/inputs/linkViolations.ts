import { QRType, type UrlData, type MeetingData, type TextData } from "../../types";
import { QR_GENERATORS, validatePayload } from "@/packages/qr-payload";
import { UNSUPPORTED_SCHEME_PREFIX } from "../../utils/security";

/**
 * The first violation that should stop a link or text field from reaching the preview: a script or
 * data scheme in any of them, or a scheme outside the allowlist in the link types. Returns a
 * violation code, or null when the content may be rendered.
 */
export const findBlockingViolation = (type: typeof QRType.URL | typeof QRType.MEETING | typeof QRType.TEXT,data: UrlData | MeetingData | TextData): string | null => {
  const value = type === QRType.TEXT ? (data as TextData).text : type === QRType.URL ? (data as UrlData).url : (data as MeetingData).url;
  if (!value) return null;
  const constructed = QR_GENERATORS[type].construct(data as never);
  const blocking = validatePayload(constructed, type).find(
    (v) => v === 'URI_INJECTION_VIOLATION' || v.startsWith(UNSUPPORTED_SCHEME_PREFIX),
  );
  return blocking ?? null;
};
