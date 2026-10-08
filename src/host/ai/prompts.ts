import type { AiAction, AiRequest } from '../../bridge/messages';

/** The document before the cursor sent with Continue writing and Ask AI keeps at most this many characters (its end). */
export const MAX_CONTEXT = 6000;

/** What an AI action asks for: the instructions, and the text they apply to. Both are plain text. */
export interface AiPrompt {
  instructions: string;
  text: string;
}

type PromptInput = Omit<AiRequest, 'id'>;

const TASKS: Record<Exclude<AiAction, 'translate' | 'continue' | 'ask'>, string> = {
  improve: 'Improve the writing of the text: make it clearer and read better, keeping its meaning, tone and length.',
  shorten: 'Make the text shorter, about half as long, keeping the key points.',
  longer: 'Make the text longer and more detailed, keeping its tone. Add no made-up facts.',
  grammar: 'Fix the spelling and grammar of the text. Change nothing else.',
  summarize: 'Summarize the text in a few sentences, or a short bulleted list when it covers several points.',
};

const RULES_REWRITE = 'Return only the rewritten Markdown, with no preamble, no explanation and no code fence around it.';
const RULES_NEW = 'Return only the resulting Markdown, with no preamble, no explanation and no code fence around it.';
const KEEP_FORMAT = 'Keep the Markdown formatting and links.';
const KEEP_LANGUAGE = 'Keep the original language of the text.';

/** `text` in a ```markdown fence longer than any backtick run inside it, so the text can't close it. */
export function fenced(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return `${fence}markdown\n${text}\n${fence}`;
}

/** The end of the document before the cursor: the part the new text follows. */
const tail = (context: string) => (context.length > MAX_CONTEXT ? `…${context.slice(-MAX_CONTEXT)}` : context);

/** The prompt for an AI action. The same text goes to the editor's model and, in one message, to a web chat. */
export function aiPrompt(req: PromptInput): AiPrompt {
  const lines: string[] = ['You are a writing assistant in a Markdown editor.'];
  let text: string;
  const before = req.context?.trim() ? `The document before the cursor:\n\n${fenced(tail(req.context))}` : '';
  switch (req.action) {
    case 'continue':
      lines.push(
        'Continue writing the document from where it ends, in the same style, tone and formatting: one or two paragraphs.',
        'Return only the new text that follows, not the text you were given, with no preamble and no code fence around it.',
        KEEP_FORMAT,
        'Write in the language of the document.',
      );
      text = before || 'The document is empty.';
      break;
    case 'ask':
      if (req.markdown.trim()) {
        lines.push(`Apply this instruction to the text: ${req.instruction ?? ''}`, RULES_REWRITE, KEEP_FORMAT, `${KEEP_LANGUAGE} unless the instruction says otherwise.`);
        text = `Text:\n\n${fenced(req.markdown)}`;
      } else {
        lines.push(`Write what this instruction asks for: ${req.instruction ?? ''}`, RULES_NEW, KEEP_FORMAT, 'Write in the language of the document, or of the instruction when the document is empty.');
        text = before || 'The document is empty.';
      }
      break;
    case 'translate':
      lines.push(`Translate the text into ${req.lang ?? 'English'}.`, RULES_REWRITE, KEEP_FORMAT, 'Leave code, URLs and link targets as they are.');
      text = `Text:\n\n${fenced(req.markdown)}`;
      break;
    default:
      lines.push(TASKS[req.action], req.action === 'summarize' ? RULES_NEW : RULES_REWRITE, KEEP_FORMAT, KEEP_LANGUAGE);
      text = `Text:\n\n${fenced(req.markdown)}`;
  }
  return { instructions: lines.join('\n'), text };
}

/** The prompt as one message, for the clipboard and a web chat. */
export function chatPrompt(req: PromptInput): string {
  const p = aiPrompt(req);
  return `${p.instructions}\n\n${p.text}`;
}
