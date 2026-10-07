import React, { useState } from "react";
import { Button } from "../ui/Button";
import { LocationData } from "../../types";
import { TextField } from "../ui/FormFields";
import { FormBlock } from "../ui/FormBlock";
import { announcePolitely } from "../../utils/a11y";

interface LocationInputProps {
  data: LocationData;
  onChange: (updates: Partial<LocationData>) => void;
}

/** Human-readable messages for GeolocationPositionError codes. */
const GEOLOCATION_ERROR_MESSAGES: Record<number, string> = {
  1: "Location access denied. Please allow location permission in your browser.",
  2: "Location unavailable. Your device could not determine its position.",
  3: "Location request timed out. Please try again.",
};

export const LocationInput: React.FC<LocationInputProps> = ({
  data,
  onChange,
}) => {
  const [addressQuery, setAddressQuery] = useState("");
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  const handleSearchAddress = async () => {
    if (!addressQuery.trim()) {
      setAddressError("Please enter an address to search.");
      return;
    }

    setIsSearchingAddress(true);
    setAddressError(null);

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          addressQuery.trim(),
        )}&limit=1`,
      );

      if (!response.ok) {
        throw new Error("Network error while searching address.");
      }

      const results = await response.json();

      if (Array.isArray(results) && results.length > 0) {
        const { lat, lon } = results[0];
        onChange({
          latitude: String(lat),
          longitude: String(lon),
        });
        announcePolitely("Location coordinates populated");
        setAddressError(null);
      } else {
        setAddressError("No location found for the specified address.");
      }
    } catch {
      setAddressError(
        "Failed to search address. Please check your network connection and try again.",
      );
    } finally {
      setIsSearchingAddress(false);
    }
  };

  const handleGetCurrentLocation = () => {
    if (!navigator.geolocation) {
      setGeoError("Geolocation is not supported by your browser.");
      return;
    }

    setIsLoading(true);
    setGeoError(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLoading(false);
        setGeoError(null);
        onChange({
          latitude: String(position.coords.latitude),
          longitude: String(position.coords.longitude),
        });
        announcePolitely("Location coordinates populated");
      },
      (err) => {
        setIsLoading(false);
        setGeoError(
          GEOLOCATION_ERROR_MESSAGES[err.code] ??
            "An unknown error occurred while fetching location.",
        );
      },
      { timeout: 10000 },
    );
  };

  return (
    <FormBlock legend="Geo-Location">
      <TextField
        id="location-address-search"
        label="Search Address"
        type="text"
        placeholder="e.g. 1600 Pennsylvania Ave NW, Washington, DC"
        value={addressQuery}
        onChange={(e) => setAddressQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSearchAddress();
          }
        }}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={handleSearchAddress}
        disabled={isSearchingAddress}
        aria-busy={isSearchingAddress}
        size="sm"
        fullWidth
        data-testid="search-address-button"
      >
        {isSearchingAddress ? "Searching address…" : "Search Address"}
      </Button>
      {addressError && (
        <p role="alert" className="text-xs text-danger">
          {addressError}
        </p>
      )}
      <TextField
        id="location-latitude"
        label="Latitude"
        type="text"
        inputMode="decimal"
        placeholder="-90 to 90 (e.g. 40.7128)"
        maxLength={20}
        value={data.latitude}
        onChange={(e) => onChange({ latitude: e.target.value })}
      />
      <TextField
        id="location-longitude"
        label="Longitude"
        type="text"
        inputMode="decimal"
        placeholder="-180 to 180 (e.g. -74.0060)"
        maxLength={21}
        // Longitude has one extra character vs latitude because it has 3 integer digits
        // (-180) versus latitude's 2 (-90), requiring one more character for the sign+digits.
        value={data.longitude}
        onChange={(e) => onChange({ longitude: e.target.value })}
      />
      <Button
        type="button"
        variant="secondary"
        onClick={handleGetCurrentLocation}
        disabled={isLoading}
        aria-busy={isLoading}
        size="sm"
        fullWidth
        data-testid="use-current-location"
      >
        {isLoading ? "Fetching location…" : "Use Current Location"}
      </Button>
      {geoError && (
        <p role="alert" className="text-xs text-danger">
          {geoError}
        </p>
      )}
    </FormBlock>
  );
};
