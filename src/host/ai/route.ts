import { AI_SETTINGS, type AiSetting } from '../../bridge/messages';

/** A web chat the prompt can be opened in; `editor` is the editor's own chat view (Copilot Chat in VS Code). */
export type ChatTarget = 'editor' | 'chatgpt' | 'claude';

/**
 * Where an AI action goes: the editor's language model (streamed into the suggestion box), a chat
 * (the prompt is copied and the chat opened), nowhere because the setting asks for a model there
 * isn't (`none`), or nowhere because AI is turned off.
 */
export type Route = { kind: 'model' } | { kind: 'chat'; target: ChatTarget } | { kind: 'none' } | { kind: 'off' };

export interface RouteInput {
  setting: AiSetting;
  /** The editor offers at least one chat model (`vscode.lm.selectChatModels()`). */
  hasModel: boolean;
  /** `vscode.env.appName`. */
  appName: string;
  /** `workbench.action.chat.open` exists. */
  hasChatCommand: boolean;
}

/** URLs this long or longer open the bare chat site instead of `?q=`: some browsers and sites cut long ones. */
export const MAX_URL = 1800;

const SITES: Record<Exclude<ChatTarget, 'editor'>, string> = {
  chatgpt: 'https://chatgpt.com/',
  claude: 'https://claude.ai/new',
};

export const isCursor = (appName: string) => /cursor/i.test(appName);

export function chooseRoute({ setting, hasModel, appName, hasChatCommand }: RouteInput): Route {
  switch (setting) {
    case 'off':
      return { kind: 'off' };
    case 'chatgpt':
    case 'claude':
      return { kind: 'chat', target: setting };
    case 'editor':
      return hasModel ? { kind: 'model' } : { kind: 'none' };
    case 'auto':
      if (hasModel) return { kind: 'model' };
      // Cursor has the command, but its chat ignores the query: the prompt would be lost.
      return { kind: 'chat', target: hasChatCommand && !isCursor(appName) ? 'editor' : 'chatgpt' };
  }
}

/** The chat site, with the prompt filled in when the URL stays short enough. */
export function chatUrl(target: Exclude<ChatTarget, 'editor'>, prompt: string): string {
  const site = SITES[target];
  const url = `${site}?q=${encodeURIComponent(prompt)}`;
  return url.length < MAX_URL ? url : site;
}

/** Where the text goes, for the first-use notice. `vendor`: the model's vendor (`copilot` in VS Code). */
export function destination(route: Route, vendor?: string, appName = 'VS Code'): string {
  if (route.kind === 'model') return vendor === 'copilot' ? `GitHub Copilot via ${appName}` : `the ${vendor ?? 'language'} model via ${appName}`;
  if (route.kind !== 'chat') return '';
  if (route.target === 'editor') return `${appName}'s chat (or chatgpt.com)`;
  return route.target === 'chatgpt' ? 'chatgpt.com' : 'claude.ai';
}

/** The model to use: a gpt-4o or Claude family when there is one, otherwise the first. */
export function pickModel<T extends { family: string }>(models: readonly T[]): T | undefined {
  return models.find((m) => /gpt-4o|claude/i.test(m.family)) ?? models[0];
}

/** The `margin.ai` setting's value, `auto` when it is missing or unknown. */
export function aiSetting(value: unknown): AiSetting {
  return typeof value === 'string' && (AI_SETTINGS as readonly string[]).includes(value) ? (value as AiSetting) : 'auto';
}
