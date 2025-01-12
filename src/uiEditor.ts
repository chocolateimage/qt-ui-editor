import * as vscode from 'vscode';

export class QtUIEditorProvider implements vscode.CustomTextEditorProvider {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
		const provider = new QtUIEditorProvider(context);
		const providerRegistration = vscode.window.registerCustomEditorProvider(QtUIEditorProvider.viewType, provider);
		return providerRegistration;
	}

    private static readonly viewType = 'qtUiEditor.qtUiEditor';

    constructor(
		private readonly context: vscode.ExtensionContext
	) { }

    resolveCustomTextEditor(document: vscode.TextDocument, webviewPanel: vscode.WebviewPanel, token: vscode.CancellationToken): Thenable<void> | void {
        webviewPanel.webview.options = {
            enableScripts: true
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        function updateWebview() {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        }

        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
			if (e.document.uri.toString() === document.uri.toString()) {
				updateWebview();
			}
		});

		// Make sure we get rid of the listener when our editor is closed.
		webviewPanel.onDidDispose(() => {
			changeDocumentSubscription.dispose();
		});

        webviewPanel.webview.onDidReceiveMessage(e => {
			switch (e.type) {
				case 'update':
					this.updateContent(document, e.content);
					return;
			}
		});

        updateWebview();
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'script.js'));

		const styleResetUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'reset.css'));

		const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(
			this.context.extensionUri, 'media', 'vscode.css'));

        const styleMainUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'style.css'));
        
        const styleQtUri = webview.asWebviewUri(vscode.Uri.joinPath(
            this.context.extensionUri, 'media', 'qt.css'));
        
        return /* html */`
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">

            <meta name="viewport" content="width=device-width, initial-scale=1.0">

            <link href="${styleResetUri}" rel="stylesheet" />
            <link href="${styleVSCodeUri}" rel="stylesheet" />
            <link href="${styleMainUri}" rel="stylesheet" />
            <link href="${styleQtUri}" rel="stylesheet" />

            <title>UI Editor</title>
        </head>
        <body>
            <div class="warning" id="warningWidgetLoadError">
                <span class="warning-text">
                    The following widgets could not be loaded: <span id="warningWidgetLoadErrorWidgets"></span>
                </span>
                <a class="warning-link" href="https://github.com/chocolateimage/qt-ui-editor/issues/new">Submit issue...</a>
            </div>
            <div class="root" style="display: none;">
                <button class="side-collapsed-sidebar" style="display: none;">Widget Box</button>
                <div class="sidebar sidebar-left">
                    <div class="view">
                        <button class="view-title side-collapsible">Widget Box</button>
                        <div class="view-content">
                            <div id="widgetBoxList">

                            </div>
                        </div>
                    </div>
                </div>
                <div class="main">
                </div>
                <div class="sidebar sidebar-right">
                    <div class="view">
                        <button class="view-title collapsible">Object Inspector</button>
                        <div class="view-content">
                            <ul id="objectInspectorRoot">

                            </ul>
                        </div>
                    </div>
                    <div class="view">
                        <button class="view-title collapsible">Property Editor</button>
                        <div class="view-content">
                            <table id="propertyEditorTable">
                                <thead>
                                    <tr>
                                        <th>Property</th>
                                        <th>Value</th>
                                    </tr>
                                </thead>
                                <tbody id="propertyEditorProperties">
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            </div>
            <div class="new-file" style="display: none;">
                <h2>New empty file</h2>
                <button id="newFileCreateButton">Create</button>
            </div>
            <script src="${scriptUri}"></script>
        </body>
        </html>
        `;
    }

    private updateContent(document: vscode.TextDocument, content: string) {
        const edit = new vscode.WorkspaceEdit();

        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), content);

        return vscode.workspace.applyEdit(edit);
    }
}