import React, { useState } from "react";
import type { VCardData } from "../../types";
import { TextField, SelectField } from "../ui/FormFields";
import { LinkHints, hintsId } from "./FieldHints";
import { vCardFieldError, VCARD_SOCIAL_FIELDS, VCARD_SOCIAL_NETWORKS } from "@/packages/qr-payload";
import { FormBlock } from "../ui/FormBlock";
import {
  GRID_TWO_COLUMNS_CLASSES,
  SUB_CONTAINER_SPACING_CLASSES,
} from "../ui/styles";

interface VCardInputProps {
  data: VCardData;
  onChange: (updates: Partial<VCardData>) => void;
}

export const VCardInput: React.FC<VCardInputProps> = ({ data, onChange }) => {
  const firstNameError = vCardFieldError("firstName", data.firstName);
  const lastNameError = vCardFieldError("lastName", data.lastName);
  const phoneError = vCardFieldError("phone", data.phone);
  const emailError = vCardFieldError("email", data.email);
  const orgError = vCardFieldError("organization", data.organization);
  const titleError = vCardFieldError("title", data.title);
  const websiteError = vCardFieldError("website", data.website);
  const photoError = vCardFieldError("photo", data.photo);
  const streetError = vCardFieldError("street", data.street);
  const cityError = vCardFieldError("city", data.city);
  const zipError = vCardFieldError("zip", data.zip);
  const countryError = vCardFieldError("country", data.country);
  // A half-typed profile link is not yet on its network's host, so its error waits for blur (#1435).
  const [blurredSocials, setBlurredSocials] = useState<ReadonlySet<string>>(() => new Set());
  const isMeCard = data.version === "mecard";

  return (
    <FormBlock legend="Contact Details (vCard)">
      <SelectField
        id="vcard-version"
        label="Contact Format"
        value={data.version || "3.0"}
        onChange={(e) =>
          onChange({ version: e.target.value as VCardData["version"] })
        }
      >
        <option value="3.0">vCard 3.0 (Standard)</option>
        <option value="4.0">vCard 4.0 (Modern RFC 6350)</option>
        <option value="2.1">vCard 2.1 (Legacy)</option>
        <option value="mecard">MECard (Compact / NTT DoCoMo)</option>
      </SelectField>

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
          error={firstNameError}
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
          error={lastNameError}
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
          error={phoneError}
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
          error={emailError}
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
        error={orgError}
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
        error={titleError}
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

      {!isMeCard && (
        <>
          <TextField
            id="vcard-photo"
            name="photo"
            label="Profile Photo URL"
            autoComplete="url"
            type="url"
            maxLength={2048}
            placeholder="https://example.com/avatar.jpg"
            value={data.photo || ""}
            onChange={(e) => onChange({ photo: e.target.value })}
            error={photoError}
            aria-describedby={hintsId("vcard-photo")}
          />
          <p className="mt-1 text-xs text-fg-muted">Some phones don't load linked photos.</p>
          {!photoError && <LinkHints fieldId="vcard-photo" address={data.photo || ""} />}
        </>
      )}

      <FormBlock legend="Social Profiles" isSubFieldset={true}>
        {isMeCard ? (
          <p className="text-xs text-fg-muted">Social profiles are saved in vCard formats only. MECard leaves them out.</p>
        ) : (
          <div className={GRID_TWO_COLUMNS_CLASSES}>
            {VCARD_SOCIAL_FIELDS.map((field) => {
              const network = VCARD_SOCIAL_NETWORKS[field];
              return (
                <TextField
                  key={field}
                  id={`vcard-${field}`}
                  name={field}
                  label={network.name}
                  contextualLabel="Optional"
                  autoComplete="off"
                  maxLength={2048}
                  placeholder={`@user or ${network.hosts[0]}/…`}
                  value={data[field] || ""}
                  onChange={(e) => onChange({ [field]: e.target.value })}
                  onBlur={() => setBlurredSocials((prev) => new Set(prev).add(field))}
                  error={blurredSocials.has(field) ? vCardFieldError(field, data[field]) : undefined}
                />
              );
            })}
          </div>
        )}
      </FormBlock>

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
            error={streetError}
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
              error={cityError}
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
              error={zipError}
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
              error={countryError}
            />
          </div>
        </div>
      </FormBlock>
    </FormBlock>
  );
};
