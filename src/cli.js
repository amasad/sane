#!/usr/bin/env node
'use strict';

const sane = require('../');
const argv = require('minimist')(process.argv.slice(2));
const spawn = require('child_process').spawn;
const pkill = require('tree-kill');


if (argv._.length === 0) {
  const msg =
    'Usage: sane <command> [...directory] [--glob=<filePattern>] ' +
    '[--ignored=<filePattern>] [--poll] [--watchman] [--watchman-path=<watchmanBinaryPath>] [--dot] ' +
    '[--kill] [--kill-signal=<signal>]' +
    '[--wait=<seconds>]';
  console.error(msg);
  process.exit();
}

const opts = {};
const command = argv._[0];
const dir = argv._[1] || process.cwd();
const waitTime = Number(argv.wait || argv.w);
const dot = argv.dot || argv.d;
const glob = argv.glob || argv.g;
const ignored = argv.ignored || argv.i;
const poll = argv.poll || argv.p;
const watchman = argv.watchman || argv.w;
const watchmanPath = argv['watchman-path'];
const kill = argv.kill || argv.k;
const killSignal = argv['kill-signal'] || argv.s;

if (dot) {
  opts.dot = true;
}
if (glob) {
  opts.glob = glob;
}
if (ignored) {
  opts.ignored = ignored;
}
if (poll) {
  opts.poll = true;
}
if (watchman) {
  opts.watchman = true;
}
if (watchmanPath) {
  opts.watchmanPath = watchmanPath;
}

let child = null;
let runCommand = function() {
  if (kill && child) {
    pkill(child.pid, killSignal || 'SIGTERM', function(err) {
      child = spawn(command, [], { shell: true, stdio: 'inherit' });
    });
  } else {
    child = spawn(command, [], { shell: true, stdio: 'inherit' });
  }
}

let wait = false;
const watcher = sane(dir, opts);

watcher.on('ready', function() {
  console.log('Watching: ', dir + '/' + (opts.glob || ''));
  runCommand();
});

watcher.on('change', function(filepath) {
  if (wait) {
    return;
  }
  console.log('Change detected in:', filepath);
  runCommand();

  if (waitTime > 0) {
    wait = true;
    setTimeout(function() {
      wait = false;
    }, waitTime * 1000);
  }
});
