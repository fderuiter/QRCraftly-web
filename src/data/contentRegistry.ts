import { getPublicDomain, getSanitizedPath } from "../utils/metadataEngine";
import { landingPageMeta } from "./landingPageMeta";

export enum SchemaType {
  SoftwareApplication = "SoftwareApplication",
  WebApplication = "WebApplication",
  AboutPage = "AboutPage",
  FAQPage = "FAQPage",
  HowTo = "HowTo"
}

export enum SchemaCategory {
  UtilitiesApplication = "UtilitiesApplication",
  BusinessApplication = "BusinessApplication",
  SocialNetworkingApplication = "SocialNetworkingApplication",
  TravelApplication = "TravelApplication",
  DeveloperApplication = "DeveloperApplication"
}

export enum TargetPersona {
  HealthcareLegal = "Healthcare & Legal",
  SecurityConsciousEnterprise = "Security-Conscious Enterprise"
}

export enum StrategicValueCategory {
  ZeroTransitPrivacySovereignty = "Zero-Transit Privacy Sovereignty",
  AsynchronousWebWorkerDiagnostics = "Asynchronous Web Worker Diagnostics"
}

export interface ToolContent {
  id: string;
  name: string;
  url: string;
  description: string;
  seoTitle?: string;
  /** Visible H1 on generator pages; falls back to the page's own title. */
  heading?: string;
  /** Opening paragraph shown above the how-to steps. */
  intro?: string;
  image: string;
  imageAlt: string;
  ogImage?: string;
  ogImageAlt?: string;
  features: string[];
  schemaType: SchemaType | SchemaType[];
  schemaCategory: SchemaCategory;
  personas: TargetPersona[];
  valueProposition: StrategicValueCategory;
}

export interface AuxiliaryContent {
  id: string;
  name: string;
  seoTitle: string;
  description: string;
  image: string;
  imageAlt: string;
  ogImage?: string;
  ogImageAlt?: string;
  personas: TargetPersona[];
  valueProposition: StrategicValueCategory;
}

/**
 * Type guard enforcing mandatory Open Graph image attributes on a content definition.
 */
export function hasValidOgImage<T extends { image?: string; imageAlt?: string; ogImage?: string; ogImageAlt?: string }>(
  item: T
): item is T & { image: string; imageAlt: string } {
  const img = item.image || item.ogImage;
  const alt = item.imageAlt || item.ogImageAlt;
  return typeof img === 'string' && img.trim().length > 0 && typeof alt === 'string' && alt.trim().length > 0;
}

/**
 * Type guard checking if an unknown object is a valid ToolContent with mandatory OG image attributes.
 */
export function isToolContent(item: unknown): item is ToolContent {
  if (!item || typeof item !== 'object') return false;
  const tool = item as Partial<ToolContent>;
  return (
    typeof tool.id === 'string' &&
    typeof tool.name === 'string' &&
    typeof tool.description === 'string' &&
    typeof tool.image === 'string' && tool.image.trim().length > 0 &&
    typeof tool.imageAlt === 'string' && tool.imageAlt.trim().length > 0
  );
}

/**
 * Builds the registry entry of a landing page from its copy (#1035, #1036, #1037). The page's
 * share image, address and schema.org type come from here, so each page needs one copy block.
 */
