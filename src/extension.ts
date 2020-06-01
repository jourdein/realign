// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

let myStatusBarItem: vscode.StatusBarItem;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	console.log("Activating extensions");

	function registerCommandNice(commandId: string, run: (...args: any[]) => void): vscode.Disposable {
		let disposable = vscode.commands.registerCommand(commandId, run);
		context.subscriptions.push(disposable);
		return disposable;
	}

	let ext = new AlignExt();
	let disposables = Array<vscode.Disposable>();
	registerCommandNice('realign.activate',   function (args) { 
		if (!ext.is_active()){
			ext.activate();
			disposables.push(registerCommandNice('type', function (args) { ext.type(args.text); }));
			disposables.push(registerCommandNice('deleteWordLeft', function (args) { ext.backspace('word'); }));
			disposables.push(registerCommandNice('deleteLeft', function (args)     { ext.backspace('char'); }));
		}
	});
	registerCommandNice('realign.backspace', function (args) { ext.backspace('char'); });
	registerCommandNice('realign.confirm', function(args) { ext.confirm();
		vscode.commands.executeCommand('realign.deactivate');
	 });
	registerCommandNice('realign.deactivate', function (args) { 
		ext.deactivate(); 
		disposables.forEach(d => {
			d.dispose();
		});
	});
}

// this method is called when your extension is deactivated
export function deactivate() { }

class AlignExt {
	private _active: ContextKey;
	private _bar: StatusBar;
	private _edits: [number,string][];

	constructor() {
		this._active = new ContextKey('realign.active');
		
		// Create the status bar
		this._bar = new StatusBar();
		this._edits = [];
	}

	public is_active(): boolean{
		return this._active.get();
	}

	public confirm(): void{
		this._edits = [];
		this.deactivate();
	}

	public activate(): void{
		console.log("Activating");
		this._bar.clear();
		this._bar.show();
		this._active.set(true);
	}
	
	public deactivate(): void {
		console.log("Deactivating");
		// Destroy bar
		this._active.set(false);
		this._bar.clear();
		this._bar.hide();
		let text_editor = vscode.window.activeTextEditor;
		if (text_editor) {this.undo(text_editor);}
	}

	public backspace(modifier: string): void {
		console.log("Backspacing");
		let before = this._bar.get_text();
		let after  = this._bar.backspace(modifier);
		if ( before !== after ) {this.align();}
	}
	public type(text: string): void {
		console.log("Typing in bar");
		this._bar.type(text);
		this.align();
	}
	public pattern(): [Options, string] {
		// Detect options
		let pattern = this._bar.get_text();
		let match = pattern.match(/(.*)\/([lrc]\d+)?([lrc]\d+)?([lrc]\d+)?$/);
		let options = new Options(match);
		if ( match !== null ) {pattern = match[1];}
		return [options, pattern];
	}

	public undo(text_editor: vscode.TextEditor): Thenable<boolean> {
		return text_editor.edit(e => {
			// Undo edits if we have any
			for (const ed of this._edits) {
				const line_num = ed[0];
				const line_text = ed[1];
				const edit_line = text_editor.document.lineAt(line_num);
				console.log("Changing line " + line_num + " " + edit_line.text);
				console.log("  To " + line_text);
				e.replace(text_editor.document.lineAt(line_num).range, line_text);
			}
		});
	}

