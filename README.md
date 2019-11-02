# Server Manager
These are the scripts I use to form a single log file, and handle when the file
gets rotated.

`Starter.js` streams all stdio and stderr to the logfile, and spawns
`Master.js`.

`Master.js` manages starting and stopping of server processes defined in
`servers.json`. A socket.io connection can be formed to perform start, stop,
restart, and get commands.  
`Master.js` does not have any built-in authentication, and only listens on the
loopback device. A proxy that authenticates requests is recommended.
