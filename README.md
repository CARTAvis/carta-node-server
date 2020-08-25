# CARTA Server
[![carta version](https://img.shields.io/badge/CARTA%20Version-1.4.0--beta--1-orange)](https://github.com/CARTAvis/carta-backend/releases/tag/v1.4.0-beta.1)
[![npm version](http://img.shields.io/npm/v/carta-node-server.svg?style=flat)](https://npmjs.org/package/carta-node-server "View this project on npm")
![last commit](https://img.shields.io/github/last-commit/CARTAvis/carta-node-server)
![commit activity](https://img.shields.io/github/commit-activity/m/CARTAvis/carta-node-server)

## Introduction

The CARTA server provides a simple dashboard which authenticates users and allows them to manage their CARTA backend processes. It also serves static frontend code to clients, and dynamically redirects authenticated client connections to the appropriate backend processes. The server can either handle authentication itself, or delegate it to an external OAuth2-based authentication server.

## Dependencies

To allow the server to serve CARTA sessions, you must give it access to an executable CARTA backend, which can be either a compiled executable or a container. If you want to use a non-standard version of the CARTA frontend, you must also build it, and adjust the server configuration to point to it. You should use the `dev` branch of [`carta-backend`](https://github.com/CARTAvis/carta-backend).

By default, the server runs on port 8000. It should be run behind a proxy, so that it can be accessed via HTTP and HTTPS. 

MongoDB is required for storing user preferences, layouts and (in the near future) server metrics. You also need a working [NodeJS LTS](https://github.com/nvm-sh/nvm#long-term-support) installation with NPM. Use `npm install` to install all Node dependencies.

## Authentication support

The CARTA server supports three modes for authentication. All three modes use refresh and access tokens, as described in the [OAuth2 Authorization flow](https://tools.ietf.org/html/rfc6749#section-1.3.1), stored in [JWT](https://jwt.io/) format. The modes are:
- **LDAP-based authentication**: An existing LDAP server is used for user authentication. After the user's username and password configuration are validated by the LDAP server, `carta-node-server` returns a long-lived refresh token, signed with a private key, which can be exchanged by the CARTA dashboard or the CARTA frontend client for a short-lived access token.
- **Google authentication**: Google's authentication libraries are used for handling authentication. You must create a new web application in the [Google API console](https://console.developers.google.com/apis/credentials). You will then use the  client ID provided by this application in a number of places during the configuration.
- **External authentication**: This allows users to authenticate with some external OAuth2-based authentication system. This requires a fair amount of configuration, and has not been well-tested. It is assumed that the refresh token passed by the authentication system is stored as an `HttpOnly` cookie.

You can generate a private/public key pair in PEM format using `openssl`:
```shell script
openssl genrsa -out carta_private.pem 4096
openssl rsa -in carta_private.pem -outform PEM -pubout -out carta_public.pem
```

## Server Configuration
Server configuration is handled by a configuration file in JSON format, adhering to the [CARTA config schema](config/config_schema.json). Additional details can be found in the auto-generated [config documentation](docs/config_schema.html) or the [example config](config/example_config.json). By default, the server assumes the config file is located at `/etc/carta/config.json`, but you can change this with the `--config` or `-c` command line argument when running the server. 

For external authentication systems, you may need to translate a unique ID (such as email or username) from the authenticated user information to the system user. You can do this by providing a [user lookup table](config/usertable.txt.stub), which is watched by the server and reloaded whenever it is updated.

## System Configuration

The user under which the CARTA server is running (assumed to be `carta`) must be given permission to use `sudo` to start `carta_backend` processes as any authenticated user and stop running `carta_backend` processes belonging to authenticated users. We provide a [kill script](scripts/carta_kill_script.sh) which is only able to kill processes matching the name `carta_backend`. This makes it possible to restrict what processes the `carta` user is permitted to kill.

To provide the `carta` user with these privileges, you must make modifications to the [sudoers configuration](https://www.sudo.ws/man/1.9.0/sudoers.man.html). An [example sudoers config](config/example_sudoers_conf.stub) is provided. This example allows the `carta` user to run `carta_backend` only as users belonging to a specific group (assumed to be `carta-users`), in order to deny access to unauthorized accounts.

**Please only edit your sudoers configuration with `visudo` or equivalent.**

We strongly suggest serving over HTTPS and redirecting HTTP traffic to HTTPS, especially if handling authentication internally. If you use [nginx](https://www.nginx.com/) as a proxy, you can use [this configuration example](config/example_nginx.conf.stub) as a starting point to redirect incoming traffic from port 443 to port 8000.

You can also use other HTTP servers, such as Apache. Please ensure that they are set up to forward both standard HTTP requests and WebSocket traffic to the correct port.

By default, the server attempts to write log files to the `/var/log/carta` directory. Please ensure that this directory exists and that the `carta` user has write permission.

## Running the server

- Checkout and build [carta-backend](https://github.com/CARTAvis/carta-backend) using the `v1.4.0-beta.1` tag (or create the appropriate container). Detailed instructions for Ubuntu 20.04 are available [here](docs/ubuntu_focal_detailed_install.md).
- Edit the server configuration file at `/etc/carta/config.json`
- Perform system configuration:
    - Ensure `/var/log/carta` exists and is writeable by the appropriate user    
    - Adjust the sudoers configuration
    - Redirect traffic to port 8000

After you have built the backend and edited the server configuration, you can start the server with `npm run start` (if cloning from the git repository) or just running `carta-node-server` (if installing from NPM pacakge via `npm install -g carta-node-server`). You can use a utility such as [forever](https://github.com/foreversd/forever) or [pm2](https://pm2.keymetrics.io/) to keep the server running.

## Getting help

If you encounter a problem with the server or documentation, please submit an issue in this repo. If you need assistance in configuration or deployment, please contact the [CARTA helpdesk](mailto:carta_helpdesk@asiaa.sinica.edu.tw).

## TODO

Still to be implemented:
- Better error feedback
- More flexibility with external auth
