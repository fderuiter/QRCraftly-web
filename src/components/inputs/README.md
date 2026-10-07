# Input Components

This directory contains modular React components for each specific QR code data type. These components are orchestrated by `src/components/InputPanel.tsx`.

## Component Pattern

Each input component follows a consistent pattern:

1.  **Strict Props**: Takes a `data` object (specific to the type, e.g., `WifiData`) and an `onChange` handler.
2.  **Stateless (Mostly)**: Typically delegates state management to the parent (`InputPanel`) via `useInputLogic` and the centralized registry, though some may handle purely UI-local state (like toggling password visibility or geolocation loading).
3.  **Shared Styles**: Uses the shared form fields (`src/components/ui/FormFields.tsx`, `FormBlock`) and style constants from `src/components/ui/styles.ts` to ensure visual consistency.

### Example Structure

```tsx
import React from 'react';
import { WifiData } from '../../types';

interface WifiInputProps {
  data: WifiData;
  onChange: (updates: Partial<WifiData>) => void;
}

export const WifiInput: React.FC<WifiInputProps> = ({ data, onChange }) => {
  return (
    <input
      type="text"
      value={data.ssid}
      onChange={(e) => onChange({ ssid: e.target.value })}
    />
  );
};
```

## Available Components

- `TypeSelector.tsx`: The grid of QR types. Each type has its own SEO route (`QR_TYPE_ROUTES` in `src/data/navigation.ts`), so the choices are ordinary links inside a labelled `nav` list, with `aria-current="page"` on the current route. There are no tab roles, no roving tabIndex and no arrow-key interception: Tab moves through the links in document order. Choosing a type is a normal navigation; the URL, metadata, selected link and input panel all come from the route. Nothing is cleared before navigation, and QR content is not carried to the next route or persisted (volatile memory guarantee). Appearance-only settings (colours, style, layout; not content or free text such as template headlines) are carried to the next generator route in memory only, via `QRProvider retainAppearance`.
- `UrlInput.tsx`: For `QRType.URL`. Handles URL validation and sanitization.
- `TextInput.tsx`: For `QRType.TEXT`. Includes character counting.
- `WifiInput.tsx`: For `QRType.WIFI`. Handles SSID, password, encryption type, hidden network flags, and (for WPA2-Enterprise) the EAP method (`E:`), phase 2 authentication (`PH2:`) and identity (`I:`) fields.
- `EventInput.tsx`: For `QRType.EVENT`. Builds iCalendar-compatible event payloads.
- `EmailInput.tsx`: For `QRType.EMAIL`. Fields for address, subject, and body.
- `VCardInput.tsx`: For `QRType.VCARD`. Complex form for contact details supporting vCard 2.1, 3.0, 4.0 (RFC 6350), and MECard formats.
- `PhoneInput.tsx`: For `QRType.PHONE`. Simple phone number input.
- `SmsInput.tsx`: For `QRType.SMS`. Phone number and message body.
- `PaymentInput.tsx`: For `QRType.PAYMENT`. Supports Bitcoin, Ethereum, Solana, etc.
- `LocationInput.tsx`: For `QRType.LOCATION`. Collects latitude and longitude with support for browser geolocation APIs.
- `MeetingInput.tsx`: For `QRType.MEETING`. Handles online meeting links for Zoom, Microsoft Teams, and Google Meet, with automatic parsing.
- `SocialInput.tsx`: For `QRType.SOCIAL`. Configures social media platform username and handle details for Instagram, Twitter / X, and TikTok.
- `BulkCsvInput.tsx`: For `QRType.BULK_CSV`. Client-side main-thread CSV parsing and ZIP generation through `@/packages/bulk-csv` (no third-party libraries). The registry loads it through `LazyBulkCsvInput.tsx` so the code is fetched only on the Bulk CSV type. Supports column mapping, PNG/SVG format selection, a 500-row batch limit, malformed CSV error handling, progress tracking, and zero network calls.

## Adding a New Input Type

