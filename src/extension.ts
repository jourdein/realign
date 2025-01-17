// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { TextDecoder } from 'util';
import { join } from 'path';
import { SSL_OP_MSIE_SSLV2_RSA_PADDING } from 'constants';

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
	registerCommandNice('realigner.activate',   function (args) {
		if (!ext.is_active()){
			ext.activate();
			disposables.push(registerCommandNice('type', function (args) { ext.type(args.text); }));
			disposables.push(registerCommandNice('deleteWordLeft', function (args) { ext.backspace('word'); }));
			disposables.push(registerCommandNice('deleteLeft', function (args)     { ext.backspace('char'); }));
		}
	});
	registerCommandNice('realigner.backspace', function (args) { ext.backspace('char'); });
	registerCommandNice('realigner.confirm', function(args) { ext.confirm();
		vscode.commands.executeCommand('realigner.deactivate');
	 });
	registerCommandNice('realigner.deactivate', function (args) {
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
	private _doc: vscode.TextDocument|undefined;
	private _editor: vscode.TextEditor|undefined;
	private _selections: vscode.Selection[]|undefined;

	constructor() {
		this._active = new ContextKey('realigner.active');

		// Create the status bar
		this._bar = new StatusBar();
		this._edits = [];

		this._editor = undefined;
		this._doc = undefined;

		this._selections = undefined;
	}

	public is_active(): boolean{
		return this._active.get();
	}

	public confirm(): void{
		this._edits = [];
		this.deactivate();
	}

	public activate(): void{
		console.log("Activating Jourdein ReAligner");
		this._editor = vscode.window.activeTextEditor;
		if (this._editor === undefined) {
			console.log("No active document. Not activating");
			return;
		}
		this._doc = this._editor.document;
		this._bar.clear();
		this._bar.show();
		this._active.set(true);
		this._selections = this._editor.selections;
	}

	public deactivate(): void {
		console.log("Deactivating Jourdein ReAligner");
		// Destroy bar
		this._active.set(false);
		this._bar.clear();
		this._bar.hide();

		this._selections = undefined;

		if (this._edits.length) {
			let curr_editor = vscode.window.activeTextEditor;
			if (curr_editor !== undefined && curr_editor.document===this._doc) {this.undo(curr_editor);}
		}
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

	public pattern(): [Options, RegExp|undefined] {
		// Detect options
		let text = this._bar.get_text();
		return parse_pattern(text);

		// let pattern = this._bar.get_text();
		// let match = pattern.match(/(.*)\/([lrcf]\d+)?([lrcf]\d+)?([lrcf]\d+)?([lrcf]\d+)?$/);
		// let options = new Options(match);
		// if ( match !== null ) {pattern = match[1];}
		// return [options, pattern];
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
			this._edits = [];
		}, { undoStopBefore:false, undoStopAfter:true});
	}

	public expand_lines(text_editor:vscode.TextEditor, regex:RegExp): Array<number>{

		// Expand selections where needed
		let selections = this._selections;
		if (selections === undefined) {return [];}
		let all_selections = new Set<number>();
		let doc = text_editor.document;
		for (let idx = 0; idx < selections.length; idx++) {
			const selection = selections[idx];
			let upline = selection.start.line;
			let downline = selection.end.line;

			// Selection is all on one line, expand up and down
			if (selection.isEmpty || upline === downline) {
				let lineText;
				// Expand selection upwards
				while (regex.test(doc.lineAt(upline).text)) {
					if (doc.lineAt(upline).isEmptyOrWhitespace) { break; }
					all_selections.add(upline);
					upline--;
					if (upline < 0) { break; }
				}
				// Expand selection downwards
				while (regex.test(doc.lineAt(downline).text)) {
					if (doc.lineAt(downline).isEmptyOrWhitespace) { break; }
					all_selections.add(downline);
					downline++;
					if (downline >= doc.lineCount) { break; }
				}
			}
			// Selection spans multiple lines
			else {
				for (let row = upline; row <= downline; row++) {
					let vsline = doc.lineAt(row);
					if (!vsline.isEmptyOrWhitespace && regex.test(vsline.text)) {
						all_selections.add(row);
					}
				}
			}
		}
		// all_selections now holds the line numbers of our lines to align
		let lines = Array.from(all_selections);
		lines.sort();
		return lines;
	}

	public align() {

		if (this._editor === undefined) {return;}
		if (this._doc === undefined) {return;}
		let text_editor = this._editor;
		let text_doc = this._doc;
		this.undo(text_editor).then( success => {
			console.log("Successful undo");
			this._edits = [];

			let tab_size = text_editor.options.tabSize;
			if (tab_size === undefined || typeof tab_size === 'string') {return;}

			let [options, regex] = this.pattern();
			console.log("Aligning on pattern " + regex);
			if ( regex === undefined ) { return; }
			// let regex: RegExp;
			// try {
			// 	regex = RegExp(`(${pattern})`);
			// } catch (error) {
			// 	console.log("Bad regex " + pattern);
			// 	return;
			// }

			let lines = this.expand_lines(text_editor, regex);
			let str_lines: Array<string> = [];

			for (const num of lines) {
				let str_line = text_doc.lineAt(num).text;
				str_lines.push(str_line);
				this._edits.push([num, str_line]);
			}

			let splitter = new Splitter(str_lines, regex, options.fields, tab_size);

			console.log("Aligning lines " + (lines[0] + 1) + " to " + (lines[lines.length - 1] + 1));

			let finals = splitter.to_lines(options.alignments);

			// Now make our edits
			text_editor.edit(e => {
				for (let i = 0; i < lines.length; i++) {
					const line = text_doc.lineAt(lines[i]);
					// console.log("Changing line " + lines[i]);
					e.replace(line.range, finals[i]);
					// console.log("New line is " + finals[i]);
				}
			}, { undoStopBefore: false, undoStopAfter: false });

			// Move cursor to end of last line
			// let last_line = text_doc.lineAt(lines[lines.length-1]);
			// let selection = new vscode.Selection(last_line.range.end, last_line.range.end);
			// text_editor.selection = selection;
		});
	}
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
		this._statbar.text = this._prefix + text + '_';
	}

	public show() {
		this._statbar.show();
	}
	public hide() {
		this._statbar.hide();
	}
}

