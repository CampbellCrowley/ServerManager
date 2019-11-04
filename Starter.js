// Copyright 2018-2019 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (web@campbellcrowley.com)
const spawn = require('child_process').spawn;
const fs = require('fs');
const config = require('./config.js').starter;

/**
 * @classdesc The parent of all processes. Spawns Master.js as a child process
 * and restarts it if it dies. Pipes all output to log.
 * @class
 */
function Starter() {
  /**
   * The output filestream for logging.
   *
   * @private
   * @type {fs.WriteStream}
   */
  let file;
  /**
   * The current running process.
   *
   * @private
   * @type {ChildProcess}
   */
  let app;

  /**
   * Spawn a child process and pipe it's output to a log. When the child exits,
   * spawn a new one.
   *
   * @private
   */
  function start() {
    if (app) {
      app.kill('SIGHUP');
      app = null;
    }
    openLogFile();
    file.write('\nSTARTING MASTER\n');
    app = spawn('nodejs', [`${__dirname}/Master.js`], {stdio: 'pipe'});
    app.on('exit', start);
    app.on('error', file.write);
    app.stderr.pipe(file);
    app.stdout.pipe(file);
  }

  /**
   * Open the logfile for writing and start piping all the Master.js stdout and
   * stderr to the file. Called at SIGUSR1 and at boot.
   * @private
   */
  function openLogFile() {
    if (file) file.close();
    file = fs.createWriteStream(config.logfile, {flags: 'a', autoClose: false});
    file.write('OPENED LOG FILE FOR WRITING, ' + new Date());
    if (app) {
      app.on('error', file.write);
      app.stderr.pipe(file);
      app.stdout.pipe(file);
    }
  }

  process.on('SIGUSR1', openLogFile);

  start();
}

module.exports = new Starter();
