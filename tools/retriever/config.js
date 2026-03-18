'use strict';

module.exports = {
  extensions: ['.js', '.jsx', '.ts', '.tsx', '.py'],
  ignoreDirs: ['node_modules', 'dist', 'build', '.git', 'vendor', '__pycache__', '.next', 'coverage'],
  maxEntities: 40,
  maxFiles: 15,
  maxSnippetLines: 120,
  snippetContextLines: 2,
};
