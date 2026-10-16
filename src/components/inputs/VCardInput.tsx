import React from "react";
import type { VCardData } from "../../types";
import { TextField, SelectField } from "../ui/FormFields";
import { LinkHints, hintsId } from "./FieldHints";
import { isDangerousUrl } from "../../utils/security";
import { CONTAINMENT_PROFILES } from "@/packages/qr-payload";
import { FormBlock } from "../ui/FormBlock";
import {
  GRID_TWO_COLUMNS_CLASSES,
  SUB_CONTAINER_SPACING_CLASSES,
} from "../ui/styles";

interface VCardInputProps {
  data: VCardData;
  onChange: (updates: Partial<VCardData>) => void;
}

const getFieldError = (value: string | undefined): string | undefined => {
  if (!value) return undefined;
  if (isDangerousUrl(value)) {
    return "Unsafe URL scheme or malicious protocol detected.";
  }
  if (CONTAINMENT_PROFILES.TEXT_NO_CONTROL.test(value)) {
    return "Contains invalid control or zero-width characters.";
  }
  return undefined;
};

export const VCardInput: React.FC<VCardInputProps> = ({ data, onChange }) => {
  const firstNameError = getFieldError(data.firstName);
  const lastNameError = getFieldError(data.lastName);
  const phoneError = getFieldError(data.phone);
  const emailError = getFieldError(data.email);
  const orgError = getFieldError(data.organization);
  const titleError = getFieldError(data.title);
  const websiteError = getFieldError(data.website);
  const streetError = getFieldError(data.street);
  const cityError = getFieldError(data.city);
  const zipError = getFieldError(data.zip);
  const countryError = getFieldError(data.country);

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
