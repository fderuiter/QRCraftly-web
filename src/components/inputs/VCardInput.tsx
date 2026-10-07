import React, { useRef, useState } from "react";
import { VCardData } from "../../types";
import { TextField } from "../ui/FormFields";
import { LinkHints, hintsId } from "./FieldHints";
import { isDangerousUrl } from "../../utils/security";
import { FormBlock } from "../ui/FormBlock";
import { Button } from "../ui/Button";
import { Upload, X } from "lucide-react";
import { combineIds } from "../../utils/a11y";
import {
  GRID_TWO_COLUMNS_CLASSES,
  SUB_CONTAINER_SPACING_CLASSES,
} from "../ui/styles";

const MAX_PHOTO_SIZE_BYTES = 100 * 1024; // 100 KB

interface VCardInputProps {
  data: VCardData;
  onChange: (updates: Partial<VCardData>) => void;
}

export const VCardInput: React.FC<VCardInputProps> = ({ data, onChange }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const websiteError = data.website && isDangerousUrl(data.website)
    ? "Unsafe URL scheme or malicious protocol detected."
    : undefined;

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setPhotoError(null);
    if (file) {
      if (file.size > MAX_PHOTO_SIZE_BYTES) {
        setPhotoError("Image size must be under 100 KB.");
        e.target.value = "";
        onChange({ photo: "" });
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        onChange({ photo: result });
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    }
  };

  const handleRemovePhoto = () => {
    setPhotoError(null);
    onChange({ photo: "" });
  };

  return (
    <FormBlock legend="Contact Details (vCard)">
      <FormBlock legend="Profile Photo" isSubFieldset={true}>
        <div className="space-y-3">
          {data.photo ? (
            <div className="flex items-center gap-4">
              <img
                src={data.photo}
                alt="Profile preview"
                className="size-16 rounded-full border border-line bg-surface object-cover shadow-xs"
              />
              <div className="flex flex-col items-start gap-1">
                <Button
                  variant="error"
                  size="xs"
                  onClick={handleRemovePhoto}
                >
                  <X className="mr-1 size-3.5" aria-hidden="true" />
                  Remove Photo
                </Button>
                <p className="text-xs text-fg-muted">Uploaded profile photo</p>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  aria-describedby={combineIds("vcard-photo-help", photoError ? "vcard-photo-error" : undefined)}
                >
                  <Upload className="mr-1.5 size-4" aria-hidden="true" />
                  Upload Photo
                </Button>
                <span id="vcard-photo-help" className="text-xs text-fg-muted">
                  JPEG or PNG, max 100 KB
                </span>
              </div>
            </div>
          )}
          {photoError && (
            <p id="vcard-photo-error" role="alert" className="text-xs text-danger">
              {photoError}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={handlePhotoChange}
            aria-label="Upload profile photo"
          />
        </div>
      </FormBlock>

      <div className={GRID_TWO_COLUMNS_CLASSES}>
        <TextField
          id="vcard-firstname"
          name="firstName"
          label="First Name"
          autoComplete="given-name"
          maxLength={100}
          placeholder="e.g. Jane"
          value={data.firstName}
          onChange={(e) => onChange({ firstName: e.target.value })}
        />
        <TextField
          id="vcard-lastname"
          name="lastName"
          label="Last Name"
          autoComplete="family-name"
          maxLength={100}
          placeholder="e.g. Doe"
          value={data.lastName}
          onChange={(e) => onChange({ lastName: e.target.value })}
        />
      </div>

      <div className={GRID_TWO_COLUMNS_CLASSES}>
        <TextField
          id="vcard-phone"
          name="phone"
          label="Mobile Phone"
          autoComplete="tel"
          type="tel"
          maxLength={20}
          placeholder="+1 555 000 0000"
          value={data.phone}
          onChange={(e) => onChange({ phone: e.target.value })}
        />
        <TextField
          id="vcard-email"
          name="email"
          label="Email"
          autoComplete="email"
          type="email"
          maxLength={254}
          placeholder="name@example.com"
          value={data.email}
          onChange={(e) => onChange({ email: e.target.value })}
        />
      </div>

      <TextField
        id="vcard-org"
        name="organization"
        label="Company / Organization"
        autoComplete="organization"
        maxLength={100}
        placeholder="e.g. Acme Corp"
        value={data.organization}
        onChange={(e) => onChange({ organization: e.target.value })}
      />

      <TextField
        id="vcard-title"
        name="title"
        label="Job Title"
        autoComplete="organization-title"
        maxLength={100}
        placeholder="e.g. Software Engineer"
        value={data.title}
        onChange={(e) => onChange({ title: e.target.value })}
      />

      <TextField
        id="vcard-website"
        name="website"
        label="Website"
        autoComplete="url"
        type="url"
        maxLength={2048}
        placeholder="https://example.com"
        value={data.website}
        onChange={(e) => onChange({ website: e.target.value })}
        error={websiteError}
        aria-describedby={hintsId("vcard-website")}
      />
      {!websiteError && <LinkHints fieldId="vcard-website" address={data.website} />}

      <FormBlock legend="Address" isSubFieldset={true}>
        <div className={SUB_CONTAINER_SPACING_CLASSES}>
          <TextField
            id="vcard-street"
            name="street"
            label="Street"
            autoComplete="street-address"
            maxLength={100}
            placeholder="Street"
            value={data.street}
            onChange={(e) => onChange({ street: e.target.value })}
          />
          <div className={GRID_TWO_COLUMNS_CLASSES}>
            <TextField
              id="vcard-city"
              name="city"
              label="City"
              autoComplete="address-level2"
              maxLength={100}
              placeholder="City"
              value={data.city}
              onChange={(e) => onChange({ city: e.target.value })}
            />
            <TextField
              id="vcard-zip"
              name="zip"
              label="ZIP / Postal Code"
              autoComplete="postal-code"
              maxLength={20}
              placeholder="ZIP"
              value={data.zip}
              onChange={(e) => onChange({ zip: e.target.value })}
            />
            <TextField
              id="vcard-country"
              name="country"
              label="Country"
              autoComplete="country-name"
              maxLength={100}
              placeholder="Country"
              value={data.country}
              onChange={(e) => onChange({ country: e.target.value })}
            />
          </div>
        </div>
      </FormBlock>
    </FormBlock>
  );
};
