module.exports = {
  starter: {
    logfile: 'output.log',
  },
  master: {
    socket: {
      path: '/kamino.spikeybot.com/socket.io/status',
      port: 86,
      host: '127.0.0.1',
    },
  },
};