1.  Define the data structure in `src/types.ts`.
2.  Create the payload generator (construction, hydration, and parsing) in `src/packages/qr-payload/lib/generators/` and register it in `src/packages/qr-payload/lib/registry.ts`. Import generators from `@/packages/qr-payload`; there is no `utils` shim.
3.  Create a new component file in this directory (e.g., `NewTypeInput.tsx`).
4.  Register the component, its initial state, and helpers in `src/components/inputs/InputRegistry.ts`.
5.  Add the new type to the `TypeSelector` options and its route to `QR_TYPE_ROUTES` in `src/data/navigation.ts` (with a matching page under `src/pages/`).
6.  Add its display name to `QR_TYPE_LABELS` in `src/data/qrTypeLabels.ts`. Announcements ("WiFi input loaded"), the scan result sheet and the scan toast use these labels, never raw enum values. The map is typed `Record<QRType, string>`, so `tsc` fails until the new type has a label.

Input data never leaves the browser. `src/types.ts` has no telemetry or reporting schema, and new input types must not add one (see [the QRCraftly Pledge](../../../docs/PLEDGE.md)).

## Brand Design Templates

`src/types.ts` defines `BrandTemplate` and `BrandTemplateExportPayload` interfaces for visual style templates. Templates store visual properties only (colors, pattern styles, borders, logo formatting) and never contain user QR payload input.

## QR Animation Configurations

The centralized config structure in `src/types.ts` has optional fields for `animationValues`, `isAnimating`, and `animationFps` to drive high-performance frame playbacks in the canvas.

## QR Scanner Integration

The "Scan QR Code" button after the inputs opens the scanner (`src/components/QRScanner.tsx`, #1101 and #1102) in a large `Modal` that fills the screen on phones:

1. **Dialog behaviour**: The dialog takes focus when it opens, traps Tab inside, closes on Escape or "Close scanner", and returns focus to the "Scan QR Code" button.
2. **Camera**: The `useQrScanner` hook (`@/packages/optical-scanner/client`) owns the camera through its Camera Session: `start()` and `stop()` open and release the stream, attach it to the hook's `videoRef` and run the Camera Scanner Engine, and `state` reports `requesting`, `streaming`, `denied` or `unavailable`. Both calls are idempotent, so StrictMode and quick remounts never leave a camera running, and the camera is released while the tab is hidden or a result shows. Outside the reticle the video is dimmed; once a code is confirmed the reticle locks onto its corners before the result opens.
3. **Images**: The Image mode is a labelled region with a "Choose image" button and, where the browser allows, "Paste image". Ctrl/Cmd+V pastes a screenshot and an image can be dropped anywhere on the scanner. Errors sit outside the button, linked with `aria-describedby`, and are announced with `role="alert"`.
4. **Result sheet**: `src/components/scanner/ScanResultSheet.tsx` shows the type (`describeScan`), a readable summary, and for a link the real host (Punycode decoded, mixed scripts flagged). Script and data addresses are blocked and offer Copy only. "Edit in generator" calls `InputPanel`'s handler, which replaces the content and offers Undo in a toast when there was content to lose.
5. **Loading**: The scanner is not part of a page's first load (#1041). `InputPanel` loads it with `React.lazy` the first time it is wanted, and starts the download when the button is hovered or focused, so the dialog opens ready. The dialog shows a placeholder while it loads.
6. **Session history**: The last five results stay in module memory for the tab. Nothing is stored.

The standalone `/qr-code-scanner` page uses the same component with the camera off until "Start camera", and opens a result in the generator through `stageGeneratorContent` (`src/context/QRContext.tsx`), an in-memory hand-off that never touches the URL or storage.

## Playable Maze Overlay Configuration

The centralized configuration in `src/types.ts` also contains parameters for generating a solvable maze overlay directly on the QR code:

- `isMazeEnabled`: Enables/disables maze overlay rendering.
- `isMazeBridgesEnabled`: Enables scannability-audited bridge channels in maze generation.
- `mazeColor`: Sets maze path color.
- `mazePathWidth`: Controls maze path width.
- `showMazeSolution`: Toggles solved path visibility.

These parameters are controlled via `AdvancedControls.tsx`.

## Mosaic QR Configuration

`QRConfig` also carries the Mosaic QR style fields (ADR 0019): `mosaicImageUrl` (the uploaded design as a `data:` URL, or null), `mosaicMode` (`halftone` or `tiles`) and `mosaicContrast` (0..1). They are style fields, not content, and are controlled by `MosaicControls.tsx`.

## Template Export Configuration

Template export options in `QRConfig` include `templateStyle`, optional `templateHeadline`/`templateSubtext`, color overrides (`templateBgColor`, `templateTextColor`), and `templateQrScale`.
