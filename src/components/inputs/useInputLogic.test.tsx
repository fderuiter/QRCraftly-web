import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useInputLogic, clearRetainedInputStates } from "./useInputLogic";
import { TYPE_TO_PRESET_LOGO } from "../../constants/presetLogos";
import { QRProvider, useQRStore } from "../../context/QRContext";
import {
  type QRConfig,
  QRType,
  QRStyle,
  QRErrorCorrectionLevel,
  SocialFormat,
  TemplateStyle,
  CryptoNetwork,
  type EmailData,
} from "../../types";

const createMockConfig = (type: QRType, value: string): QRConfig => ({
  value,
  type,
  fgColor: "#000000",
  bgColor: "#ffffff",
  style: QRStyle.STANDARD,
  logoUrl: null,
  logoSize: 0.15,
  logoPaddingStyle: "square",
  logoPadding: 1,
  logoBackgroundColor: "#ffffff",
  eyeColor: "#000000",
  errorCorrectionLevel: QRErrorCorrectionLevel.H,
  isBorderEnabled: false,
  borderSize: 0.05,
  borderColor: "#000000",
  borderStyle: "solid",
  borderText: "",
  borderTextPosition: "bottom-center",
  borderTextColor: "#000000",
  borderLogoUrl: null,
  borderLogoPosition: "bottom-right",
  socialFormat: SocialFormat.SQUARE_1_1,
  templateStyle: TemplateStyle.NONE,
});

