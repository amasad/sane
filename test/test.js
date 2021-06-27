/* eslint-env node, mocha */
'use strict';

const fs = require('fs');
const sane = require('../');
const rimraf = require('rimraf');
const path = require('path');
const assert = require('assert');
const tmp = require('tmp');

tmp.setGracefulCleanup();
const jo = path.join.bind(path);

describe('sane in polling mode', function() {
  harness.call(this, { poll: true });
});
describe('sane in node mode', function() {
  harness.call(this, {});
});

describe('sane in fsevents mode', function() {
  it('errors in a helpful manner', function() {
    assert.throws(() => sane.FSEventsWatcher, 'asdf');
    assert.throws(() => sane('/dev/null', { fsevents: true }), 'asdf');
  });
});

describe('sane in watchman mode', function() {
  harness.call(this, { watchman: true });
});
describe('sane in watchman mode with offset project', function() {
  harness.call(this, { watchman: true, offset: true });
});

describe('sane in watchexec mode', function() {
  harness.call(this, { watchexec: true });
});

function getWatcherClass(mode) {
  if (mode.watchman) {
    return sane.WatchmanWatcher;
  } else if (mode.WatchexecWatcher) {
    return sane.WatchexecWatcher;
  } else if (mode.poll) {
    return sane.PollWatcher;
  } else {
    return sane.NodeWatcher;
  }
}