	public align() {
		let text_editor = vscode.window.activeTextEditor;
		if (text_editor === undefined) {return;}
		let text_doc = text_editor.document;
		this.undo(text_editor).then( success => {
			console.log("Successful undo");
			this._edits = [];
			if (!text_editor) {return;}
			let tab_size = text_editor.options.tabSize;
			if (tab_size === undefined || typeof tab_size === 'string') {return;}

			let [options, pattern] = this.pattern();
			console.log("Aligning on pattern " + pattern);
			if ( pattern === "" ) { return; }
			let regex: RegExp;
			try {
				regex = RegExp(pattern);
			} catch (error) {
				console.log("Bad regex " + pattern);
				return;
			}

			// Expand selections where needed
			let selections = text_editor.selections;
			let all_selections = new Set<number>();
			for (let idx = 0; idx < selections.length; idx++) {
				const selection = selections[idx];
				let upline = selection.start.line;
				let downline = selection.end.line;
				
				// Expand selection
				if (selection.isEmpty || upline === downline) {
					let lineText;
					// Expand selection upwards
					while (regex.test(text_doc.lineAt(upline).text)) {
						all_selections.add(upline);
						upline--;
						if (upline < 0) {break;}
					}
					// Expand selection downwards
					while (regex.test(text_doc.lineAt(downline).text)) {
						all_selections.add(downline);
						downline++;
						if (downline >= text_doc.lineCount) {break;}
					}
				}
				// Selection spans multiple lines
				else {
					for (let row = upline; row <= downline; row++) {
						all_selections.add(row);
					}
				}
			}
			// all_selections now holds the line numbers of our lines to align
			let lines = Array.from(all_selections);
			lines.sort();
			console.log("Aligning lines " + (lines[0] + 1) + " to " + (lines[lines.length - 1] + 1));
			
			// Figure out who is longest
			let row_strings = [];
			let max_width = 0;
			for (const num of lines) {
				let line = text_doc.lineAt(num).text;
				let result = regex.exec(line);
				if (result !== null) {
					let num_tabs = countTabs(line);
					if (max_width < result.index+tab_size*num_tabs) {
						max_width = result.index+tab_size*num_tabs;
					}
				}
			}
			console.log("Width is " + max_width);
			// Loop again now putting in needed spaces
			let finals = Array<string>();
			for (const num of lines) {
				let line = text_doc.lineAt(num).text;
				this._edits.push([num, line]);
				let split = line.split(regex);
				let match = regex.exec(line);
				if (match !== null) {
					if (split !== null) {
						let tab_size = text_editor.options.tabSize;
						if ( tab_size === undefined ) {return;} 
						if ( typeof tab_size === 'string' ) {return;}
						// TODO: Handle options
						let num_tabs = countTabs(split[0]);
						let new_str = split[0].replace(/\t/g,' '.repeat(tab_size)).padEnd(max_width, " ");
						if ( options.left !== -1 ) { new_str += ' '.repeat(options.left);}
						new_str += match[0];
						if ( options.right !== -1) { new_str += ' '.repeat(options.right);}
						new_str += split.slice(1).join(match[0]);
						// let new_str = split[0].replace(/\t/g,' '.repeat(tab_size)).padEnd(max_width, " ") + match[0] + split.slice(1).join(match[0]);
						finals.push(new_str);
					}
				}
				else {
					finals.push(line);
				}
			}
			// Now make our edits
			text_editor.edit(e => {
				for (let i = 0; i < lines.length; i++) {
					const line = text_doc.lineAt(lines[i]);
					console.log("Changing line " + lines[i]);
					e.replace(line.range, finals[i]);
					console.log("New line is " + finals[i]);
				}
			}, { undoStopBefore: false, undoStopAfter: false });

			// // Move cursor to end of last line
			// let last_line = text_doc.lineAt(lines[lines.length-1]);
			// let selection = new vscode.Selection(last_line.range.end, last_line.range.end);
			// text_editor.selection = selection;
		});
	}
}

function countTabs(str:string) : number{
	let count = 0;
	for (const char of str) {
		if ( char === '\t' ) {count++;}
	}
	return count;
}

class ContextKey {
	private _name: string;
	private _lastValue: boolean;

	constructor(name: string) {
		this._name = name;
		this._lastValue = false;
	}

	public set(value: boolean): void {
		if (this._lastValue === value) {
			return;
		}
		this._lastValue = value;
		vscode.commands.executeCommand('setContext', this._name, this._lastValue);
	}
	public get(): boolean { return this._lastValue; }
}

class StatusBar {
	private _prefix: string;
	private _statbar: vscode.StatusBarItem;

	constructor() {
		this._statbar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
		this._prefix = 'ReAlign: ';
	}

	public type(char:string): string {
		let current_text = this.get_text();
		this.set_text(current_text + char);
		return this.get_text();
	}

	public backspace(mod:string) : string{
		let current_text = this.get_text();
		if (current_text.length ) {
			if ( mod === 'char' ) {
				this.set_text(current_text.slice(0, current_text.length-1));
			}
			else if ( mod === 'word' ) {
				let trimmed = current_text.trimRight();
				console.log(trimmed);
				if ( trimmed.length < current_text.length ) {
					this.set_text(trimmed);
					return this.get_text();
				}
				let words = current_text.split(/\s+/);
				if ( words.length > 0 ){
					let lastword = words[words.length - 1];
					let fulltext = current_text;
					this.set_text(fulltext.slice(0, fulltext.length - lastword.length));
				}
			}
		}
		return this.get_text();
	}

	public clear() {
		this.set_text('');
	}

	public get_text() : string {
		return this._statbar.text.slice(this._prefix.length, this._statbar.text.length-1);
	}
	public set_text(text:string) {
		this._statbar.text = this._prefix + text + '|';
	}

	public show() {
		this._statbar.show();
	}
	public hide() {
		this._statbar.hide();
	}
}

class Options {
	public left: number;
	public right: number;
	
	constructor(match:Array<string>|null) {
		this.left = -1;
		this.right = -1;

		if ( match ) {
			for (const it of match.slice(2)) {
				if ( it === undefined ) {continue;}
				let num = +it.slice(1);
				if (it[0] === 'l'){
					this.left = num;
				}
				else if (it[0] === 'r'){
					this.right = num;
				}
				else if (it[0] === 'c'){
					this.left  = num;
					this.right = num;
				}
			}
		}
	}
}