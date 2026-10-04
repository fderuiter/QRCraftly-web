/** One how-to guide, rendered as steps on the page and as HowTo structured data. */
export interface HowToCopy {
  name: string;
  description: string;
  supply?: { name: string }[];
  steps: { name: string; text: string }[];
}

/** One question and its answer. */
export interface FaqCopy {
  question: string;
  answer: string;
}

/** The long copy of a page that its metadata entry in the content registry leaves out. */
export interface ToolCopy {
  howTo?: HowToCopy;
  faqs?: FaqCopy[];
}
