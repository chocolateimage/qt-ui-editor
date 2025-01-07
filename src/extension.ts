import * as vscode from 'vscode';
import { QtUIEditorProvider } from './uiEditor';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(QtUIEditorProvider.register(context));
}

export function deactivate() {}
