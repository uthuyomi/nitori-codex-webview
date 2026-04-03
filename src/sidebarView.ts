import * as vscode from "vscode";
import { getWebviewHtml } from "./webviewHtml";

export class NitoriCodexSidebarViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "nitoriCodex.sidebarView";

  private view: vscode.WebviewView | null = null;
  private readonly extensionUri: vscode.Uri;
  private readonly onWebviewReady: (view: vscode.WebviewView) => void;

  constructor(extensionUri: vscode.Uri, onWebviewReady: (view: vscode.WebviewView) => void) {
    this.extensionUri = extensionUri;
    this.onWebviewReady = onWebviewReady;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = getWebviewHtml(webviewView.webview, this.extensionUri);
    this.onWebviewReady(webviewView);
  }
}
