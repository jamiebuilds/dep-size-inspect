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

const DIST_PATH = path.join(__dirname, 'dist');
const PKG_PATH = path.join(DIST_PATH, 'package.json');
const ROLLUP_BIN = path.join(__dirname, 'node_modules', '.bin', 'rollup');
const CONFIG_PATH = path.join(__dirname, 'rollup.config.js');

const DEPS = [
  'react',
  'react-dom',
  'react-select',
  'styled-components',
  'redux',
  'react-redux',
  'react-transition-group',
  'react-virtualized',
  'react-router',
  'react-router-dom',
  'reselect',
  'react-helmet',
  'prop-types',
  'react-dnd',
  'react-responsive',
  'react-table',
  'axios',
  'react-intl',
  'immutable',
];

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

  let dependencies = {};

  DEPS.forEach(dep => {
    dependencies[dep] = 'latest';
  });

  await writeFile(PKG_PATH, JSON.stringify({
    name: 'test-pkg',
    dependencies,
  }, null, 2));


  await spawn('yarn', ['install'], {
    cwd: DIST_PATH,
    stdio: 'inherit'
  });

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
      stdio: 'inherit',
    });

    let sizes = {};

    if (code === 0) {
      let outputStats = await stat(entry.output);
      let outputStatsGz = await stat(entry.outputGz);

      sizes.outputBytes = outputStats.size;
      sizes.outputBytesGz = outputStatsGz.size;

      console.log(chalk.bold.green(`\n>>> ${entry.name}: ${prettyBytes(sizes.outputBytes)} min, ${prettyBytes(sizes.outputBytesGz)} min+gz\n`));
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
