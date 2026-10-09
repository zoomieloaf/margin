import * as vscode from 'vscode';
import type { AiRequest, AiSetting, HostToWebview } from '../../bridge/messages';
import { aiPrompt, chatPrompt } from './prompts';
import { aiSetting, chatCommandFor, chatUrl, chooseRoute, destination, pickModel, type ChatTarget, type Route } from './route';

/** What the AI actions use from VS Code. The integration tests replace parts of it (margin._test.stubAi). */
export interface AiEnv {
  models(): Thenable<readonly vscode.LanguageModelChat[]>;
  /** The editor has a chat Margin can open (`chatCommandFor`). */
  hasChatCommand(): Thenable<boolean>;
  /** Opens the editor's chat; true when the prompt was filled in, false when the user has to paste it. */
  openChat(prompt: string): Thenable<boolean>;
  /** A URL string: VS Code opens it as written, without re-encoding the query. */
  openExternal(url: string): Thenable<unknown>;
  clipboard(text: string): Thenable<void>;
  /** The first-use notice: true to go ahead and send the text to `where`. */
  confirm(where: string): Thenable<boolean>;
}

const CONTINUE = 'Continue';

const chatCommand = async () => chatCommandFor(vscode.env.appName, await vscode.commands.getCommands(true));

export const realEnv: AiEnv = {
  // Older editors and some forks have no `vscode.lm`.
  models: () => (vscode.lm?.selectChatModels ? vscode.lm.selectChatModels() : Promise.resolve([])),
  hasChatCommand: async () => (await chatCommand()) !== undefined,
  openChat: async (prompt) => {
    const chat = await chatCommand();
    if (!chat) throw new Error('no chat view');
    if (chat.takesQuery) await vscode.commands.executeCommand(chat.command, { query: prompt });
    else await vscode.commands.executeCommand(chat.command);
    return chat.takesQuery;
  },
  openExternal: (url) => vscode.env.openExternal(url as unknown as vscode.Uri),
  clipboard: (text) => vscode.env.clipboard.writeText(text),
  confirm: async (where) => {
    const choice = await vscode.window.showInformationMessage(
      `AI actions send the text you selected to ${where}.`,
      { modal: true, detail: 'Text is sent only when you run an AI action. Margin asks once for each place it sends text to; the setting margin.ai chooses the place, or turns AI actions off.' },
      CONTINUE,
    );
    return choice === CONTINUE;
  },
};

/** globalState key: the places the user agreed to send text to (see `consentId`). */
const CONSENT_KEY = 'margin.ai.consent';

const consentId = (route: Route, vendor?: string) => (route.kind === 'chat' ? `chat:${route.target}` : `model:${vendor ?? ''}`);

const paste = process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V';

/** Readable text for a failed model request (shown as a toast in the webview). */
export function modelErrorMessage(err: unknown): string {
  if (err instanceof vscode.LanguageModelError) {
    if (err.code === vscode.LanguageModelError.NoPermissions().code) return 'Margin may not use the AI model. Allow it when VS Code asks, or set margin.ai to chatgpt or claude.';
    if (err.code === vscode.LanguageModelError.Blocked().code) return 'The AI request was blocked (quota or rate limit). Try again later.';
    if (err.code === vscode.LanguageModelError.NotFound().code) return 'The AI model is no longer available.';
  }
  return `The AI request failed: ${err instanceof Error ? err.message : String(err)}`;
}

/**
 * Runs AI actions for all Margin editors: the editor's language model when there is one
 * (tier 1, streamed into the webview's suggestion box), otherwise the prompt is copied and a chat
 * opened (tier 2). Knows whether a model is available and tells the editors when that changes.
 */
export class AiService implements vscode.Disposable {
  env: AiEnv = realEnv;
  private hasModel = false;
  private readonly changed = new vscode.EventEmitter<boolean>();
  /** Fires with whether a model is available, after `vscode.lm.onDidChangeChatModels`. */
  readonly onDidChangeAvailable = this.changed.event;
  private readonly subs: vscode.Disposable[] = [this.changed];

  constructor(private readonly state: vscode.Memento) {
    if (vscode.lm?.onDidChangeChatModels) this.subs.push(vscode.lm.onDidChangeChatModels(() => void this.refresh()));
  }

  get setting(): AiSetting {
    return aiSetting(vscode.workspace.getConfiguration('margin').get('ai'));
  }

  /** Whether a model was available at the last check. */
  get available(): boolean {
    return this.hasModel;
  }

  /** Checks again whether the editor offers a model; fires onDidChangeAvailable. */
  async refresh(): Promise<boolean> {
    try {
      this.hasModel = (await this.env.models()).length > 0;
    } catch {
      this.hasModel = false;
    }
    this.changed.fire(this.hasModel);
    return this.hasModel;
  }

