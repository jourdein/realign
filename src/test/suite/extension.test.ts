import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from 'vscode';
import * as ReAlign from '../../extension';
import { Test } from 'mocha';


function test_bad_pattern(user_pattern:string){
	let [opt, pattern] = ReAlign.parse_pattern(user_pattern);
	assert.strictEqual(pattern, undefined);
}
function test_good_pattern(user_pattern:string, left:number, right:number, fields:number){
	let [opt, pattern] = ReAlign.parse_pattern(user_pattern);
	console.log(opt, pattern);
	assert.notEqual(pattern, undefined);

	assert.equal(opt.left, left);
	assert.equal(opt.right, right);
	assert.equal(opt.fields, fields);
}
function test_align(input:Array<string>, answer:Array<string>, user_pattern:string) {
	let [opt, pattern] = ReAlign.parse_pattern(user_pattern);

	if ( pattern === undefined ) { assert.notEqual(pattern, undefined); return;}
	
	let tabsize = 4;
	let splitter = new ReAlign.Splitter(input, pattern, opt.fields, tabsize);
	let relines = splitter.to_lines(opt.left, opt.right);
	for (let i = 0; i < relines.length; i++) {
		assert.equal(relines[i], answer[i]);
	}
}

suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Start all tests.');

	test('Test good patterns', () => {

		test_good_pattern('=', 1, 1, -1);
		test_good_pattern('\\w+', 1, 1, -1);
		test_good_pattern('=/l1', 1, 1, -1);
		test_good_pattern('=/l1r2', 1, 2, -1);
		test_good_pattern('=/c2', 2, 2, -1);
		test_good_pattern('=/f1', 1, 1, 1);
	});

	test('Test bad patterns', () => {
		test_bad_pattern('(=');
		test_bad_pattern('asdf)');
		test_bad_pattern('=/[c2');
	});

	test('Test simple', () => {

		let lines = [
			"this.lines = lines;",
			"this.regex = regex;",
			"this.tabsize = tabsize;",
			"this.maxsplit = maxsplit;",
			"this.indent = 9999999;",
			"this.rows = [];",
			"this.col_widths = [];"
		];
		let answer = [
		"this.lines      = lines;",
		"this.regex      = regex;",
		"this.tabsize    = tabsize;",
		"this.maxsplit   = maxsplit;",
		"this.indent     = 9999999;",
		"this.rows       = [];",
		"this.col_widths = [];",
		];

		test_align(lines, answer, '=');
	});

	test('Test align options', () => {

		let lines = [
			"this.lines = lines;",
			"this.regex = regex;",
			"this.tabsize = tabsize;",
			"this.maxsplit = maxsplit;",
			"this.indent = 9999999;",
			"this.rows = [];",
			"this.col_widths = [];"
		];
		let answer_l2 = [
		"this.lines       = lines;",
		"this.regex       = regex;",
		"this.tabsize     = tabsize;",
		"this.maxsplit    = maxsplit;",
		"this.indent      = 9999999;",
		"this.rows        = [];",
		"this.col_widths  = [];",
		];

		let answer_r0 = [
			"this.lines      =lines;",
			"this.regex      =regex;",
			"this.tabsize    =tabsize;",
			"this.maxsplit   =maxsplit;",
			"this.indent     =9999999;",
			"this.rows       =[];",
			"this.col_widths =[];",
		];

		let answer_c2 = [
			"this.lines       =  lines;",
			"this.regex       =  regex;",
			"this.tabsize     =  tabsize;",
			"this.maxsplit    =  maxsplit;",
			"this.indent      =  9999999;",
			"this.rows        =  [];",
			"this.col_widths  =  [];",
		];

		let answer_l0r1 = [
			"this.lines     = lines;",
			"this.regex     = regex;",
			"this.tabsize   = tabsize;",
			"this.maxsplit  = maxsplit;",
			"this.indent    = 9999999;",
			"this.rows      = [];",
			"this.col_widths= [];",
		];

		test_align(lines, answer_l2, '=/l2');
		test_align(lines, answer_r0, '=/r0');
		test_align(lines, answer_c2, '=/c2');
		test_align(lines, answer_l0r1, '=/l0r1');
	});


	test('Test fields', () => {

		let lines = [
			"disposables.push(registerCommandNice('type', function (args) { ext.type(args.text); }));",
			"disposables.push(registerCommandNice('deleteWordLeft', function (args) { ext.backspace('word'); }));",
			"disposables.push(registerCommandNice('deleteLeft', function (args) { ext.backspace('char'); }));",
		];
		
		let answers = [
			"disposables.push ( registerCommandNice ( 'type', function           ( args) { ext.type      ( args.text); }));",
			"disposables.push ( registerCommandNice ( 'deleteWordLeft', function ( args) { ext.backspace ( 'word'); }));",
			"disposables.push ( registerCommandNice ( 'deleteLeft', function     ( args) { ext.backspace ( 'char'); }));",
		];
		
		let answers_l0r1 = [
			"disposables.push( registerCommandNice( 'type', function          ( args) { ext.type     ( args.text); }));",
			"disposables.push( registerCommandNice( 'deleteWordLeft', function( args) { ext.backspace( 'word'); }));",
			"disposables.push( registerCommandNice( 'deleteLeft', function    ( args) { ext.backspace( 'char'); }));",
		];
		
		let answers_f1 = [
			"disposables.push ( registerCommandNice('type', function (args) { ext.type(args.text); }));",
			"disposables.push ( registerCommandNice('deleteWordLeft', function (args) { ext.backspace('word'); }));",
			"disposables.push ( registerCommandNice('deleteLeft', function (args) { ext.backspace('char'); }));",
		];

		let answers_f3 = [
			"disposables.push(registerCommandNice('type', function          (args) { ext.type(args.text); }));",
			"disposables.push(registerCommandNice('deleteWordLeft', function(args) { ext.backspace('word'); }));",
			"disposables.push(registerCommandNice('deleteLeft', function    (args) { ext.backspace('char'); }));",
		];



		test_align(lines, answers, '\\(');
		test_align(lines, answers_l0r1, '\\(/l0r1');
		test_align(lines, answers_f1, '\\(/f1');
		test_align(lines, answers_f3, '\\(/c0f3');
		
		
	});
	
	test("Test wildcards", () => {

		let lines = [
			"// The module 'vscode' contains the VS Code extensibility API",
			"// Import the module and reference it with the alias vscode in your code below",
		];
		
		let answers = [
		"// The     module ' vscode ' contains  the        VS  Code  extensibility  API",
		"// Import  the      module   and       reference  it  with  the            alias  vscode  in  your  code  below",
		];		

		let answers_f1 = [
			"// The    module 'vscode' contains the VS Code extensibility API",
			"// Import the module and reference it with the alias vscode in your code below",
		];

		let answers_f2 = [
			"// The     module 'vscode' contains the VS Code extensibility API",
			"// Import  the    module and reference it with the alias vscode in your code below",
		];

		test_align(lines, answers, '\\w+');
		test_align(lines, answers_f1, '\\w+/f1');
		test_align(lines, answers_f2, '\\w+/f2');
	});

});