function landingEntry(id: string): ToolContent {
  const copy = landingPageMeta[id];
  return {
    id,
    name: copy.name,
    url: getPublicDomain() + "/" + id,
    description: copy.description,
    seoTitle: copy.seoTitle,
    heading: copy.heading,
    image: `/og/${id}.png`,
    imageAlt: copy.imageAlt,
    features: copy.features,
    schemaType: [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    schemaCategory: SchemaCategory.UtilitiesApplication,
    personas: [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    valueProposition: StrategicValueCategory.ZeroTransitPrivacySovereignty,
  };
}

export const contentRegistry: Record<string, ToolContent> = {
  "about": {
    "id": "about",
    "name": "About QRCraftly",
    "url": getPublicDomain() + "/about",
    "description": "Learn about QRCraftly's mission to provide a free, secure, and open-source QR code generator with privacy-first architecture.",
    "seoTitle": "About QRCraftly - Privacy & Open Source",
    "image": "/og/about.png",
    "imageAlt": "About QRCraftly - Privacy & Open Source",
    "features": [],
    "schemaType": SchemaType.AboutPage,
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "free-forever": {
    "id": "free-forever",
    "name": "The QRCraftly Pledge",
    "url": getPublicDomain() + "/free-forever",
    "description": "Free QR codes that never expire. No sign-up, no ads, nothing leaves your browser. QRCraftly will shut down before it ever becomes ad supported.",
    "seoTitle": "Free QR Codes: No Ads, No Tracking, Never Expire - QRCraftly",
    "image": "/og/free-forever.png",
    "imageAlt": "The QRCraftly Pledge: no ads, no tracking, free forever",
    "features": [
      "No Ads, Ever",
      "No Tracking or Analytics",
      "Entirely Client-Side",
      "Completely Free, No Sign-Up"
    ],
    "schemaType": SchemaType.AboutPage,
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "email-qr-code": {
    "id": "email-qr-code",
    "name": "Email QR Code Generator",
    "url": getPublicDomain() + "/email-qr-code",
    "description": "Make an email QR code in seconds. Scanning opens a ready-to-send message. Free forever, no ads, no sign-up, and your text stays in your browser.",
    "seoTitle": "Free Email QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Email QR Code Generator",
    "image": "/og/email-qr-code.png",
    "imageAlt": "Preview of the Email QR Code Generator tool",
    "features": [
      "Generate Pre-filled Emails",
      "Secure Client-Side",
      "Custom Design"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "event-qr-code": {
    "id": "event-qr-code",
    "name": "Event QR Code Generator",
    "url": getPublicDomain() + "/event-qr-code",
    "description": "Make a calendar event QR code in seconds. Guests add it with one scan. Free forever, no ads, no sign-up, and your details stay in your browser.",
    "seoTitle": "Free Event QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Calendar Event QR Code Generator",
    "image": "/og/event-qr-code.png",
    "imageAlt": "Preview of the Event QR Code Generator tool",
    "features": [
      "Generate Calendar Event QR",
      "Secure Client-Side",
      "Custom Design"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "index": {
    "id": "index",
    "name": "QRCraftly",
    "url": getPublicDomain(),
    "description": "Make free QR codes that never expire. No sign-up, no ads, no tracking: every code is made in your browser. Add colours, logos and image mosaics.",
    "seoTitle": "Free QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free QR Code Generator",
    "intro": "QRCraftly makes static QR codes that work forever: no trial that switches your printed codes off, no account, no watermark and no ads. Everything is generated in your browser, so your links, Wi-Fi passwords and contact details never reach our servers. Style your code with colours, shapes, a logo or your own image, and check that it scans before you download it.",
    "image": "/og/index.png",
    "imageAlt": "Preview of the QRCraftly Free QR Code Generator",
    "features": [
      "Custom QR Codes",
      "WiFi QR Codes",
      "vCard",
      "Secure Client-Side Generation",
      "Artistic Styles"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "location-qr-code": {
    "id": "location-qr-code",
    "name": "Location QR Code Generator",
    "url": getPublicDomain() + "/location-qr-code",
    "description": "Make a location QR code in seconds. Scanning opens the place in a maps app. Free forever, no ads, no sign-up, and nothing is uploaded.",
    "seoTitle": "Free Location QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Location QR Code Generator",
    "image": "/og/location-qr-code.png",
    "imageAlt": "Preview of the Location QR Code Generator tool",
    "features": [
      "Generate Location QR",
      "Secure Client-Side",
      "Custom Design"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "meeting-qr-code": {
    "id": "meeting-qr-code",
    "name": "Meeting QR Code Generator",
    "url": getPublicDomain() + "/meeting-qr-code",
    "description": "Make a meeting QR code in seconds. Zoom, Teams or Meet links open with a scan. Free forever, no ads, no sign-up, and your link stays in your browser.",
    "seoTitle": "Free Meeting QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Meeting QR Code Generator",
    "image": "/og/meeting-qr-code.png",
    "imageAlt": "Preview of the Meeting QR Code Generator tool",
    "features": [
      "Generate Virtual Meeting QR",
      "Zoom/Teams/Meet Support",
      "Secure Client-Side"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "payment-qr-code": {
    "id": "payment-qr-code",
    "name": "Payment QR Code Generator",
    "url": getPublicDomain() + "/payment-qr-code",
    "description": "Make a crypto payment QR code in seconds. Bitcoin, Ethereum, Solana and Litecoin. Free forever, no ads, no sign-up, and your address stays in your browser.",
    "seoTitle": "Free Crypto Payment QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Crypto Payment QR Code Generator",
    "image": "/og/payment-qr-code.png",
    "imageAlt": "Preview of the Payment QR Code Generator tool",
    "features": [
      "Generate Crypto Payment QR",
      "Bitcoin/Ethereum Support",
      "Secure Client-Side"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.BusinessApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "phone-qr-code": {
    "id": "phone-qr-code",
    "name": "Phone QR Code Generator",
    "url": getPublicDomain() + "/phone-qr-code",
    "description": "Make a phone QR code in seconds. Scanning opens the dialer with your number ready. Free forever, no ads, no sign-up, and nothing is uploaded.",
    "seoTitle": "Free Phone QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Phone QR Code Generator",
    "image": "/og/phone-qr-code.png",
    "imageAlt": "Preview of the Phone QR Code Generator tool",
    "features": [
      "Generate Click-to-Call QR",
      "Secure Client-Side",
      "Custom Design"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "sms-qr-code": {
    "id": "sms-qr-code",
    "name": "SMS QR Code Generator",
    "url": getPublicDomain() + "/sms-qr-code",
    "description": "Make an SMS QR code in seconds. Scanning opens a text with your number and message filled in. Free forever, no ads, no sign-up.",
    "seoTitle": "Free SMS QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free SMS QR Code Generator",
    "image": "/og/sms-qr-code.png",
    "imageAlt": "Preview of the SMS QR Code Generator tool",
    "features": [
      "Generate Pre-filled SMS",
      "Secure Client-Side",
      "Custom Design"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "social-qr-code": {
    "id": "social-qr-code",
    "name": "Social QR Code Generator",
    "url": getPublicDomain() + "/social-qr-code",
    "description": "Make a social media QR code in seconds. Opens your Instagram, X or TikTok profile. Free forever, no ads, no sign-up, and your handle stays in your browser.",
    "seoTitle": "Free Social Media QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Social Media QR Code Generator",
    "image": "/og/social-qr-code.png",
    "imageAlt": "Preview of the Social QR Code Generator tool",
    "features": [
      "Generate Social Profile QR",
      "Instagram/Twitter/TikTok Links",
      "Secure Client-Side"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.SocialNetworkingApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "bulk-csv-qr-code": {
    "id": "bulk-csv-qr-code",
    "name": "Bulk CSV Batch QR Code Generator",
    "url": getPublicDomain() + "/bulk-csv-qr-code",
    "description": "Generate bulk batch QR codes from CSV or TXT files directly in your browser. Download as ZIP archive.",
    "seoTitle": "Free Bulk CSV Batch QR Code Generator | Privacy First - QRCraftly",
    "image": "/og/bulk-csv-qr-code.png",
    "imageAlt": "Preview of Bulk CSV Batch QR Code Generator tool",
    "features": [
      "Batch CSV QR Generation",
      "ZIP Package Download",
      "Zero Network Privacy"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "text-qr-code": {
    "id": "text-qr-code",
    "name": "Text QR Code Generator",
    "url": getPublicDomain() + "/text-qr-code",
    "description": "Make a text QR code in seconds. Scanning shows your text as written. Free forever, no ads, no sign-up, and your text never leaves your browser.",
    "seoTitle": "Free Text QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free Text QR Code Generator",
    "image": "/og/text-qr-code.png",
    "imageAlt": "Preview of the Text QR Code Generator tool",
    "features": [
      "Convert Text to QR",
      "Secure Client-Side",
      "Custom Design"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "vcard-qr-code": {
    "id": "vcard-qr-code",
    "name": "vCard QR Code Generator",
    "url": getPublicDomain() + "/vcard-qr-code",
    "description": "Make a vCard QR code in seconds. People save your contact with one scan. Free forever, no ads, no sign-up, and your details stay in your browser.",
    "seoTitle": "Free vCard QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free vCard QR Code Generator",
    "image": "/og/vcard-qr-code.png",
    "imageAlt": "Preview of the vCard QR Code Generator tool",
    "features": [
      "Generate vCard Contact QR",
      "Secure Client-Side",
      "Custom Design"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.BusinessApplication,
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "wifi-qr-code": {
    "id": "wifi-qr-code",
    "name": "WiFi QR Code Generator",
    "url": getPublicDomain() + "/wifi-qr-code",
    "description": "Make a Wi-Fi QR code in seconds. Guests join by scanning. Free forever, no ads, no sign-up, and your password never leaves your browser.",
    "seoTitle": "Free WiFi QR Code Generator: No Sign-up, Never Expires | QRCraftly",
    "heading": "Free WiFi QR Code Generator",
    "image": "/og/wifi-qr-code.png",
    "imageAlt": "Preview of the WiFi QR Code Generator tool",
    "features": [
      "Generate WiFi Access QR Codes",
      "WPA/WPA2 Support",
      "Hidden SSID Support"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "file-transfer": {
    "id": "file-transfer",
    "name": "Animated QR File Transfer",
    "url": getPublicDomain() + "/file-transfer",
    "description": "Share files offline safely using multi-frame QR streams and recycled UI canvas. Optimized to prevent memory crashes on mobile browsers.",
    "seoTitle": "Offline Animated QR File Transfer | High-Performance - QRCraftly",
    "image": "/og/file-transfer.png",
    "imageAlt": "Preview of the High-Performance Animated QR File Transfer tool",
    "features": [
      "Offline File Sharing",
      "Sequential Slicing Worker",
      "Recycled Canvas UI"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.DeveloperApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.AsynchronousWebWorkerDiagnostics,
  },
  "arcade": {
    "id": "arcade",
    "name": "QR Arcade & Durability Lab",
    "url": getPublicDomain() + "/arcade",
    "description": "Stress-test your QR design in the browser: blast it in the Arcade Blaster or strike modules in the Damage Simulator while Reed-Solomon analytics and a real scanner report whether it still decodes.",
    "seoTitle": "QR Arcade & Durability Lab | Stress-Test QR Error Correction - QRCraftly",
    "image": "/og/arcade.png",
    "imageAlt": "QR Arcade & Durability Lab: blasting a QR code while a live scanner checks it",
    "features": [
      "Arcade Blaster with plasma bolts, a thermal laser and antimatter rockets",
      "Damage Simulator with precision strikes and artillery barrages",
      "4x4 micro-cell damage, particles and screen shake (calmed under reduced motion)",
      "Live Reed-Solomon health across interleaved blocks with a 20% finder damage alarm",
      "Real scanner verdict from BarcodeDetector or an off-thread Web Worker",
      "Tests your own generator design without sending it anywhere"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.AsynchronousWebWorkerDiagnostics,
  },
  "qr-code-scanner": {
    "id": "qr-code-scanner",
    "name": "QR Code Scanner",
    "url": getPublicDomain() + "/qr-code-scanner",
    "description": "Scan a QR code online with your camera, or from a photo or screenshot. No app, no sign-up, and nothing is uploaded: every code is read in your browser, with a safety check before any link opens.",
    "seoTitle": "QR Code Scanner Online: Scan from Camera or Image, Nothing Uploaded - QRCraftly",
    "heading": "QR Code Scanner",
    "image": "/og/qr-code-scanner.png",
    "imageAlt": "QRCraftly QR code scanner reading a code with the camera",
    "features": [
      "Scan with your camera, or from a photo or screenshot",
      "Paste a screenshot with Ctrl+V or drop an image anywhere on the scanner",
      "Shows the real address of a link before you open it, and blocks script links",
      "Readable summaries of WiFi, contact, event, phone and email codes",
      "Open any code in the generator to edit it and make your own",
      "Runs entirely in your browser: no uploads, no app, no account"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  },
  "qr-code-checker": landingEntry("qr-code-checker"),
  "mosaic-qr-code": landingEntry("mosaic-qr-code"),
  "qr-code-with-logo": landingEntry("qr-code-with-logo"),
  "google-review-qr-code": landingEntry("google-review-qr-code"),
  "menu-qr-code": landingEntry("menu-qr-code"),
  "instagram-qr-code": landingEntry("instagram-qr-code"),
  "whatsapp-qr-code": landingEntry("whatsapp-qr-code"),
  "pdf-qr-code": landingEntry("pdf-qr-code"),
  "security": {
    "id": "security",
    "name": "Security & Privacy",
    "url": getPublicDomain() + "/security",
    "description": "Detailed information on QRCraftly's security architecture, privacy-first processing, and HIPAA compliance alignment.",
    "seoTitle": "Security & Privacy - QRCraftly",
    "image": "/og/security.png",
    "imageAlt": "Security & Privacy Transparency Hub",
    "features": [
      "Zero-Server Data Processing",
      "Client-Side Web Crypto Encryption",
      "HIPAA & GDPR Alignment Architecture",
      "Vulnerability Disclosure Portal"
    ],
    "schemaType": [SchemaType.SoftwareApplication, SchemaType.WebApplication],
    "schemaCategory": SchemaCategory.UtilitiesApplication,
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty,
  }
};

export const auxiliaryRegistry: Record<string, AuxiliaryContent> = {
  "acknowledgements": {
    "id": "acknowledgements",
    "name": "Open-Source Acknowledgements",
    "seoTitle": "Open-Source Acknowledgements and Licenses - QRCraftly",
    "description": "Every open-source package whose code QRCraftly sends to your browser, with its version and full license text.",
    "image": "/og/acknowledgements.png",
    "imageAlt": "Open-source acknowledgements - QRCraftly",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "privacy": {
    "id": "privacy",
    "name": "QRCraftly for iPhone, iPad and Mac: Privacy Policy",
    "seoTitle": "QRCraftly for iPhone, iPad and Mac: Privacy Policy",
    "description": "Privacy policy for QRCraftly: QR Code Studio, the native app for iPhone, iPad and Mac. The app collects no data and makes no network connections.",
    "image": "/og/privacy.png",
    "imageAlt": "QRCraftly for iPhone, iPad and Mac privacy policy",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "support": {
    "id": "support",
    "name": "QRCraftly for iPhone, iPad and Mac: Support",
    "seoTitle": "QRCraftly for iPhone, iPad and Mac: Support",
    "description": "Help for QRCraftly: QR Code Studio on iPhone, iPad and Mac: codes that won't scan, camera access, Camera Transfer and how to contact us.",
    "image": "/og/support.png",
    "imageAlt": "QRCraftly for iPhone, iPad and Mac support",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "guides": {
    "id": "guides",
    "name": "QR Code Guides",
    "seoTitle": "QR Code Guides: Plain Answers With Sources - QRCraftly",
    "description": "Plain-language guides on why QR codes stop working, static versus dynamic codes and more, with sources. Free, ad-free and nothing tracked.",
    "image": "/og/guides.png",
    "imageAlt": "QR code guides - QRCraftly",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "guides/why-qr-codes-stop-working": {
    "id": "guides/why-qr-codes-stop-working",
    "name": "Why QR codes stop working",
    "seoTitle": "Why Your QR Code Stopped Working (and How to Fix It for Good) | QRCraftly",
    "description": "QR codes do not expire by themselves. Find out whether yours was switched off, points at a dead page or is just hard to scan, and how to make one that lasts.",
    "image": "/og/guides-why-qr-codes-stop-working.png",
    "imageAlt": "Why QR codes stop working",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "guides/static-vs-dynamic-qr-codes": {
    "id": "guides/static-vs-dynamic-qr-codes",
    "name": "Static vs dynamic QR codes",
    "seoTitle": "Static vs Dynamic QR Codes: What You Give Up and What You Pay | QRCraftly",
    "description": "A plain comparison of static and dynamic QR codes: editing, scan counts, cost, privacy and what happens if the provider disappears, with a way to keep both.",
    "image": "/og/guides-static-vs-dynamic-qr-codes.png",
    "imageAlt": "Static vs dynamic QR codes",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "guides/how-to-print-a-qr-code-that-scans": {
    "id": "guides/how-to-print-a-qr-code-that-scans",
    "name": "Printing a QR code that scans",
    "seoTitle": "How to Print a QR Code That Scans: Size, Margin and Contrast | QRCraftly",
    "description": "The size, quiet zone, contrast and file format that decide whether a printed QR code scans, with a checklist you can run before you send anything to print.",
    "image": "/og/guides-how-to-print-a-qr-code-that-scans.png",
    "imageAlt": "Printing a QR code that scans",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "guides/qr-code-error-correction-explained": {
    "id": "guides/qr-code-error-correction-explained",
    "name": "Error correction explained",
    "seoTitle": "QR Code Error Correction Levels Explained (L, M, Q, H) | QRCraftly",
    "description": "What the four QR code error correction levels recover, what each costs in size, and how to choose one when you add a logo or print on a rough surface.",
    "image": "/og/guides-qr-code-error-correction-explained.png",
    "imageAlt": "Error correction explained",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "guides/qr-code-scams-quishing": {
    "id": "guides/qr-code-scams-quishing",
    "name": "QR code scams (quishing)",
    "seoTitle": "QR Code Scams (Quishing): How They Work and How to Stay Safe | QRCraftly",
    "description": "How fake QR codes steal logins and payments, the warning signs to look for before you scan, and what to do if you have already scanned one.",
    "image": "/og/guides-qr-code-scams-quishing.png",
    "imageAlt": "QR code scams (quishing)",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "file-transfer/receive": {
    "id": "file-transfer/receive",
    "name": "Offline Animated QR File Receiver",
    "seoTitle": "Offline Animated QR File Receiver | High-Performance - QRCraftly",
    "description": "Receive files offline safely using multi-frame QR streams and camera capture. Optimized with lookahead packet recovery.",
    "image": "/og/file-transfer-receive.png",
    "imageAlt": "Preview of the High-Performance Animated QR File Receiver",
    "personas": [TargetPersona.HealthcareLegal, TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  },
  "_error": {
    "id": "_error",
    "name": "404 Page Not Found",
    "seoTitle": "404 Page Not Found - QRCraftly",
    "description": "The page you are looking for does not exist.",
    "image": "/og-image.png",
    "imageAlt": "404 Page Not Found - QRCraftly",
    "personas": [TargetPersona.HealthcareLegal],
    "valueProposition": StrategicValueCategory.ZeroTransitPrivacySovereignty
  }
};

/**
 * A retired route kept only as a redirect to its canonical replacement.
 */
export interface LegacyRouteContent extends AuxiliaryContent {
  /** Where visitors are redirected (path and query only, never payload content). */
  redirectTo: string;
  /** Canonical path search engines should index instead. */
  canonicalPath: string;
}

/**
 * Retired routes. They are excluded from the sitemap and audits, marked noindex, and point
 * their canonical link at the replacement.
 */
export const legacyRouteRegistry: Record<string, LegacyRouteContent> = {
  "destroy-the-qr": {
    "id": "destroy-the-qr",
    "name": "Destroy the QR (moved to QR Arcade)",
    "seoTitle": "Destroy the QR is now QR Arcade Blaster - QRCraftly",
    "description": "Destroy the QR is now the Arcade Blaster mode of the QR Arcade & Durability Lab.",
    "image": "/og-image.png?type=arcade",
    "imageAlt": "QR Arcade & Durability Lab",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.AsynchronousWebWorkerDiagnostics,
    "redirectTo": "/arcade?mode=blaster",
    "canonicalPath": "/arcade"
  },
  "game": {
    "id": "game",
    "name": "QR Damage Simulator (moved to QR Arcade)",
    "seoTitle": "The QR Damage Simulator is now part of QR Arcade - QRCraftly",
    "description": "The QR Damage Simulator game is now the Damage Simulator mode of the QR Arcade & Durability Lab.",
    "image": "/og-image.png?type=arcade",
    "imageAlt": "QR Arcade & Durability Lab",
    "personas": [TargetPersona.SecurityConsciousEnterprise],
    "valueProposition": StrategicValueCategory.AsynchronousWebWorkerDiagnostics,
    "redirectTo": "/arcade?mode=simulator",
    "canonicalPath": "/arcade"
  }
};

const getRegistryKeyForPath = (path: string): string => {
  let cleanPath = getSanitizedPath(path);
  if (cleanPath !== "/" && cleanPath.endsWith("/")) {
    cleanPath = cleanPath.slice(0, -1);
  }
  if (cleanPath === "" || cleanPath === "/") {
    return "index";
  }
  const pathLookup = cleanPath.startsWith("/") ? cleanPath.slice(1) : cleanPath;
  return pathLookup;
};

export function getContentById(id: string): ToolContent | AuxiliaryContent | undefined {
  return contentRegistry[id] || auxiliaryRegistry[id] || legacyRouteRegistry[id];
}

export function getContentForPath(path: string): ToolContent | AuxiliaryContent | undefined {
  const key = getRegistryKeyForPath(path);
  return contentRegistry[key] || auxiliaryRegistry[key] || legacyRouteRegistry[key];
}

/**
 * Looks up a retired route.
 * @param path - A pathname.
 * @returns Its redirect entry, or undefined for live routes.
 */
export function getLegacyRedirect(path: string): LegacyRouteContent | undefined {
  return legacyRouteRegistry[getRegistryKeyForPath(path)];
}

export function getMetadataForPath(path: string): { title: string; description: string; image: string; imageAlt: string } {
  const pathLookup = getRegistryKeyForPath(path);

  if (contentRegistry[pathLookup]) {
    const item = contentRegistry[pathLookup];
    return {
      title: item.seoTitle || item.name,
      description: item.description,
      image: item.image || item.ogImage || '/og-image.png',
      imageAlt: item.imageAlt || item.ogImageAlt || item.seoTitle || item.name,
    };
  }
  
  if (auxiliaryRegistry[pathLookup] || legacyRouteRegistry[pathLookup]) {
    const item = auxiliaryRegistry[pathLookup] || legacyRouteRegistry[pathLookup];
    return {
      title: item.seoTitle,
      description: item.description,
      image: item.image || item.ogImage || '/og-image.png',
      imageAlt: item.imageAlt || item.ogImageAlt || item.seoTitle,
    };
  }

  return {
    title: "QRCraftly - Free Custom QR Code Generator",
    description: "Generate beautiful, custom QR codes for free. No sign-up required.",
    image: "/og-image.png",
    imageAlt: "QRCraftly QR Code Example",
  };
}

/**
 * Minimal page-context shape needed to resolve metadata.
 */
export interface MetadataPageContext {
  /** The requested path. */
  urlPathname: string;
  /** Whether this render is the 404 page. */
  is404?: boolean | null;
  /** Status code of an aborted render, if any. */
  abortStatusCode?: number;
}

/**
 * Resolves metadata for a rendered page. The 404 page uses the
 * dedicated `_error` entry instead of inheriting the homepage fallback for an unknown URL.
 * @param pageContext - The Vike page context.
 * @returns Title, description and image metadata.
 */
export function getMetadataForPageContext(pageContext: MetadataPageContext): ReturnType<typeof getMetadataForPath> {
  const isError = Boolean(pageContext.is404) || pageContext.abortStatusCode === 404;
  return getMetadataForPath(isError ? '/_error' : pageContext.urlPathname);
}
