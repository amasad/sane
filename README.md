sane
----

I've been driven to insanity by node filesystem watcher wrappers.
Sane aims to be fast, small, and reliable file system watcher.

## API

### sane(dir, globs)

Watches a directory and all it's descendant directorys for changes, deletions, and additions on files and directories.
Shortcut for `new sane.Watcher(files, {globs: globs})`.

```js
var watcher = sane('path/to/dir', ['**/*.js, '**/*.css']);
watcher.on('ready', function () { console.log('ready') });
watcher.on('change', function (filepath) { console.log('file changed', filepath); });
watcher.on('add', function (filepath) { console.log('file added', filepath); });
watcher.on('delete', function (filepath) { console.log('file deleted', filepath); });
// close
watcer.close();
```

### sane.Watcher(dir, options)

options:

* `persistent`: boolean indicating that the process shouldn't die while we're watching files.
* `glob`: a single string glob pattern or an array of them.

For the glob pattern documentation, see [minimatch](https://github.com/isaacs/minimatch).

### sane.Watcher#close

### sane.Watcher events

Emits the following events:

All events are passed the file/dir path relative to the root directory
* `ready` when the program is ready to detect events in the directory
* `change` when a file changes
* `add` when a file or directory has been added
* `delete` when a file or directory has been deleted

Stops watching.

## License

MIT
