// Copyright 2018-2019 Campbell Crowley. All rights reserved.
// Author: Campbell Crowley (web@campbellcrowley.com)
const childProcess = require('child_process');
const spawn = childProcess.spawn;
const exec = childProcess.exec;
const common = require('./common.js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config.js').master;
const sIoClient = require('socket.io-client');

/**
 * @classdesc Start, stops, and restarts all server processes and monitors their
 * status.
 * @class
 */
function Master() {
  const app = http.createServer(handler);
  const io = require('socket.io')(
      app, {path: config.socket.path, serveClient: true});
  common.begin();

  app.listen(config.socket.port, config.socket.host);

  /**
   * The last time that a child rebooted.
   *
   * @private
   * @type {number}
   */
  let lastRestart = 0;

  /**
   * Array of all connected clients' socket.
   *
   * @private
   * @type {Socket[]}
   */
  const sockets = [];

  /**
   * Default current working directory of a child. May be overriden in
   * servers.json
   *
   * @private
   * @type {string}
   * @constant
   * @default __dirname
   */
  const cwd = __dirname;
  /**
   * Default options for a child process.
   *
   * @private
   * @type {{cwd: string}}
   * @default
   */
  const options = {cwd: cwd, stdio: ['inherit', 'pipe', 'pipe']};

  /**
   * List of all servers we are to spawn as child processes. Parsed from
   * servers.json.
   *
   * @private
   * @type {Array.<Object.<*>>}
   */
  let serverList = [];
  /**
   * The previously loaded server list to compare against for checking for
   * changes.
   * @see {@link Master~serverList}
   *
   * @private
   * @type {Array.<Object.<string>>}
   */
  let previousServerList = [];
  /**
   * Currently spawned child processes and their a associated data.
   * @todo Improve the type description.
   *
   * @private
   * @type {Object.<Object>}
   */
  const currentServers = {};

  /**
   * Host information and current socket information for child nodes to fetch
   * and send requests from and to. Parsed from {@link childrenFile}.
   *
   * @private
   * @type {Array.<{
   *  id: string,
   *  hostname: string,
   *  port: number,
   *  path: string,
   *  socket: Socket
   * }>}
   */
  const children = [];
  /**
   * Path to the file that stores the information about child node host
   * information.
   *
   * @private
   * @constant
   * @default
   * @type {string}
   */
  const childrenFile = `${__dirname}/children.json`;

  /**
   * Re-read list of servers from servers.json and {@link childrenFile}.
   *
   * @private
   */
  function updateServerList() {
    fs.readFile(`${__dirname}/servers.json`, (err, data) => {
      if (err) return;
      try {
        const parsed = JSON.parse(data);
        if (parsed) {
          previousServerList = serverList.splice(0);
          serverList = parsed;
          updateCurrentServers();
        }
      } catch (err) {
        console.log(err);
      }
    });
    fs.readFile(childrenFile, (err, data) => {
      if (err) return;
      try {
        const parsed = JSON.parse(data);
        if (parsed) {
          updateChildren(parsed);
        }
      } catch (err) {
        console.log(err);
      }
    });
  }
  updateServerList();
  fs.watchFile(`${__dirname}/servers.json`, (curr, prev) => {
    if (curr.mtime == prev.mtime) return;
    common.log('Re-reading servers from file');
    updateServerList();
  });

  /**
   * Check that all servers are in the requested state. If not, then start or
   * stop processes to match the requested state.
   *
   * @private
   */
  function updateCurrentServers() {
    // Ensure all servers are running.
    let didSomething = false;
    for (const i in serverList) {
      if (!serverList[i]) continue;
      const id = serverList[i].id;
      if (typeof currentServers[id] == 'undefined' ||
          typeof currentServers[id].process == 'undefined' ||
          ((currentServers[id].currentState == 'stopped' ||
            currentServers[id].process.killed) &&
           currentServers[id].goalState == 'running')) {
        try {
          currentServers[id] = {
            process: fork(
                serverList[i].cmd, serverList[i].filename,
                serverList[i].wd || cwd, id),
            goalState: 'running',
            currentState: 'starting',
            startTime: Date.now(),
            endTime: 0,
            user: serverList[i].user,
          };
          if (serverList[i].priority != null) {
            exec(
                'renice -n ' + serverList[i].priority + ' -p ' +
                currentServers[id].process.pid);
            common.log('Set nice value to ' + serverList[i].priority);
          }
          lastRestart = Date.now();
        } catch (err) {
          console.log(err);
        }
        setTimeout(updateRunning(id), 3000);
        didSomething = true;
      }
    }
    // Destroy servers that no longer exist.
    Object.keys(currentServers).forEach((key) => {
      if (serverList.findIndex((obj) => obj.id == key) < 0) {
        if (currentServers[key].process) {
          if (previousServerList.find((obj2) => key == obj2.id).user) {
            try {
              process.kill(-currentServers[key].process.pid);
            } catch (err) {
              // Process is probably already dead.
            }
          } else {
            currentServers[key].process.kill('SIGHUP');
          }
        }
        delete currentServers[key];
        didSomething = true;
      }
    });
    if (didSomething) updateAllClients();
  }

  /**
   * Check that a process is running, and update it's state if it is runinng.
   *
   * @private
   * @param {string} id The id in the object of the server we are checking.
   * @return {function} Function to run to actually check.
   */
  function updateRunning(id) {
    return function() {
      if (currentServers[id] && !currentServers[id].endTime) {
        currentServers[id].currentState = 'running';
        updateAllClients();
      }
    };
  }

  /**
   * Fork a new child process with the given options.
   *
   * @private
   * @param {string} cmd The command to run to spawn the process.
   * @param {string} filename The file to run with the command.
   * @param {string} wd The working directory of the spawned process.
   * @param {string} id The id of the process to spawn.
   * @return {Object} The object storing the process reference and other
   * associated data.
   */
  function fork(cmd, filename, wd, id) {
    const i = serverList.findIndex((el) => el.id == id);
    if (!serverList[i]) {
      common.error(
          'Failed to fork ' + filename + ' ID:' + id +
          ' Doesn\'t exist in file');
      return;
    }
    common.log('Fork ' + filename);
    options.cwd = wd;
    let forked;
    if (serverList[i].user && serverList[i].user != 'root') {
      options.detached = true;
      forked = spawn(
          'runuser', ['-u', serverList[i].user, '--', cmd, filename].concat(
              serverList[i].args),
          options);
      options.detached = false;
    } else {
      forked = spawn(cmd, [filename].concat(serverList[i].args), options);
    }
    linkStdIo(forked, serverList[i]);
    if (serverList[i].priority != null && forked.process) {
      exec(
          'renice -n ' + serverList[i].priority + ' -p ' + forked.process.pid);
      common.log('Set nice value to ' + serverList[i].priority);
    }
    forked.on('exit', function(id) {
      return function() {
        common.error(filename + ' EXITTED! (' + id + ')');
        if (currentServers[id]) {
          currentServers[id].currentState = 'stopped';
          currentServers[id].endTime = Date.now();
          setTimeout(updateCurrentServers, (lastRestart + 3000) - Date.now());
        }
        updateAllClients();
      };
    }(id));
    forked.on('error', common.error);
    return forked;
  }

  /**
   * Link stdin, stderr, and stdout listeners to modifying stream per-forked
   * process.
   *
   * @private
   * @param {ChildProcess} forked The forked process to link IO middleman to.
   * @param {Object} data Server configuration data.
   */
  function linkStdIo(forked, data) {
    forked.stdout.on(
        'data', (row) => process.stdout.write(`${data.id}:${row}`));
    forked.stderr.on(
        'data', (row) => process.stderr.write(`${data.id}:${row}`));
  }

  /**
   * Handler for all http requests. Replies 401 from all requests unless they
   * originate from a local address.
   *
   * @private
   * @param {http.IncomingMessage} req The client's request.
   * @param {http.ServerResponse} res Our response to the client.
   */
  function handler(req, res) {
    const conIp =
        req.connection.remoteAddress.replace(/[^0-9.]/g, '').split('.');
    if (!conIp || conIp.length != 4 || conIp[0] != 127 || conIp[1] != 0 ||
        conIp[2] != 0 || conIp[3] != 1) {
      common.error(
          'RECEIVED REQUEST FROM NON LOCAL ADDRESS ' + conIp.join('.'),
          conIp.join('.'));
      res.writeHead(401);
      res.end('Forbidden');
      return;
    }
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress ||
        'ERRR';
    if (req.method == 'GET') {
      const id = req.url.split('/')[2] || req.headers['server-id'];
      command(req, res, ip, id);
    } else if (req.method == 'POST') {
      let body = '';
      req.on('data', (data) => body += data);
      req.on('end', () => command(req, res, ip, body.replace('id=', '')));
      req.on('close', () => common.log('Request aborted'));
    } else {
      common.error('INVALID METHOD REQUEST: ' + req.method, ip);
    }
  }
  /**
   * Causes a child to be killed, then restarted.
   *
   * @private
   * @param {string} id The id of the server to kill.
   * @param {string} ip The ip of the client that requested the reboot, for
   * logging.
   */
  function reboot(id, ip) {
    common.log('Rebooting: ' + id, ip);
    if (id == -1) {
      process.exit();
    } else {
      if (currentServers[id].process && !currentServers[id].process.killed) {
        if (currentServers[id].user) {
          try {
            process.kill(-currentServers[id].process.pid);
          } catch (err) {
            // Process is probably dead already.
          }
        } else {
          currentServers[id].process.kill('SIGHUP');
        }
      }
      if (currentServers[id].goalState != 'running') {
        currentServers[id].goalState = 'running';
        updateCurrentServers();
      }
    }
  }
  /**
   * Causes a child to be killed, and not restarted.
   *
   * @private
   * @param {string} id The id of the server to kill.
   * @param {string} ip The ip of the client that requested the reboot, for
   * logging.
   */
  function kill(id, ip) {
    common.log('Killing: ' + id, ip);
    if (id == -1) {
      process.exit();
    } else {
      currentServers[id].goalState = 'stopped';
      if (currentServers[id].process && !currentServers[id].process.killed) {
        if (currentServers[id].user) {
          try {
            process.kill(-currentServers[id].process.pid);
          } catch (err) {
            // Process is probably dead already.
          }
        } else {
          currentServers[id].process.kill('SIGHUP');
        }
      }
      if (currentServers[id].unstoppable) {
        currentServers[id].goalState = 'running';
        updateCurrentServers();
      }
    }
  }
  /**
   * Formats server data into an object that a user is allowed to see.
   *
   * @private
   * @param {string} ip The ip of the client that requested the reboot, for
   * @param {boolean} [silent=false] if we should silence logging.
   * @return {Array.<Object.<*>>} The servers data.
   */
  function get(ip, silent) {
    // if (!silent) common.log("Get", ip);
    const list = serverList.map((obj) => {
      if (!currentServers[obj.id]) {
        common.error('Failed to get ' + obj.id + ', No file data');
        return;
      }
      const out = Object.assign({}, obj);
      out.wd = path.relative(cwd, out.wd || cwd);
      out.filename = path.relative(cwd, out.filename);
      try {
        out.goalState = currentServers[obj.id].goalState;
        out.currentState = currentServers[obj.id].currentState;
        out.endTime = currentServers[obj.id].endTime;
        out.startTime = currentServers[obj.id].startTime;
        if (currentServers[obj.id].process) {
          out.pid = currentServers[obj.id].process.pid;
        }
      } catch (err) {
        console.log(currentServers);
        console.log(err);
      }
      return out;
    });
    list.splice(0, 0, {
      wd: cwd,
      id: -1,
      filename: process.argv[1],
      goalState: 'running',
      currentState: 'running',
      unstoppable: true,
    });
    return list;
  }
  /**
   * The client requested a command to be run via http. Parse and reply.
   *
   * @private
   * @param {http.IncomingMessage} req The client's request.
   * @param {http.ServerResponse} res Our response to the client.
   * @param {string} ip The ip of the client for logging.
   * @param {string} id The requested server id to run the command on.
   */
  function command(req, res, ip, id) {
    // common.log("Request " + req.url + " (" + id + ")", ip);
    if (req.url.startsWith('/reboot') || req.url.startsWith('/start')) {
      if ((typeof id === 'undefined' ||
           typeof currentServers[id] === 'undefined') &&
          id != -1) {
        res.writeHead(400);
        res.end('Invalid server ID. (' + id + ')');
        return;
      }
      reboot(id, ip);
      res.writeHead(200);
      res.end('Success');
    } else if (req.url.startsWith('/kill')) {
      if ((typeof id === 'undefined' ||
           typeof currentServers[id] === 'undefined') &&
          id != -1) {
        res.writeHead(400);
        res.end('Invalid server ID. (' + id + ')');
        return;
      }
      kill(id, ip);
      res.writeHead(200);
      res.end('Success');
    } else if (req.url.startsWith('/get')) {
      res.writeHead(200);
      res.end(JSON.stringify(get(ip)));
    } else {
      res.writeHead(400);
      res.end('Unknown command.');
    }
  }

  io.on('connection', (socket) => {
    common.log(
        'Socket connected: ' +
            common.getIPName(socket.handshake.headers['x-forwarded-for']),
        socket.id);
    sockets.push(socket);

    socket.on('disconnect', () => {
      common.log(
          'Socket disconnected: ' +
              common.getIPName(socket.handshake.headers['x-forwarded-for']),
          socket.id);
      for (const i in sockets) {
        if (sockets[i].id == socket.id) sockets.splice(i, 1);
      }
    });
    socket.on('start', (id) => reboot(id, socket.id));
    socket.on('reboot', (id) => reboot(id, socket.id));
    socket.on('kill', (id) => kill(id, socket.id));
    socket.on('get', () => {
      getAll((getList) => socket.emit('get_', getList));
    });
  });
  /**
   * Send updated server data to all connected sockets.
   *
   * @private
   */
  function updateAllClients() {
    getAll((dat) => {
      for (const s of sockets) {
        s.emit('get_', dat);
      }
    });
  }

  /**
   * Get all information from all children.
   *
   * @private
   * @param {function} cb Callback with single parameter that is an array of
   * status information.
   */
  function getAll(cb) {
    const total = children.length;
    let num = 0;
    const getList = get(null, true);
    const getDone = function() {
      if (++num < total) return;
      cb(getList);
    };

    children.forEach((el) => {
      if (el.socket && el.socket.emit) {
        el.socket.emit('get', (res) => {
          res.forEach((c) => {
            c.id = `${el.id}${c.id}`;
            getList.push(c);
          });
          getDone();
        });
      } else {
        getDone();
      }
    });
  }

  /**
   * Update the socket connections with the children nodes with new host
   * information.
   *
   * @private
   * @param {Array.<{
   *  id: string,
   *  hostname: string,
   *  port: number,
   *  path: string,
   *  socket: Socket
   * }>} data The new data parsed from file.
   */
  function updateChildren(data) {
    children.filter((c) => {
      const found = data.find((n) => n.id == c.id);
      if (!found) {
        c.socket.disconnect();
        common.log('Terminating child connection: ' + c.id);
        return false;
      } else {
        Object.assign(c, found);
        return true;
      }
    });
    data.forEach((n) => {
      const found = children.find((c) => c.id == n.id);
      if (!found) {
        common.log('Creating child connection: ' + n.id);
        n.socket = sIoClient.connect(
            {hostname: n.hostname, path: n.path, port: n.port});
        children.push(n);
      } else if (!found.socket) {
        common.log('Re-creating child connection: ' + n.id);
        found.socket = sIoClient.connect(
            {hostname: n.hostname, path: n.path, port: n.port});
      }
    });
    updateAllClients();
  }

  /**
   * Runs when the process is about to die, and kills all the children to ensure
   * we don't leave stragglers.
   *
   * @private
   */
  function exit() {
    for (const i in currentServers) {
      if (!currentServers[i]) continue;
      currentServers[i].goalState = 'stopped';

      if (!currentServers[i].process) continue;

      if (currentServers[i].user) {
        try {
          process.kill(-currentServers[i].process.pid);
        } catch (err) {
          console.error(err);
        }
      } else {
        currentServers[i].process.kill('SIGHUP');
      }
    }
  }

  process.on('exit', exit);
  process.on('SIGINT', exit);
  process.on('SIGHUP', exit);
}

module.exports = new Master();