function harness(mode) {
  const defer = fn => setTimeout(fn, mode.poll ? 1000 : 300);

  if (mode.poll) {
    this.timeout(5000);
  }

  let global_testdir = null;
  let testdir = null;
  after(function() {
    if (global_testdir) {
      try {
        rimraf.sync(global_testdir.name);
      } catch (e) {
        // Doesn't exist
      }
    }
  });
  before(function() {
    global_testdir = tmp.dirSync({
      prefix: 'sane-test',
      unsafeCleanup: true,
    });
    testdir = fs.realpathSync(global_testdir.name);

    // Some Watchman deployments are restricted to watching
    // project roots.  Let's fake one
    fs.mkdirSync(jo(testdir, '.git'));

    // If testing watchman watch-project in offset mode, create an offset dir
    if (mode.offset) {
      testdir = jo(testdir, 'offset');
      fs.mkdirSync(testdir);
    }

    for (let i = 0; i < 10; i++) {
      fs.writeFileSync(jo(testdir, 'file_' + i), 'test_' + i);
      let subdir = jo(testdir, 'sub_' + i);
      try {
        fs.mkdirSync(subdir);
      } catch (e) {
        // Already exists.
      }
      for (let j = 0; j < 10; j++) {
        fs.writeFileSync(jo(subdir, 'file_' + j), 'test_' + j);
      }
    }
  });

  describe('sane plugin', function() {
    beforeEach(function() {
      this.watcher = sane(testdir, {
        glob: '**/file_1',
        watcher: './test/plugin_watcher',
      });
    });

    afterEach(function(done) {
      this.watcher.close(done);
    });

    it('uses the custom plugin watcher', function(done) {
      this.watcher.on('is-test-plugin', function() {
        done();
      });
    });
  });

  describe('sane(file)', function() {
    beforeEach(function() {
      let Watcher = getWatcherClass(mode);
      this.watcher = new Watcher(testdir);
    });

    afterEach(function(done) {
      this.watcher.close(done);
    });

    it('emits a ready event', function(done) {
      this.watcher.on('ready', done);
      this.watcher.on('error', function(error) {
        done(error);
      });
    });

    it('change emits event', function(done) {
      let testfile = jo(testdir, 'file_1');
      this.watcher.on('error', function(error) {
        done(error);
      });
      this.watcher.on('change', function(filepath, dir, stat) {
        assert(stat instanceof fs.Stats);
        assert.equal(filepath, path.relative(testdir, testfile));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('ready', function() {
        fs.writeFileSync(testfile, 'wow');
      });
    });

    it('emits change events for subdir files', function(done) {
      let subdir = 'sub_1';
      let testfile = jo(testdir, subdir, 'file_1');
      this.watcher.on('change', (filepath, dir) => {
        assert.equal(filepath, path.relative(testdir, testfile));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('ready', function() {
        fs.writeFileSync(testfile, 'wow');
      });
    });
    it('adding a file will trigger an add event', function(done) {
      let testfile = jo(testdir, 'file_x' + Math.floor(Math.random() * 10000));
      this.watcher.on('add', (filepath, dir, stat) => {
        assert(stat instanceof fs.Stats);
        assert.equal(filepath, path.relative(testdir, testfile));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('change', () => {
        done(new Error('Should not emit change on add'));
      });
      this.watcher.on('ready', () => {
        fs.writeFileSync(testfile, 'wow');
      });
    });

    it('removing a file will emit delete event', function(done) {
      let testfile = jo(testdir, 'file_9');
      this.watcher.on('delete', (filepath, dir) => {
        assert.equal(filepath, path.relative(testdir, testfile));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('ready', () => fs.unlinkSync(testfile));
    });

    it('changing, removing, deleting should emit the "all" event', function(done) {
      let toChange = jo(testdir, 'file_4');
      let toDelete = jo(testdir, 'file_5');
      let toAdd = jo(testdir, 'file_x' + Math.floor(Math.random() * 10000));
      let i = 0;
      let added = false;

      this.watcher.on('all', (type, filepath, dir, stat) => {
        assert.equal(dir, testdir);
        if (type === 'change') {
          // Windows emits additional change events for newly created files.
          if (added && filepath === path.relative(dir, toAdd)) {
            return;
          }
          assert(stat instanceof fs.Stats);
          assert.equal(filepath, path.relative(dir, toChange));
        } else if (type === 'delete') {
          assert(!stat);
          assert.equal(filepath, path.relative(dir, toDelete));
        } else if (type === 'add') {
          assert(stat instanceof fs.Stats);
          assert.equal(filepath, path.relative(dir, toAdd));
          added = true;
        }
        if (++i === 3) {
          done();
        }
      });

      this.watcher.on('ready', () => {
        fs.writeFileSync(toChange, 'hai');
        fs.unlinkSync(toDelete);
        fs.writeFileSync(toAdd, 'hai wow');
      });
    });

    it('removing a dir will emit delete event', function(done) {
      let subdir = jo(testdir, 'sub_9');
      this.watcher.on('delete', (filepath, dir) => {
        // Ignore delete events for files in the dir.
        if (path.dirname(filepath) === path.relative(testdir, subdir)) {
          return;
        }
        assert.equal(filepath, path.relative(testdir, subdir));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('ready', () => rimraf.sync(subdir));
    });

    it('adding a dir will emit an add event', function(done) {
      let subdir = jo(testdir, 'sub_x' + Math.floor(Math.random() * 10000));
      this.watcher.on('add', (filepath, dir, stat) => {
        assert(stat instanceof fs.Stats);
        assert.equal(filepath, path.relative(testdir, subdir));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('ready', () => fs.mkdirSync(subdir));
    });

    it('adding in a subdir will trigger an add event', function(done) {
      let subdir = jo(testdir, 'sub_x' + Math.floor(Math.random() * 10000));
      let testfile = jo(subdir, 'file_x' + Math.floor(Math.random() * 10000));
      let i = 0;
      this.watcher.on('add', (filepath, dir, stat) => {
        assert(stat instanceof fs.Stats);
        if (++i === 1) {
          assert.equal(filepath, path.relative(testdir, subdir));
          assert.equal(dir, testdir);
        } else {
          assert.equal(filepath, path.relative(testdir, testfile));
          assert.equal(dir, testdir);
          done();
        }
      });
      this.watcher.on('ready', () => {
        fs.mkdirSync(subdir);
        defer(() => fs.writeFileSync(testfile, 'wow'));
      });
    });

    it('closes watchers when dirs are deleted', function(done) {
      let subdir = jo(testdir, 'sub_1');
      let testfile = jo(subdir, 'file_1');
      let actualFiles = {};
      let expectedFiles = {};
      expectedFiles[path.relative(testdir, subdir)] = true;
      expectedFiles[path.relative(testdir, testfile)] = true;
      this.watcher.on('ready', () => {
        this.watcher.on('add', filepath => {
          // win32 order is not guaranteed and events may leak between tests
          if (expectedFiles[filepath]) {
            actualFiles[filepath] = true;
          }
          if (Object.keys(actualFiles).length === 2) {
            assert.deepEqual(expectedFiles, actualFiles);
            done();
          }
        });
        rimraf.sync(subdir);
        defer(() => {
          fs.mkdirSync(subdir);
          defer(() => fs.writeFileSync(testfile, 'wow'));
        });
      });
    });

    it('should be ok to remove and then add the same file', function(done) {
      let testfile = jo(testdir, 'sub_8', 'file_1');
      this.watcher.on('add', (filepath, dir) => {
        assert.equal(filepath, path.relative(testdir, testfile));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('delete', (filepath, dir) => {
        assert.equal(filepath, path.relative(testdir, testfile));
        assert.equal(dir, testdir);
      });
      this.watcher.on('ready', () => {
        fs.unlinkSync(testfile);
        defer(() => fs.writeFileSync(testfile, 'wow'));
      });
    });

    if (!mode.poll) {
      it('emits events for subdir/subdir files', function(done) {
        let subdir1 = 'subsub_1';
        let subdir2 = 'subsub_2';
        let filename = 'file_1';
        let testfile = jo(testdir, subdir1, subdir2, filename);
        let addedSubdir1 = false;
        let addedSubdir2 = false;
        let addedFile = false;
        this.watcher.on('add', filepath => {
          if (filepath === subdir1) {
            assert.equal(addedSubdir1, false);
            addedSubdir1 = true;
          } else if (filepath === jo(subdir1, subdir2)) {
            assert.equal(addedSubdir2, false);
            addedSubdir2 = true;
          } else if (filepath === jo(subdir1, subdir2, filename)) {
            assert.equal(addedFile, false);
            addedFile = true;
          }
          if (addedSubdir1 && addedSubdir2 && addedFile) {
            done();
          }
        });
        this.watcher.on('ready', () => {
          fs.mkdirSync(jo(testdir, subdir1));
          fs.mkdirSync(jo(testdir, subdir1, subdir2));
          fs.writeFileSync(testfile, 'wow');
        });
      });
      it('emits events for subdir/subdir files 2', function(done) {
        let subdir1 = 'subsub_1b';
        let subdir2 = 'subsub_2b';
        let filename = 'file_1b';
        let testfile = jo(testdir, subdir1, subdir2, filename);
        let addedSubdir1 = false;
        let addedSubdir2 = false;
        let addedFile = false;
        this.watcher.on('add', filepath => {
          if (filepath === subdir1) {
            assert.equal(addedSubdir1, false);
            addedSubdir1 = true;
          } else if (filepath === jo(subdir1, subdir2)) {
            assert.equal(addedSubdir2, false);
            addedSubdir2 = true;
          } else if (filepath === jo(subdir1, subdir2, filename)) {
            assert.equal(addedFile, false);
            addedFile = true;
          }
          if (addedSubdir1 && addedSubdir2 && addedFile) {
            done();
          }
        });
        this.watcher.on('ready', () => {
          fs.mkdirSync(jo(testdir, subdir1));
          fs.mkdirSync(jo(testdir, subdir1, subdir2));
          setTimeout(() => fs.writeFileSync(testfile, 'wow'), 500);
        });
      });
    }
  });

  describe('sane(file, glob)', function() {
    beforeEach(function() {
      let Watcher = getWatcherClass(mode);
      this.watcher = new Watcher(testdir, { glob: ['**/file_1', '**/file_2'] });
    });

    afterEach(function(done) {
      this.watcher.close(done);
    });

    it('ignore files according to glob', function(done) {
      let i = 0;
      this.watcher.on('change', (filepath, dir) => {
        assert.ok(filepath.match(/file_(1|2)/), 'only file_1 and file_2');
        assert.equal(dir, testdir);
        if (++i == 2) {
          done();
        }
      });
      this.watcher.on('ready', () => {
        fs.writeFileSync(jo(testdir, 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_9'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_3'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_2'), 'wow');
      });
    });
  });

  describe('sane(dir, {dot: false})', function() {
    beforeEach(function() {
      let Watcher = getWatcherClass(mode);
      this.watcher = new Watcher(testdir, { dot: false });
    });

    afterEach(function(done) {
      this.watcher.close(done);
    });

    it('should ignore dot files', function(done) {
      let i = 0;
      this.watcher.on('change', (filepath, dir) => {
        assert.ok(filepath.match(/file_(1|2)/), 'only file_1 and file_2');
        assert.equal(dir, testdir);
        if (++i == 2) {
          done();
        }
      });
      this.watcher.on('ready', () => {
        fs.writeFileSync(jo(testdir, 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, '.file_9'), 'wow');
        fs.writeFileSync(jo(testdir, '.file_3'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_2'), 'wow');
      });
    });

    it('should ignore dot dirs', function(done) {
      this.watcher.on('change', (filepath, dir) => {
        assert.ok(filepath.match(/file_1/), 'only file_1 got : ' + filepath);
        assert.equal(dir, testdir);
        done();
      });

      this.watcher.on('add', filepath => {
        if (filepath.match(/^\.lol/)) {
          done(new Error('Should not emit add events for ignored dirs'));
        }
      });

      this.watcher.on('ready', () => {
        let subdir = jo(testdir, '.lol' + Math.floor(Math.random() * 10000));
        fs.mkdirSync(subdir);
        fs.writeFileSync(jo(subdir, 'file'), 'wow');
        fs.writeFileSync(jo(subdir, '.file_3'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_1'), 'wow');
      });
    });
  });

  describe('sane(dir, ignored)', function() {
    beforeEach(function() {
      let Watcher = getWatcherClass(mode);
      this.watcher = new Watcher(testdir, {
        ignored: ['**/file_3', /file_4/, file => file.indexOf('file_5') !== -1],
      });
    });

    afterEach(function(done) {
      this.watcher.close(done);
    });

    it('ignores files', function(done) {
      let i = 0;
      this.watcher.on('change', (filepath, dir) => {
        assert.ok(filepath.match(/file_(1|2)/), 'only file_1 and file_2');
        assert.equal(dir, testdir);
        if (++i === 2) {
          done();
        }
      });
      this.watcher.on('ready', () => {
        fs.writeFileSync(jo(testdir, 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_4'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_3'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_5'), 'wow');
        fs.writeFileSync(jo(testdir, 'file_2'), 'wow');
      });
    });
  });

  describe('sane(dir, ignored) - node_watcher directory ignore', function() {
    beforeEach(function() {
      let Watcher = getWatcherClass({}); // node_watcher only
      this.watcher = new Watcher(testdir, {
        ignored: [/sub_0/, file => file.indexOf('sub_1') !== -1],
      });
      //overwrite standard ignore for test
      this.watcher.doIgnore = () => false;
    });

    afterEach(function(done) {
      this.watcher.close(done);
    });

    it('ignores folders', function(done) {
      let i = 0;
      this.watcher.on('change', (filepath, dir) => {
        assert.ok(
          !filepath.match(/sub_(0|1)/),
          'Found changes in ignored subdir sub_0 and/or sub_1'
        );
        assert.equal(dir, testdir);
        if (++i == 2) {
          done();
        }
      });
      this.watcher.on('ready', () => {
        fs.writeFileSync(jo(testdir, 'sub_0', 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, 'sub_1', 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, 'sub_2', 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, 'sub_3', 'file_1'), 'wow');
        fs.writeFileSync(jo(testdir, 'sub_4', 'file_1'), 'wow');
      });
    });
  });

  describe('sane shortcut alias', function() {
    beforeEach(function() {
      this.watcher = sane(testdir, {
        glob: '**/file_1',
        poll: mode.poll,
        watchman: mode.watchman,
      });
    });

    afterEach(function(done) {
      this.watcher.close(done);
    });

    it('allows for shortcut mode using just a string as glob', function(done) {
      this.watcher.on('change', (filepath, dir) => {
        assert.ok(filepath.match(/file_1/));
        assert.equal(dir, testdir);
        done();
      });
      this.watcher.on('ready', () => {
        fs.writeFileSync(jo(testdir, 'file_1'), 'wow');
      });
    });
  });
}
