var assert = require('assert');
var common = require('../src/common.js');

context('common.js', function () {
  context('isFileIncluded', function () {
    var globs = ['./**/*'];
    var ignore = ['./test/**/*'];

    it('should match a single file', function () {
      assert(common.isFileIncluded(
        globs,
        false,
        [],
        './package.json'
      ));
    });

    it('should respect ignore patterns', function () {
      assert(common.isFileIncluded(
        globs,
        false,
        [],
        './test/common.js'
      ));
      assert(!common.isFileIncluded(
        globs,
        false,
        ignore,
        './test/common.js'
      ));
    });

    it('should accept the ./ when there are no globs only if dot is true', function() {
      assert(!common.isFileIncluded(
        [],
        false,
        [],
        './'
      ));

      assert(common.isFileIncluded(
        [],
        true,
        [],
        './'
      ));
    });
  });
});
