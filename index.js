// @flow
'use strict';
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const spawn = require('spawndamnit');
const pLimit = require('p-limit');
const os = require('os');
const chalk = require('chalk');
const Table = require('cli-table');
const prettyBytes = require('pretty-bytes');

const fsLimit = pLimit(64);
const processLimit = pLimit(os.cpus().length);
const mkdir = promisify(fs.mkdir);
const writeFile = promisify(fs.writeFile);
const stat = promisify(fs.stat);

async function exists(filePath) {
  try {
    let fileStat = await stat(filePath);
    return fileStat.isFile();
  } catch (err) {
    if (err.code === 'ENOENT') {
      return false;
    } else {
      throw err;
    }
  }
}

const DEPS = [
  'analytics/annotation',
  'array-find',
  'assert',
  'axios',
  'bricks.js',
  'bytes',
  'calendar-base',
  'chromatism',
  'chunkinator',
  'classnames',
  'collapse-whitespace',
  'css-color-names',
  'date-fns',
  'date-fns/distance_in_words_to_now',
  'date-fns/format',
  'date-fns/get_time',
  'date-fns/is_before',
  'date-fns/is_same_day',
  'date-fns/is_this_year',
  'date-fns/is_today',
  'date-fns/is_yesterday',
  'date-fns/parse',
  'date-fns/start_of_day',
  'dateformat',
  'deep-equal',
  'domready',
  'es6-promise',
  'eventemitter2',
  'filesize',
  'focusin',
  'jquery',
  'js-search',
  'keycode',
  'linkify-it',
  'lodash.clonedeep',
  'lodash.debounce',
  'lodash.pick',
  'lowlight',
  'lowlight/lib/core',
  'lru-fast',
  'markdown-it',
  'markdown-it-table',
  'memoize-one',
  'outdent',
  'p-queue',
  'polished/lib/color/parseToRgb',
  'polished/lib/color/rgba',
  'postis',
  'prismjs',
  'prop-types',
  'prosemirror-commands',
  'prosemirror-history',
  'prosemirror-inputrules',
  'prosemirror-keymap',
  'prosemirror-markdown',
  'prosemirror-model',
  'prosemirror-schema-list',
  'prosemirror-state',
  'prosemirror-tables',
  'prosemirror-transform',
  'prosemirror-utils',
  'prosemirror-view',
  'query-string',
  'querystring',
  'raf-schd',
  'react',
  'react-addons-text-content',
  'react-beautiful-dnd',
  'react-deprecate',
  'react-dom',
  'react-lazily-render',
  'react-redux',
  'react-render-image',
  'react-scrolllock',
  'react-select',
  'react-select/lib/Async',
  'react-select/lib/AsyncCreatable',
  'react-select/lib/Creatable',
  'react-select/lib/animated',
  'react-syntax-highlighter',
  'react-transition-group',
  'react-transition-group/Transition',
  'react-transition-group/TransitionGroup',
  'react-virtualized/dist/commonjs/List',
  'redux',
  'redux-devtools-extension/developmentOnly',
  'redux-thunk',
  'refractor',
  'refractor/core',
  'resumablejs',
  'rusha',
  'rxjs',
  'rxjs/Observable',
  'rxjs/Subject',
  'rxjs/Subscription',
  'styled-components',
  'tabbable',
  // 'typescript',
  'typestyle',
  'ua-parser-js',
  'url',
  'uuid',
  'uuid/v1',
  'uuid/v4',
  'xregexp/src/addons/unicode-base',
  'xregexp/src/addons/unicode-categories',
  'xregexp/src/addons/unicode-scripts',
  'xregexp/src/xregexp',
];

const DIST_PATH = path.join(__dirname, 'dist');
const ROLLUP_BIN = path.join(__dirname, 'node_modules', '.bin', 'rollup');
const CONFIG_PATH = path.join(__dirname, 'rollup.config.js');

async function createEntry(kind, name, fileContents) {
  let id = name.replace(/\//g, '--');
  let input = path.join(DIST_PATH, id + '.js');
  let output = path.join(DIST_PATH, id + '.bundle.js');
  let outputGz = path.join(DIST_PATH, id + '.bundle.js.gz');
  await writeFile(input, fileContents);
  return { kind, name, id, input, output, outputGz };
}

async function main() {
  try {
    await mkdir(DIST_PATH);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }

  let entries = await Promise.all(DEPS.map(name => fsLimit(() => {
    return createEntry('module', name, `console.log(require('${name}'));`);
  })));

  entries.push(
    await createEntry('all', '_all', DEPS.map(name => `console.log(require('${name}'));`).join('\n'))
  );


  let results = await Promise.all(entries.map(entry => processLimit(async () => {
    let { code, stdout, stderr } = await spawn(ROLLUP_BIN, [
      '-c', CONFIG_PATH,
    ], {
      env: Object.assign({}, process.env, {
        ROLLUP_INPUT_FILE: entry.input,
        ROLLUP_OUTPUT_FILE: entry.output,
        ROLLUP_TARGET_NAME: entry.name,
        ROLLUP_TARGET_ONLY: entry.kind === 'all' ? 'false' : 'true',
      }),
      // stdio: 'inherit',
    });

    let sizes = {};

    if (code === 0) {
      let outputStats = await stat(entry.output);
      let outputStatsGz = await stat(entry.outputGz);

      sizes.outputBytes = outputStats.size;
      sizes.outputBytesGz = outputStatsGz.size;

      console.log(chalk.dim(`${entry.name}: ${prettyBytes(sizes.outputBytes)} min, ${prettyBytes(sizes.outputBytesGz)} min+gz`));
    } else {
      console.log(chalk.red(entry.name));
    }

    return { entry, code, stdout, stderr, sizes };
  })));

  let successful = results.filter(res => {
    if (res.code !== 0) {
      console.log(chalk.red.bold(res.entry.name));
      console.log(res.stderr.toString());
      console.log(chalk.red(`Exited with ${res.code}`));
    }
    return res.code === 0;
  });

  let sorted = successful.sort((a, b) => {
    return b.sizes.outputBytesGz - a.sizes.outputBytesGz;
  });

  let totals = successful.reduce((totals, res) => {
    return {
      outputBytes: totals.outputBytes + res.sizes.outputBytes,
      outputBytesGz: totals.outputBytesGz + res.sizes.outputBytesGz,
    };
  }, {
    outputBytes: 0,
    outputBytesGz: 0,
  });

  let table = new Table({
    head: ['Name', 'min', 'min+gz']
  });

  sorted.forEach(res => {
    table.push([
      res.entry.name === '_all' ? chalk.bold.yellow('All'): res.entry.name,
      prettyBytes(res.sizes.outputBytes),
      prettyBytes(res.sizes.outputBytesGz),
    ]);
  });

  // table.push([
  //   chalk.bold.yellow('Totals'),
  //   chalk.bold.yellow(prettyBytes(totals.outputBytes)),
  //   chalk.bold.yellow(prettyBytes(totals.outputBytesGz)),
  // ]);

  console.log(table.toString());
}

main().catch(err => {
  console.log(err);
});
