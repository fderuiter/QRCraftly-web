import React, { useState, useId, useEffect, useRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from './Button';

/**
 * Props for {@link AccordionItem}.
 */
interface AccordionItemProps {
  /** Visible label of the disclosure button (also names the panel region). */
  title: string;
  /** Panel content. It stays mounted while collapsed so local state survives toggling. */
  children: React.ReactNode;
  /** Whether the panel starts expanded. */
  defaultOpen?: boolean;
  /** Wraps the disclosure button in a heading of this level so the section appears in the document outline. */
  headingLevel?: 2 | 3 | 4;
  /** Optional stable id for the panel (defaults to a generated id). */
  panelId?: string;
  /** Called with the new expanded state whenever the section is toggled. */
  onOpenChange?: (open: boolean) => void;
  /**
   * Opens the panel each time this number changes (a page's call to action uses it). Leave it
   * undefined for a section the page does not open.
   */
  openRequest?: number;
}

/**
 * A single disclosure section: a button exposing `aria-expanded`/`aria-controls` and a labelled
 * region. Collapsed panels are hidden with the `hidden` attribute rather than unmounted, so
 * form state inside them is kept and the content remains in server-rendered HTML. A URL hash
 * that points inside a collapsed panel opens it and scrolls the target into view.
 * @param props - Component props.
 * @param props.title - Visible label of the disclosure button.
 * @param props.children - Content.
 * @param props.defaultOpen - Whether the panel starts expanded.
 * @param props.headingLevel - Heading level wrapping the button.
 * @param props.panelId - Optional stable panel id.
 * @param props.onOpenChange - Called with the new expanded state.
 * @param props.openRequest - Opens the panel each time this number changes.
 * @returns The disclosure section.
 */
export function AccordionItem({ title, children, defaultOpen = false, headingLevel, panelId: panelIdProp, onOpenChange, openRequest }: AccordionItemProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  // A new open request opens the panel during this render, so it is open when the caller's effects run.
  const [seenRequest, setSeenRequest] = useState(openRequest);
  if (openRequest !== seenRequest) {
    setSeenRequest(openRequest);
    if (openRequest !== undefined) setIsOpen(true);
  }
  const id = useId();
  const buttonId = `accordion-button-${id}`;
  const panelId = panelIdProp ?? `accordion-panel-${id}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });
  useEffect(() => {
    if (openRequest !== undefined) onOpenChangeRef.current?.(true);
  }, [openRequest]);

  // A link to something inside a collapsed panel (such as a heading anchor) opens it.
  useEffect(() => {
    const openForHash = () => {
      const targetId = decodeURIComponent(window.location.hash.slice(1));
      const target = targetId ? document.getElementById(targetId) : null;
      const panel = rootRef.current?.querySelector(':scope > [role="region"]');
      if (!target || !panel?.contains(target) || !panel.hasAttribute('hidden')) return;
      setIsOpen(true);
      onOpenChangeRef.current?.(true);
      // Scroll once the panel is shown and again when its height animation ends.
      requestAnimationFrame(() => target.scrollIntoView());
      panel.addEventListener('transitionend', () => target.scrollIntoView(), { once: true });
    };
    openForHash();
    window.addEventListener('hashchange', openForHash);
    return () => window.removeEventListener('hashchange', openForHash);
  }, []);

  const button = (
    <Button
      id={buttonId}
      variant="disclosure"
      onClick={() => {
        const next = !isOpen;
        setIsOpen(next);
        onOpenChange?.(next);
      }}
      aria-expanded={isOpen}
      aria-controls={panelId}
    >
      <span className="font-semibold text-fg">{title}</span>
      <ChevronDown
        aria-hidden="true"
        className={`size-5 shrink-0 text-fg-muted motion-safe:transition-transform motion-safe:duration-(--duration-base) ${isOpen ? 'rotate-180' : ''}`}
      />
    </Button>
  );

  const Heading = headingLevel ? (`h${headingLevel}` as const) : null;

  return (
    <div ref={rootRef} className="mb-4 overflow-hidden rounded-xl border border-line bg-surface-raised transition-colors duration-(--duration-slow)">
      {Heading ? <Heading className="m-0 text-base">{button}</Heading> : button}
      <div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        hidden={!isOpen}
        className="disclosure-panel text-fg-muted"
      >
        {/* The row animates 0fr to 1fr (see .disclosure-panel in index.css); the padding lives inside it. */}
        <div>
          <div className="px-5 pb-4">{children}</div>
        </div>
      </div>
    </div>
  );
}

/**
 * Props for {@link Accordion}.
 */
interface AccordionProps {
  /** One or more {@link AccordionItem}s. */
  children: React.ReactNode;
}

/**
 * Vertical group of independent disclosure sections.
 * @param props - Component props.
 * @param props.children - Content.
 * @returns The accordion container.
 */
export function Accordion({ children }: AccordionProps) {
  return <div className="w-full">{children}</div>;
}
