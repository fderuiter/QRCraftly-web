import React from "react";
import { UrlData } from "../../types";
import { TextField } from "../ui/FormFields";
import { normalizeUrl } from "../../utils/url";
import { describeViolation } from "@/packages/qr-payload";
import { QRType } from "../../types";
import { findBlockingViolation } from "./linkViolations";

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
          onBlur={() => {
            if (data.url) {
              onChange({ url: normalizeUrl(data.url) });
            }
          }}
          error={urlError}
        />
      </div>
    </div>
  );
};