export class Options {
	public fields: number;
	public alignments: Array<Array<string|number>>;

	constructor(match: Array<string>|null) {
		this.fields = 1;
		this.alignments = [];

		// Fields / Repetition retrieval
		if (match && match[3]) {
			let num = 1;
			const field = match[3];

			if (field.length !== 1) { num = +field.slice(1); }

			this.fields = num;
		}

		// Flag retrieval
		if (match && match[2]) {

			let align_data: Array<string|number> = [];

			const flags = [...match[2].matchAll(/[lrc][0-9]*/g)];

			for (const it of flags) {
				if (it === undefined) { continue; }

				// extract the captured flag
				const flag  = it[0];
				const align = flag.charAt(0);
				let num = 1; // default padding

				if (flag.length !== 1) { num = +flag.slice(1); }

				if      (align === 'l') { align_data = [align, num]; }
				else if (align === 'r') { align_data = [align, num]; }
				else if (align === 'c') { align_data = [align, num]; }
				else if (align === 'f') { this.fields = num; }

				if (align_data.length > 0) { this.alignments.push(align_data); }
			}
		}
	}
}

export class Splitter {

	public lines: Array<string>;
	public regex: RegExp;
	public maxsplit:number;
	public tabsize:number;
	public indent:number;
	public rows: Array<Array<string>>;
	public col_widths: Array<number>;

	constructor(lines:Array<string>, regex:RegExp, maxsplit:number, tabsize:number){
		this.lines = lines;
		this.regex = regex;
		this.tabsize = tabsize;
		this.maxsplit = maxsplit;
		this.indent = 9999999;
		this.rows = [];
		this.col_widths = [];

		if (maxsplit > 0) {this.maxsplit*=2;}

		this.parse_lines();
	}

	public parse_lines():void {
		this.rows = [];

		// Add all rows to table
		for (const rawline of this.lines) {
			let line = rawline.replace(/\t/g, ' '.repeat(this.tabsize));

			// Find smallest indentation
			let indent = line.length - line.trimLeft().length;
			if (indent < this.indent) {this.indent = indent;}

			// Removes indentation and splits on regex
			let row = line.trimLeft().split(this.regex);

			if ( this.maxsplit > 0 && row.length > this.maxsplit ) {
				let newrow = row.slice(0, this.maxsplit);
				newrow.push(row.slice(this.maxsplit).join(""));
				row = newrow;
			}

			// Remove spaces from each split
			for (let i = 0; i < row.length; i++) {
				row[i] = row[i].trim();
			}
			this.rows.push(row);
		}
		this.update_widths();
	}

