import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { axe } from "../../../tests/utils/axe";
import { TypeSelector } from "./TypeSelector";
import { QRType } from "../../types";
import { QR_TYPE_ROUTES } from "../../data/navigation";

describe("TypeSelector link navigation", () => {
  it("renders a labelled navigation landmark containing a list of links", () => {
    render(<TypeSelector currentType={QRType.URL} />);
    const nav = screen.getByRole("navigation", { name: "QR code types" });
    const list = within(nav).getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(12);
    expect(within(nav).getAllByRole("link")).toHaveLength(12);
  });

  it("does not use tab semantics or roving tabIndex", () => {
    const { container } = render(<TypeSelector currentType={QRType.WIFI} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(container.querySelector("[tabindex]")).toBeNull();
    expect(container.querySelector("[aria-selected]")).toBeNull();
  });

  it("links each type to its dedicated route", () => {
    render(<TypeSelector currentType={QRType.URL} />);
    expect(screen.getByRole("link", { name: "URL" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Text" })).toHaveAttribute("href", "/text-qr-code");
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute("href", "/vcard-qr-code");
    expect(screen.getByRole("link", { name: "Social" })).toHaveAttribute("href", QR_TYPE_ROUTES[QRType.SOCIAL]);
  });

  it("marks only the current route with aria-current='page'", () => {
    render(<TypeSelector currentType={QRType.WIFI} />);
    const current = screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page");
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveAccessibleName("WiFi");
    expect(screen.getByRole("link", { name: "URL" })).not.toHaveAttribute("aria-current");
  });

  it("styles the current link with a non-colour cue in both themes", () => {
    render(<TypeSelector currentType={QRType.TEXT} />);
    const current = screen.getByRole("link", { name: "Text" });
    // A filled tint in theme tokens plus a check badge, distinct from the focus ring.
    expect(current.className).toContain("bg-accent-soft");
    expect(current.className).toContain("border-accent-strong");
    expect(current.querySelector("svg.lucide-check")).not.toBeNull();
    expect(screen.getByRole("link", { name: "URL" }).querySelector("svg.lucide-check")).toBeNull();
  });

  it("does not intercept arrow keys", () => {
    render(<TypeSelector currentType={QRType.URL} />);
    const link = screen.getByRole("link", { name: "URL" });
    link.focus();
    const notCancelled = fireEvent.keyDown(link, { key: "ArrowRight" });
    expect(notCancelled).toBe(true);
    expect(document.activeElement).toBe(link);
  });

  it("has no axe violations", async () => {
    const { container } = render(<TypeSelector currentType={QRType.EMAIL} />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
