import resolve from 'rollup-plugin-node-resolve';
import babel from 'rollup-plugin-babel';
import commonjs from 'rollup-plugin-commonjs';
import alias from 'rollup-plugin-alias';
import uglify from 'rollup-plugin-uglify';
import replace from 'rollup-plugin-replace';
import gzip from 'rollup-plugin-gzip';
import prettier from 'rollup-plugin-prettier';
import json from 'rollup-plugin-json';
import resolveFrom from 'resolve-from';

// we must do this because the React libraries use object properties
// to export things, see this for more information:
// https://github.com/rollup/rollup-plugin-commonjs#custom-named-exports
const namedExports = {
  'node_modules/react/index.js': [
    'Children', 'Component', 'PureComponent', 'createElement', 'cloneElement',
    'isValidElement', 'createFactory', 'version', 'Fragment'
  ],
  'node_modules/react-dom/index.js': [
    'findDOMNode', 'render', 'unmountComponentAtNode', 'version'
  ]
};

let config = {
  input: process.env.ROLLUP_INPUT_FILE,
  output: {
    file: process.env.ROLLUP_OUTPUT_FILE,
    format: 'cjs'
  },
  plugins: [
    resolve({
      preferBuiltins: false,
    }),
    babel({
      externalHelpers: true,
      exclude: 'node_modules/**'
    }),
    commonjs({ namedExports }),
    replace({
      'process.env.NODE_ENV': '"production"',
    }),
    uglify({
      mangle: {
        toplevel: true
      },
    }),
    gzip({
      algorithm: 'zopfli',
      options: {
        numiterations: 10
      }
    }),
    json(),
  ]
};

if (process.env.ROLLUP_TARGET_ONLY === 'true') {
  config.external = id => {
    if (id[0] === '.') return false;
    if (id.includes(process.env.ROLLUP_INPUT_FILE)) return false;
    if (id.includes(process.env.ROLLUP_TARGET_NAME)) return false;
    return true;
  };
}

export default config;
