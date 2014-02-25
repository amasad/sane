sane
----

I've been driven to insanity by node filesystem watcher wrappers.
Sane aims to be fast, small, and reliable file system watcher. No bells and whistles, just change events.

## API

### sane(dir, globs)

Shortcut for `new sane.Watcher(files, {globs: globs})`

```js
var watcher = sane('path/to/dir', ['**/*.js, '**/*.css']);
watcher.on('ready', function () { console.log('ready') });
watcher.on('change', function (filepath) { console.log('file changed', filepath); });
// close
watcer.close();
```

### sane.Watcher(dir, options)

options:

* `persistent`: boolean indicating that the process shouldn't die while we're watching files.
* `glob`: a single string glob pattern or an array of them.

For the glob pattern documentation, see [minimatch](https://github.com/isaacs/minimatch).

### sane.Watcher#close

Stops watching.

## License

MIT
