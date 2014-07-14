sane
----

I've been driven to insanity by node filesystem watcher wrappers.
Sane aims to be fast, small, and reliable file system watcher. It does that by:

* Always use fs.watch (unless polling is forced) and sensibly workaround the various issues with it
* Sane is all JavaScript, no native components
* Stay away from polling because it's very slow and cpu intensive
* Support polling for environments like Vagrant shared directory where there are no native filesystem events

## Install

Requires node >= v0.10.0.

```
$ npm install sane
```

## API

### sane(dir, globs, options)

Watches a directory and all it's descendant directorys for changes, deletions, and additions on files and directories.
Shortcut for `new sane.Watcher(dir, {glob: globs, ..options})`.

```js
var watcher = sane('path/to/dir', ['**/*.js, '**/*.css']);
watcher.on('ready', function () { console.log('ready') });
watcher.on('change', function (filepath) { console.log('file changed', filepath); });
watcher.on('add', function (filepath) { console.log('file added', filepath); });
watcher.on('delete', function (filepath) { console.log('file deleted', filepath); });
// close
watcher.close();
```

For `options` see `sane.Watcher`.

### sane.Watcher(dir, options)

options:

* `persistent`: boolean indicating that the process shouldn't die while we're watching files.
* `glob`: a single string glob pattern or an array of them.
* `poll`: puts the watcher in polling mode. Under the hood that means `fs.watchFile`.
* `interval`: indicates how often the files should be polled. (passed to `fs.watchFile`)

For the glob pattern documentation, see [minimatch](https://github.com/isaacs/minimatch).

### sane.Watcher#close

Stops watching.

### sane.Watcher events

Emits the following events:

All events are passed the file/dir path relative to the root directory
* `ready` when the program is ready to detect events in the directory
* `change` when a file changes
* `add` when a file or directory has been added
* `delete` when a file or directory has been deleted

## License

MIT
