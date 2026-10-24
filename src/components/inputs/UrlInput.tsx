import React from "react";
import type { UrlData } from "../../types";
import { TextField } from "../ui/FormFields";
import { looksLikeWebAddress, normalizeUrl } from "@/packages/core/url";
import { describeViolation, SAMPLE_PAYLOADS } from "@/packages/qr-payload";
import { QRType } from "../../types";
import { FieldNotes, LinkHints, hintsId } from './FieldHints';
import { findBlockingViolation } from "./linkViolations";

/** Shown under the field when what was typed cannot be a web address. */
const NOT_AN_ADDRESS_NOTE = "This doesn't look like a web address. Check it before you print or share the code.";

/**
 * Properties for the UrlInput component.
 */
interface UrlInputProps {
  /** The current URL configuration data. */
  data: UrlData;
  /** Callback to update the parent configuration. */
  onChange: (updates: Partial<UrlData>) => void;
}

/**
 * Website URL Input Component.
 * The URL is encoded directly into a static QR code; nothing leaves the browser.
 * @param props - Component properties.
 * @param props.data - The URL data input state.
 * @param props.onChange - Handler called on URL configuration changes.
 * @returns The rendered UrlInput component.
 */
export const UrlInput: React.FC<UrlInputProps> = ({ data, onChange }) => {
  const violation = findBlockingViolation(QRType.URL, data);
  const urlError = violation ? describeViolation(violation) : undefined;
  // A typo such as "my site" still makes a code, so say so before it is printed.
  const notAnAddress = !urlError && !looksLikeWebAddress(data.url);

  return (
    <div className="space-y-4">
      <div>
        <TextField
          id="url-input"
          label="Website URL"
          suppressHydrationWarning={true}
          name="url"
          autoComplete="url"
          type="url"
          maxLength={2048}
          placeholder="https://example.com"
          value={data.url}
          onChange={(e) => {
            onChange({ url: e.target.value });
          }}
          onFocus={(e) => {
            // The sample address is a placeholder with a working code: typing replaces it.
            if (data.url === SAMPLE_PAYLOADS[QRType.URL]) e.currentTarget.select();
          }}
          onBlur={() => {
            // Leave a typo as typed, so the person can see and fix it.
            if (data.url && looksLikeWebAddress(data.url)) {
              onChange({ url: normalizeUrl(data.url) });
            }
          }}
          error={urlError}
          aria-describedby={hintsId('url-input')}
        />
        {notAnAddress && <FieldNotes fieldId="url-input" notes={[NOT_AN_ADDRESS_NOTE]} />}
        {!urlError && !notAnAddress && <LinkHints fieldId="url-input" address={data.url} />}
      </div>
    </div>
  );
};
