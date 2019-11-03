// Copyright 2018-2019 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (dev@campbellcrowley.com)
const dateFormat = require('dateformat');
const fs = require('fs');

/**
 * Commonly required things. Helper functions and constants.
 *
 * @class
 */
function Common() {
  const self = this;
  /**
   * The number of characters reserved for the filename of the script.
   *
   * @private
   * @constant
   * @type {number}
   * @default
   */
  const prefixLength = 14;

  /**
   * The color code to prefix log messages with for this script.
   *
   * @private
   * @type {number}
   * @default
   */
  let mycolor = 0;
  /**
   * The script's filename to show in the log.
   *
   * @private
   * @type {string}
   * @constant
   */
  const app = process.argv[1] ?
      process.argv[1].substring(process.argv[1].lastIndexOf('/') + 1) :
      '';
  /**
   * The final formatted filename for logging.
   *
   * @private
   * @type {string}
   */
  let title;

  /**
   * Whether this should be shown as a release version, or a debug version in
   * the log.
   *
   * @type {boolean}
   */
  this.isRelease = false;
  /**
   * Whether this current instance is running as a unit test.
   *
   * @type {boolean}
   */
  this.isTest = false;

  /**
   * Initialize variables and settings for logging properly.
   *
   * @param {boolean} isTest Is this running as a test.
   * @param {boolean} isRelease Is this a release version, or a development
   * version of the app running.
   */
  this.begin = function(isTest, isRelease) {
    self.isRelease = isRelease || false;
    self.isTest = isTest || false;
    switch (app) {
      case 'Master.js':
        mycolor = 32;
        break;
    }
    let temptitle = app;
    if (self.isRelease) temptitle = 'R' + temptitle;
    else temptitle = 'D' + temptitle;

    for (let i = temptitle.length; i < prefixLength; i++) {
      temptitle += ' ';
    }
    if (temptitle.length > prefixLength) {
      temptitle = temptitle.substring(0, prefixLength);
    }
    temptitle += ' ';
    title = temptitle;

    self.log(app + ' Begin');
  };

  /**
   * Pad an IP address with zeroes.
   *
   * @param {number} str The ipv4 address as a string to format.
   * @returns {string} The padded address.
   */
  this.padIp = function(str) {
    const dM = str.match(/\./g);
    const cM = str.match(/:/g);
    if (dM && dM.length == 3) {
      const res = str.split('.');
      for (let i = 0; i < res.length; i++) {
        res[i] = ('000' + res[i]).slice(-3);
        res[i] = res[i].replace(':', '0');
      }
      str = res.join('.');
    } else if (cM && cM.length == 7) {
      const res = str.split(':');
      for (let i = 0; i < res.length; i++) {
        res[i] = ('0000' + res[i]).slice(-4);
        // res[i] = res[i].replace(':', '0');
      }
      str = res.join(':');
    }
    for (let i = str.length; i < 45; i++) {
      str += ' ';
    }
    return str.substring(0, 45);
  };

  /**
   * Formats a given IP address by padding with zeroes, or completely replacing
   * with a human readable alias if the address is a known location.
   *
   * @param {string} ip The ip address to format.
   * @returns {string} The formmatted address.
   */
  this.getIPName = function(ip) {
    ip = self.padIp(ip);
    switch (ip) {
      default:
        return ip;
      case '':
      case '   ':
      case '127.000.000.001':
        return 'SELF           ';
      case '205.167.046.140':
      case '205.167.046.157':
      case '205.167.046.15':
      case '204.088.159.118':
        return 'MVHS           ';
    }
  };
  /**
   * Format a prefix for a log message or error. Includes the ip before the
   * message.
   *
   * @param {string} ip The ip to include in the prefix.
   * @returns {string} The formatted prefix for a log message.
   */
  this.updatePrefix = function(ip) {
    if (typeof ip === 'undefined') {
      ip = '               ';
    }
    const formattedIP = self.getIPName(ip.replace('::ffff:', ''));

    const date = dateFormat(new Date(), 'mm-dd HH:MM:ss');
    return `[${title}${date} ${formattedIP}]:`;
  };

  /**
   * Write the final portion of the log message.
   *
   * @private
   * @param {string} prefix The first characters on the line.
   * @param {string} message The message to display.
   * @param {string} ip The IP address or unique identifier of the client that
   * caused this event to happen.
   * @param {number} [traceIncrease=0] Increase the distance up the stack to
   * show the in the log.
   */
  function write(prefix, message, ip, traceIncrease = 0) {
    const output = [prefix];
    output.push(getTrace(traceIncrease + 1));
    if (self.isRelease) {
      output.push(`${self.updatePrefix(ip)}\x1B[;${mycolor}m`);
    } else {
      output.push(`\x1B[;${mycolor}m${self.updatePrefix(ip)}`);
    }
    message = message.toString().replace(/\n/g, '\\n');
    output.push(` ${message}`);
    output.push('\x1B[1;0m\n');
    process.stdout.write(output.join(''));
  }

  /**
   * Format a log message to be logged. Prefixed with DBG.
   *
   * @param {string} message The message to display.
   * @param {string} ip The IP address or unique identifier of the client that
   * caused this event to happen.
   * @param {number} [traceIncrease=0] Increase the distance up the stack to
   * show the in the log.
   */
  this.logDebug = function(message, ip, traceIncrease = 0) {
    write('DBG:', message, ip, traceIncrease);
  };

  /**
   * Format a log message to be logged.
   *
   * @param {string} message The message to display.
   * @param {string} ip The IP address or unique identifier of the client that
   * caused this event to happen.
   * @param {number} [traceIncrease=0] Increase the distance up the stack to
   * show the in the log.
   */
  this.log = function(message, ip, traceIncrease = 0) {
    write('INF:', message, ip, traceIncrease);
  };

  /**
   * Format a log message to be logged. Prefixed with WRN.
   *
   * @param {string} message The message to display.
   * @param {string} ip The IP address or unique identifier of the client that
   * caused this event to happen.
   * @param {number} [traceIncrease=0] Increase the distance up the stack to
   * show the in the log.
   */
  this.logWarning = function(message, ip, traceIncrease = 0) {
    write('WRN:', message, ip, traceIncrease);
  };

  /**
   * Format an error message to be logged.
   *
   * @param {string} message The message to display.
   * @param {string} ip The IP address or unique identifier of the client that
   * caused this event to happen.
   * @param {number} [traceIncrease=0] Increase the distance up the stack to
   * show the in the log.
   */
  this.error = function(message, ip, traceIncrease = 0) {
    const output = ['ERR:'];
    message = `${message}`.replace(/\n/g, '\\n');
    output.push(getTrace(traceIncrease));
    output.push('\x1B[;31m');
    output.push(`${self.updatePrefix(ip)} ${message}`);
    output.push('\x1B[1;0m\n');
    process.stdout.write(output.join(''));
  };

  /**
   * Gets the name and line number of the current function stack.
   *
   * @private
   *
   * @param {number} [traceIncrease=0] Increase the distance up the stack to
   * show the in the log.
   * @returns {string} Formatted string with length 24.
   */
  function getTrace(traceIncrease = 0) {
    if (typeof traceIncrease !== 'number') traceIncrease = 0;
    // let func = __function(traceIncrease) + ':' + __line(traceIncrease);
    let func = __filename(traceIncrease) + ':' + __line(traceIncrease);
    while (func.length < 20) func += ' ';
    func = ('00000' + process.pid).slice(-5) + ' ' +
        func.substr(func.length - 20, 20);
    return func;
  }

  /**
   * @description Gets the stack trace of the current function call.
   *
   * @private
   * @return {Stack} Error stack for logging.
   */
  function __stack() {
    const orig = Error.prepareStackTrace;
    Error.prepareStackTrace = function(_, stack) {
      return stack;
    };
    const err = new Error();
    /* eslint-disable-next-line no-caller */
    Error.captureStackTrace(err, arguments.callee);
    const stack = err.stack;
    Error.prepareStackTrace = orig;
    return stack;
  }

  /**
   * Gets the line number of the function that called a log function.
   *
   * @private
   * @param {number} [inc=0] Increase distance up the stack to returns.
   * @returns {number} Line number of call in stack.
   */
  function __line(inc = 0) {
    return __stack()[3 + inc].getLineNumber();
  }

  /**
   * Gets the name of the function that called a log function.
   *
   * @private
   * @param {number} [inc=0] Increase distance up the stack to return.
   * @returns {string} Function name in call stack.
   */
  /* function __function(inc = 0) {
    return __stack()[3 + inc].getFunctionName();
  } */

  /**
   * Gets the name of the file that called a log function.
   *
   * @private
   * @param {number} [inc=0] Increase distance up the stack to returns.
   * @returns {string} Filename in call stack.
   */
  function __filename(inc = 0) {
    return __stack()[3 + inc].getFileName();
  }
}

module.exports = new Common();
