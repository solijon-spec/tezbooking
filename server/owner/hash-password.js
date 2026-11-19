'use strict';

const { hashPassword } = require('./auth');
const { StringDecoder } = require('node:string_decoder');

const input = process.stdin;
const decoder = new StringDecoder('utf8');
let password = '';
let finished = false;

function finish() {
  if (finished) return;
  finished = true;
  if (input.isTTY && input.setRawMode) input.setRawMode(false);
  input.pause();
  process.stdout.write('\n');
  const length = Array.from(password).length;
  if (length < 12 || length > 1024) {
    process.stderr.write('Owner password must be 12 to 1024 characters.\n');
    process.exitCode = 1;
    return;
  }
  process.stdout.write(hashPassword(password) + '\n');
  password = '';
}

if (input.isTTY && input.setRawMode) {
  process.stdout.write('Enter an Owner password (12+ characters; input hidden): ');
  input.setRawMode(true);
  input.resume();
  input.on('data', chunk => {
    for (const char of decoder.write(chunk)) {
      if (char === '\u0003') {
        password = '';
        process.stdout.write('\nCancelled.\n');
        process.exitCode = 1;
        input.setRawMode(false);
        input.pause();
        return;
      }
      if (char === '\r' || char === '\n') return finish();
      if (char === '\u007f' || char === '\b') password = Array.from(password).slice(0, -1).join('');
      else if (char >= ' ' && char !== '\u007f' && Array.from(password).length < 1024) password += char;
    }
  });
} else {
  process.stderr.write('Run this command in an interactive terminal so the password stays hidden.\n');
  process.exitCode = 1;
}