  /**
   * Runs one action and reports to `post`: chunks then done, an error, or a fallback to a chat.
   * Nothing is sent before the user agreed (once per place), and nothing after `token` is cancelled.
   */
  async run(req: AiRequest, post: (m: HostToWebview) => void, token: vscode.CancellationToken): Promise<void> {
    const fail = (message: string) => post({ type: 'aiError', id: req.id, message });
    const setting = this.setting;
    const models = setting === 'auto' || setting === 'editor' ? await Promise.resolve(this.env.models()).catch(() => []) : [];
    const model = pickModel(models);
    const route = chooseRoute({
      setting,
      hasModel: model !== undefined,
      appName: vscode.env.appName,
      hasChatCommand: setting === 'auto' && !model ? await this.env.hasChatCommand() : false,
    });
    if (route.kind === 'off') return fail('AI actions are turned off (the margin.ai setting).');
    if (route.kind === 'none') return fail('No AI model is available in this editor. Sign in to GitHub Copilot, or set margin.ai to chatgpt or claude.');
    if (!(await this.consent(route, model?.vendor))) return fail('Nothing was sent.');
    if (token.isCancellationRequested) return;
    if (route.kind === 'model') await this.stream(model!, req, post, token);
    else if (route.kind === 'chat') await this.chat(route.target, req, post);
  }

  private async consent(route: Route, vendor?: string): Promise<boolean> {
    const id = consentId(route, vendor);
    const agreed = this.state.get<string[]>(CONSENT_KEY, []);
    if (agreed.includes(id)) return true;
    if (!(await this.env.confirm(destination(route, vendor, vscode.env.appName)))) return false;
    await this.state.update(CONSENT_KEY, [...this.state.get<string[]>(CONSENT_KEY, []), id]);
    return true;
  }

  /** Tier 1: the editor's model, streamed. Run from a user action, which is what Copilot's consent requires. */
  private async stream(model: vscode.LanguageModelChat, req: AiRequest, post: (m: HostToWebview) => void, token: vscode.CancellationToken): Promise<void> {
    const prompt = aiPrompt(req);
    const messages = [vscode.LanguageModelChatMessage.User(prompt.instructions), vscode.LanguageModelChatMessage.User(prompt.text)];
    try {
      const response = await model.sendRequest(messages, { justification: 'Margin rewrites the text you selected when you run an AI action.' }, token);
      for await (const text of response.text) {
        if (token.isCancellationRequested) return;
        post({ type: 'aiChunk', id: req.id, text });
      }
      if (!token.isCancellationRequested) post({ type: 'aiDone', id: req.id });
    } catch (err) {
      if (!token.isCancellationRequested) post({ type: 'aiError', id: req.id, message: modelErrorMessage(err) });
    }
  }

  /** Tier 2: the prompt goes to the clipboard and a chat opens; the answer comes back by paste. */
  private async chat(target: ChatTarget, req: AiRequest, post: (m: HostToWebview) => void): Promise<void> {
    const prompt = chatPrompt(req);
    await this.env.clipboard(prompt);
    let opened = target === 'claude' ? 'claude.ai' : 'chatgpt.com';
    let prefilled = true;
    if (target === 'editor') {
      try {
        prefilled = await this.env.openChat(prompt);
        opened = `${vscode.env.appName}'s chat`;
      } catch {
        await this.env.openExternal(chatUrl('chatgpt', prompt));
      }
    } else {
      await this.env.openExternal(chatUrl(target, prompt));
    }
    post({ type: 'aiFallback', id: req.id });
    // Cursor's chat can't be given the prompt: it is pasted there, and the answer pasted back here.
    if (prefilled) post({ type: 'toast', text: `Prompt copied, paste the answer back with ${paste}`, sub: `Opened ${opened}` });
    else post({ type: 'toast', text: `Prompt copied: press ${paste} and Enter in ${opened}`, sub: `Then paste the answer back here with ${paste}` });
  }

  dispose(): void {
    this.subs.forEach((s) => s.dispose());
  }
}

/** The AI actions of one Margin editor: each runs unawaited and can be cancelled by id. */
export class AiSession implements vscode.Disposable {
  private readonly running = new Map<string, vscode.CancellationTokenSource>();

  constructor(private readonly service: AiService, private readonly post: (m: HostToWebview) => void) {}

  /** Starts `req`; resolves when it is finished. Not awaited by the message queue: a long answer mustn't hold up edits. */
  start(req: AiRequest): Promise<void> {
    this.cancel(req.id);
    const cts = new vscode.CancellationTokenSource();
    this.running.set(req.id, cts);
    return this.service
      .run(req, this.post, cts.token)
      .catch((err: unknown) => this.post({ type: 'aiError', id: req.id, message: modelErrorMessage(err) }))
      .finally(() => {
        if (this.running.get(req.id) === cts) this.running.delete(req.id);
        cts.dispose();
      });
  }

  cancel(id: string): void {
    this.running.get(id)?.cancel();
    this.running.delete(id);
  }

  /** Discards every running action (mode change, panel closed). */
  cancelAll(): void {
    for (const id of [...this.running.keys()]) this.cancel(id);
  }

  dispose(): void {
    this.cancelAll();
  }
}
