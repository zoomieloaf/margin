import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

export function webviewHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64');
  const asset = (name: string) => webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', name));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} https: http: data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="${asset('webview.css').toString()}">
<title>Margin</title>
</head>
<body>
<div id="app"></div>
<script nonce="${nonce}" src="${asset('webview.js').toString()}"></script>
</body>
</html>`;
}