	public update_widths(): void {
		this.col_widths = [];
		for (const row of this.rows) {
			for (let col = 0; col < row.length; col++) {
				let col_width = row[col].length;
				if (this.col_widths.length-1 < col) {
					this.col_widths.push(col_width);
				}
				else if (col_width > this.col_widths[col]) {
					this.col_widths[col] = col_width;
				}
			}
		}
	}

	fillSpaces(content: string, alignment: Array<string|number>, colWidth: number): string {

		let align, padding = "";
		let padLength = 1;
		const fill = colWidth - content.length;

		if (alignment) {
			align = alignment[0];
			padLength = alignment.length > 1 ? +alignment[1] : padLength;
		}

		padding = " ".repeat(padLength);

		switch (align) {
			case 'r':
				content = " ".repeat(fill) + content + padding;
				break;
			case 'c': {
				const halfFill = Math.floor(fill/2);
				const lFill = " ".repeat(halfFill);
				const rFill = " ".repeat(fill - halfFill);
				content = lFill + content + rFill + padding;
				break;
			}
			case 'l':
			default:
				content = content + " ".repeat(fill) + padding;
				break;
		}

		return content;
	}

	public to_lines(alignments:Array<Array<string|number>>): Array<string> {
		let finals = Array<string>();
		const flagGroup = alignments.length !== 0 ? Math.ceil(alignments.length / 3) : 0;

console.log("ROWS", this.rows);

		for (let r = 0; r < this.rows.length; r++) {
			let row = this.rows[r];
			let farr: Array<string> = [" ".repeat(this.indent)];
			let modifiedColumn: Array<string> = [];

			for (let c = 0; c < row.length; c++) {

				if (this.col_widths[c] === 0) { continue; }

				const isOddColumn = c % 2 === 1;
				let flagIdxCenter = 1;
				let flagIdxLeft = flagIdxCenter - 1;
				let flagIdxRight = flagIdxCenter + 1;

				// derive flag indexes (left center right) based on
				// center col and center flag index
				if (isOddColumn && flagGroup !== 0) { // get odd col [a, :, b, :, c, :, d]
					// if more flag group exist
					// center flag would be [1, 4, 7, ...]
					// group > 1
					const maxFlagIdx = (flagGroup - 1) * 3; // define max group/existing group

					// related with 'c'
					// if c == 1 use group 1
					// if c == 3 use group 2 ..and so on
					const colGroup = Math.ceil(c / 2);
					const flagIdx = (colGroup - 1) * 3;

					// override defaults
					// make sure idx is in range.
					flagIdxLeft = flagIdx <= maxFlagIdx ? flagIdx : flagIdxLeft;
					flagIdxCenter = flagIdxLeft + 1;
					flagIdxRight = flagIdxCenter + 1;
				}

				// instead of sequential alteration,
				// do alteration based on center col (odd)
				if (isOddColumn) {
					// do on center
					[
						[c-1, flagIdxLeft],
						[c,   flagIdxCenter],
						[c+1, flagIdxRight]
					].forEach(el => {
						const [colIdx, flagIdx] = el;
						let theRow = row[colIdx];

						if (theRow === undefined) { return; }

						theRow = this.fillSpaces(theRow, alignments[flagIdx], this.col_widths[colIdx]);
						modifiedColumn[colIdx] = theRow;
					});
				}
			}

			farr.push(modifiedColumn.join(''));

			let final = farr.join("").trimRight();
			finals.push(final);
		}
		return finals;
	}
}

export function parse_pattern(text:string): [Options, RegExp|undefined] {
	// Detect options
	let match = text.match(/(.+?)\/([lrc0-9]*)(f[0-9]*)?$/);
	let options = new Options(match);

	if (match !== null) { text = match[1]; }

	let regex:RegExp|undefined;

	try {
console.log('=> Trying.. ', text);
		regex = RegExp(`(${text})`);
	} catch (error) {
		console.log("Bad regex => ", text);
		regex = undefined;
	}

	return [options, regex];
}
