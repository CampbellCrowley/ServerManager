// Copyright 2018 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (web@campbellcrowley.com)
let fs = require('fs');
let path = require('path');
let async = require('async');
let dateFormat = require('dateformat');
let zlib = require('zlib');
let minifier = require('uglify-es');
let crypto = require('crypto'); // ETag hashing

/**
 * @classdesc Commonly required things. Mostly helper functions.
 * @class
 */
function Common() {
  const self = this;
  /**
   * The number of characters reserved for the filename of the script.
   * @private
   * @constant
   * @type {number}
   * @default
   */
  const prefixLength = 14;

  /**
   * `Cache-Control: max-age=` value. How long to tell clients to cache the
   * served file.
   * @private
   * @constant
   * @type {number}
   * @default
   */
  const ccMaxAge = 24 * 60 * 60; // 24 Hours
  // const ccMaxAge = 15 * 60; // 15 Minutes

  /**
   * The last time at which the header file was modified, for use in checking if
   * we should re-load the file into memory.
   *
   * @private
   * @type {number}
   */
  let headerFileLastModified;
  /**
   * The last time at which the footer file was modified, for use in checking if
   * we should re-load the file into memory.
   *
   * @private
   * @type {number}
   */
  let footerFileLastModified;
  /**
   * The last time at which the styles file was modified, for use in checking if
   * we should re-load the file into memory.
   *
   * @private
   * @type {number}
   */
  let stylesFileLastModified;
  /**
   * The file that has been loaded. This variable stores the actual contents of
   * the file for faster replacement into the file being served.
   *
   * @private
   * @type {string}
   */
  let headerFile;
  /**
   * The file that has been loaded. This variable stores the actual contents of
   * the file for faster replacement into the file being served.
   *
   * @private
   * @type {string}
   */
  let footerFile;
  /**
   * The file that has been loaded. This variable stores the actual contents of
   * the file for faster replacement into the file being served.
   *
   * @private
   * @type {string}
   */
  let stylesFile;
  /**
   * Whether we will actually be doing any replacements. This also determines
   * whether we should load the files or not.
   *
   * @private
   * @type {boolean}
   * @default
   */
  let shouldReplaceTags = false;

  /**
   * Files that have been read from disk that we cached in order to improve
   * future requests for the file. Mapped by filename, stored with cached time
   * and last modified time.
   *
   * @private
   * @type {{data: Buffer, cachedTime: number, modifiedTime: number}}
   */
  let cachedFiles = {};

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
  const app = process.argv[1].substring(process.argv[1].lastIndexOf('/') + 1);
  /**
   * The final formatted filename for logging.
   *
   * @private
   * @type {string}
   */
  let title;

  /**
   * The subdomain of where the file was requested from. This is to determine
   * whether we should replace the URLs in the file with a different version, to
   * point to the correct server.
   *
   * @private
   * @type {string}
   */
  let subDom = 'dev';
  /**
   * Whether this should be shown as a release version, or a debug version in
   * the log.
   *
   * @public
   * @type {boolean}
   */
  this.isRelease = false;

  /**
   * Initialize variables and settings for logging properly.
   *
   * @public
   * @param {boolean} [replaceFileTags=false] True if for the files served, we
   * should replace the tags with the respective header, footer, or styles file.
   * @param {boolean} [isRelease=false] Is this a release version, or a
   * development version of the app running.
   */
  this.begin = function(replaceFileTags, isRelease) {
    self.isRelease = isRelease || false;
    if (replaceFileTags) {
      shouldReplaceTags = true;
      updateCachedFiles(true);
      setInterval(updateCachedFiles, 5000);
    }
    switch (app) {
      case 'Master.js':
        mycolor = 32;
        break;
      case 'fileServer.js':
        mycolor = 36;
        break;
      case 'stopwatch.js':
        mycolor = 34;
        break;
      case 'accounts.js':
        mycolor = 35;
        break;
      case 'proxy.js':
        mycolor = 37;
        break;
      case 'trax.js':
        mycolor = 33;
        break;
      case 'monitor.js':
        mycolor = 43;
        break;
      case 'patreon.js':
        mycolor = 92;
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
   * Pad an IP address with zeroes
   *
   * @public
   * @param {number} str The ipv4 address as a string to format.
   * @return {string} The padded address.
   */
  this.padIp = function(str) {
    let finalRes = str;
    if (str.match(/\./g) || [] == 3) {
      let res = str.split('.');
      for (let i = 0; i < res.length; i++) {
        res[i] = ('000' + res[i]).slice(-3);
        res[i] = res[i].replace(':', '0');
      }
      finalRes = res.join('.');
    } else if (str.match(/:/g) || [] == 7) {
      let res = str.split(':');
      for (let i = 0; i < res.length; i++) {
        res[i] = ('0000' + res[i]).slice(-4);
        // res[i] = res[i].replace(':', '0');
      }
      finalRes = res.join(':');
    }
    for (let i = finalRes.length; i < 45; i++) {
      finalRes += ' ';
    }
    return finalRes.substring(0, 45);
  };

  /**
   * Formats a given IP address by padding with zeroes, or completely replacing
   * with a human readable alias if the address is a known location.
   *
   * @public
   * @param {string} ip The ip address to format.
   * @return {string} The formmatted address.
   */
  this.getIPName = function(ip) {
    ip = self.padIp(ip);
    switch (ip) {
      default:
        return ip;
      case '::1                                          ':
      case '127.000.000.001                              ':
        return 'SELF                                         ';
      case '192.168.001.116                              ':
        return 'RPI                                          ';
      case '132.241.174.082                              ':
      case '132.241.174.226                              ':
      case '132.241.174.112                              ':
        return 'CHICO                                        ';
      case '098.210.161.122                              ':
      case '2601:0647:4300:1200:127b:44ff:fe4d:91dc      ':
        return 'HOME                                         ';
      case '076.021.061.017                              ':
        return 'OLD HOME                                     ';
      case '205.167.046.140                              ':
      case '205.167.046.157                              ':
      case '205.167.046.015                              ':
      case '204.088.159.118                              ':
        return 'MVHS                                         ';
    }
  };
  /**
   * Format a prefix for a log message or error. Includes the ip before the
   * message.
   *
   * @public
   * @param {string} ip The ip to include in the prefix.
   * @return {string} The formatted prefix for a log message.
   */
  this.updatePrefix = function(ip) {
    if (typeof ip === 'undefined') {
      ip = '               ';
    }
    const formattedIP = self.getIPName(ip.replace('::ffff:', ''));

    const date = dateFormat(new Date(), 'mm-dd HH:MM:ss');
    return '[' + title + date + ' ' + formattedIP + ']:';
  };


  /**
   * Reply to a web request with 404.html
   *
   * @public
   * @param {http.ServerResponse} res The server response we are to send.
   * @param {string} requestedFilename The filepath to check for a specific
   * domain's 404 page.
   */
  this.res404 = function(res, requestedFilename) {
    let domain = requestedFilename.match(/([^\/]*\.(com|org|net))/)[1];
    fs.exists('/var/www/' + domain + '/404.html', function(exists1) {
      if (exists1) {
        self.getFile(
            '/var/www/' + domain + '/404.html', res, 'text/html', true);
      } else {
        fs.exists('/var/www/404.html', function(exists) {
          if (exists) {
            self.getFile('/var/www/404.html', res, 'text/html', true);
          } else {
            self.error('File not found:  404.html');
            res.end('404');
          }
        });
      }
    });
  };

  /**
   * Reply to a web request for a file. This finds the file and replies with the
   * given mime type.
   *
   * @public
   * @param {string} localPath The path to the file from cwd.
   * @param {http.ServerResponse} res The response we are to send.
   * @param {string} [mimeType='text/plain'] The mimeType to send with the file.
   * @param {boolean} [is404=false] Is the file we are trying to find the 404
   * file. This will set the status code to 404 as well.
   * @param {Object} [moreOpts={}] Stores additional options not previously
   * mentioned.
   * @param {string} [moreOpts.encoding=''] The accepted-encoding header from
   * the client to determine compression.
   * @param {Object} [moreOpts.minify=null] The options for minifiable files.
   * @param {string} [moreOpts.etag=''] The entity tag from the client used to
   * determine whether the client's cached version is the same as ours.
   * @param {function} [cb] Callback to fire after response is complete.
   */
  this.getFile = function(
      localPath, res, mimeType = 'text/plain', is404 = false, moreOpts = {},
      cb) {
    is404 = (typeof is404 === 'boolean' && is404);
    fs.stat(localPath, function(err, stats) {
      if (err) {
        res.writeHead(500);
        res.end('500 Internal Server Error (FS)');
        self.error('Failed to stat file: ' + localPath);
        console.log(err);
        if (cb) cb(500);
        return;
      }
      // ETag changes every 7 days for all files regardless of whether the file
      // actually changed. This is to update headers and footers without needing
      // to check if this requested file includes them.
      // const now = new Date();
      const cycler = '';
          // Math.floor(now.getDate() / 7) + now.getMonth() + now.getYear();
      const ETag =
          crypto.createHash('sha1')
              .update(`ETAG-${localPath}${stats.mtime.getTime()}${cycler}`)
              .digest('hex');
      res.setHeader('ETag', ETag);
      if (!is404 && ETag == moreOpts.etag) {
        res.writeHead(
            304, {'Cache-Control': 'max-age=' + ccMaxAge, 'ETag': ETag});
        res.end();
        if (cb) cb(304);
        return;
      }
      const noCache = moreOpts.noCache;
      readFile(localPath, noCache, (err, contents_, fromCache) => {
        if (err) {
          res.writeHead(500);
          res.end('500 Internal Server Error (FS)');
          self.error('Failed to read file: ' + localPath);
          console.log(err);
          if (cb) cb(500);
          return;
        }
        try {
          let contents = contents_.toString();
          subDom = getSubDom(localPath);
          let domain =
              localPath.match(/^\/var\/www\/(\w+\.\w+\.(?:com|org|net))/);
          if (!domain) {
            res.setHeader('Content-Length', contents_.byteLength);
            res.setHeader('Content-Type', mimeType);
            if (is404) {
              res.statusCode = 404;
            } else {
              res.statusCode = 200;
            }
            res.end(contents_);
            if (cb) cb(404);
            return;
          } else {
            domain = domain[1];
          }
          res.setHeader('Content-Type', mimeType);
          res.setHeader('Cache-Control', 'max-age=' + ccMaxAge);
          if (is404) {
            res.statusCode = 404;
          } else {
            res.statusCode = 200;
          }

          replaceTags(contents, domain, (c) => {
            const cache = cachedFiles[localPath];
            if (cache) {
              c = c.toString().replace(
                  /%FILE_MODIFIED_TIMESTAMP%/g,
                  (new Date(cache.modifiedTime)).toString());
            } else {
              c = c.toString().replace(
                  /%FILE_MODIFIED_TIMESTAMP%/g, (new Date()).toString());
            }
            c = contents_.toString() === c ? contents_ : c;
            prepareFile(c, localPath, res, moreOpts, fromCache, cb);
          });
        } catch (e) {
          res.setHeader('Content-Length', contents_.byteLength);
          res.setHeader('Content-Type', mimeType);
          if (is404) {
            res.statusCode = 404;
          } else {
            res.statusCode = 200;
          }
          res.end(contents_);
          if (cb) cb(404);
          console.error(e);
        }
      });
    });
  };

  /**
   * Final preparations and send file contents.
   * @private
   * @param {string} contents File data to send.
   * @param {string} localPath The absolute path to the file.
   * @param {http.ServerResponse} res Response object.
   * @param {object} moreOpts Additional options.
   * @param {boolean} fromCache Was file loaded from cached version.
   * @param {function} cb Callback once completed.
   */
  function prepareFile(contents, localPath, res, moreOpts, fromCache, cb) {
    const encoding = moreOpts.encoding || '';
    const minify = moreOpts.minify;
    let comp = '';

    const finalSend = function(err, buffer) {
      if (err) {
        self.error('Failed to prepare (' + encoding + '): ' + localPath);
        console.error(err);
        res.statusCode = 500;
        res.end('500: Internal Server Error.');
        if (cb) cb(500);
      } else {
        if (comp) res.setHeader('Content-Encoding', comp);
        if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
        res.setHeader('Content-Length', buffer.byteLength);
        res.end(buffer);
        if (cb) cb(res.statusCode);
      }
    };

    const compressContents = function(err, contents) {
      if (err) {
        res.statusCode = 500;
        res.end('500: Internal Server Error.');
        if (cb) cb(500);
        return;
      }

      if (/\bgzip\b/.test(encoding)) {
        comp = 'gzip';
        zlib.gzip(contents, finalSend);
      } else if (/\bdeflate\b/.test(encoding)) {
        comp = 'deflate';
        zlib.deflate(contents, finalSend);
      } else {
        finalSend(null, contents);
      }
    };

    if (minify && !minify.disable && !fromCache && !moreOpts.noCache) {
      const minName = localPath.replace(/^.*\/([^/]+)$/, '$1');
      const minPath = localPath.replace(/\/var\/www\//, 'https://');
      if ((!minify.options || !minify.options.output ||
           !minify.options.output.comments) &&
          !minify.skipCopyright) {
        minify.options = minify.options || {};
        minify.options.output = minify.options.output || {};
        minify.options.output.comments = '/^\\ Copyright|^\\ Author\\:/';
        minify.options.sourceMap = {
          filename: minName,
          url: minName + '.map',
          root: '',
        };
      }
      const result = minifier.minify(
          {[minPath + '.source']: contents.toString()}, minify.options);
      if (result.error) {
        self.error('Minifying failed due to an error: ' + localPath);
        console.error(result.error);
        compressContents(null, contents);
      } else {
        const fn = path.relative(process.cwd(), localPath);
        if (cachedFiles[fn]) cachedFiles[fn].data = result.code;
        compressContents(null, result.code);
        if (result.map) {
          fs.writeFile(localPath + '.map', result.map, (err) => {
            if (err) {
              self.error('Failed to save source map: ' + localPath + '.map');
              console.error(err);
            } else {
              self.logDebug('Saved source map: ' + localPath + '.map');
            }
          });
        }
      }
    } else {
      compressContents(null, contents);
    }
  }

  /**
   * Simplified wrapper around fs.readFile in order to cache read files.
   * @private
   *
   * @param {string} filename Path to the file to read.
   * @param {boolean} noCache Force skipping cache, and read from file.
   * @param {Function} cb Callback with file data.
   */
  function readFile(filename, noCache, cb) {
    filename = path.relative(process.cwd(), filename);
    fs.stat(filename, (err, stats) => {
      if (err) {
        cb(err, null, false);
        return;
      }
      let mTime = stats.mtime.getTime();
      if (!noCache && cachedFiles[filename] &&
          cachedFiles[filename].modifiedTime == mTime) {
        cb(null, cachedFiles[filename].data, true);
      } else {
        fs.readFile(filename, (err, data) => {
          if (err) {
            cb(err, data, false);
            return;
          }
          if (!noCache) {
            cachedFiles[filename] = {
              data: data,
              modifiedTime: mTime,
              cachedTime: Date.now(),
            };
          }
          cb(err, data, false);
        });
      }
    });
  }

  /**
   * Parses the subdomain the file was requested from from the path of the file
   * requested.
   *
   * @private
   * @param {string} localPath The path from the file from cwd.
   * @return {string} The subdomain of the origin of the request.
   */
  function getSubDom(localPath) {
    localPath = path.relative(process.cwd(), localPath);
    return localPath.split('/')[0].split('.')[0];
  }
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
   * @return {string} Formatted string with length 24.
   */
  function getTrace(traceIncrease = 0) {
    if (typeof traceIncrease !== 'number') traceIncrease = 0;
    let func = __filename(traceIncrease) + ':' + __line(traceIncrease);
    while (func.length < 20) func += ' ';
    func = ('00000' + process.pid).slice(-5) + ' ' +
        func.substr(func.length - 20, 20);
    return func;
  }

  /**
   * Gets the line number of the function that called a log function.
   *
   * @private
   * @param {number} [inc=0] Increase distance up the stack to returns.
   * @return {number} Line number of call in stack.
   */
  function __line(inc = 0) {
    return __stack()[3 + inc].getLineNumber();
  }

  /**
   * Gets the name of the file that called a log function.
   *
   * @private
   * @param {number} [inc=0] Increase distance up the stack to returns.
   * @return {string} Filename in call stack.
   */
  function __filename(inc = 0) {
    return __stack()[3 + inc].getFileName();
  }

  /**
   * Replaces tags in a given file with their appropriate values.
   *
   * @private
   * @param {string} contents The file of which to replace the tags of.
   * @param {string} domain The domain of the file to replace the tags of.
   * @param {function} cb The callback containing the file after replacing tags
   * as the only parameter.
   */
  function replaceTags(contents, domain, cb) {
    if (!shouldReplaceTags) cb(contents);
    async.waterfall(
        [
          function(cb) {
            cb(null, contents, domain);
          },
          replaceHeader,
          replaceFooter,
          replaceStyles,
          replaceURLS,
        ],
        function(err, contents, domain) {
          if (err) {
            self.error(err);
          } else {
            cb(contents);
          }
        });
  }

  /**
   * The basic callback with error and data parameters.
   * @callback basicCallback
   *
   * @param {?string} error Null if no error, otherwise a string with the error
   * message.
   * @param {*} data Null if error, otherwise has a the response with the
   * expected data.
   */

  /**
   * Replaces `<div id="mainheader"></div>` in a file with
   * ./dev.campbellcrowley.com/header.html
   *
   * @private
   * @param {string} contents The file to fill the header.
   * @param {string} domain The domain the file was requested from.
   * @param {basicCallback} cb The whole file with replaced tags.
   */
  function replaceHeader(contents, domain, cb) {
    contents = contents.toString();
    let Tag = '<div id="mainheader"></div>';
    if (contents.indexOf(Tag) > -1) {
      readFile(domain + '/header.html', false, function(err, data) {
        if (err || !data) {
          contents = contents.replaceAll(Tag, headerFile);
        } else {
          contents = contents.replaceAll(Tag, data.toString());
        }
        cb(null, contents, domain);
      });
    } else {
      cb(null, contents, domain);
    }
  }
  /**
   * Replaces `<div id="mainfooter"></div>` in a file with
   * ./dev.campbellcrowley.com/footer.html
   *
   * @private
   * @param {string} contents The file to fill the footer.
   * @param {string} domain The domain the contents are being modified in.
   * @param {basicCallback} cb The whole file with replaced tags.
   */
  function replaceFooter(contents, domain, cb) {
    contents = contents.toString();
    let Tag = '<div id="mainfooter"></div>';
    if (contents.indexOf(Tag) > -1) {
      readFile(domain + '/footer.html', false, function(err, data) {
        if (err || !data) {
          contents = contents.replaceAll(Tag, footerFile);
        } else {
          contents = contents.replaceAll(Tag, data.toString());
        }
        cb(null, contents, domain);
      });
    } else {
      cb(null, contents, domain);
    }
  }
  /**
   * Replaces `<style></style>` in a file with
   * ./dev.campbellcrowley.com/styles.css
   *
   * @private
   * @param {string} contents The file to fill the styles.
   * @param {string} domain The domain the contents are being modified in.
   * @param {basicCallback} cb The whole file with replaced tags.
   */
  function replaceStyles(contents, domain, cb) {
    contents = contents.toString();
    let Tag = '<style></style>';
    if (contents.indexOf(Tag) > -1) {
      readFile(domain + '/styles.css', false, function(err, data) {
        if (err || !data) {
          contents =
              contents.replaceAll(Tag, '<style>' + stylesFile + '</style>');
        } else {
          contents = contents.replaceAll(
              Tag, '<style>' + data.toString() + '</style>');
        }
        cb(null, contents, domain);
      });
    } else {
      cb(null, contents, domain);
    }
  }
  /**
   * Replaces url subdomains of a few special urls.
   *
   * @private
   * @param {string} contents The file to fill the styles.
   * @param {string} domain The domain the contents are being modified in.
   * @param {basicCallback} cb The whole file with replaced tags.
   */
  function replaceURLS(contents, domain, cb) {
    contents = contents.toString();
    if (subDom !== 'dev') {
      contents = contents.replaceAll(
          'dev.campbellcrowley.com/' + subDom, subDom + '.campbellcrowley.com');
      contents = contents.replaceAll(
          '\'dev.campbellcrowley.com\', {path: \'/socket.io/' + subDom + '\', ',
          '\'' + subDom + '.campbellcrowley.com\', {');
      contents = contents.replaceAll(
          '\'dev.campbellcrowley.com\', {path: \'/socket.io/' + subDom + '\'',
          '\'' + subDom + '.campbellcrowley.com\', {');
    }
    cb(null, contents, domain);
  }

  /**
   * Updated the files held in memory with the newer files on file if they have
   * changed. Updates ./dev/header.html ./dev/footer.html and ./dev/styles.css
   * into memory.
   *
   * @private
   * @param {boolean} [force=false] Force the update irregardless of whether the
   * file has been modified since last update.
   */
  function updateCachedFiles(force) {
    fs.stat('./dev.campbellcrowley.com/header.html', function(err, stats) {
      if (err) {
        self.error(err);
        return;
      }
      let mtime = stats.mtime + '';
      if (force !== true && headerFileLastModified === mtime &&
          typeof headerFile !== 'undefined') {
        return;
      }

      headerFileLastModified = mtime;
      fs.readFile('./dev.campbellcrowley.com/header.html', function(err, data) {
        if (err !== null) {
          self.error(err);
          return;
        }
        self.log('Updating header.html');
        try {
          headerFile = data.toString();
        } catch (e) {
          self.error(e);
        }
      });
    });
    fs.stat('./dev.campbellcrowley.com/footer.html', function(err, stats) {
      if (err) {
        self.error(err);
        return;
      }
      let mtime = stats.mtime + '';
      if (force !== true && footerFileLastModified === mtime &&
          typeof footerFile !== 'undefined') {
        return;
      }

      footerFileLastModified = mtime;
      fs.readFile('./dev.campbellcrowley.com/footer.html', function(err, data) {
        if (err !== null) {
          self.error(err);
          return;
        }
        self.log('Updating footer.html');
        try {
          footerFile = data.toString();
        } catch (e) {
          self.error(e);
        }
      });
    });
    fs.stat('./dev.campbellcrowley.com/styles.css', function(err, stats) {
      if (err) {
        self.error(err);
        return;
      }
      let mtime = stats.mtime + '';
      if (force !== true && stylesFileLastModified === mtime &&
          typeof stylesFile !== 'undefined') {
        return;
      }

      stylesFileLastModified = mtime;
      fs.readFile('./dev.campbellcrowley.com/styles.css', function(err, data) {
        if (err !== null) {
          self.error(err);
          return;
        }
        self.log('Updating styles.css');
        try {
          stylesFile = data.toString();
        } catch (e) {
          self.error(e);
        }
      });
    });
  }
}

/* eslint-disable-next-line no-extend-native */
String.prototype.replaceAll = function(search, replacement) {
  return this.replace(new RegExp(search, 'g'), replacement);
};

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

module.exports = new Common();
