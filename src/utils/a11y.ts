import { QRType } from '../types';
import { QR_GENERATORS, type QRPayloadDataMap } from '@/packages/qr-payload';

export function combineIds(...ids: (string | undefined | null | false)[]): string | undefined {
  const combined = ids.filter(Boolean).join(' ');
  return combined.length > 0 ? combined : undefined;
}

export function getQrTypeLabel(type: QRType): string {
  switch (type) {
    case QRType.WIFI:
      return 'WiFi Network';
    case QRType.URL:
      return 'URL';
    case QRType.TEXT:
      return 'Text';
    case QRType.EVENT:
      return 'Event';
    case QRType.VCARD:
      return 'Contact';
    case QRType.EMAIL:
      return 'Email';
    case QRType.PHONE:
      return 'Phone';
    case QRType.SMS:
      return 'SMS';
    case QRType.PAYMENT:
      return 'Payment';
    case QRType.LOCATION:
      return 'Location';
    case QRType.MEETING:
      return 'Meeting';
    case QRType.SOCIAL:
      return 'Social';
    case QRType.BULK_CSV:
      return 'Bulk CSV Batch';
    default:
      return type;
  }
}

const DESCRIBERS: { [K in QRType]: (data: QRPayloadDataMap[K]) => string } = {
  [QRType.WIFI]: (data) => data.ssid || '',
  [QRType.URL]: (data) => data.url || '',
  [QRType.TEXT]: (data) => data.text || '',
  [QRType.EVENT]: (data) => data.title || '',
  [QRType.VCARD]: (data) => {
    const nameParts = [data.firstName, data.lastName].filter(Boolean);
    return nameParts.join(' ') || data.organization || '';
  },
  [QRType.EMAIL]: (data) => data.email || '',
  [QRType.PHONE]: (data) => data.number || '',
  [QRType.SMS]: (data) => data.number || '',
  [QRType.PAYMENT]: (data) => data.address || '',
  [QRType.LOCATION]: (data) => (data.latitude && data.longitude ? `${data.latitude}, ${data.longitude}` : ''),
  [QRType.MEETING]: (data) => data.url || '',
  [QRType.SOCIAL]: (data) => (data.handle ? `@${data.handle}` : ''),
  [QRType.BULK_CSV]: (data) => data.fileName || 'Bulk CSV Batch',
};

function describePayload<K extends QRType>(type: K, value: string): string {
  const data = QR_GENERATORS[type].hydrate(value);
  if (!data) return value;
  return DESCRIBERS[type](data);
}

export function getQrTypeDescription(type: QRType, value: string): string {
  if (!value) return '';
  if (!Object.prototype.hasOwnProperty.call(QR_GENERATORS, type)) return value;
  try {
    return describePayload(type, value);
  } catch {
    return value;
  }
}

/**
 * Announce a message politely to screen readers using a visually hidden live region.
 */
export function announcePolitely(message: string) {
  if (typeof document === 'undefined') return;
  let liveRegion = document.getElementById('dynamic-focus-live-region');
  if (!liveRegion) {
    liveRegion = document.createElement('div');
    liveRegion.id = 'dynamic-focus-live-region';
    liveRegion.className = 'sr-only';
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.setAttribute('role', 'status');
    // Ensure it is visually hidden
    liveRegion.style.position = 'absolute';
    liveRegion.style.width = '1px';
    liveRegion.style.height = '1px';
    liveRegion.style.padding = '0';
    liveRegion.style.margin = '-1px';
    liveRegion.style.overflow = 'hidden';
    liveRegion.style.clip = 'rect(0, 0, 0, 0)';
    liveRegion.style.whiteSpace = 'nowrap';
    liveRegion.style.borderWidth = '0';
    document.body.appendChild(liveRegion);
  }

  // Clear content first to trigger some assistive tech reliably
  liveRegion.textContent = '';
  setTimeout(() => {
    if (liveRegion) {
      liveRegion.textContent = message;
    }
  }, 50);
}