describe("useInputLogic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRetainedInputStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should synchronize state with a valid external value change", () => {
    const config = createMockConfig(QRType.TEXT, "Initial Text");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    expect(result.current.inputProps.data).toEqual({ text: "Initial Text" });

    // Update config externally with a new text value
    const updatedConfig = createMockConfig(QRType.TEXT, "External Change");
    rerender({ cfg: updatedConfig });

    expect(result.current.inputProps.data).toEqual({ text: "External Change" });
  });

  it("should reset visual text and internal state to initialState synchronously when external reset occurs (Issue A)", () => {
    const config = createMockConfig(QRType.TEXT, "Stale Text");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    expect(result.current.inputProps.data).toEqual({ text: "Stale Text" });

    // Simulate clearing / resetting the form externally
    const clearedConfig = createMockConfig(QRType.TEXT, "");
    rerender({ cfg: clearedConfig });

    // It should reset synchronously to initialState
    expect(result.current.inputProps.data).toEqual({ text: "" });
  });

  it("should cancel active input timers upon receiving an external configuration change, avoiding overwrite (Issue B)", () => {
    const config = createMockConfig(QRType.TEXT, "Original State");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // User types: the first edit after a quiet spell is written at once, the next one in the
    // same burst waits for the burst to pause
    act(() => {
      result.current.inputProps.onChange({ text: "User Typed" });
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    act(() => {
      result.current.inputProps.onChange({ text: "User Typed Something" });
    });

    // The state updates locally immediately
    expect(result.current.inputProps.data).toEqual({ text: "User Typed Something" });

    // Before debounce timer (100ms) fires, an external reset or change occurs
    const externalConfig = createMockConfig(QRType.TEXT, "Original State Restored");
    rerender({ cfg: externalConfig });

    // Advancing timers by 200ms
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Stale typed value must not overwrite the restored/external state
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(result.current.inputProps.data).toEqual({ text: "Original State Restored" });
  });

  it("should validate input locally and block onChange propagation if value is invalid (Issue C)", () => {
    // Let's test WifiInput with invalid SSID (control character)
    const config = createMockConfig(QRType.WIFI, "WIFI:T:WPA;S:MyWiFi;P:secret;;");
    const onChange = vi.fn();

    const { result } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // Initial SSID state
    expect(result.current.inputProps.data).toMatchObject({ ssid: "MyWiFi" });

    // Change to include invalid control character
    act(() => {
      result.current.inputProps.onChange({ ssid: "MyWiFi\u0001Network" });
    });

    // Advance timers by 200ms to trigger debounce
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Validation should fail and prevent the onChange callback from propagating
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should validate URL input locally and block onChange propagation if URL is dangerous", () => {
    const config = createMockConfig(QRType.URL, "https://example.com");
    const onChange = vi.fn();

    const { result } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    expect(result.current.inputProps.data).toMatchObject({ url: "https://example.com" });

    // Change URL to a dangerous javascript URI
    act(() => {
      result.current.inputProps.onChange({ url: "javascript:alert(1)" });
    });

    // Advance timers by 200ms to trigger debounce
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Validation should fail and prevent the onChange callback from propagating
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should validate Email input locally and block onChange propagation if email, CC, or BCC is invalid", () => {
    const config = createMockConfig(QRType.EMAIL, "mailto:user@example.com?subject=&body=");
    const onChange = vi.fn();
    const onRefusedChange = vi.fn();

    const { result } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange, onRefusedChange),
      { initialProps: { cfg: config } }
    );

    expect((result.current.inputProps.data as EmailData).email).toBe("user@example.com");

    // Change email to malformed email address
    act(() => {
      result.current.inputProps.onChange({ email: "invalid-email" });
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    // Validation should fail, block onChange, and notify onRefusedChange(true)
    expect(onChange).not.toHaveBeenCalled();
    expect(onRefusedChange).toHaveBeenCalledWith(true);

    // Change CC to invalid address list
    act(() => {
      result.current.inputProps.onChange({ email: "user@example.com", cc: "cc1@example.com, not-an-email" });
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onRefusedChange).toHaveBeenCalledWith(true);

    // Change to valid emails in recipient, CC, and BCC
    act(() => {
      result.current.inputProps.onChange({
        email: "user@example.com",
        cc: "cc1@example.com, cc2@example.com",
        bcc: "bcc@example.com",
      });
    });

    act(() => {
      vi.advanceTimersByTime(200);
    });

    expect(onChange).toHaveBeenLastCalledWith({
      value: "mailto:user@example.com?cc=cc1%40example.com%2C%20cc2%40example.com&bcc=bcc%40example.com&subject=&body=",
    });
    expect(onRefusedChange).toHaveBeenLastCalledWith(false);
  });

  it("should validate vCard inputs locally, allow plain text schemes, block control chars and dangerous website URLs, and propagate clean edits", () => {
    const config = createMockConfig(QRType.VCARD, "BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane;;;\r\nFN:Jane Doe\r\nEND:VCARD");
    const onChange = vi.fn();

    const { result } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // Initial first name state
    expect(result.current.inputProps.data).toMatchObject({ firstName: "Jane" });

    // Change title to contain a colon/scheme (Javascript: The Good Parts) -> valid
    act(() => {
      result.current.inputProps.onChange({ title: "Javascript: The Good Parts" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // Change email to contain control characters -> blocked
    act(() => {
      result.current.inputProps.onChange({ email: "jane\x00@example.com" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onChange).toHaveBeenCalledTimes(1); // blocked

    // Change website to contain a dangerous scheme -> blocked
    act(() => {
      result.current.inputProps.onChange({ website: "javascript:alert(1)" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onChange).toHaveBeenCalledTimes(1); // blocked

    // Positive control: after refused edits, a clean edit must call onChange
    act(() => {
      result.current.inputProps.onChange({ email: "jane@example.com", website: "https://example.com" });
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("should preserve newly normalized URL state and push constructed value when swapping tabs", () => {
    const config = createMockConfig(QRType.URL, "http://google.com/");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // Initial state is normalized url
    expect(result.current.inputProps.data).toMatchObject({ url: "http://google.com/" });

    // Simulate tab swap: QRContext updates type to TEXT and value to empty string
    const textConfig = createMockConfig(QRType.TEXT, "");
    rerender({ cfg: textConfig });

    // The local state of URL should remain preserved in useInputLogic's inputStates under URL key,
    // and we should now be looking at TEXT state
    expect(result.current.inputProps.data).toMatchObject({ text: "" });

    // Simulate switching back to URL: QRContext updates type back to URL and value to empty string
    const backToUrlConfig = createMockConfig(QRType.URL, "");
    rerender({ cfg: backToUrlConfig });

    // It should detect the tab switch, preserve the local "http://google.com/" state, and push it back to the store
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ value: "http://google.com/" }));
  });

  it("should preserve uncommitted form state across generator route remounts via volatile cache", () => {
    const onChange1 = vi.fn();
    const urlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");

    // Route 1 (URL generator): user types uncommitted text
    const { result: urlHook, unmount: unmountUrl } = renderHook(() => useInputLogic(urlConfig, onChange1));
    act(() => {
      urlHook.current.inputProps.onChange({ url: "https://example.com/retained" });
    });
    expect(urlHook.current.inputProps.data).toEqual({ url: "https://example.com/retained" });
    unmountUrl(); // User navigates away to another route

    // Route 2 (WiFi generator): mounts as a new route instance
    const onChange2 = vi.fn();
    const wifiConfig = createMockConfig(QRType.WIFI, "https://qrcraftly.com");
    const { result: wifiHook, unmount: unmountWifi } = renderHook(() => useInputLogic(wifiConfig, onChange2));
    act(() => {
      wifiHook.current.inputProps.onChange({ ssid: "MyOfficeWiFi", password: "SecretPassword" });
    });
    expect(wifiHook.current.inputProps.data).toMatchObject({ ssid: "MyOfficeWiFi" });
    unmountWifi(); // User navigates away from WiFi route

    // Route 3: User returns to URL generator route (which starts with default config)
    const onChange3 = vi.fn();
    const returnUrlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");
    const { result: returnUrlHook } = renderHook(() => useInputLogic(returnUrlConfig, onChange3));

    // The returned hook should hydrate from retained input cache and push the constructed retained value
    expect(returnUrlHook.current.inputProps.data).toEqual({ url: "https://example.com/retained" });
    expect(onChange3).toHaveBeenCalledWith({ value: "https://example.com/retained" });
  });

  it("should preserve explicitly cleared empty state across route remounts", () => {
    const onChange1 = vi.fn();
    const urlConfig = createMockConfig(QRType.URL, "https://example.com");

    // Route 1 (URL generator): user clears the text
    const { result: urlHook, unmount: unmountUrl } = renderHook(() => useInputLogic(urlConfig, onChange1));
    act(() => {
      urlHook.current.inputProps.onChange({ url: "" });
    });
    expect(urlHook.current.inputProps.data).toEqual({ url: "" });
    unmountUrl();

    // Route 2: Return to URL route with default config
    const onChange2 = vi.fn();
    const defaultUrlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");
    const { result: returnUrlHook } = renderHook(() => useInputLogic(defaultUrlConfig, onChange2));

    // Retained cache should preserve the explicitly cleared state ("")
    expect(returnUrlHook.current.inputProps.data).toEqual({ url: "" });
    expect(onChange2).toHaveBeenCalledWith({ value: "" });
  });

  it("should clear retained input states when clearRetainedInputStates is called", () => {
    const onChange1 = vi.fn();
    const urlConfig = createMockConfig(QRType.URL, "https://example.com");

    const { result: urlHook, unmount } = renderHook(() => useInputLogic(urlConfig, onChange1));
    act(() => {
      urlHook.current.inputProps.onChange({ url: "https://custom.org" });
    });
    unmount();

    // Clear module memory
    clearRetainedInputStates();

    // Re-mount with default config
    const onChange2 = vi.fn();
    const defaultUrlConfig = createMockConfig(QRType.URL, "https://qrcraftly.com");
    const { result: freshHook } = renderHook(() => useInputLogic(defaultUrlConfig, onChange2));

    // Should fall back to default initial state rather than old custom value
    expect(freshHook.current.inputProps.data).toEqual({ url: "https://qrcraftly.com" });
  });

  describe("payment validation and refusal state", () => {
    it("emits refused state and blocks onChange when payment amount validation fails", () => {
      const config = createMockConfig(QRType.PAYMENT, "");
      const onChange = vi.fn();
      const onRefusedChange = vi.fn();

      const { result } = renderHook(() =>
        useInputLogic(config, onChange, onRefusedChange)
      );

      // Set SEPA network and an invalid amount with 3 decimal places
      act(() => {
        result.current.inputProps.onChange({
          network: CryptoNetwork.EPC_SEPA,
          iban: "DE89370400440532013000",
          name: "Jane Doe",
          amount: "12.345",
        });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onRefusedChange).toHaveBeenCalledWith(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("does not trigger refusal for advisory SEPA IBAN checksum warnings when name is present", () => {
      const config = createMockConfig(QRType.PAYMENT, "");
      const onChange = vi.fn();
      const onRefusedChange = vi.fn();

      const { result } = renderHook(() =>
        useInputLogic(config, onChange, onRefusedChange)
      );

      // DE88370400440532013000 has an invalid mod-97 checksum
      act(() => {
        result.current.inputProps.onChange({
          network: CryptoNetwork.EPC_SEPA,
          iban: "DE88370400440532013000",
          name: "Jane Doe",
        });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onRefusedChange).toHaveBeenLastCalledWith(false);
      expect(onChange).toHaveBeenCalledWith({
        value: "BCD\n002\n1\nSCT\n\nJane Doe\nDE88370400440532013000",
      });
    });

    it("keeps all-blank or whitespace-only SEPA form empty and not refused", () => {
      const config = createMockConfig(QRType.PAYMENT, "");
      const onChange = vi.fn();
      const onRefusedChange = vi.fn();

      const { result } = renderHook(() =>
        useInputLogic(config, onChange, onRefusedChange)
      );

      act(() => {
        result.current.inputProps.onChange({
          network: CryptoNetwork.EPC_SEPA,
          iban: "   ",
          name: "   ",
          amount: "   ",
          bic: "   ",
          label: "   ",
        });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onRefusedChange).toHaveBeenLastCalledWith(false);
      expect(onChange).toHaveBeenCalledWith({
        value: "",
      });
    });

    it("emits refused state and blocks onChange when SEPA beneficiary name is missing", () => {
      const config = createMockConfig(QRType.PAYMENT, "");
      const onChange = vi.fn();
      const onRefusedChange = vi.fn();

      const { result } = renderHook(() =>
        useInputLogic(config, onChange, onRefusedChange)
      );

      act(() => {
        result.current.inputProps.onChange({
          network: CryptoNetwork.EPC_SEPA,
          iban: "DE89370400440532013000",
          name: "",
        });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onRefusedChange).toHaveBeenCalledWith(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    it("generates payment payload without refusal when details are valid", () => {
      const config = createMockConfig(QRType.PAYMENT, "");
      const onChange = vi.fn();
      const onRefusedChange = vi.fn();

      const { result } = renderHook(() =>
        useInputLogic(config, onChange, onRefusedChange)
      );

      act(() => {
        result.current.inputProps.onChange({
          network: CryptoNetwork.EPC_SEPA,
          iban: "DE89370400440532013000",
          name: "Jane Doe",
          amount: "12.50",
        });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onRefusedChange).toHaveBeenLastCalledWith(false);
      expect(onChange).toHaveBeenCalledWith({
        value: "BCD\n002\n1\nSCT\n\nJane Doe\nDE89370400440532013000\nEUR12.50",
      });
    });

    it("does not trigger input refusal for advisory crypto checksum warnings", () => {
      const config = createMockConfig(QRType.PAYMENT, "");
      const onChange = vi.fn();
      const onRefusedChange = vi.fn();

      const { result } = renderHook(() =>
        useInputLogic(config, onChange, onRefusedChange)
      );

      // Address with invalid checksum
      act(() => {
        result.current.inputProps.onChange({
          network: CryptoNetwork.BITCOIN,
          address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN",
          amount: "0.1",
        });
      });

      act(() => {
        vi.advanceTimersByTime(200);
      });

      expect(onRefusedChange).toHaveBeenLastCalledWith(false);
      expect(onChange).toHaveBeenCalledWith({
        value: "bitcoin:1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfN?amount=0.1",
      });
    });
  });
});

describe("useInputLogic flush", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRetainedInputStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("applies a pending debounced edit immediately and only once", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useInputLogic(createMockConfig(QRType.TEXT, ""), onChange));

    const type = (text: string) =>
      act(() => {
        (result.current.inputProps as { onChange: (u: { text: string }) => void }).onChange({ text });
      });
    type("t");
    expect(onChange).toHaveBeenCalledTimes(1);
    type("typed");
    expect(onChange).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.flush();
    });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ value: "typed" });

    act(() => {
      vi.advanceTimersByTime(200);
      result.current.flush();
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does nothing when no edit is pending", () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useInputLogic(createMockConfig(QRType.TEXT, "x"), onChange));
    act(() => {
      result.current.flush();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("useInputLogic automatic preset logo placement", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearRetainedInputStates();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not auto-place preset logo when no store is present", () => {
    const onChange = vi.fn();
    const initialConfig = createMockConfig(QRType.URL, "https://example.com");

    const { rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: initialConfig } }
    );

    // Switch type to PHONE without a store
    const phoneConfig = createMockConfig(QRType.PHONE, "");
    phoneConfig.logoUrl = TYPE_TO_PRESET_LOGO[QRType.URL];
    rerender({ cfg: phoneConfig });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("automatically assigns matching preset logo and sets errorCorrectionLevel to H on QRType switch when store exists and logo is not overridden", async () => {
    const initialConfig = createMockConfig(QRType.URL, "https://example.com");

    const { result, rerender } = renderHook(
      ({ cfg }) => {
        const store = useQRStore();
        useInputLogic(cfg, vi.fn());
        return store;
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) => <QRProvider>{children}</QRProvider>,
        initialProps: { cfg: initialConfig },
      }
    );

    // Switch type to PHONE
    const phoneConfig = createMockConfig(QRType.PHONE, "");
    phoneConfig.logoUrl = TYPE_TO_PRESET_LOGO[QRType.URL];
    
    await act(async () => {
      rerender({ cfg: phoneConfig });
      await Promise.resolve();
    });

    expect(result.current.getState().config.logoUrl).toBe(TYPE_TO_PRESET_LOGO[QRType.PHONE]);
    expect(result.current.getState().config.errorCorrectionLevel).toBe(QRErrorCorrectionLevel.H);
  });

  it("clears logoUrl when switching to a QRType without a mapped preset logo", async () => {
    const initialConfig = createMockConfig(QRType.PHONE, "1234567890");

    const { result, rerender } = renderHook(
      ({ cfg }) => {
        const store = useQRStore();
        useInputLogic(cfg, vi.fn());
        return store;
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) => <QRProvider>{children}</QRProvider>,
        initialProps: { cfg: initialConfig },
      }
    );

    // Switch type to TEXT (which has null preset logo)
    const textConfig = createMockConfig(QRType.TEXT, "");
    textConfig.logoUrl = TYPE_TO_PRESET_LOGO[QRType.PHONE];

    await act(async () => {
      rerender({ cfg: textConfig });
      await Promise.resolve();
    });

    expect(result.current.getState().config.logoUrl).toBeNull();
  });

  it("preserves manual user logo removal across QRType switches", () => {
    const initialConfig = createMockConfig(QRType.URL, "https://example.com");

    const { result, rerender } = renderHook(
      ({ cfg }) => {
        const store = useQRStore();
        useInputLogic(cfg, vi.fn());
        return store;
      },
      {
        wrapper: ({ children }: { children: React.ReactNode }) => <QRProvider>{children}</QRProvider>,
        initialProps: { cfg: initialConfig },
      }
    );

    // Explicitly remove logo in store
    act(() => {
      result.current.updateConfig({ logoUrl: null });
    });
    expect(result.current.getState().isLogoOverridden).toBe(true);

    // Switch type to EMAIL
    const emailConfig = createMockConfig(QRType.EMAIL, "");
    emailConfig.logoUrl = null;
    rerender({ cfg: emailConfig });

    // Auto preset logo assignment should be skipped because user explicitly opted out
    expect(result.current.getState().config.logoUrl).toBeNull();
  });

  it("does not interrupt pending form input typing debounce when logoUrl changes", () => {
    const config = createMockConfig(QRType.TEXT, "Start");
    const onChange = vi.fn();

    const { result, rerender } = renderHook(
      ({ cfg }) => useInputLogic(cfg, onChange),
      { initialProps: { cfg: config } }
    );

    // User types in text input (first edit fires, second edit is debounced)
    act(() => {
      result.current.inputProps.onChange({ text: "Typed A" });
    });
    act(() => {
      result.current.inputProps.onChange({ text: "Typed B" });
    });

    // logoUrl changes externally (e.g., logo color or size preview)
    const logoUpdatedConfig = { ...config, logoUrl: "data:image/svg+xml;base64,sample" };
    rerender({ cfg: logoUpdatedConfig });

    // Advance debounce timer
    act(() => {
      vi.advanceTimersByTime(200);
    });

    // The debounced edit should still complete successfully
    expect(onChange).toHaveBeenLastCalledWith({ value: "Typed B" });
  });
});

